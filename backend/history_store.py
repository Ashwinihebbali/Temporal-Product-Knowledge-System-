"""Append-only historical events and source snapshots in PostgreSQL."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date

import psycopg
from psycopg.rows import dict_row


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS source_artifacts (
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, event_date DATE,
        summary TEXT NOT NULL DEFAULT '', payload JSONB NOT NULL, ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(source_type, source_id))""",
    "ALTER TABLE source_artifacts ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    """CREATE TABLE IF NOT EXISTS history_events (
        event_id TEXT PRIMARY KEY, entity_id TEXT REFERENCES features(feature_id),
        record_id BIGINT REFERENCES records(record_id),
        event_type TEXT NOT NULL, event_date DATE NOT NULL, summary TEXT NOT NULL,
        aim_objective TEXT NOT NULL DEFAULT '', objective_basis TEXT NOT NULL DEFAULT '',
        evidence_span TEXT NOT NULL DEFAULT '', source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        feature_ids JSONB NOT NULL DEFAULT '[]'::jsonb, confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
        inferred BOOLEAN NOT NULL DEFAULT FALSE, event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(), neo4j_synced_at TIMESTAMPTZ)""",
    "ALTER TABLE history_events ADD COLUMN IF NOT EXISTS record_id BIGINT REFERENCES records(record_id)",
    "CREATE INDEX IF NOT EXISTS idx_history_events_date ON history_events(event_date, event_type)",
    """CREATE TABLE IF NOT EXISTS history_event_sync_state (
        event_id TEXT PRIMARY KEY REFERENCES history_events(event_id), synced_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE OR REPLACE FUNCTION chronodev_history_events_immutable() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'history_events is append-only'; END; $$ LANGUAGE plpgsql""",
    """DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='history_events_immutable') THEN
        CREATE TRIGGER history_events_immutable BEFORE UPDATE OR DELETE ON history_events
        FOR EACH ROW EXECUTE FUNCTION chronodev_history_events_immutable(); END IF; END $$""",
    """CREATE TABLE IF NOT EXISTS entity_aliases (
        alias_id BIGSERIAL PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES features(feature_id),
        alias_name TEXT NOT NULL, valid_from DATE, valid_to DATE,
        source_ref TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(entity_id, alias_name, valid_from))""",
    """CREATE TABLE IF NOT EXISTS entity_relations (
        relation_id BIGSERIAL PRIMARY KEY, from_entity TEXT NOT NULL REFERENCES features(feature_id),
        to_entity TEXT NOT NULL REFERENCES features(feature_id), relation_type TEXT NOT NULL,
        source_ref TEXT NOT NULL DEFAULT '', evidence_span TEXT NOT NULL DEFAULT '',
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(from_entity, to_entity, relation_type, source_ref))""",
    """CREATE TABLE IF NOT EXISTS history_flags (
        flag_id BIGSERIAL PRIMARY KEY, entity_id TEXT REFERENCES features(feature_id),
        flag_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'review', message TEXT NOT NULL,
        source_refs JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(flag_type, entity_id, message))""",
    """CREATE TABLE IF NOT EXISTS dataset_ingestion_state (
        dataset_name TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, ingested_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
]


