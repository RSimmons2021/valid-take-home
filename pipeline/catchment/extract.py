"""Download one metro's slice of each Overture theme we use into local GeoParquet.

Reads Overture's GeoParquet on S3 with DuckDB, filtering on the `bbox` struct so only
the row groups that overlap the metro are fetched. Raw slices are cached under
`data/raw/<metro>/` and skipped on re-runs; pass `force=True` to refresh them.
"""

from __future__ import annotations

import time
from pathlib import Path

from .config import PREVIOUS_S3_ROOT, S3_ROOT, Metro
from .db import connect, scalar

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

# theme, type, columns to keep (keeps the cache small and the intent explicit)
LAYERS: list[tuple[str, str, str]] = [
    (
        "places",
        "place",
        "id, names.primary AS name, confidence, operating_status, basic_category, "
        "taxonomy, brand.names.primary AS brand, brand.wikidata AS brand_wikidata, "
        "addresses[1].postcode AS postcode, [s.dataset FOR s IN sources] AS datasets, geometry",
    ),
    (
        "addresses",
        "address",
        "id, street, number, unit, postcode, postal_city, country, geometry",
    ),
    (
        "buildings",
        "building",
        "id, subtype, class, height, num_floors, ST_Centroid(geometry) AS geometry, "
        "ST_Area_Spheroid(geometry) AS footprint_m2",
    ),
    (
        "divisions",
        "division_area",
        "id, division_id, names.primary AS name, subtype, class, country, geometry",
    ),
    # Neighbourhood polygons are sparse in the US, but neighbourhood *points* are not.
    # Cells are labelled by the nearest point, with polygons taking precedence.
    (
        "divisions",
        "division",
        "id, names.primary AS name, subtype, class, local_type.en AS local_type, population, country, geometry",
    ),
]


def raw_path(metro: Metro, typ: str) -> Path:
    return RAW / metro.id / f"{typ}.parquet"


def extract(metro: Metro, force: bool = False, log=print) -> dict[str, int]:
    con = connect(remote=True)
    out_dir = RAW / metro.id
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for theme, typ, cols in LAYERS:
        dest = raw_path(metro, typ)
        if dest.exists() and not force:
            counts[typ] = scalar(con, f"SELECT count(*) FROM '{dest}'")
            log(f"  {typ:<14} cached  {counts[typ]:>9,}")
            continue
        extra = ""
        if typ in ("division_area", "division"):
            extra = " AND subtype IN ('county', 'locality', 'neighborhood', 'macrohood', 'microhood')"
        tmp = dest.with_suffix(".tmp.parquet")
        t0 = time.time()
        con.sql(
            f"COPY (SELECT {cols} FROM read_parquet('{S3_ROOT}/theme={theme}/type={typ}/*') "
            f"WHERE {metro.where}{extra}) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)"
        )
        tmp.replace(dest)  # never leave a half-written cache behind
        counts[typ] = scalar(con, f"SELECT count(*) FROM '{dest}'")
        log(f"  {typ:<14} fetched {counts[typ]:>9,}  in {time.time() - t0:.0f}s")

    # Previous release: only what the diff needs (id and status), so it stays small.
    dest = RAW / metro.id / "place_prev.parquet"
    if dest.exists() and not force:
        counts["place_prev"] = scalar(con, f"SELECT count(*) FROM '{dest}'")
        log(f"  {'place_prev':<14} cached  {counts['place_prev']:>9,}")
    else:
        tmp = dest.with_suffix(".tmp.parquet")
        t0 = time.time()
        con.sql(
            "COPY (SELECT id, operating_status, confidence "
            f"FROM read_parquet('{PREVIOUS_S3_ROOT}/theme=places/type=place/*') "
            f"WHERE {metro.where}) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)"
        )
        tmp.replace(dest)
        counts["place_prev"] = scalar(con, f"SELECT count(*) FROM '{dest}'")
        log(f"  {'place_prev':<14} fetched {counts['place_prev']:>9,}  in {time.time() - t0:.0f}s")
    return counts
