# Data pipeline

`pipeline/catchment/` turns Overture's global GeoParquet into one small file per metro. It runs offline, and the output is committed, so the app never needs Python or S3.

```bash
cd pipeline
uv sync
uv run python -m catchment all              # extract + build every metro
uv run python -m catchment extract austin   # download raw slices only (cached)
uv run python -m catchment build austin     # rebuild from cached raw slices (seconds)
uv run python -m catchment all --force      # re-download even if cached
```

A full extract of all four metros takes about 4 minutes on a home connection. A rebuild from cache takes about 20 seconds.

## 1. Configuration (`config.py`)

Everything that changes the output lives here, so a diff of this file explains a diff of the data.

| Setting | Value | Why |
| --- | --- | --- |
| `RELEASE` | `2026-10-21.0` | Pinned Overture release, also used for the basemap tiles. |
| `SCHEMA` | `2.0.0` | Schema of that release (`categories` removed, `taxonomy` added). |
| `H3_RES` | `9` | ~0.1 km² cells: block-level differences, with dozens of addresses per cell. |
| `MIN_CONFIDENCE` | `0.5` | Keeps ~85% of SF places and cuts most of the stale long tail. |
| `DEDUPE_METERS` | `40` | Same normalised name within 40 m means one business seen by two sources. |
| `METROS` | 4 boxes | `sf-bay`, `austin`, `chicago`, `denver`, each with `bbox`, `center`, `zoom`. |

## 2. Extract (`extract.py`)

DuckDB reads `s3://overturemaps-us-west-2/release/<RELEASE>/theme=…/type=…/*` directly, with no credentials. The filter is an overlap test on Overture's `bbox` struct column (`Metro.where`), which lets DuckDB skip row groups outside the metro instead of downloading the planet.

| Layer | Columns kept | Notes |
| --- | --- | --- |
| `places/place` | id, name, confidence, operating_status, basic_category, taxonomy, brand, brand wikidata, first address postcode, source datasets, geometry | |
| `addresses/address` | id, street, number, unit, postcode, postal_city, country, geometry | One point per address; units are separate points where listed. |
| `buildings/building` | id, subtype, class, height, num_floors, centroid, footprint m² | Footprints become centroids, with area computed on the spheroid. |
| `divisions/division_area` | id, division_id, name, subtype, class, country, geometry | Only `county`, `locality`, `neighborhood`, `macrohood`, `microhood`. |
| `divisions/division` | id, name, subtype, class, local_type, population, country, geometry | Points. They label cells where polygons are missing. |

Slices are written to `pipeline/data/raw/<metro>/<type>.parquet` (gitignored). Writes go to a `.tmp.parquet` first and are renamed into place, so an interrupted run never leaves a half-written cache. HTTP reads retry with backoff (`db.connect(remote=True)`).

## 3. Clean places (`clean.py`)

Each place is judged once, in this order, and gets **exactly one** reason if it's dropped. The counts form the *ledger* that the app shows in "About the data".

| Order | Reason | Rule |
| --- | --- | --- |
| 1 | `outside` | Point outside the metro box. The bbox overlap pulls in edge rows. Not shown in the ledger. |
| 2 | `closed` | `operating_status` is `permanently_closed` or `temporarily_closed`. |
| 3 | `low_confidence` | `confidence` is missing or below `MIN_CONFIDENCE`. |
| 4 | `uncategorized` | No `taxonomy.primary`. |
| 5 | `duplicate` | A better-scored place with the same normalised name lies within `DEDUPE_METERS`. |

Notes:

- **Status is checked before confidence on purpose.** The schema says closed places carry confidence 0. In this release most closed places in SF have confidence ≥ 0.6, so a confidence filter alone would keep about 8,000 closed businesses in SF.
- **Name normalisation** lowercases the name, strips accents, and removes everything but `[a-z0-9]`, so `"Joe's Plumbing"` and `"JOES PLUMBING"` match. Names of 2 characters or fewer are never deduplicated.
- **The duplicate winner** is the higher `(confidence, id)` pair, so the result is deterministic.