class HistoryStore:
    def __init__(self, database_url: str):
        self.database_url = database_url
        with self._connect() as db:
            for statement in SCHEMA:
                db.execute(statement)

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row)

    @staticmethod
    def _date(value):
        value = str(value or "")[:10]
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            return None

    @staticmethod
    def _stable_id(*parts):
        return hashlib.sha256("\x1f".join(str(x or "") for x in parts).encode("utf-8")).hexdigest()

    def ingest_dataset(self, data):
        """Persist all cleaned CSV source rows and generated dated history events once per source revision."""
        files = sorted(data.data_dir.glob("*.csv"))
        fingerprint = self._stable_id(*[(p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in files])
        with self._connect() as db:
            state = db.execute("SELECT fingerprint FROM dataset_ingestion_state WHERE dataset_name='axis2'").fetchone()
            if state and state["fingerprint"] == fingerprint:
                return {"skipped":True, "reason":"dataset unchanged"}

        artifacts = []
        def add_rows(kind, rows, key_fn, date_fn, summary_fn):
            for row in rows:
                source_id = str(key_fn(row) or "").strip()
                if not source_id:
                    source_id = self._stable_id(kind, json.dumps(row, sort_keys=True, ensure_ascii=False))
                artifacts.append((kind, source_id, self._date(date_fn(row)),
                                  str(summary_fn(row) or "")[:2000],
                                  json.dumps(row, ensure_ascii=False, default=str)))

        add_rows("issue", data.issues, lambda r:r.get("issue_id"), lambda r:r.get("created_date"), lambda r:r.get("summary_clean"))
        add_rows("commit", data.commits, lambda r:r.get("commit_hash"), lambda r:r.get("committed_date"), lambda r:r.get("message_clean"))
        add_rows("comment", data.comments, lambda r:self._stable_id(r.get("issue_id"),r.get("username"),r.get("created_date"),r.get("message_clean")), lambda r:r.get("created_date"), lambda r:r.get("message_clean"))
        add_rows("code_change", data.changes, lambda r:self._stable_id(r.get("commit_hash"),r.get("file_path"),r.get("old_file_path"),r.get("change_type")), lambda r:data.commit_by_hash.get(r.get("commit_hash"),{}).get("committed_date"), lambda r:r.get("file_path"))
        add_rows("component", data.components, lambda r:f"{r.get('issue_id','')}:{r.get('component','')}", lambda r:data.issue_by_id.get(r.get("issue_id"),{}).get("created_date"), lambda r:r.get("component"))
        add_rows("issue_commit_link", data.links, lambda r:f"{r.get('issue_id','')}:{r.get('commit_hash','')}", lambda r:data.commit_by_hash.get(r.get("commit_hash"),{}).get("committed_date"), lambda r:r.get("issue_id"))

        # Materialize the established source timeline, retaining its original evidence and inference notes.
        timeline = data.project_timeline(limit=1_000_000, offset=0)["events"]
        event_rows = []
        for event in timeline:
            event_date = self._date(event.get("date"))
            if not event_date:
                continue
            feature_ids = list(dict.fromkeys(event.get("feature_ids", []) or ([event["feature_id"]] if event.get("feature_id") else [])))
            evidence = event.get("event", "")
            refs = event.get("evidence", [])
            if event.get("issue_ids"):
                refs = list(refs) + [{"type":"issue", "id":x} for x in event["issue_ids"]]
            if event.get("commit_hash"):
                refs = list(refs) + [{"type":"commit", "id":event["commit_hash"]}]
            event_id = self._stable_id(event_date, event.get("event_type"), event.get("event"), feature_ids, refs)
            basis = event.get("objective_basis", "not recorded")
            confidence = 0.85 if event.get("objective_confidence") != "unknown" else 0.2
            if "inferred" in basis:
                confidence = min(confidence, 0.65)
            event_rows.append((event_id, feature_ids[0] if feature_ids else None,
                event.get("event_type", "historical_event"), event_date,
                str(event.get("event", ""))[:2000], str(event.get("aim_objective", ""))[:2000],
                basis, str(evidence)[:5000], json.dumps(refs, ensure_ascii=False, default=str),
                json.dumps(feature_ids), confidence, event.get("objective_confidence") == "inferred",
                json.dumps(event, ensure_ascii=False, default=str)))

        with self._connect() as db:
            cur = db.cursor()
            for start in range(0, len(artifacts), 1000):
                cur.executemany("""INSERT INTO source_artifacts(source_type,source_id,event_date,summary,payload)
                    VALUES(%s,%s,%s,%s,%s::jsonb) ON CONFLICT(source_type,source_id) DO UPDATE
                    SET event_date=EXCLUDED.event_date,summary=EXCLUDED.summary,payload=EXCLUDED.payload""",
                    artifacts[start:start+1000])
            for start in range(0, len(event_rows), 1000):
                cur.executemany("""INSERT INTO history_events(event_id,entity_id,event_type,event_date,summary,
                    aim_objective,objective_basis,evidence_span,source_refs,feature_ids,confidence,inferred,event_payload)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s::jsonb)
                    ON CONFLICT(event_id) DO NOTHING""", event_rows[start:start+1000])
            db.execute("""INSERT INTO dataset_ingestion_state(dataset_name,fingerprint) VALUES('axis2',%s)
                ON CONFLICT(dataset_name) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,ingested_at=now()""", (fingerprint,))
        return {"skipped":False, "source_artifacts":len(artifacts), "events_added":len(event_rows)}

    def append_record_event(self, record: dict):
        if not record.get("occurred_at"):
            return None
        event_date = self._date(record["occurred_at"])
        if not event_date:
            return None
        refs = [{"type":record["source_type"], "id":record["source_id"]}]
        event_id = self._stable_id("record_added", event_date, record.get("record_id"), record.get("summary"))
        event = {"date":event_date, "event_type":"record_added", "event":record.get("summary", ""),
                 "feature":record.get("feature", ""), "feature_id":record.get("feature_id"),
                 "feature_ids":[record["feature_id"]], "aim_objective":"Address: " + record.get("summary", ""),
                 "objective_basis":"inferred from inserted record summary", "objective_confidence":"inferred",
                 "evidence":[{"type":record["source_type"], "id":record["source_id"]}]}
        with self._connect() as db:
                db.execute("""INSERT INTO history_events(event_id,entity_id,record_id,event_type,event_date,summary,aim_objective,
                objective_basis,evidence_span,source_refs,feature_ids,confidence,inferred,event_payload)
                    VALUES(%s,%s,%s,'record_added',%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,0.6,TRUE,%s::jsonb)
                    ON CONFLICT(event_id) DO NOTHING""", (event_id, record["feature_id"],record.get("record_id"),event_date,
                record.get("summary", ""), event["aim_objective"], event["objective_basis"],
                record.get("summary", ""), json.dumps(refs), json.dumps([record["feature_id"]]), json.dumps(event)))
        return event_id

    def append_extracted_events(self, record: dict, extracted: list[dict], feature_resolver):
        """Append only validated Ollama events; every evidence span must occur verbatim in source text."""
        allowed = {"introduced","modified","renamed","removed","proposed","approved","implemented","rejected"}
        source_text = (record.get("summary", "") + "\n" + record.get("description", "")).strip()
        saved = []
        for item in extracted:
            event_type = str(item.get("event_type", "")).lower()
            evidence = str(item.get("evidence", "")).strip()
            name = str(item.get("entity", "")).strip()
            event_date = self._date(item.get("date"))
            if event_type not in allowed or not event_date or not evidence or evidence not in source_text or not name:
                continue
            date_is_supported = event_date == self._date(record.get("occurred_at")) or event_date in source_text
            if not date_is_supported:
                continue
            entity = feature_resolver(name, evidence, event_date)
            feature_id = entity["feature_id"]
            confidence = max(0.0, min(1.0, float(item.get("confidence", 0.5))))
            refs = [{"type":record["source_type"], "id":record["source_id"]}]
            event_id = self._stable_id(record.get("source_type"),record.get("source_id"),event_type,event_date,name,evidence)
            event = {"date":event_date,"event_type":event_type,"event":str(item.get("summary", ""))[:2000],
                     "feature":entity.get("feature",name),"feature_id":feature_id,"feature_ids":[feature_id],
                     "aim_objective":str(item.get("aim_objective", ""))[:2000],
                     "objective_basis":"extracted from source record; evidence validated",
                     "objective_confidence":"inferred","evidence":[{"type":record["source_type"],"id":record["source_id"],"span":evidence}]}
            with self._connect() as db:
                db.execute("""INSERT INTO history_events(event_id,entity_id,record_id,event_type,event_date,summary,aim_objective,
                    objective_basis,evidence_span,source_refs,feature_ids,confidence,inferred,event_payload)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,TRUE,%s::jsonb)
                    ON CONFLICT(event_id) DO NOTHING""", (event_id,feature_id,record.get("record_id"),event_type,event_date,
                    event["event"],event["aim_objective"],event["objective_basis"],evidence,
                    json.dumps(refs),json.dumps([feature_id]),confidence,json.dumps(event)))
                alias = str(item.get("alias_hint", "")).strip()
                if event_type == "renamed" and alias and alias.lower() != name.lower():
                    db.execute("""INSERT INTO entity_aliases(entity_id,alias_name,valid_to,source_ref)
                        VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (feature_id,alias,event_date,f"{record['source_type']}:{record['source_id']}"))
            saved.append(event_id)
            self.create_flags_for_events(feature_id)
        return saved

    def list_events(self, *, start_date=None, end_date=None, entity_id=None, event_type=None, limit=500, offset=0):
        clauses, params = [], []
        for column, value, op in (("event_date",start_date,">="),("event_date",end_date,"<="),
                                  ("entity_id",entity_id,"="),("event_type",event_type,"=")):
            if value is not None:
                clauses.append(f"{column}{op}%s")
                params.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self._connect() as db:
            total = db.execute("SELECT count(*) AS n FROM history_events"+where, params).fetchone()["n"]
            rows = db.execute("SELECT * FROM history_events"+where+" ORDER BY event_date,event_id LIMIT %s OFFSET %s",
                              params+[limit, offset]).fetchall()
        items = [dict(row) for row in rows]
        for item in items:
            for key in ("source_refs","feature_ids","event_payload"):
                if isinstance(item.get(key), str):
                    item[key] = json.loads(item[key])
        return {"total":total,"limit":limit,"offset":offset,"items":items}

    def search_events(self, query: str, *, start_date=None, end_date=None, limit=100, offset=0):
        stopwords = {"what","when","where","who","why","how","did","does","was","were","the","a","an","is","are","for","to","of","in","on","about","and","or","with","from","it","this","that","changed","happen","happened"}
        terms = list(dict.fromkeys(t for t in re.findall(r"[a-z0-9-]+", query.lower()) if len(t)>1 and t not in stopwords))
        if not terms:
            return {"query":query,"total_events":0,"events":[],"limit":limit,"offset":offset}
        text_expr = "concat_ws(' ',summary,aim_objective,evidence_span,event_payload::text)"
        score_expr = " + ".join(f"CASE WHEN {text_expr} ILIKE %s THEN 1 ELSE 0 END" for _ in terms)
        text_filter = "(" + " OR ".join(f"{text_expr} ILIKE %s" for _ in terms) + ")"
        clauses = [text_filter]
        patterns = ["%"+term+"%" for term in terms]
        params = patterns
        if start_date:
            clauses.append("event_date >= %s"); params.append(start_date)
        if end_date:
            clauses.append("event_date <= %s"); params.append(end_date)
        where = " WHERE " + " AND ".join(clauses)
        with self._connect() as db:
            total = db.execute("SELECT count(*) AS n FROM history_events"+where, params).fetchone()["n"]
            rows = db.execute(f"SELECT *,({score_expr}) AS relevance_score FROM history_events"+where+
                              " ORDER BY relevance_score DESC,event_date DESC LIMIT %s OFFSET %s",
                              patterns+params+[limit, offset]).fetchall()
        items = [dict(row) for row in rows]
        for item in items:
            for key in ("source_refs","feature_ids","event_payload"):
                if isinstance(item.get(key), str):
                    item[key] = json.loads(item[key])
        return {"query":query,"total_events":total,"events":items,"limit":limit,"offset":offset}

    def entities(self, limit=500):
        with self._connect() as db:
            rows = db.execute("""SELECT f.feature_id AS entity_id,f.canonical_name AS name,'feature' AS type,
                f.description,COALESCE(json_agg(json_build_object('name',a.alias_name,'valid_from',a.valid_from,'valid_to',a.valid_to))
                FILTER(WHERE a.alias_id IS NOT NULL),'[]') AS aliases FROM features f LEFT JOIN entity_aliases a
                ON a.entity_id=f.feature_id GROUP BY f.feature_id ORDER BY f.feature_id LIMIT %s""", (limit,)).fetchall()
        return rows

    def source_artifact(self, source_type: str, source_id: str):
        with self._connect() as db:
            row = db.execute("SELECT source_type,source_id,event_date,summary,payload FROM source_artifacts WHERE source_type=%s AND source_id=%s",
                             (source_type,source_id)).fetchone()
        if not row:
            return None
        if isinstance(row["payload"],str):
            row["payload"] = json.loads(row["payload"])
        return row

    def graph(self, limit=1000):
        with self._connect() as db:
            rows = db.execute("""SELECT f.feature_id,f.canonical_name,a.source_type,a.source_id FROM feature_assignments a
                JOIN features f ON f.feature_id=a.feature_id ORDER BY a.source_type,a.source_id LIMIT %s""", (limit,)).fetchall()
            entity_relations = db.execute("SELECT relation_id,from_entity,to_entity,relation_type FROM entity_relations").fetchall()
            aliases = db.execute("SELECT alias_id,entity_id,alias_name FROM entity_aliases").fetchall()
        nodes, edges, seen = [], [], set()
        for row in rows:
            feature_key = "feature:"+row["feature_id"]
            source_key = row["source_type"]+":"+row["source_id"]
            if feature_key not in seen:
                nodes.append({"data":{"id":feature_key,"label":row["canonical_name"],"kind":"feature"}})
                seen.add(feature_key)
            if source_key not in seen:
                nodes.append({"data":{"id":source_key,"label":row["source_id"],"kind":row["source_type"]}})
                seen.add(source_key)
            edges.append({"data":{"id":source_key+"->"+feature_key,"source":source_key,"target":feature_key,"label":"HAS_FEATURE"}})
        for row in entity_relations:
            from_key, to_key = "feature:"+row["from_entity"], "feature:"+row["to_entity"]
            for key in (from_key,to_key):
                if key not in seen:
                    feature_id = key.split(":",1)[1]
                    feature = self._feature_label(feature_id)
                    nodes.append({"data":{"id":key,"label":feature or feature_id,"kind":"feature"}})
                    seen.add(key)
            edges.append({"data":{"id":"relation:"+str(row["relation_id"]),"source":from_key,
                                  "target":to_key,"label":row["relation_type"]}})
        for row in aliases:
            feature_key, alias_key = "feature:"+row["entity_id"], "alias:"+str(row["alias_id"])
            nodes.append({"data":{"id":alias_key,"label":row["alias_name"],"kind":"alias"}})
            edges.append({"data":{"id":"alias-link:"+str(row["alias_id"]),"source":feature_key,
                                  "target":alias_key,"label":"ALIAS"}})
        return {"nodes":nodes,"edges":edges,"total_links":len(edges)}

    def _feature_label(self, feature_id):
        with self._connect() as db:
            row = db.execute("SELECT canonical_name FROM features WHERE feature_id=%s", (feature_id,)).fetchone()
        return row["canonical_name"] if row else None

    def flags(self, limit=500):
        with self._connect() as db:
            return db.execute("SELECT * FROM history_flags ORDER BY created_at DESC LIMIT %s", (limit,)).fetchall()

    def add_alias(self, entity_id: str, alias_name: str, valid_from=None, valid_to=None, source_ref=""):
        with self._connect() as db:
            row = db.execute("""INSERT INTO entity_aliases(entity_id,alias_name,valid_from,valid_to,source_ref)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING alias_id""",
                (entity_id,alias_name.strip(),valid_from,valid_to,source_ref.strip())).fetchone()
            if row:
                return {"alias_id":row["alias_id"],"created":True}
            return {"created":False,"detail":"This alias entry already exists."}

    def resolve_alias(self, name: str, on_date: str):
        with self._connect() as db:
            row = db.execute("""SELECT a.entity_id,f.canonical_name FROM entity_aliases a
                JOIN features f ON f.feature_id=a.entity_id WHERE lower(a.alias_name)=lower(%s)
                AND (a.valid_from IS NULL OR a.valid_from <= %s)
                AND (a.valid_to IS NULL OR a.valid_to >= %s)
                ORDER BY a.valid_from DESC NULLS LAST LIMIT 1""", (name,on_date,on_date)).fetchone()
        if row:
            return {"feature_id":row["entity_id"],"feature":row["canonical_name"]}
        return None

    def add_relation(self, from_entity: str, to_entity: str, relation_type: str,
                     source_ref="", evidence_span="", confidence=0.5):
        with self._connect() as db:
            row = db.execute("""INSERT INTO entity_relations(from_entity,to_entity,relation_type,source_ref,evidence_span,confidence)
                VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING relation_id""",
                (from_entity,to_entity,relation_type,source_ref.strip(),evidence_span.strip(),confidence)).fetchone()
            if row:
                return {"relation_id":row["relation_id"],"created":True}
            return {"created":False,"detail":"This relation entry already exists."}

    def create_flags_for_events(self, entity_id: str):
        """Add review flags for unsupported lifecycle ordering; never edit prior events."""
        with self._connect() as db:
            rows = db.execute("SELECT event_id,event_type,event_date,summary,source_refs FROM history_events WHERE entity_id=%s ORDER BY event_date,event_id",
                              (entity_id,)).fetchall()
            types = [(r["event_type"],r) for r in rows]
            approved_dates = [r["event_date"] for event_type,r in types if event_type == "approved"]
            for event_type, row in types:
                if event_type == "implemented" and not any(d <= row["event_date"] for d in approved_dates):
                    refs = row["source_refs"] if isinstance(row["source_refs"],str) else json.dumps(row["source_refs"])
                    db.execute("""INSERT INTO history_flags(entity_id,flag_type,severity,message,source_refs)
                        VALUES(%s,'implementation_without_prior_approval','review',%s,%s::jsonb) ON CONFLICT DO NOTHING""",
                        (entity_id,f"Implementation on {row['event_date']} has no earlier approved event in the stored evidence.",refs))
            rejected_dates = [r["event_date"] for event_type,r in types if event_type == "rejected"]
            for event_type, row in types:
                if event_type == "implemented" and any(d <= row["event_date"] for d in rejected_dates):
                    refs = row["source_refs"] if isinstance(row["source_refs"],str) else json.dumps(row["source_refs"])
                    db.execute("""INSERT INTO history_flags(entity_id,flag_type,severity,message,source_refs)
                        VALUES(%s,'implementation_after_rejection','high',%s,%s::jsonb) ON CONFLICT DO NOTHING""",
                        (entity_id,f"Implementation on {row['event_date']} follows a rejected event; review the evidence.",refs))
            removed_dates = [r["event_date"] for event_type,r in types if event_type == "removed"]
            for event_type, row in types:
                if event_type in {"modified","implemented"} and any(d < row["event_date"] for d in removed_dates):
                    refs = row["source_refs"] if isinstance(row["source_refs"],str) else json.dumps(row["source_refs"])
                    db.execute("""INSERT INTO history_flags(entity_id,flag_type,severity,message,source_refs)
                        VALUES(%s,'change_after_removal','review',%s,%s::jsonb) ON CONFLICT DO NOTHING""",
                        (entity_id,f"A {event_type} event on {row['event_date']} follows a removal event; verify whether the feature was restored.",refs))
            approved_rejected = {r["event_date"] for event_type,r in types if event_type == "approved"} & {
                r["event_date"] for event_type,r in types if event_type == "rejected"}
            for conflict_date in approved_rejected:
                db.execute("""INSERT INTO history_flags(entity_id,flag_type,severity,message)
                    VALUES(%s,'decision_status_conflict','review',%s) ON CONFLICT DO NOTHING""",
                    (entity_id,f"Both approval and rejection events are recorded on {conflict_date}; inspect their evidence."))
