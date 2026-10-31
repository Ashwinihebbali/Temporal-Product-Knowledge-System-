"""PostgreSQL-backed feature/record registry used when DATABASE_URL is set.

PostgreSQL is authoritative in this mode. Neo4j is populated asynchronously by
neo4j_sync.py, so a graph outage never rolls back a saved source record.
"""
from __future__ import annotations

import csv
import hashlib
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from feature_store import FeatureRegistry


class PostgresFeatureRegistry(FeatureRegistry):
    def __init__(self, database_url: str, similarity_threshold: float = 0.82):
        self.database_url = database_url
        self.similarity_threshold = similarity_threshold
        schema = [
            """CREATE TABLE IF NOT EXISTS features (
                    feature_id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
                    origin TEXT NOT NULL DEFAULT 'ingested', created_at TEXT NOT NULL
                )""",
            """CREATE TABLE IF NOT EXISTS records (
                    record_id BIGSERIAL PRIMARY KEY, source_type TEXT NOT NULL,
                    summary TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', occurred_at TEXT,
                    feature_id TEXT NOT NULL REFERENCES features(feature_id),
                    content_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
                )""",
            """CREATE TABLE IF NOT EXISTS record_sources (
                    source_type TEXT NOT NULL, source_id TEXT NOT NULL,
                    record_id BIGINT NOT NULL REFERENCES records(record_id),
                    PRIMARY KEY(source_type, source_id)
                )""",
            """CREATE TABLE IF NOT EXISTS feature_assignments (
                    feature_id TEXT NOT NULL REFERENCES features(feature_id),
                    source_type TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(feature_id, source_type, source_id)
                )""",
            "CREATE INDEX IF NOT EXISTS idx_assignments_feature ON feature_assignments(feature_id)",
            "CREATE INDEX IF NOT EXISTS idx_records_occurred_at ON records(occurred_at)",
        ]
        with self._connect() as db:
            for statement in schema:
                db.execute(statement)
        self._refresh_feature_cache()

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def _refresh_feature_cache(self):
        with self._connect() as db:
            rows = db.execute("SELECT feature_id,canonical_name,normalized_name FROM features").fetchall()
        self._feature_cache = {row["feature_id"]:dict(row) for row in rows}

    def seed_components(self, component_csv: Path):
        """Seed component names and issue assignments in one transaction."""
        if not component_csv.exists():
            return
        with component_csv.open("r", encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("SELECT pg_advisory_xact_lock(728145093)")
            features = db.execute("SELECT feature_id,canonical_name,normalized_name FROM features").fetchall()
            next_num = db.execute("SELECT COALESCE(MAX(CAST(substr(feature_id,6) AS INTEGER)),0)+1 AS n FROM features").fetchone()["n"]
            name_to_id = {}
            for row in rows:
                name = " ".join(row.get("component", "").strip().split())
                if not name:
                    continue
                if name not in name_to_id:
                    normalized = self._normalize(name)
                    ranked = sorted(((self._similarity(normalized, f["normalized_name"]), f) for f in features),
                                    key=lambda pair: pair[0], reverse=True)
                    if ranked and ranked[0][0] >= self.similarity_threshold:
                        feature_id = ranked[0][1]["feature_id"]
                    else:
                        feature_id = f"FEAT-{next_num:05d}"
                        next_num += 1
                        db.execute("INSERT INTO features(feature_id,canonical_name,normalized_name,origin,created_at) VALUES(%s,%s,%s,%s,%s)",
                                   (feature_id, name, normalized, "dataset_component", now))
                        features.append({"feature_id":feature_id,"canonical_name":name,"normalized_name":normalized})
                    name_to_id[name] = feature_id
            assignments = [(name_to_id[row["component"].strip()], "issue", row["issue_id"].strip(), now)
                           for row in rows if row.get("component", "").strip() and row.get("issue_id", "").strip()]
            db.cursor().executemany("""INSERT INTO feature_assignments(feature_id,source_type,source_id,created_at)
                VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""", assignments)
        self._refresh_feature_cache()

    def resolve_feature(self, name: str, description: str = "", origin: str = "ingested"):
        name = " ".join(str(name).strip().split())
        normalized = self._normalize(name)
        if not normalized:
            raise ValueError("Feature name must contain letters or numbers")
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            # Serialize feature ID allocation across API workers.
            db.execute("SELECT pg_advisory_xact_lock(728145093)")
            rows = db.execute("SELECT feature_id,canonical_name,normalized_name FROM features").fetchall()
            ranked = sorted(((self._similarity(normalized, row["normalized_name"]), row) for row in rows),
                            key=lambda pair: pair[0], reverse=True)
            if ranked and ranked[0][0] >= self.similarity_threshold:
                score, row = ranked[0]
                if description:
                    db.execute("UPDATE features SET description=CASE WHEN description='' THEN %s ELSE description END WHERE feature_id=%s",
                               (description[:2000], row["feature_id"]))
                return {"feature_id":row["feature_id"], "feature":row["canonical_name"],
                        "created":False, "similarity":round(score, 4), "matched_existing":True}
            next_num = db.execute("SELECT COALESCE(MAX(CAST(substr(feature_id,6) AS INTEGER)),0)+1 AS n FROM features").fetchone()["n"]
            feature_id = f"FEAT-{next_num:05d}"
            db.execute("INSERT INTO features(feature_id,canonical_name,normalized_name,description,origin,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
                       (feature_id, name, normalized, description[:2000], origin, now))
            self._feature_cache[feature_id] = {"feature_id":feature_id,"canonical_name":name,"normalized_name":normalized}
        return {"feature_id":feature_id, "feature":name, "created":True,
                "similarity":0.0, "matched_existing":False}

    def assign_source(self, feature_id: str, source_type: str, source_id: str):
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("INSERT INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                       (feature_id, source_type.strip().lower(), source_id.strip(), now))

    def get_feature_id(self, name: str):
        rows = list(self._feature_cache.values())
        ranked = sorted(((self._similarity(name, row["normalized_name"]), row) for row in rows),
                        key=lambda pair: pair[0], reverse=True)
        return ranked[0][1]["feature_id"] if ranked and ranked[0][0] >= self.similarity_threshold else None

    def insert_record(self, *, source_type: str, source_id: str, summary: str, description: str,
                      occurred_at: str | None, feature_name: str):
        source_type = source_type.strip().lower()
        source_id = source_id.strip()
        summary = " ".join(summary.strip().split())
        description = " ".join((description or "").strip().split())
        content_hash = hashlib.sha256("\n".join((source_type, self._normalize(summary),
            self._normalize(description), occurred_at or "")).encode()).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            prior = db.execute("""SELECT r.*,f.canonical_name FROM record_sources s
                JOIN records r ON r.record_id=s.record_id JOIN features f ON f.feature_id=r.feature_id
                WHERE s.source_type=%s AND s.source_id=%s""", (source_type, source_id)).fetchone()
            if prior:
                return self._record_result(prior, True, "source_id")
            prior = db.execute("""SELECT r.*,f.canonical_name FROM records r JOIN features f ON f.feature_id=r.feature_id
                WHERE r.content_hash=%s""", (content_hash,)).fetchone()
            if prior:
                db.execute("INSERT INTO record_sources(source_type,source_id,record_id) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",
                           (source_type, source_id, prior["record_id"]))
                db.execute("INSERT INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                           (prior["feature_id"], source_type, source_id, now))
                return self._record_result(prior, True, "same_content")

        resolved = self.resolve_feature(feature_name, description, origin="ingested")
        with self._connect() as db:
            cur = db.execute("""INSERT INTO records(source_type,summary,description,occurred_at,feature_id,content_hash,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(content_hash) DO NOTHING RETURNING record_id""",
                (source_type, summary, description, occurred_at, resolved["feature_id"], content_hash, now))
            inserted = cur.fetchone()
            if inserted:
                record_id = inserted["record_id"]
                duplicate, reason = False, None
            else:
                record_id = db.execute("SELECT record_id FROM records WHERE content_hash=%s", (content_hash,)).fetchone()["record_id"]
                duplicate, reason = True, "same_content"
            db.execute("INSERT INTO record_sources(source_type,source_id,record_id) VALUES(%s,%s,%s) ON CONFLICT(source_type,source_id) DO NOTHING",
                       (source_type, source_id, record_id))
            row = db.execute("SELECT r.*,f.canonical_name FROM records r JOIN features f ON f.feature_id=r.feature_id WHERE r.record_id=%s",
                             (record_id,)).fetchone()
            db.execute("INSERT INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                       (row["feature_id"], source_type, source_id, now))
        result = self._record_result(row, duplicate, reason)
        if not duplicate:
            result.update({"feature_created":resolved["created"], "feature_similarity":resolved["similarity"]})
        return result

    @staticmethod
    def _record_result(row, duplicate: bool, duplicate_reason):
        return {"record_id":row["record_id"], "source_type":row["source_type"],
                "summary":row["summary"], "description":row["description"],
                "occurred_at":row["occurred_at"], "feature_id":row["feature_id"],
                "feature":row["canonical_name"], "duplicate":duplicate,
                "duplicate_reason":duplicate_reason}

    def list_features(self, limit=500, offset=0):
        with self._connect() as db:
            rows = db.execute("""SELECT f.feature_id,f.canonical_name,f.description,f.origin,f.created_at,
                COUNT(DISTINCT a.source_type || ':' || a.source_id) AS record_count FROM features f
                LEFT JOIN feature_assignments a ON a.feature_id=f.feature_id GROUP BY f.feature_id
                ORDER BY f.feature_id LIMIT %s OFFSET %s""", (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) AS n FROM features").fetchone()["n"]
        return {"total":total, "limit":limit, "offset":offset, "items":rows}

    def list_records(self, limit=100, offset=0):
        with self._connect() as db:
            rows = db.execute("""SELECT r.*,f.canonical_name AS feature,s.source_id FROM records r
                JOIN features f ON f.feature_id=r.feature_id JOIN record_sources s ON s.record_id=r.record_id
                ORDER BY r.record_id DESC LIMIT %s OFFSET %s""", (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) AS n FROM records").fetchone()["n"]
        return {"total":total, "limit":limit, "offset":offset, "items":rows}
