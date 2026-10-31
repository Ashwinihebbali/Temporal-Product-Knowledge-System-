# ChronoDev AI backend

A FastAPI backend for the cleaned Axis2 dataset. It reconstructs history, assigns persistent feature IDs, prevents duplicate feature/record inserts, and uses Ollama for local feature extraction and evidence-grounded Q&A. SQLite remains the default; setting `DATABASE_URL` switches the feature and inserted-record registry to PostgreSQL. Neo4j is an idempotent graph projection of PostgreSQL.

## Run the complete local demo

Docker Compose starts PostgreSQL, Neo4j, the FastAPI API, and the React dashboard. From the `backend` directory:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

The first start downloads the images and ingests the cleaned CSV history, so allow a few minutes. Open the UI at `http://127.0.0.1:5173`, API docs at `http://127.0.0.1:8001/docs`, Neo4j Browser at `http://localhost:7474`, and API storage status at `http://127.0.0.1:8001/api/storage/status`.

To run the API outside Docker during development, stop the Compose `api` and `frontend` services, install `requirements.txt` into the backend venv, then run `python -m uvicorn main:app --reload` from this directory. To run the React dev server outside Docker, use `npm install` and `npm run dev` from `frontend`.

## PostgreSQL and Neo4j (local, optional)

From the `backend` directory, copy the sample environment file and start the free local database services:

```powershell
Copy-Item .env.example .env
docker compose up -d
```

Install the additional Python packages, then start the API as usual:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Open `http://127.0.0.1:8001/api/storage/status` to see the primary store and graph sync state. Neo4j Browser is at `http://localhost:7474`; sign in with username `neo4j` and the password in `.env` (default for this local demo: `chronodev-local`). Example Cypher:

```cypher
MATCH (s:SourceRecord)-[:HAS_FEATURE]->(f:Feature)
RETURN s.source_type, s.source_id, s.summary, f.feature_id, f.name
LIMIT 25
```

PostgreSQL is authoritative. On first start, the backend stores source rows from the cleaned issues, commits, comments, code changes, component mappings, and issue-commit links, then materializes dated timeline events with source references and confidence. Re-import is fingerprinted and idempotent. Event rows are append-only; graph-sync bookkeeping lives separately. New API records can create structured, source-validated Ollama events and aliases. The app periodically projects features, assignments, aliases, relations, and events into Neo4j using stable keys and `MERGE`; if Neo4j is offline, PostgreSQL remains the source of truth and the next cycle retries. Data is persisted in Docker volumes. The `.env` file is local configuration and should not be committed.

If you already have local SQLite records you want to keep, migrate them once before switching the app to PostgreSQL. With PostgreSQL running and `.env` present, load the URL into the current PowerShell session and run:

```powershell
$env:DATABASE_URL = "postgresql://chronodev:chronodev-local@localhost:5432/chronodev"
.venv\Scripts\python.exe .\migrate_sqlite_to_postgres.py .\chronodev_features.sqlite3
```

The migration preserves `FEAT-...` IDs and is safe to rerun. Startup also seeds the dataset's issue components into whichever registry is selected.

## Feature ID and append workflow

On startup the backend seeds the selected feature registry from existing `issue_component.csv` values. Without `DATABASE_URL`, the registry persists in `backend/chronodev_features.sqlite3`; with it, PostgreSQL stores the feature registry and inserted records.

Insert a new source record with `POST /api/records`:

```json
{
  "source_type": "issue",
  "source_id": "DEMO-001",
  "summary": "Add token authentication to HTTP client",
  "description": "The HTTP client should accept a bearer token.",
  "occurred_at": "2024-03-05T10:00:00Z",
  "feature": "HTTP authentication"
}
```

The dashboard also has **Batch import** for a JSON array of up to 25 records. The same operation is available at `POST /api/records/batch` with `{"records":[...]}`; each item uses the single-record fields shown above. The response reports created records, duplicates, and rejected items. The dashboard's timeline event detail shows the stored evidence quote and whether the event was inferred.

`feature` is optional. When omitted, the local Ollama model extracts a concise feature name; if Ollama is unavailable, the issue summary is used. Similar feature names reuse an existing ID at the registry's 0.82 similarity threshold. Otherwise, a new feature ID is appended. Exact repeated source IDs or identical normalized content and dates are deduplicated; the response reports `duplicate`, `feature_id`, and whether a feature was newly created.

- `GET /api/features` lists known feature IDs and record counts.
- `POST /api/features/resolve` resolves a feature name to an existing ID or appends a new one.
- `GET /api/records` lists inserted records.
- Dated inserted records appear in `GET /api/history/timeline` and `GET /api/history/search` with their `feature_id`.

## History and Q&A

- `GET /api/history/timeline?limit=20&offset=0` reads event dates from source records; optional date filters only narrow the result.
- `GET /api/history/search?q=authentication&limit=10` retrieves matching dated events.
- `GET /api/events` filters stored events by date, entity, and event type; `GET /api/history/as-of?as_of=2014-12-31` lists explicit `implemented` events up to that date.
- `GET /api/entities`, `GET /api/graph`, and `GET /api/flags` supply the feature graph and review panel.
- `GET /api/source-records/{source_type}/{source_id}` returns the preserved source artifact for evidence inspection.
- `GET /api/issues/{issue_id}/timeline` shows an issue's report, discussion, and linked code history.
- `GET /api/ai/status` checks local Ollama.
- `GET /api/storage/status` reports whether SQLite or PostgreSQL is selected and the latest Neo4j sync result.
- `POST /api/ask` retrieves evidence and asks Ollama to summarize it.

Objectives are inferred from source summaries or commit messages because the dataset has no explicit date-wise project-goal records. Ollama output can still need evidence review.
