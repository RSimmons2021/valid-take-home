"""Turn raw Overture places into places we are willing to count.

Every place that is dropped is dropped for exactly one recorded reason, so the app can
show a ledger ("12,104 raw → 9,870 kept: 1,402 closed, 611 low confidence, …").
Rules are applied in this order; a place is attributed to the first rule it fails.

1. outside   – the point lies outside the metro box (bbox overlap pulls in edge rows)
2. closed    – operating_status is permanently or temporarily closed. Note: Overture's
               schema says closed places carry confidence 0, but in the 2026-10 release
               most closed places in SF have confidence ≥ 0.6, so confidence alone would
               keep them. Status is checked first for that reason.
3. low_confidence – confidence missing or below MIN_CONFIDENCE
4. uncategorized  – no taxonomy.primary, so we can't say what it is
5. duplicate – same normalised name as a better-scored place within DEDUPE_METERS
               (two sources describing one business)
"""

from __future__ import annotations

import duckdb

from .config import DEDUPE_METERS, MIN_CONFIDENCE, Metro
from .db import rows

REASONS = ["outside", "closed", "low_confidence", "uncategorized", "duplicate"]


def name_key_sql(col: str = "name") -> str:
    # lower-case, strip accents and everything that isn't a letter or digit
    return f"regexp_replace(lower(strip_accents(coalesce({col}, ''))), '[^a-z0-9]', '', 'g')"


def clean_places(
    con: duckdb.DuckDBPyConnection,
    source: str,
    metro: Metro,
    min_confidence: float = MIN_CONFIDENCE,
    dedupe_m: float = DEDUPE_METERS,
) -> dict:
    """Read `source` (a table or parquet path) into table `places` and return the ledger."""
    xmin, ymin, xmax, ymax = metro.bbox
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE places_raw AS
        SELECT *, ST_X(geometry) AS lon, ST_Y(geometry) AS lat, {name_key_sql()} AS name_key
        FROM {source}
    """)
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE places_judged AS
        SELECT *,
          CASE
            WHEN NOT (lon BETWEEN {xmin} AND {xmax} AND lat BETWEEN {ymin} AND {ymax}) THEN 'outside'
            WHEN operating_status IN ('permanently_closed', 'temporarily_closed') THEN 'closed'
            WHEN confidence IS NULL OR confidence < {min_confidence} THEN 'low_confidence'
            WHEN taxonomy.primary IS NULL THEN 'uncategorized'
            ELSE NULL
          END AS dropped
        FROM places_raw
    """)
    # Duplicates among survivors: keep the highest-confidence member of each near-twin pair.
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE place_dupes AS
        WITH s AS (
          SELECT id, name_key, lon, lat, confidence FROM places_judged
          WHERE dropped IS NULL AND length(name_key) > 2
        )
        SELECT DISTINCT a.id
        FROM s a JOIN s b
          ON a.name_key = b.name_key AND a.id <> b.id
         AND abs(a.lat - b.lat) < 0.001 AND abs(a.lon - b.lon) < 0.0013
         AND ST_Distance_Sphere(ST_Point(a.lon, a.lat), ST_Point(b.lon, b.lat)) <= {dedupe_m}
        WHERE (b.confidence, b.id) > (a.confidence, a.id)
    """)
    con.sql("""
        UPDATE places_judged SET dropped = 'duplicate'
        WHERE dropped IS NULL AND id IN (SELECT id FROM place_dupes)
    """)
    con.sql("CREATE OR REPLACE TEMP TABLE places AS SELECT * FROM places_judged WHERE dropped IS NULL")

    counts = {r["dropped"]: r["n"] for r in rows(con, "SELECT dropped, count(*) AS n FROM places_judged GROUP BY 1")}
    raw = sum(counts.values())
    return {
        "raw": raw,
        "kept": counts.get(None, 0),
        "dropped": {reason: counts.get(reason, 0) for reason in REASONS},
        "min_confidence": min_confidence,
        "dedupe_meters": dedupe_m,
    }
