from contextlib import asynccontextmanager
import asyncio
from datetime import date, datetime
import json
import re
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx
from config import settings
from data_service import ChronoData
from feature_store import FeatureRegistry

async def _graph_sync_loop(app: FastAPI, driver):
    from neo4j_sync import sync_postgres_to_neo4j
    while True:
        try:
            counts = await asyncio.to_thread(sync_postgres_to_neo4j, settings.database_url,
                                             driver, settings.neo4j_database)
            sync_status = "syncing" if counts.get("pending_events", 0) else "ok"
            app.state.graph_sync.update({"status":sync_status, "last_sync_counts":counts,
                                         "last_error":None})
        except Exception as exc:
            # PostgreSQL remains the source of truth; the next cycle retries.
            app.state.graph_sync.update({"status":"retrying", "last_error":str(exc)[:500]})
        await asyncio.sleep(max(2, settings.graph_sync_interval_seconds))

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.database_url.strip():
        from postgres_store import PostgresFeatureRegistry
        registry = PostgresFeatureRegistry(settings.database_url)
    else:
        registry = FeatureRegistry(settings.feature_db_path)
    registry.seed_components(settings.data_dir / "issue_component.csv")
    app.state.features = registry
    app.state.data = ChronoData(settings.data_dir, settings.model_path, registry)
    app.state.history = None
    app.state.ingestion_result = {"enabled":False,"detail":"PostgreSQL is not configured."}
    if settings.database_url.strip():
        from history_store import HistoryStore
        app.state.history = HistoryStore(settings.database_url)
        app.state.ingestion_result = await asyncio.to_thread(app.state.history.ingest_dataset, app.state.data)
    app.state.graph_sync = {"enabled":bool(settings.database_url and settings.neo4j_uri),
                            "status":"disabled", "last_sync_counts":None, "last_error":None}
    driver = None
    sync_task = None
    if settings.database_url and settings.neo4j_uri:
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password))
        sync_task = asyncio.create_task(_graph_sync_loop(app, driver))
    try:
        yield
    finally:
        if sync_task:
            sync_task.cancel()
            try:
                await sync_task
            except asyncio.CancelledError:
                pass
        if driver:
            await asyncio.to_thread(driver.close)

app = FastAPI(title="ChronoDev AI API", version="0.3.0", lifespan=lifespan,
              description="Temporal product history, stable feature IDs, and evidence-grounded answers for Apache Axis2.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    max_evidence: int = Field(default=5, ge=1, le=12)

class FeatureResolveRequest(BaseModel):
    feature_name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)

class NewRecordRequest(BaseModel):
    source_type: str = Field(min_length=2, max_length=40)
    source_id: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=3, max_length=500)
    description: str = Field(default="", max_length=10000)
    occurred_at: datetime | None = None
    feature: str | None = Field(default=None, min_length=2, max_length=120)

class AliasRequest(BaseModel):
    alias_name: str = Field(min_length=1, max_length=120)
    valid_from: date | None = None
    valid_to: date | None = None
    source_ref: str = Field(default="", max_length=250)

class RelationRequest(BaseModel):
    from_entity: str = Field(min_length=1, max_length=40)
    to_entity: str = Field(min_length=1, max_length=40)
    relation_type: str = Field(pattern="^(depends_on|supersedes|replaces)$")
    source_ref: str = Field(default="", max_length=250)
    evidence_span: str = Field(default="", max_length=2000)
    confidence: float = Field(default=0.5, ge=0, le=1)

class BatchRecordRequest(BaseModel):
    records: list[NewRecordRequest] = Field(min_length=1, max_length=25)

@app.get("/health")
def health():
    return {"status":"ok", "dataset":"Apache Axis2", "ai":"local Ollama" if settings.use_ollama else "disabled",
            "storage":"postgresql" if settings.database_url else "sqlite"}

@app.get("/api/storage/status")
def storage_status():
    """Show configured stores and the last PostgreSQL-to-Neo4j sync result."""
    return {"primary_store":"postgresql" if settings.database_url else "sqlite",
            "neo4j_configured":bool(settings.neo4j_uri),
            "graph_sync":app.state.graph_sync,
            "dataset_ingestion":app.state.ingestion_result}

