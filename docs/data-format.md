# Data format

The pipeline writes two kinds of file into `app/public/data/`. The writer is `pipeline/catchment/aggregate.py` and the reader's types are `app/src/data/types.ts`. Keep them in step.

## `index.json`

A list of the available metros. The app loads it first, to fill the metro picker and to pick a default.

```jsonc
{
  "release": "2026-10-21.0",
  "schema": "2.0.0",
  "metros": [
    {
      "id": "sf-bay",                 // file name stem and URL key
      "name": "San Francisco & Oakland",
      "region": "California",
      "center": [-122.33, 37.79],     // [lon, lat]
      "zoom": 11.4,
      "cells": 3741,
      "homes": 671630,
      "places_kept": 98512,
      "units_per_rooftop": 1.58,      // < 1.2 means the county doesn't list apartment units
      "bytes": 2428802
    }
  ]
}
```

## `<metro>.json`

**Columnar**: instead of an array of cell objects, each field is one array, and index `i` in every array refers to the same cell. This keeps the file small (0.8–1.5 MB gzipped), makes parsing a single `JSON.parse`, and lets the app copy each column straight into a typed array.

### Top level

| Key | Type | Meaning |
| --- | --- | --- |
| `metro` | object | `id`, `name`, `region`, `bbox` `[xmin, ymin, xmax, ymax]`, `center` `[lon, lat]`, `zoom` |
| `release`, `schema` | string | Overture release and schema the file was built from |
| `h3_res` | number | H3 resolution of `hexes.id` (9) |
| `built_at` | string | ISO-8601 UTC build time |
| `signals` | `{id, label, description}[]` | Signal definitions, **in index order**. `places.signal` indexes into this. |
| `ledger` | object | Cleaning and coverage stats (below) |
| `names` | string[] | Interned neighbourhood and city names. `hexes.hood` and `hexes.city` index into it. |
| `zips` | `{code, homes}[]` | ZIPs and their total homes. `hexes.zip` indexes into it. |
| `hexes` | object of arrays | One entry per cell (below) |
| `changes` | object \| null | Places changed since the previous release: `since`, `added` and `closed` (columnar: id, name, signal, lon, lat), and `totals` |
| `places` | object of arrays | Named places that map to a signal (below) |

### `hexes` (length = number of cells, sorted by H3 id)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | H3 cell id (resolution 9) |
| `homes` | int | Address points in the cell |
| `rooftops` | int | Distinct (street, number) pairs |
| `single` | int 0–100 | % of rooftops with one address and no unit (0 when there are no rooftops) |
| `buildings` | int | Building centroids in the cell |
| `height` | number \| null | Median building height in metres |
| `footprint` | int | Total building footprint in m² |
| `zip` | int | Index into `zips`, or `-1` |
| `hood` | int | Index into `names`, or `-1` |
| `city` | int | Index into `names`, or `-1` |
| `signals` | `{[signalId]: int[]}` | Places of each signal in the cell itself. The app sums neighbours. |

### `places` (only places with a signal and a name; sorted by signal, then confidence descending)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Overture GERS ID |
| `name` | string | `names.primary` |
| `brand` | string \| null | `brand.names.primary` |
| `signal` | int | Index into `signals` |
| `confidence` | number | Overture confidence, rounded to 2 decimals |
| `lon`, `lat` | number | Rounded to 5 decimals (~1 m) |

### `ledger`

```jsonc
{
  "places": {
    "raw": 120769,                 // in the metro box (edge rows from the bbox overlap excluded)
    "kept": 98512,
    "dropped": { "closed": 8096, "low_confidence": 11655, "uncategorized": 2283, "duplicate": 223 },
    "min_confidence": 0.5,
    "dedupe_meters": 40.0
  },
  "addresses": { "in_metro": 671630, "rooftops": 426239, "with_postcode": 407691, "units_per_rooftop": 1.58 },
  "buildings": { "in_metro": 417755, "with_height": 326125 },
  "cells": 3741,
  "signal_places": { "home_trades": 3877, "...": 0 }   // places per signal after cleaning
}
```

`raw == kept + sum(dropped)` always holds. A pipeline test enforces it.

## Conventions

- **Missing values.** Index fields use `-1`. Measured values use `null`. Counts are never missing (they're 0).
- **Coordinates** are WGS84 `[lon, lat]` everywhere except where named `lat`/`lon` explicitly.
- **Stable identity.** Places carry GERS IDs, so a future "what changed since the last release" view can diff places by ID.
- **Compatibility.** The app reads fields by name and ignores unknown keys, so adding a field is backward compatible. Renaming or removing one means changing `types.ts` and `data/metro.ts` and rebuilding all metros.

## In the browser (`app/src/data/metro.ts`)

`buildMetro(file)` converts a file into a `Metro`:

- Each column becomes a `Float64Array` or `Int32Array`.
- `lat`/`lon` come from the cell centres, and `x`/`y` are metres from the metro centre (equirectangular projection, accurate enough at city scale) for distance queries.
- `counts[signal]` is per cell. `near[signal]` is the sum over the cell and its six neighbours (`gridDisk(id, 1)`, about a 450 m radius). Scoring uses `near`.
- `places.cell` is each place's cell index, so a cell's nearby places can be listed without a spatial index.
