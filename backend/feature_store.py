from __future__ import annotations
import csv
from contextlib import contextmanager
import hashlib
import re
import sqlite3
from difflib import SequenceMatcher
from datetime import datetime, timezone
from pathlib import Path

TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)
STOPWORDS = {"a", "an", "the", "for", "of", "to", "in", "on", "with", "support", "feature", "module", "issue", "add", "added", "allow", "enable"}
SYNONYMS = {"auth":"authentication", "login":"authentication", "configs":"configuration", "config":"configuration", "codegen":"code generation"}

class FeatureRegistry:
    """Persistent local feature IDs, similarity-based reuse, and duplicate-safe record inserts."""
    def __init__(self, db_path: Path, similarity_threshold: float = 0.82):
        self.db_path = Path(db_path).resolve()
        self.similarity_threshold = similarity_threshold
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS features (
                    feature_id TEXT PRIMARY KEY,
                    canonical_name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL DEFAULT '',
                    origin TEXT NOT NULL DEFAULT 'ingested',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS records (
                    record_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_type TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    occurred_at TEXT,
                    feature_id TEXT NOT NULL REFERENCES features(feature_id),
                    content_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS record_sources (
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    record_id INTEGER NOT NULL REFERENCES records(record_id),
                    PRIMARY KEY(source_type, source_id)
                );
                CREATE TABLE IF NOT EXISTS feature_assignments (
                    feature_id TEXT NOT NULL REFERENCES features(feature_id),
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(feature_id, source_type, source_id)
                );
            """)

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _normalize(value: str):
        words = []
        for word in TOKEN_RE.findall(str(value).lower()):
            words.extend(SYNONYMS.get(word, word).split())
        return " ".join(w for w in words if w not in STOPWORDS)

    @classmethod
    def _similarity(cls, left: str, right: str):
        a, b = cls._normalize(left), cls._normalize(right)
        if not a or not b:
            return 0.0
        if a == b:
            return 1.0
        ta, tb = set(a.split()), set(b.split())
        jaccard = len(ta & tb) / max(1, len(ta | tb))
        sequence = SequenceMatcher(None, a, b).ratio()
        return 0.55 * jaccard + 0.45 * sequence

    def seed_components(self, component_csv: Path):
        if not component_csv.exists():
            return
        with component_csv.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        for row in rows:
            name = row.get("component", "").strip()
            source_id = row.get("issue_id", "").strip()
            if not name:
                continue
            feature = self.resolve_feature(name, origin="dataset_component")
            if source_id:
                self.assign_source(feature["feature_id"], "issue", source_id)

    def assign_source(self, feature_id: str, source_type: str, source_id: str):
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(?,?,?,?)",
                       (feature_id, source_type.strip().lower(), source_id.strip(), now))

    def resolve_feature(self, name: str, description: str = "", origin: str = "ingested"):
        name = " ".join(str(name).strip().split())
        normalized = self._normalize(name)
        if not normalized:
            raise ValueError("Feature name must contain letters or numbers")
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT feature_id,canonical_name,normalized_name FROM features").fetchall()
            ranked = sorted(((self._similarity(normalized, row["normalized_name"]), row) for row in rows),
                            key=lambda pair: pair[0], reverse=True)
            if ranked and ranked[0][0] >= self.similarity_threshold:
                score, row = ranked[0]
                if description:
                    db.execute("UPDATE features SET description=CASE WHEN description='' THEN ? ELSE description END WHERE feature_id=?",
                               (description[:2000], row["feature_id"]))
                db.commit()
                return {"feature_id":row["feature_id"], "feature":row["canonical_name"],
                        "created":False, "similarity":round(score, 4), "matched_existing":True}
            next_num = db.execute("SELECT COALESCE(MAX(CAST(substr(feature_id,6) AS INTEGER)),0)+1 FROM features").fetchone()[0]
            feature_id = f"FEAT-{next_num:05d}"
            db.execute("INSERT INTO features(feature_id,canonical_name,normalized_name,description,origin,created_at) VALUES(?,?,?,?,?,?)",
                       (feature_id, name, normalized, description[:2000], origin, now))
            db.commit()
        return {"feature_id":feature_id, "feature":name, "created":True,
                "similarity":0.0, "matched_existing":False}

    def get_feature_id(self, name: str):
        with self._connect() as db:
            rows = db.execute("SELECT feature_id,normalized_name FROM features").fetchall()
        ranked = sorted(((self._similarity(name, row["normalized_name"]), row) for row in rows),
                        key=lambda pair: pair[0], reverse=True)
        return ranked[0][1]["feature_id"] if ranked and ranked[0][0] >= self.similarity_threshold else None

    def insert_record(self, *, source_type: str, source_id: str, summary: str, description: str,
                      occurred_at: str | None, feature_name: str):
        source_type = source_type.strip().lower()
        source_id = source_id.strip()
        summary = " ".join(summary.strip().split())
        description = " ".join((description or "").strip().split())
        normalized_content = "\n".join((source_type, self._normalize(summary),
                                        self._normalize(description), occurred_at or ""))
        content_hash = hashlib.sha256(normalized_content.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("""SELECT r.*,f.canonical_name FROM record_sources s
                JOIN records r ON r.record_id=s.record_id JOIN features f ON f.feature_id=r.feature_id
                WHERE s.source_type=? AND s.source_id=?""", (source_type, source_id)).fetchone()
            if prior:
                db.commit()
                return self._record_result(prior, True, "source_id")
            prior = db.execute("""SELECT r.*,f.canonical_name FROM records r
                JOIN features f ON f.feature_id=r.feature_id WHERE r.content_hash=?""", (content_hash,)).fetchone()
            if prior:
                db.execute("INSERT INTO record_sources(source_type,source_id,record_id) VALUES(?,?,?)",
                           (source_type, source_id, prior["record_id"]))
                db.execute("INSERT OR IGNORE INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(?,?,?,?)",
                           (prior["feature_id"], source_type, source_id, now))
                db.commit()
                return self._record_result(prior, True, "same_content")

        resolved = self.resolve_feature(feature_name, description, origin="ingested")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT record_id FROM records WHERE content_hash=?", (content_hash,)).fetchone()
            if prior:
                db.execute("INSERT OR IGNORE INTO record_sources(source_type,source_id,record_id) VALUES(?,?,?)",
                           (source_type, source_id, prior["record_id"]))
                db.execute("INSERT OR IGNORE INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(?,?,?,?)",
                           (resolved["feature_id"], source_type, source_id, now))
                row = db.execute("SELECT r.*,f.canonical_name FROM records r JOIN features f USING(feature_id) WHERE record_id=?",
                                 (prior["record_id"],)).fetchone()
                db.commit()
                return self._record_result(row, True, "same_content")
            cur = db.execute("""INSERT INTO records(source_type,summary,description,occurred_at,feature_id,content_hash,created_at)
                VALUES(?,?,?,?,?,?,?)""", (source_type, summary, description, occurred_at,
                                            resolved["feature_id"], content_hash, now))
            record_id = cur.lastrowid
            db.execute("INSERT INTO record_sources(source_type,source_id,record_id) VALUES(?,?,?)",
                       (source_type, source_id, record_id))
            db.execute("INSERT OR IGNORE INTO feature_assignments(feature_id,source_type,source_id,created_at) VALUES(?,?,?,?)",
                       (resolved["feature_id"], source_type, source_id, now))
            row = db.execute("SELECT r.*,f.canonical_name FROM records r JOIN features f USING(feature_id) WHERE record_id=?",
                             (record_id,)).fetchone()
            db.commit()
        result = self._record_result(row, False, None)
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
                LEFT JOIN feature_assignments a ON a.feature_id=f.feature_id
                GROUP BY f.feature_id ORDER BY f.feature_id LIMIT ? OFFSET ?""", (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) FROM features").fetchone()[0]
        return {"total":total, "limit":limit, "offset":offset, "items":[dict(r) for r in rows]}

    def list_records(self, limit=100, offset=0):
        with self._connect() as db:
            rows = db.execute("""SELECT r.*,f.canonical_name AS feature,s.source_id
                FROM records r JOIN features f USING(feature_id)
                JOIN record_sources s USING(record_id) ORDER BY r.record_id DESC LIMIT ? OFFSET ?""",
                (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        return {"total":total, "limit":limit, "offset":offset, "items":[dict(r) for r in rows]}