@app.get("/api/ai/status")
async def ai_status():
    """Check whether the configured Ollama server and model are ready."""
    if not settings.use_ollama:
        return {"enabled":False, "reachable":False, "model":settings.ollama_model, "ready":False,
                "detail":"Set USE_OLLAMA=true to enable local generation."}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{settings.ollama_url.rstrip('/')}/api/tags")
            response.raise_for_status()
        models = response.json().get("models", [])
        names = [m.get("name", "") for m in models]
        available = any(n == settings.ollama_model or n.split(":")[0] == settings.ollama_model.split(":")[0] for n in names)
        return {"enabled":True, "reachable":True, "model":settings.ollama_model, "ready":available,
                "installed_models":names,
                "detail":"Model is ready." if available else f"Pull the configured model: ollama pull {settings.ollama_model}"}
    except (httpx.HTTPError, ValueError):
        return {"enabled":True, "reachable":False, "model":settings.ollama_model, "ready":False,
                "detail":f"Cannot reach Ollama at {settings.ollama_url}. Start the Ollama app/service."}

@app.get("/api/features")
def list_features(limit: int = Query(default=100, ge=1, le=1000), offset: int = Query(default=0, ge=0)):
    return app.state.features.list_features(limit, offset)

@app.post("/api/features/resolve")
def resolve_feature(body: FeatureResolveRequest):
    """Reuse a sufficiently similar feature ID or append one new feature to the registry."""
    return app.state.features.resolve_feature(body.feature_name, body.description)

async def _extract_feature(record: NewRecordRequest):
    if record.feature and record.feature.strip():
        return record.feature.strip(), "provided"
    existing_features = [item["canonical_name"] for item in app.state.features.list_features(limit=1000)["items"]]
    context = (f"Existing feature names: {', '.join(existing_features)}\n"
               f"Record summary: {record.summary}\nRecord description: {record.description[:3000]}")
    if settings.use_ollama:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/generate",
                    json={"model":settings.ollama_model,
                          "system":"Extract one concise product capability or feature name (2 to 6 words). If the record describes an existing feature, return that feature's exact canonical name from the provided list. Otherwise return one new concise name. Return only the name. Do not include an issue ID, status, event date, explanation, or sentence.",
                          "prompt":context, "stream":False, "options":{"temperature":0}})
                response.raise_for_status()
                candidate = response.json().get("response", "").strip().splitlines()[0].strip(" \t\r\n\"'`*:-")
                candidate = re.sub(r"^(feature|capability)\s*:\s*", "", candidate, flags=re.I).strip()
                if 2 <= len(candidate) <= 120:
                    return candidate, "ollama"
        except (httpx.HTTPError, ValueError, IndexError):
            pass
    return record.summary.strip(), "summary_fallback"

async def _extract_events(record: NewRecordRequest):
    """Ask the local model for evidence-grounded lifecycle events in strict JSON."""
    if not settings.use_ollama:
        return []
    schema = {"type":"object","properties":{"events":{"type":"array","items":{
        "type":"object","properties":{"entity":{"type":"string"},"event_type":{"type":"string"},
        "date":{"type":"string"},"summary":{"type":"string"},"aim_objective":{"type":"string"},
        "evidence":{"type":"string"},"alias_hint":{"type":"string"},"confidence":{"type":"number"}},
        "required":["entity","event_type","date","summary","aim_objective","evidence","alias_hint","confidence"],
        "additionalProperties":False}}},"required":["events"],"additionalProperties":False}
    prompt = (f"Source type: {record.source_type}\nSource ID: {record.source_id}\n"
              f"Document event date (if explicitly supplied): {record.occurred_at.isoformat() if record.occurred_at else 'not supplied'}\n"
              f"Source text:\n{record.summary}\n{record.description[:7000]}")
    system = ("Extract up to 5 product lifecycle events from this one source record. Allowed event_type values: "
              "introduced, modified, renamed, removed, proposed, approved, implemented, rejected. "
              "Return an empty events array when evidence is insufficient. The date must be explicit in the source "
              "text or equal the supplied document event date; never use today's date. Evidence must be an exact "
              "contiguous quote copied from the source text. Do not infer approvals or implementations from a ticket "
              "being closed. Keep summary and aim_objective concise. alias_hint is the old name only for an explicit rename; otherwise empty.")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/generate",
                json={"model":settings.ollama_model,"system":system,"prompt":prompt,
                      "format":schema,"stream":False,"options":{"temperature":0}})
            response.raise_for_status()
        parsed = json.loads(response.json().get("response", "{}"))
        return parsed.get("events", []) if isinstance(parsed, dict) else []
    except (httpx.HTTPError, ValueError, TypeError):
        return []

