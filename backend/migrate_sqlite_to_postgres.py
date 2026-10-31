"""One-time, idempotent migration of the local SQLite feature registry to PostgreSQL."""
import os
import sqlite3
import sys

import psycopg
from psycopg.rows import dict_row

from postgres_store import PostgresFeatureRegistry


def main():
    sqlite_path = sys.argv[1] if len(sys.argv) > 1 else "chronodev_features.sqlite3"
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("Set DATABASE_URL first (copy .env.example to .env and load it in PowerShell).")
    source = sqlite3.connect(sqlite_path)
    source.row_factory = sqlite3.Row
    # Create PostgreSQL tables before copying; rows keep their existing FEAT IDs.
    PostgresFeatureRegistry(database_url)
    features = source.execute("SELECT * FROM features ORDER BY feature_id").fetchall()
    records = source.execute("SELECT * FROM records ORDER BY record_id").fetchall()
    sources = source.execute("SELECT * FROM record_sources").fetchall()
    assignments = source.execute("SELECT * FROM feature_assignments").fetchall()
    remap = {}
    with psycopg.connect(database_url, row_factory=dict_row) as target:
        for row in features:
            target.execute("""INSERT INTO features(feature_id,canonical_name,normalized_name,description,origin,created_at)
                VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                tuple(row[k] for k in ("feature_id","canonical_name","normalized_name","description","origin","created_at")))
        for row in records:
            saved = target.execute("""INSERT INTO records(source_type,summary,description,occurred_at,feature_id,content_hash,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash
                RETURNING record_id""",
                tuple(row[k] for k in ("source_type","summary","description","occurred_at","feature_id","content_hash","created_at"))).fetchone()
            remap[row["record_id"]] = saved["record_id"]
        for row in sources:
            target.execute("INSERT INTO record_sources(source_type,source_id,record_id) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",
                           (row["source_type"], row["source_id"], remap[row["record_id"]]))
        for row in assignments:
            target.execute("""INSERT INTO feature_assignments(feature_id,source_type,source_id,created_at)
                VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                tuple(row[k] for k in ("feature_id","source_type","source_id","created_at")))
    source.close()
    print(f"Migrated {len(features)} features, {len(records)} records, {len(sources)} source links, and {len(assignments)} feature assignments.")


if __name__ == "__main__":
    main()
