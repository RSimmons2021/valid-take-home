"""Behaviour of the cleaning, classification and aggregation rules, on small synthetic data.

These run offline on tiny tables in an in-memory DuckDB.
"""

from __future__ import annotations

import h3
import pytest

from catchment import signals as sig
from catchment.aggregate import aggregate_addresses
from catchment.cells import fill_from_neighbors, zip5
from catchment.clean import clean_places
from catchment.config import Metro
from catchment.db import connect, rows, scalar


def q(v) -> str:
    """A SQL literal (Python's repr would double-quote "Joe's", which SQL reads as a column)."""
    if v is None:
        return "NULL::VARCHAR"
    return "'" + str(v).replace("'", "''") + "'"


BOX = Metro("test", "Test", "CA", (-122.5, 37.7, -122.3, 37.9), (-122.4, 37.8), 12)


@pytest.fixture(scope="module")
def database():
    with connect() as con:
        yield con


@pytest.fixture
def con(database):
    # Load the extensions once. Roll back table creation and data changes after each test.
    database.begin()
    try:
        yield database
    finally:
        database.rollback()


def make_places(con, places: list[dict]) -> str:
    """places: dicts with id, name, lon, lat and optional confidence/status/primary/basic."""
    values = []
    for p in places:
        primary = p.get("primary", "coffee_shop")
        values.append(
            "({id}, {name}, {conf}, {status}, {basic}, "
            "{{'primary': {prim}, 'hierarchy': [], 'alternates': []}}, NULL, "
            "ST_Point({lon}, {lat}))".format(
                id=q(p["id"]),
                name=q(p["name"]),
                conf=p.get("confidence", 0.9),
                status=q(p.get("status")),
                basic=q(p.get("basic", "coffee_shop")),
                prim=q(primary),
                lon=p["lon"],
                lat=p["lat"],
            )
        )
    con.sql(f"""
        CREATE OR REPLACE TABLE src AS SELECT * FROM (VALUES {", ".join(values)})
        t(id, name, confidence, operating_status, basic_category, taxonomy, brand, geometry)
    """)
    return "src"


def kept_ids(con) -> set[str]:
    return {r["id"] for r in rows(con, "SELECT id FROM places")}


class TestCleanPlaces:
    def test_closed_places_are_dropped_even_with_high_confidence(self, con):
        # The 2026-10 release has closed places scored 0.9; status must win.
        src = make_places(
            con,
            [
                {"id": "a", "name": "Open Cafe", "lon": -122.4, "lat": 37.8},
                {
                    "id": "b",
                    "name": "Gone Cafe",
                    "lon": -122.41,
                    "lat": 37.8,
                    "confidence": 0.95,
                    "status": "permanently_closed",
                },
            ],
        )
        ledger = clean_places(con, src, BOX)
        assert kept_ids(con) == {"a"}
        assert ledger["dropped"]["closed"] == 1

    def test_low_confidence_and_missing_confidence_are_dropped(self, con):
        src = make_places(
            con,
            [
                {"id": "a", "name": "Sure", "lon": -122.4, "lat": 37.8, "confidence": 0.5},
                {"id": "b", "name": "Unsure", "lon": -122.41, "lat": 37.8, "confidence": 0.49},
                {"id": "c", "name": "Unknown", "lon": -122.42, "lat": 37.8, "confidence": "NULL"},
            ],
        )
        ledger = clean_places(con, src, BOX)
        assert kept_ids(con) == {"a"}
        assert ledger["dropped"]["low_confidence"] == 2

    def test_uncategorized_and_outside_are_dropped(self, con):
        src = make_places(
            con,
            [
                {"id": "a", "name": "In", "lon": -122.4, "lat": 37.8},
                {"id": "b", "name": "No category", "lon": -122.41, "lat": 37.8, "primary": None},
                {"id": "c", "name": "Far away", "lon": -100.0, "lat": 37.8},
            ],
        )
        ledger = clean_places(con, src, BOX)
        assert kept_ids(con) == {"a"}
        assert ledger["dropped"]["uncategorized"] == 1
        assert ledger["dropped"]["outside"] == 1

    def test_near_twins_merge_keeping_the_more_confident_listing(self, con):
        # ~11 m apart, same name modulo case/punctuation → one business, two sources.
        src = make_places(
            con,
            [
                {"id": "a", "name": "Joe's Plumbing", "lon": -122.4, "lat": 37.8, "confidence": 0.7},
                {"id": "b", "name": "JOES PLUMBING", "lon": -122.4, "lat": 37.8001, "confidence": 0.9},
            ],
        )
        ledger = clean_places(con, src, BOX)
        assert kept_ids(con) == {"b"}
        assert ledger["dropped"]["duplicate"] == 1

    def test_same_name_far_apart_is_two_places(self, con):
        # Two Starbucks 300 m apart are two Starbucks.
        src = make_places(
            con,
            [
                {"id": "a", "name": "Starbucks", "lon": -122.4, "lat": 37.8},
                {"id": "b", "name": "Starbucks", "lon": -122.4, "lat": 37.8027},
            ],
        )
        clean_places(con, src, BOX)
        assert kept_ids(con) == {"a", "b"}

    def test_every_place_is_accounted_for_once(self, con):
        src = make_places(
            con,
            [
                {
                    "id": str(i),
                    "name": f"P{i % 3}",
                    "lon": -122.4 + i * 1e-5,
                    "lat": 37.8,
                    "confidence": 0.3 + (i % 7) / 10,
                    "status": "permanently_closed" if i % 5 == 0 else None,
                }
                for i in range(40)
            ],
        )
        ledger = clean_places(con, src, BOX)
        assert ledger["kept"] + sum(ledger["dropped"].values()) == 40