## 4. Signals (`signals.py`)

Each kept place maps to **at most one** signal. Rules are checked in list order, so the more specific ones come first: a Whole Foods is a premium grocer before it is "everyday errands". A rule matches on `brand.names.primary`, `taxonomy.primary` or `basic_category`, and can exclude primaries.

| Signal id | Label | Matches |
| --- | --- | --- |
| `premium_grocers` | Premium grocers | Brands: Whole Foods Market, Trader Joe's, Sprouts, Erewhon, Natural Grocers, Central Market, Mariano's, Lazy Acres, Bristol Farms |
| `home_cleaning` | Cleaning services | home/carpet/duct cleaning, window washing, pressure washing, gutters |
| `home_trades` | Home repair trades | `basic_category = home_service`, minus cleaning, movers and furniture rental |
| `home_retail` | Home & hardware stores | `hardware_home_and_garden_store` |
| `moving` | Moves & real estate | movers, self storage, `real_estate_service` |
| `pet_care` | Pet sitters & boarding | pet sitting, boarding, dog walkers and trainers |
| `pet_life` | Pet owners nearby | vets, animal hospitals, groomers, pet stores, dog parks |
| `families` | Young families | preschools, elementary and middle schools, childcare, playgrounds, pediatricians |
| `tutoring` | Tutoring & classes | tutoring, specialty schools, educational services |
| `fitness` | Gyms & studios | gyms, fitness studios, sport/fitness facilities |
| `nightlife` | Nightlife | bars, clubs, lounges, music venues |
| `offices` | Offices | corporate/business offices, coworking |
| `daily_needs` | Everyday errands | groceries, coffee, cafés, convenience, pharmacies, laundromats |
| `seniors` | Senior living | senior living, retirement homes |

The same rules exist as a SQL `CASE` (`signal_case_sql`, used by the build) and as Python (`classify`, used by tests). A test asserts the two agree. Signal labels and descriptions are written into each data file, so the app never hard-codes them.

## 5. Aggregate (`aggregate.py`)

All points are assigned to cells with `h3_latlng_to_cell_string(lat, lon, 9)` (DuckDB `h3` community extension). The cell set is every cell that has an address or a building.

**Homes and rooftops.** Addresses are grouped into rooftops by `(street, number)`. Per cell:
- `homes` is the number of address points.
- `rooftops` is the number of distinct rooftops.
- `single` is the percentage of rooftops with exactly one address and no unit, a detached-house proxy.

**Buildings.** Per cell: count, median height and total footprint.

**Signal counts.** Places per (cell, signal).

**ZIP per cell**, in priority order:
1. The modal postcode of the cell's address rooftops.
2. Otherwise the modal postcode of the cell's places, but only a *trusted* ZIP: one that appears in the address feed, or that at least 20 places in the metro agree on. Place postcodes include mailing ZIPs from other states (a New Hampshire ZIP appeared in the Bay Area before this rule).
3. Otherwise the most common ZIP in the nearest labelled H3 ring (k = 1…3, `cells.fill_from_neighbors`).

Ties in postcode counts use the lowest postcode at each step. A ZIP's `homes` total is the sum of homes in the cells assigned to it, which keeps ZIP reach consistent with cell reach.

**Neighbourhood label** (`hood`):
1. The containing neighbourhood polygon, ranked neighbourhood > microhood > macrohood. Polygons under 0.2 km² are ignored (Overture tags plazas and pocket parks as microhoods), as are names like `Beat 2511`, `District 4`, `Ward 12` and `Precinct 3` (Chicago police beats are tagged as neighbourhoods).
2. Otherwise the nearest `neighborhood` or `macrohood` *point* within 2 km. Microhood points are ignored for the same reason.

**City label** (`city`):
1. The containing locality polygon, ranked by the division's `local_type`: city > town > village > hamlet > other, then the smaller area. Townships (`local_type = locality`) overlap the cities inside them.
2. Otherwise the containing county polygon. Consolidated city-counties such as Denver and San Francisco keep their name. Ordinary counties read "Travis County".
3. Otherwise the nearest locality point.