async def _save_record(body: NewRecordRequest):
    feature_name, extraction_mode = await _extract_feature(body)
    try:
        stored = app.state.features.insert_record(
            source_type=body.source_type, source_id=body.source_id,
            summary=body.summary, description=body.description,
            occurred_at=body.occurred_at.isoformat() if body.occurred_at else None,
            feature_name=feature_name)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    stored["feature_extraction"] = extraction_mode
    if app.state.history and not stored.get("duplicate"):
        extracted = await _extract_events(body)
        if extracted:
            def resolve_event_entity(name, evidence, event_date):
                alias = app.state.history.resolve_alias(name, event_date)
                if alias:
                    return alias
                return app.state.features.resolve_feature(name, evidence, "event_extraction")
            stored["event_ids"] = await asyncio.to_thread(app.state.history.append_extracted_events,
                stored, extracted, resolve_event_entity)
        else:
            event_id = await asyncio.to_thread(app.state.history.append_record_event, stored)
            stored["event_ids"] = [event_id] if event_id else []
    return stored

@app.post("/api/records")
async def insert_record(body: NewRecordRequest):
    """Append a record, extract/reuse a feature ID, and deduplicate repeats."""
    return await _save_record(body)

@app.post("/api/records/batch")
async def insert_record_batch(body: BatchRecordRequest):
    """Process a small second batch through the same dedupe and evidence pipeline."""
    results = []
    for record in body.records:
        try:
            results.append(await _save_record(record))
        except HTTPException as exc:
            results.append({"source_id":record.source_id,"error":exc.detail})
    return {"submitted":len(body.records),
            "created":sum(1 for item in results if not item.get("duplicate") and not item.get("error")),
            "duplicates":sum(1 for item in results if item.get("duplicate")),
            "failed":sum(1 for item in results if item.get("error")),"items":results}

@app.get("/api/records")
def list_records(limit: int = Query(default=100, ge=1, le=1000), offset: int = Query(default=0, ge=0)):
    return app.state.features.list_records(limit, offset)

@app.get("/api/history/timeline")
def project_history_timeline(start_date: date | None = None, end_date: date | None = None,
                             limit: int = Query(default=500, ge=1, le=2000),
                             offset: int = Query(default=0, ge=0)):
    """Project-wide chronology; its event dates are read from source records."""
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "start_date must be on or before end_date")
    if app.state.history:
        result = app.state.history.list_events(start_date=start_date, end_date=end_date,
                                               limit=limit, offset=offset)
        events = []
        for row in result["items"]:
            event = row.get("event_payload", row)
            if isinstance(event, str):
                event = json.loads(event)
            event = dict(event)
            event.update({"event_id":row["event_id"], "evidence_span":row["evidence_span"],
                          "source_refs":row["source_refs"], "confidence":row["confidence"],
                          "inferred":row["inferred"]})
            events.append(event)
        return {"start_date":str(start_date) if start_date else None,
                "end_date":str(end_date) if end_date else None,
                "total_events":result["total"],
                "events":events,
                "limit":limit,"offset":offset}
    return app.state.data.project_timeline(start_date.isoformat() if start_date else None,
        end_date.isoformat() if end_date else None, limit, offset)

@app.get("/api/history/search")
def search_history(q: str = Query(min_length=1), start_date: date | None = None,
                   end_date: date | None = None, limit: int = Query(default=20, ge=1, le=100),
                   offset: int = Query(default=0, ge=0)):
    """Search the dataset-derived historical events; dates are optional filters."""
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "start_date must be on or before end_date")
    if app.state.history:
        return app.state.history.search_events(q, start_date=start_date, end_date=end_date,
                                               limit=limit, offset=offset)
    return app.state.data.search_history(q, limit, offset,
        start_date.isoformat() if start_date else None, end_date.isoformat() if end_date else None)

