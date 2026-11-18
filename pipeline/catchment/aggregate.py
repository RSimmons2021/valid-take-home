"""Roll a metro's cleaned layers up to H3 cells and write the file the app ships.

Output is columnar JSON: one array per field, aligned by cell index. A 15k-cell metro
is a few hundred KB gzipped. The browser reads it with no parsing beyond JSON.parse,
and scoring is a pass over typed arrays.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from . import signals as sig
from .cells import fill_from_neighbors, zip5
from .clean import clean_places
from .config import H3_RES, PREVIOUS_RELEASE, RELEASE, SCHEMA, Metro
from .db import connect, rows, scalar
from .diff import release_diff
from .extract import raw_path


def _in_box(metro: Metro, lon: str = "lon", lat: str = "lat") -> str:
    xmin, ymin, xmax, ymax = metro.bbox
    return f"{lon} BETWEEN {xmin} AND {xmax} AND {lat} BETWEEN {ymin} AND {ymax}"


def _cell(lat: str = "lat", lon: str = "lon") -> str:
    return f"h3_latlng_to_cell_string({lat}, {lon}, {H3_RES})"


def aggregate_addresses(con: duckdb.DuckDBPyConnection, source: str, metro: Metro) -> dict:
    """Addresses → cells. A rooftop is a distinct (street, number); units are counted as homes.

    `single_share` (rooftops with exactly one address and no unit) separates detached
    houses from apartment blocks, which matters for any business that sells to owners.
    """
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE addr AS
        SELECT {_cell()} AS h, street, number, unit, postcode
        FROM (SELECT *, ST_X(geometry) AS lon, ST_Y(geometry) AS lat FROM {source})
        WHERE {_in_box(metro)}
    """)
    con.sql("""
        CREATE OR REPLACE TEMP TABLE roof AS
        SELECT h, street, number, count(*) AS n, count(unit) AS units, mode(postcode ORDER BY postcode) AS zip
        FROM addr GROUP BY ALL
    """)
    con.sql("""
        CREATE OR REPLACE TEMP TABLE hex_addr AS
        SELECT h,
               sum(n)::INT AS homes,
               count(*)::INT AS rooftops,
               count(*) FILTER (WHERE n = 1 AND units = 0)::INT AS single_rooftops,
               mode(zip ORDER BY zip) AS zip
        FROM roof GROUP BY h
    """)
    return {
        "in_metro": scalar(con, "SELECT count(*) FROM addr"),
        "rooftops": scalar(con, "SELECT count(*) FROM roof"),
        "with_postcode": scalar(con, "SELECT count(postcode) FROM addr"),
    }


def aggregate_buildings(con: duckdb.DuckDBPyConnection, source: str, metro: Metro) -> dict:
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE hex_bld AS
        SELECT {_cell()} AS h,
               count(*)::INT AS buildings,
               median(height) AS median_height,
               sum(footprint_m2) AS footprint_m2
        FROM (SELECT *, ST_X(geometry) AS lon, ST_Y(geometry) AS lat FROM {source})
        WHERE {_in_box(metro)}
        GROUP BY 1
    """)
    return {
        "in_metro": scalar(con, "SELECT coalesce(sum(buildings), 0) FROM hex_bld"),
        "with_height": scalar(
            con,
            f"SELECT count(height) FROM (SELECT height, ST_X(geometry) lon, ST_Y(geometry) lat "
            f"FROM {source}) WHERE {_in_box(metro)}",
        ),
    }


def aggregate_places(con: duckdb.DuckDBPyConnection) -> None:
    """Cleaned `places` → signal index per place, then counts per (cell, signal)."""
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE places_sig AS
        SELECT id, name, confidence, brand, postcode, lon, lat, {_cell()} AS h,
               {sig.signal_case_sql()} AS s
        FROM places
    """)
    # Some county address feeds (e.g. Alameda) ship without postcodes; places often have them.
    con.sql("""
        CREATE OR REPLACE TEMP TABLE hex_place_zip AS
        WITH pz AS (
          SELECT h, left(postcode, 5) AS zip FROM places_sig WHERE regexp_matches(postcode, '^\\d{5}')
        ),
        -- Place postcodes are noisy (a business's mailing ZIP in another state). Trust a ZIP only if
        -- the address feed has it, or at least 20 places in the metro agree on it.
        trusted AS (
          SELECT zip FROM pz GROUP BY zip HAVING count(*) >= 20
          UNION SELECT DISTINCT left(postcode, 5) FROM addr WHERE postcode IS NOT NULL
        )
        SELECT h, mode(zip ORDER BY zip) AS zip FROM pz WHERE zip IN (SELECT zip FROM trusted) GROUP BY h
    """)
    con.sql("""
        CREATE OR REPLACE TEMP TABLE hex_sig AS
        SELECT h, s, count(*)::INT AS n FROM places_sig WHERE s IS NOT NULL GROUP BY ALL
    """)