class TestSignals:
    @pytest.mark.parametrize(
        ("primary", "basic", "brand", "expected"),
        [
            ("plumbing", "home_service", None, "home_trades"),
            ("home_cleaning", "home_service", None, "home_cleaning"),  # cleaning beats trades
            ("mover", "home_service", None, "moving"),  # excluded from trades
            ("grocery_store", "food_and_beverage_store", "Whole Foods Market", "premium_grocers"),
            ("grocery_store", "food_and_beverage_store", "Safeway", "daily_needs"),
            ("dog_walker", "animal_or_pet_service", None, "pet_care"),
            ("veterinarian", "animal_or_pet_service", None, "pet_life"),
            ("yoga_studio", "fitness_studio", None, "fitness"),
            ("law_firm", "attorney_or_law_firm", None, None),
        ],
    )
    def test_classify(self, primary, basic, brand, expected):
        assert sig.classify(primary, basic, brand) == expected

    def test_sql_and_python_classifiers_agree(self, con):
        cases = [
            ("plumbing", "home_service", None),
            ("home_cleaning", "home_service", None),
            ("mover", "home_service", None),
            ("grocery_store", "food_and_beverage_store", "Trader Joe's"),
            ("dog_park", "dog_park", None),
            ("preschool", "preschool", None),
            ("bar", "bar", None),
            ("law_firm", "attorney_or_law_firm", None),
            (None, None, None),
        ]
        for primary, basic, brand in cases:
            case = sig.signal_case_sql("p", "b", "br")
            got = con.sql(f"SELECT {case} FROM (SELECT {q(primary)} p, {q(basic)} b, {q(brand)} br)").fetchall()[0][0]
            want = sig.classify(primary, basic, brand)
            assert (None if got is None else sig.SIGNALS[got].id) == want, (primary, basic, brand)

    def test_signal_ids_are_unique(self):
        assert len({s.id for s in sig.SIGNALS}) == len(sig.SIGNALS)