@app.get("/api/events")
def list_historical_events(start_date: date | None = None, end_date: date | None = None,
                           entity_id: str | None = None, event_type: str | None = None,
                           limit: int = Query(default=100, ge=1, le=1000),
                           offset: int = Query(default=0, ge=0)):
    if not app.state.history:
        raise HTTPException(503, "Historical event storage requires DATABASE_URL.")
    return app.state.history.list_events(start_date=start_date, end_date=end_date,
        entity_id=entity_id, event_type=event_type, limit=limit, offset=offset)

@app.get("/api/entities")
def list_entities(limit: int = Query(default=500, ge=1, le=1000)):
    if not app.state.history:
        raise HTTPException(503, "Entity storage requires DATABASE_URL.")
    return {"items":app.state.history.entities(limit)}

@app.get("/api/source-records/{source_type}/{source_id}")
def get_source_record(source_type: str, source_id: str):
    if not app.state.history:
        raise HTTPException(503, "Source records require DATABASE_URL.")
    row = app.state.history.source_artifact(source_type, source_id)
    if not row:
        raise HTTPException(404, "Source record not found")
    return row

@app.get("/api/graph")
def feature_graph(limit: int = Query(default=1000, ge=1, le=5000)):
    if not app.state.history:
        raise HTTPException(503, "Graph view requires DATABASE_URL.")
    return app.state.history.graph(limit)

@app.get("/api/flags")
def list_history_flags(limit: int = Query(default=500, ge=1, le=1000)):
    if not app.state.history:
        raise HTTPException(503, "History flags require DATABASE_URL.")
    return {"items":app.state.history.flags(limit)}

@app.post("/api/entities/{entity_id}/aliases")
def add_entity_alias(entity_id: str, body: AliasRequest):
    if not app.state.history:
        raise HTTPException(503, "Alias storage requires DATABASE_URL.")
    if body.valid_from and body.valid_to and body.valid_from > body.valid_to:
        raise HTTPException(422, "valid_from must be on or before valid_to")
    valid_ids = {item["feature_id"] for item in app.state.features.list_features(limit=1000)["items"]}
    if entity_id not in valid_ids:
        raise HTTPException(404, "Entity not found")
    return app.state.history.add_alias(entity_id, body.alias_name, body.valid_from,
                                       body.valid_to, body.source_ref)

@app.post("/api/relations")
def add_entity_relation(body: RelationRequest):
    if not app.state.history:
        raise HTTPException(503, "Relation storage requires DATABASE_URL.")
    valid_ids = {item["feature_id"] for item in app.state.features.list_features(limit=1000)["items"]}
    if body.from_entity not in valid_ids or body.to_entity not in valid_ids:
        raise HTTPException(404, "Both entities must exist")
    if body.from_entity == body.to_entity:
        raise HTTPException(422, "An entity cannot be related to itself")
    return app.state.history.add_relation(body.from_entity, body.to_entity, body.relation_type,
        body.source_ref, body.evidence_span, body.confidence)

@app.get("/api/history/as-of")
def history_as_of(as_of: date, entity_id: str | None = None,
                  limit: int = Query(default=500, ge=1, le=1000)):
    if not app.state.history:
        raise HTTPException(503, "As-of history requires DATABASE_URL.")
    result = app.state.history.list_events(end_date=as_of, entity_id=entity_id,
                                           event_type="implemented", limit=limit)
    implemented = [row.get("event_payload", row) for row in result["items"]]
    return {"as_of":as_of.isoformat(),"implemented_count":len(implemented),"items":implemented[:limit],
            "note":"Only events explicitly extracted as implemented are included; inferred status remains marked in each event."}

@app.get("/api/issues/search")
def search_issues(q: str = Query(min_length=1), limit: int = Query(default=10, ge=1, le=50)):
    return {"items":app.state.data.search_issues(q, limit)}

@app.get("/api/issues/{issue_id}/timeline")
def timeline(issue_id: str):
    try:
        return app.state.data.timeline(issue_id.upper())
    except KeyError:
        raise HTTPException(404, "Issue not found")