**Output.** `app/public/data/<metro>.json` plus an updated `index.json`. The format is in [data-format.md](data-format.md).

## 5b. What changed since the previous release (`diff.py`)

GERS ids are stable across releases. The pipeline also reads the previous release (`PREVIOUS_RELEASE = 2026-09-23.0`, places only: id, status, confidence) and diffs it by id:

- **added**: a kept, signal-bearing place whose id didn't exist in the previous release. The app says "new in Overture", not "opened": the 2026-10 release added three sources, so a new id can be a newly sourced business.
- **closed**: a place that was open (or had no status) in the previous release and is closed now. That's a real status change for a known place.
- Ids that vanished entirely aren't reported: removal can mean closure, a merge, or a source dropping out.

Each metro file gets a `changes` block (85–290 places per metro, plus totals). The app reads it through the user's weights; see [frontend.md](frontend.md).

## 6. Data realities found while building

These are real properties of the 2026-10-21.0 release that shaped the code. They're worth knowing before changing anything.

| Finding | Where handled |
| --- | --- |
| Closed places often have high confidence | `clean.py` checks status first |
| Alameda County addresses (Oakland, Berkeley) have no postcodes | ZIP backfill from trusted place postcodes |
| Place postcodes include out-of-state mailing ZIPs | 20-place trust rule |
| Austin's and Chicago's county feeds list buildings, not units (1.04–1.06 addresses per rooftop, against 1.6 in SF and Denver) | `units_per_rooftop` recorded. The app warns in the legend and the ledger. Not "fixed" by guessing units. |
| Plazas tagged as microhoods; police beats tagged as neighbourhoods | Area floor and name filter (also applied to basemap labels) |
| Townships overlap cities; Denver has only a county polygon | `local_type` ranking, county fallback |

## 7. Built metros

| Metro | Cells | Places kept / in box | Address points | Addresses per rooftop |
| --- | ---: | ---: | ---: | ---: |
| `sf-bay` (San Francisco & Oakland) | 3,741 | 98,512 / 120,769 | 671,630 | 1.58 |
| `austin` | 11,060 | 82,756 / 103,352 | 427,527 | 1.04 |
| `chicago` | 11,758 | 180,173 / 268,149 | 1,026,184 | 1.06 |
| `denver` | 5,989 | 88,144 / 108,156 | 646,143 | 1.66 |

## Extending

**Add a metro.** Add a `Metro(...)` to `config.METROS`. Give it an id, a display name, a region, a bbox `(xmin, ymin, xmax, ymax)`, a centre and a zoom. Then run `python -m catchment all <id>`. The app discovers it through `index.json`, with no app change needed. Check its `units_per_rooftop` and ZIP coverage in the build log before trusting it.

**Add or change a signal.** Edit `SIGNALS` in `signals.py`, keeping the specific rules before the general ones. Add a case to `TestSignals.test_classify`, rebuild every metro, and add the signal to any profile in `app/src/model/profiles.ts` that should use it. Factors are generated from the data file's `signals` list, so the panel picks it up automatically.

**Change a threshold.** Edit `config.py`, rebuild, and update the numbers in section 7 and in the README.

## Tests

```bash
uv run pytest -q        # 28 tests, offline, about 2 s
uv run ruff check . && uv run ruff format --check .
```

`tests/test_pipeline.py` builds tiny tables in an in-memory DuckDB. It covers each cleaning rule (including "closed beats confidence" and "every place is accounted for once"), SQL/Python classifier parity, the address roll-up (units, rooftops, detached share), ZIP normalisation and the ring fill.

## DuckDB 2.0 notes

- `SET geometry_always_xy = true` is set explicitly in `db.connect()`. Overture geometries are lon/lat, and spheroid functions refuse to guess the axis order in 2.0.
- Relations no longer keep results: use `con.sql(q).fetchall()`, not `.fetchone()`. Helpers are in `db.py` (`rows`, `scalar`).
- The `h3` extension comes from the community repository (`INSTALL h3 FROM community`).