def label_cells(con: duckdb.DuckDBPyConnection, area_src: str, point_src: str) -> None:
    """Name each cell: neighbourhood (polygon, else nearest point ≤ 2 km) and locality."""
    con.sql("""
        CREATE OR REPLACE TEMP TABLE cells AS
        SELECT h, h3_cell_to_lat(h) AS lat, h3_cell_to_lng(h) AS lon
        FROM (SELECT h FROM hex_addr UNION SELECT h FROM hex_bld)
    """)
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE areas AS
        SELECT a.name, a.subtype, a.geometry, ST_Area_Spheroid(a.geometry) AS area_m2,
               CASE d.local_type WHEN 'city' THEN 0 WHEN 'town' THEN 1 WHEN 'village' THEN 2
                                 WHEN 'hamlet' THEN 3 ELSE 4 END AS place_rank,
               CASE a.subtype WHEN 'neighborhood' THEN 0 WHEN 'microhood' THEN 1
                            WHEN 'macrohood' THEN 2 WHEN 'locality' THEN 3 ELSE 4 END AS rank
        FROM {area_src} a LEFT JOIN {point_src} d ON d.id = a.division_id
        -- Overture tags plazas and pocket parks as microhoods; ignore anything under 0.2 km².
        -- Chicago's police beats are tagged as neighbourhoods; they aren't what anyone calls home.
        WHERE a.name IS NOT NULL AND ST_Area_Spheroid(a.geometry) > 200000
          AND NOT regexp_matches(a.name, '^(Beat|District|Ward|Precinct) \\d+')
    """)
    con.sql(f"""
        CREATE OR REPLACE TEMP TABLE pts AS
        SELECT name, subtype, ST_X(geometry) AS lon, ST_Y(geometry) AS lat
        FROM {point_src}
        WHERE name IS NOT NULL AND NOT regexp_matches(name, '^(Beat|District|Ward|Precinct) \\d+')
    """)
    con.sql("""
        CREATE OR REPLACE TEMP TABLE cell_hood AS
        WITH poly AS (
          SELECT c.h, arg_min(a.name, (a.rank, a.area_m2, a.name)) AS name
          FROM cells c JOIN areas a
            ON a.rank < 3 AND ST_Contains(a.geometry, ST_Point(c.lon, c.lat))
          GROUP BY c.h
        ), near AS (
          SELECT c.h,
                 arg_min(p.name, (ST_Distance_Sphere(ST_Point(c.lon, c.lat), ST_Point(p.lon, p.lat)), p.name)) AS name
          FROM cells c JOIN pts p
            ON p.subtype IN ('neighborhood', 'macrohood')
           AND abs(p.lat - c.lat) < 0.018 AND abs(p.lon - c.lon) < 0.023
          WHERE ST_Distance_Sphere(ST_Point(c.lon, c.lat), ST_Point(p.lon, p.lat)) < 2000
          GROUP BY c.h
        )
        SELECT c.h, coalesce(poly.name, near.name) AS hood
        FROM cells c LEFT JOIN poly USING (h) LEFT JOIN near USING (h)
    """)
    con.sql("""
        CREATE OR REPLACE TEMP TABLE cell_city AS
        WITH poly AS (
          -- Townships overlap the cities and villages inside them (Jefferson ⊃ part of Chicago) and
          -- carry local_type 'locality'. Prefer city > town > village > hamlet > other, then the smaller area.
          SELECT c.h, arg_min(a.name, (a.place_rank, a.area_m2, a.name)) AS name
          FROM cells c JOIN areas a ON a.rank = 3 AND ST_Contains(a.geometry, ST_Point(c.lon, c.lat))
          GROUP BY c.h
        ), near AS (
          SELECT c.h,
                 arg_min(p.name, (ST_Distance_Sphere(ST_Point(c.lon, c.lat), ST_Point(p.lon, p.lat)), p.name)) AS name
          FROM cells c JOIN pts p
            ON p.subtype = 'locality' AND abs(p.lat - c.lat) < 0.09 AND abs(p.lon - c.lon) < 0.11
          GROUP BY c.h
        )
        -- Consolidated city-counties (Denver, San Francisco) have a county polygon but no locality one,
        -- so a county outranks the nearest locality point (which may be an enclave like Glendale).
        , county AS (
          SELECT c.h, arg_min(a.name, (a.area_m2, a.name)) AS name
          FROM cells c JOIN areas a ON a.rank = 4 AND ST_Contains(a.geometry, ST_Point(c.lon, c.lat))
          GROUP BY c.h
        )
        -- …but an ordinary county reads as "Travis County", not as a town called Travis.
        , county_label AS (
          SELECT h, CASE
              WHEN name IN (SELECT name FROM pts WHERE subtype = 'locality') OR name LIKE '% County' THEN name
              ELSE name || ' County' END AS name
          FROM county
        )
        SELECT c.h, coalesce(poly.name, county_label.name, near.name) AS city
        FROM cells c LEFT JOIN poly USING (h) LEFT JOIN county_label USING (h) LEFT JOIN near USING (h)
    """)


class _Interner:
    def __init__(self) -> None:
        self.values: list[str] = []
        self._ix: dict[str, int] = {}

    def __call__(self, v: str | None) -> int:
        if v is None:
            return -1
        if v not in self._ix:
            self._ix[v] = len(self.values)
            self.values.append(v)
        return self._ix[v]


def build_metro(metro: Metro, out_dir: Path, log=print) -> dict:
    con = connect()
    src = lambda typ: f"read_parquet('{raw_path(metro, typ)}')"  # noqa: E731

    ledger = clean_places(con, src("place"), metro)
    ledger["raw"] -= ledger["dropped"].pop("outside")
    log(f"  places     {ledger['raw']:>9,} in metro → {ledger['kept']:,} kept  {ledger['dropped']}")
    addr = aggregate_addresses(con, src("address"), metro)
    addr["units_per_rooftop"] = round(addr["in_metro"] / max(1, addr["rooftops"]), 2)
    log(f"  addresses  {addr['in_metro']:>9,}  rooftops {addr['rooftops']:,}")
    bld = aggregate_buildings(con, src("building"), metro)
    log(f"  buildings  {bld['in_metro']:>9,}")
    aggregate_places(con)
    prev = raw_path(metro, "place_prev")
    changes = release_diff(con, f"read_parquet('{prev}')") if prev.exists() else None
    if changes:
        t = changes["totals"]
        log(f"  changes    +{t['new_ids']:,} new ids, {t['newly_closed']:,} newly closed since {PREVIOUS_RELEASE}")
    label_cells(con, src("division_area"), src("division"))

    cells = rows(
        con,
        """
        SELECT c.h, coalesce(a.homes, 0) AS homes, coalesce(a.rooftops, 0) AS rooftops,
               coalesce(a.single_rooftops, 0) AS single_rooftops, coalesce(a.zip, pz.zip) AS zip,
               coalesce(b.buildings, 0) AS buildings, b.median_height, coalesce(b.footprint_m2, 0) AS footprint_m2,
               hood.hood, city.city
        FROM cells c
        LEFT JOIN hex_addr a USING (h) LEFT JOIN hex_bld b USING (h) LEFT JOIN hex_place_zip pz USING (h)
        LEFT JOIN cell_hood hood USING (h) LEFT JOIN cell_city city USING (h)
        ORDER BY c.h
    """,
    )
    index = {c["h"]: i for i, c in enumerate(cells)}
    sig_counts = [[0] * len(cells) for _ in sig.SIGNALS]
    for r in rows(con, "SELECT h, s, n FROM hex_sig"):
        i = index.get(r["h"])
        if i is not None:
            sig_counts[r["s"]][i] = r["n"]

    cell_zips = fill_from_neighbors([c["h"] for c in cells], [zip5(c["zip"]) for c in cells])
    zip_homes: dict[str, int] = {}
    for c, z in zip(cells, cell_zips, strict=False):
        if z is not None:
            zip_homes[z] = zip_homes.get(z, 0) + c["homes"]

    names = _Interner()
    zips = _Interner()
    hexes = {
        "id": [c["h"] for c in cells],
        "homes": [c["homes"] for c in cells],
        "rooftops": [c["rooftops"] for c in cells],
        # percent of rooftops that are single-address (detached-house proxy)
        "single": [round(100 * c["single_rooftops"] / c["rooftops"]) if c["rooftops"] else 0 for c in cells],
        "buildings": [c["buildings"] for c in cells],
        "height": [None if c["median_height"] is None else round(c["median_height"], 1) for c in cells],
        "footprint": [round(c["footprint_m2"]) for c in cells],
        "zip": [zips(z) for z in cell_zips],
        "hood": [names(c["hood"]) for c in cells],
        "city": [names(c["city"]) for c in cells],
        "signals": {s.id: sig_counts[i] for i, s in enumerate(sig.SIGNALS)},
    }

    places = rows(
        con,
        """
        SELECT id, name, confidence, brand, lon, lat, s FROM places_sig
        WHERE s IS NOT NULL AND name IS NOT NULL ORDER BY s, confidence DESC, id
    """,
    )
    signal_counts = {s.id: sum(sig_counts[i]) for i, s in enumerate(sig.SIGNALS)}

    doc = {
        "metro": {
            "id": metro.id,
            "name": metro.name,
            "region": metro.region,
            "bbox": metro.bbox,
            "center": metro.center,
            "zoom": metro.zoom,
        },
        "release": RELEASE,
        "schema": SCHEMA,
        "h3_res": H3_RES,
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signals": sig.manifest(),
        "ledger": {
            "places": ledger,
            "addresses": addr,
            "buildings": bld,
            "cells": len(cells),
            "signal_places": signal_counts,
        },
        "names": names.values,
        "zips": [{"code": z, "homes": zip_homes.get(z, 0)} for z in zips.values],
        "hexes": hexes,
        "changes": None if changes is None else {"since": PREVIOUS_RELEASE, **changes},
        "places": {
            "id": [p["id"] for p in places],
            "name": [p["name"] for p in places],
            "brand": [p["brand"] for p in places],
            "signal": [p["s"] for p in places],
            "confidence": [round(p["confidence"], 2) for p in places],
            "lon": [round(p["lon"], 5) for p in places],
            "lat": [round(p["lat"], 5) for p in places],
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{metro.id}.json"
    out.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
    log(f"  → {out.name}  {len(cells):,} cells, {len(places):,} places, {out.stat().st_size / 1e6:.1f} MB")
    return {
        "id": metro.id,
        "name": metro.name,
        "region": metro.region,
        "center": metro.center,
        "zoom": metro.zoom,
        "cells": len(cells),
        "homes": sum(hexes["homes"]),
        "places_kept": ledger["kept"],
        # addresses per rooftop. ~1.0 means the county feed lists buildings, not apartment units,
        # so dense blocks are under-counted; the app warns about it.
        "units_per_rooftop": addr["units_per_rooftop"],
        "bytes": out.stat().st_size,
    }


def write_index(entries: list[dict], out_dir: Path) -> None:
    doc = {"release": RELEASE, "schema": SCHEMA, "metros": entries}
    (out_dir / "index.json").write_text(json.dumps(doc, indent=2))