@app.get("/api/issues/{issue_id}/links")
def issue_links(issue_id: str):
    key, data = issue_id.upper(), app.state.data
    if key not in data.issue_by_id:
        raise HTTPException(404, "Issue not found")
    commits = [data.commit_by_hash[row["commit_hash"]] for row in data.links
               if row.get("issue_id") == key and row.get("commit_hash") in data.commit_by_hash]
    commits.sort(key=lambda row: row.get("committed_date", ""))
    return {"issue_id":key, "items":[{"commit_hash":r.get("commit_hash"),
            "date":data._date(r.get("committed_date")), "author":r.get("author", ""),
            "message":r.get("message_clean", "")} for r in commits]}

def _answer_reference(item: dict) -> str:
    kind = item.get("kind", "source")
    if kind == "history_event":
        identifier = item.get("event_id") or item.get("id")
        return f"[event:{identifier}]" if identifier else "[event]"
    if kind in {"issue", "issue_comment"}:
        identifier = item.get("issue_id")
        return f"[issue:{identifier}]" if identifier else "[issue]"
    if kind == "commit":
        identifier = item.get("commit_hash")
        return f"[commit:{identifier}]" if identifier else "[commit]"
    identifier = item.get("event_id") or item.get("issue_id") or item.get("commit_hash")
    return f"[source:{identifier}]" if identifier else "[source]"


def _short_evidence_text(item: dict, max_chars: int = 220) -> str:
    payload = item.get("event") if isinstance(item.get("event"), dict) else {}
    value = (item.get("summary") or payload.get("event") or item.get("message")
             or item.get("text") or item.get("evidence_span") or payload.get("aim_objective") or "")
    value = " ".join(str(value).split())
    return value if len(value) <= max_chars else value[:max_chars - 1].rsplit(" ", 1)[0] + "…"


def _compact_evidence_for_model(evidence: list[dict]) -> list[dict]:
    compact = []
    for item in evidence[:8]:
        kind = item.get("kind", "source")
        row = {"kind":kind, "citation":_answer_reference(item)}
        payload = item.get("event") if isinstance(item.get("event"), dict) else {}
        if kind == "history_event":
            row.update({"date":item.get("date"), "feature":payload.get("feature"),
                        "event_type":item.get("event_type"), "summary":_short_evidence_text(item),
                        "objective":payload.get("aim_objective") or item.get("aim_objective"),
                        "evidence_quote":str(item.get("evidence_span") or "")[:240]})
        elif kind == "issue_comment":
            row.update({"issue_id":item.get("issue_id"), "author":item.get("author"),
                        "date":item.get("date"), "comment":_short_evidence_text(item, 300)})
        elif kind == "issue":
            row.update({key:item.get(key) for key in ("issue_id", "summary", "status", "created_at", "resolved_at") if item.get(key) is not None})
        elif kind == "commit":
            row.update({key:item.get(key) for key in ("commit_hash", "date", "author") if item.get(key) is not None})
            row["message"] = _short_evidence_text(item, 300)
        else:
            row["summary"] = _short_evidence_text(item, 300)
        compact.append(row)
    return compact


def _format_retrieval_fallback(evidence: list[dict], ai_status: str) -> str:
    lines = ["I couldn’t generate an AI summary, but I found these matching records:"]
    for item in evidence[:5]:
        date_value = item.get("date") or item.get("event_date")
        if hasattr(date_value, "isoformat"):
            date_value = date_value.isoformat()
        date_label = str(date_value)[:10] if date_value else "Date not recorded"
        feature = item.get("event", {}).get("feature") if isinstance(item.get("event"), dict) else None
        detail = _short_evidence_text(item)
        label = f" — {feature}" if feature else ""
        lines.append(f"- {date_label}{label}: {detail or 'No short summary available.'} {_answer_reference(item)}")
    if ai_status != "disabled":
        lines.append(f"\nAI status: {ai_status.replace('_', ' ')}.")
    return "\n".join(lines)