class TestAddresses:
    def test_tied_postcodes_choose_the_lower_zip(self, con):
        con.sql("""
            CREATE TABLE a AS SELECT * FROM (VALUES
                ('A St', '1', NULL, '94114', ST_Point(-122.4, 37.8)),
                ('A St', '1', NULL, '94110', ST_Point(-122.4, 37.8)),
                ('B St', '2', NULL, '94114', ST_Point(-122.4, 37.8))
            ) t(street, number, unit, postcode, geometry)
        """)
        aggregate_addresses(con, "a", BOX)
        assert scalar(con, "SELECT zip FROM roof WHERE street = 'A St'") == "94110"
        assert scalar(con, "SELECT zip FROM hex_addr") == "94110"

    def test_units_count_as_homes_and_rooftops_split_houses_from_blocks(self, con):
        lon, lat = -122.4, 37.8
        pts = [("1 A St", "1", None)] + [("2 A St", "2", f"#{u}") for u in range(10)]
        values = ", ".join(
            f"({q(street)}, {q(num)}, {q(unit)}, '94110', ST_Point({lon}, {lat}))" for street, num, unit in pts
        )
        con.sql(f"CREATE TABLE a AS SELECT * FROM (VALUES {values}) t(street, number, unit, postcode, geometry)")
        stats = aggregate_addresses(con, "a", BOX)
        cell = rows(con, "SELECT * FROM hex_addr")
        assert len(cell) == 1
        assert cell[0]["homes"] == 11  # 1 house + 10 units
        assert cell[0]["rooftops"] == 2
        assert cell[0]["single_rooftops"] == 1  # only the house
        assert stats["in_metro"] == 11


class TestCells:
    @pytest.mark.parametrize(
        ("raw", "want"),
        [
            ("94110", "94110"),
            ("94110-1234", "94110"),
            (" 94110 ", "94110"),
            ("9411", None),
            ("", None),
            (None, None),
            ("SW1A 1AA", None),
        ],
    )
    def test_zip5(self, raw, want):
        assert zip5(raw) == want

    def test_fill_takes_the_nearest_ring(self):
        center = h3.latlng_to_cell(37.8, -122.4, 9)
        ring1 = sorted(h3.grid_ring(center, 1))
        ring2 = sorted(h3.grid_ring(center, 2))
        ids = [center, *ring1, *ring2]
        # one ring-1 neighbour says 94110; every ring-2 cell says 94999
        values = [None, "94110", *([None] * 5), *(["94999"] * len(ring2))]
        out = fill_from_neighbors(ids, values)
        assert out[0] == "94110"

    def test_fill_leaves_isolated_cells_empty(self):
        a = h3.latlng_to_cell(37.8, -122.4, 9)
        b = h3.latlng_to_cell(40.0, -100.0, 9)
        assert fill_from_neighbors([a, b], [None, "94110"]) == [None, "94110"]


class TestReleaseDiff:
    def test_added_and_newly_closed_by_gers_id(self, con):
        from catchment.aggregate import aggregate_places
        from catchment.diff import release_diff

        src = make_places(
            con,
            [
                {"id": "old", "name": "Old Vet", "lon": -122.40, "lat": 37.80, "primary": "veterinarian", "basic": "x"},
                {"id": "new", "name": "New Vet", "lon": -122.41, "lat": 37.80, "primary": "veterinarian", "basic": "x"},
                {
                    "id": "shut",
                    "name": "Shut Vet",
                    "lon": -122.42,
                    "lat": 37.80,
                    "primary": "veterinarian",
                    "basic": "x",
                    "status": "permanently_closed",
                },
                {
                    "id": "was_shut",
                    "name": "Long Gone Vet",
                    "lon": -122.43,
                    "lat": 37.80,
                    "primary": "veterinarian",
                    "basic": "x",
                    "status": "permanently_closed",
                },
            ],
        )
        clean_places(con, src, BOX)
        con.sql("ALTER TABLE places ADD COLUMN postcode VARCHAR")
        con.sql("CREATE TEMP TABLE addr (postcode VARCHAR)")  # aggregate_places checks place ZIPs against addresses
        aggregate_places(con)
        con.sql(
            "CREATE TABLE prev_src AS SELECT * FROM (VALUES ('old', 'open'), ('shut', 'open'), "
            "('was_shut', 'permanently_closed')) t(id, operating_status)"
        )
        d = release_diff(con, "prev_src")
        assert d["added"]["name"] == ["New Vet"]  # absent last release, kept now
        assert d["closed"]["name"] == ["Shut Vet"]  # open then, closed now; already-closed isn't news
        assert d["totals"] == {"new_ids": 1, "newly_closed": 1}
        assert sig.SIGNALS[d["added"]["signal"][0]].id == "pet_life"
