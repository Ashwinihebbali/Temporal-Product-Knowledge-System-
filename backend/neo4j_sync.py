"""Idempotent PostgreSQL-to-Neo4j projection for ChronoDev's feature graph."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row
from neo4j import Driver


def sync_postgres_to_neo4j(database_url: str, driver: Driver, neo4j_database: str = "neo4j") -> dict:
    """Copy the current relational state into Neo4j using MERGE (safe to retry)."""
    with psycopg.connect(database_url, row_factory=dict_row) as pg:
        features = pg.execute("SELECT feature_id,canonical_name,description,origin,created_at FROM features").fetchall()
        assignments = pg.execute("""SELECT feature_id,source_type,source_id,created_at
            FROM feature_assignments""").fetchall()
        records = pg.execute("""SELECT r.record_id,r.source_type,s.source_id,r.summary,r.description,
            r.occurred_at,r.feature_id FROM records r JOIN record_sources s ON s.record_id=r.record_id""").fetchall()
        events = pg.execute("""SELECT event_id,entity_id,event_type,event_date,summary,aim_objective,
            evidence_span,source_refs,feature_ids,confidence,inferred FROM history_events e
            LEFT JOIN history_event_sync_state s USING(event_id) WHERE s.event_id IS NULL
            ORDER BY event_date,event_id LIMIT 10000""").fetchall()
        aliases = pg.execute("SELECT alias_id,entity_id,alias_name,valid_from,valid_to,source_ref FROM entity_aliases").fetchall()
        relations = pg.execute("SELECT relation_id,from_entity,to_entity,relation_type,source_ref,evidence_span,confidence FROM entity_relations").fetchall()

    with driver.session(database=neo4j_database) as session:
        session.run("CREATE CONSTRAINT chrono_feature_id IF NOT EXISTS FOR (f:Feature) REQUIRE f.feature_id IS UNIQUE").consume()
        session.run("CREATE CONSTRAINT chrono_source_key IF NOT EXISTS FOR (s:SourceRecord) REQUIRE s.key IS UNIQUE").consume()
        session.run("CREATE CONSTRAINT chrono_history_event_id IF NOT EXISTS FOR (e:HistoryEvent) REQUIRE e.event_id IS UNIQUE").consume()
        if features:
            session.run("""UNWIND $rows AS row MERGE (f:Feature {feature_id:row.feature_id})
                SET f.name=row.canonical_name, f.description=row.description,
                    f.origin=row.origin, f.created_at=row.created_at""", rows=features).consume()
        if assignments:
            session.run("""UNWIND $rows AS row
                MATCH (f:Feature {feature_id:row.feature_id})
                MERGE (s:SourceRecord {key:row.source_type + ':' + row.source_id})
                ON CREATE SET s.source_type=row.source_type, s.source_id=row.source_id,
                              s.created_at=row.created_at
                MERGE (s)-[:HAS_FEATURE]->(f)""", rows=assignments).consume()
        if records:
            session.run("""UNWIND $rows AS row
                MATCH (f:Feature {feature_id:row.feature_id})
                MERGE (s:SourceRecord {key:row.source_type + ':' + row.source_id})
                SET s.source_type=row.source_type, s.source_id=row.source_id,
                    s.summary=row.summary, s.description=row.description,
                    s.occurred_at=row.occurred_at, s.record_id=row.record_id
                MERGE (s)-[:HAS_FEATURE]->(f)""", rows=records).consume()
        if events:
            graph_events = [{**row, "event_date":row["event_date"].isoformat(),
                             "source_refs":row["source_refs"] or [],
                             "feature_ids":row["feature_ids"] or []} for row in events]
            session.run("""UNWIND $rows AS row MERGE (e:HistoryEvent {event_id:row.event_id})
                SET e.event_type=row.event_type,e.event_date=row.event_date,e.summary=row.summary,
                    e.aim_objective=row.aim_objective,e.evidence_span=row.evidence_span,
                    e.confidence=row.confidence,e.inferred=row.inferred""", rows=graph_events).consume()
            session.run("""UNWIND $rows AS row MATCH (e:HistoryEvent {event_id:row.event_id})
                UNWIND row.feature_ids AS fid MATCH (f:Feature {feature_id:fid})
                MERGE (e)-[:ABOUT_FEATURE]->(f)""", rows=graph_events).consume()
            session.run("""UNWIND $rows AS row MATCH (e:HistoryEvent {event_id:row.event_id})
                UNWIND row.source_refs AS ref
                WITH e,ref WHERE ref.id IS NOT NULL
                MERGE (s:SourceRecord {key:ref.type + ':' + ref.id})
                ON CREATE SET s.source_type=ref.type,s.source_id=ref.id
                MERGE (e)-[:EVIDENCED_BY]->(s)""", rows=graph_events).consume()
        if aliases:
            alias_rows = [{**row,"valid_from":row["valid_from"].isoformat() if row["valid_from"] else None,
                           "valid_to":row["valid_to"].isoformat() if row["valid_to"] else None} for row in aliases]
            session.run("""UNWIND $rows AS row MATCH (f:Feature {feature_id:row.entity_id})
                MERGE (a:EntityAlias {alias_id:row.alias_id})
                SET a.name=row.alias_name,a.valid_from=row.valid_from,a.valid_to=row.valid_to,a.source_ref=row.source_ref
                MERGE (f)-[:HAS_ALIAS]->(a)""", rows=alias_rows).consume()
        if relations:
            session.run("""UNWIND $rows AS row
                MATCH (a:Feature {feature_id:row.from_entity})
                MATCH (b:Feature {feature_id:row.to_entity})
                MERGE (a)-[r:ENTITY_RELATION {relation_id:row.relation_id}]->(b)
                SET r.relation_type=row.relation_type,r.source_ref=row.source_ref,
                    r.evidence_span=row.evidence_span,r.confidence=row.confidence""", rows=relations).consume()
    if events:
        with psycopg.connect(database_url) as pg:
            pg.cursor().executemany("INSERT INTO history_event_sync_state(event_id) VALUES(%s) ON CONFLICT DO NOTHING",
                                    [(row["event_id"],) for row in events])
    with psycopg.connect(database_url, row_factory=dict_row) as pg:
        pending_events = pg.execute("""SELECT count(*) AS n FROM history_events e LEFT JOIN history_event_sync_state s
            USING(event_id) WHERE s.event_id IS NULL""").fetchone()["n"]
    return {"features":len(features), "assignments":len(assignments),
            "records":len(records), "events":len(events), "pending_events":pending_events}