@app.post("/api/ask")
async def ask(body: AskRequest):
    issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", body.question.upper())
    if issue_match:
        issue_id = issue_match.group(1)
        try:
            issue_history = app.state.data.timeline(issue_id)
        except KeyError:
            issue_history = None
        if issue_history:
            issue = issue_history["issue"]
            evidence = [{"kind":"issue", **issue}]
            comments = []
            for event in issue_history["events"]:
                for source in event.get("evidence", []):
                    if source.get("type") == "issue_comment":
                        comment = {"kind":"issue_comment", "issue_id":issue_id,
                                   "author":source.get("author", ""),
                                   "text":source.get("text", ""), "date":event.get("date")}
                        if comment["text"] and comment not in comments:
                            comments.append(comment)
            evidence.extend(comments[:body.max_evidence-1])
            answer_lines = [f"Answer: [issue:{issue_id}] {issue['summary']}.",
                            f"Status: recorded as {issue['status']} in the dataset."]
            if comments:
                answer_lines.append("Discussion:")
                answer_lines.extend(
                    f"- {item['author']}: {_short_evidence_text({'text': item['text']}, 260)} [issue:{issue_id}]"
                    for item in comments[:2])
            if not issue.get("created_at") and not issue.get("resolved_at"):
                answer_lines.append("Dates: creation and resolution dates are not recorded for this issue.")
            return {"answer":"\n".join(answer_lines), "evidence":evidence, "mode":"issue_lookup"}
    if app.state.history:
        hits = app.state.history.search_events(body.question, limit=body.max_evidence)["events"]
        evidence = [{"kind":"history_event","event_id":row["event_id"],
            "date":row["event_date"].isoformat(),"event_type":row["event_type"],
            "summary":row["summary"],"feature_ids":row["feature_ids"],
            "evidence_span":row["evidence_span"],"source_refs":row["source_refs"],
            "confidence":row["confidence"],"inferred":row["inferred"],
            "event":row["event_payload"]} for row in hits]
        if not evidence:
            evidence = app.state.data.evidence(body.question, body.max_evidence)
    else:
        evidence = app.state.data.evidence(body.question, body.max_evidence)
    if not evidence:
        return {"answer":"I could not find matching records in this dataset.", "evidence":[], "mode":"retrieval"}
    ai_status = "disabled" if not settings.use_ollama else "unavailable"
    if settings.use_ollama:
        system = ("You are ChronoDev, a concise historical product-record assistant. Use only the supplied evidence. "
                  "Write a readable answer in this exact format: 'Answer:' followed by 1-3 short sentences; then "
                  "'Timeline:' followed by dated bullets only when dates are present; then 'Evidence:' followed by "
                  "at most 3 short bullets. Put one point per line. Keep the whole answer under 180 words. "
                  "Do not paste long source comments or repeat the same detail. Summarize comments in your own words. "
                  "Cite issues as [issue:ID], commits as [commit:HASH], and history events using the supplied "
                  "citation exactly (for example [event:abc123]); never write a citation with None or a missing ID. "
                  "Say status as recorded in the dataset, not as current. Never invent dates, causes, links, or fixes. "
                  "If evidence does not support a detail, say 'Not recorded in the supplied evidence.'")
        compact_evidence = _compact_evidence_for_model(evidence)
        prompt = f"Question: {body.question}\n\nRelevant evidence (already shortened):\n{json.dumps(compact_evidence, ensure_ascii=False)}"
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/generate",
                    json={"model":settings.ollama_model, "system":system, "prompt":prompt,
                          "stream":False, "keep_alive":"5m", "options":{"temperature":0, "num_predict":360}})
                response.raise_for_status()
                answer = response.json().get("response", "").strip()
                if answer:
                    return {"answer":answer, "evidence":evidence, "mode":"ollama", "model":settings.ollama_model}
                ai_status = "empty_response"
        except httpx.TimeoutException:
            ai_status = "timeout"
        except httpx.HTTPStatusError as exc:
            ai_status = "model_missing" if exc.response.status_code == 404 else "request_failed"
        except (httpx.HTTPError, ValueError):
            ai_status = "unavailable"
    return {"answer":_format_retrieval_fallback(evidence, ai_status),
            "evidence":evidence, "mode":"retrieval_fallback", "ai_status":ai_status}
