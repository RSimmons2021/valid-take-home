# Development

## Prerequisites

| Tool | Version used | For |
| --- | --- | --- |
| Node | 22 | the app |
| npm | 10+ | the app (lockfile is `app/package-lock.json`) |
| Python | 3.12+ | the pipeline |
| [uv](https://docs.astral.sh/uv/) | latest | Python env and lockfile (`pipeline/uv.lock`) |

The pipeline is only needed to change data. The app builds from the committed files in `app/public/data/`.

## Commands

```bash
# app
cd app
npm ci
npm run dev          # http://localhost:5173
npm test             # vitest: model + sketch tests (24)
npm run typecheck    # tsc -b
npm run lint         # oxlint src
npm run build        # static site → app/dist (relative base, deployable anywhere)
npm run preview      # serve app/dist on :4173

# pipeline
cd pipeline
uv sync
uv run pytest -q                       # 27 tests, offline
uv run ruff check . && uv run ruff format --check .
uv run python -m catchment all         # extract + build all metros
uv run python -m catchment build denver
```

CI (`.github/workflows/ci.yml`) runs exactly these checks on every push and PR: ruff, ruff format and pytest for the pipeline; lint, typecheck, test and build for the app.

## Deploying

`render.yaml` describes a Render static site:

| Setting | Value |
| --- | --- |
| Root | `app/` |
| Build | `npm ci && npm run build` |
| Publish directory | `dist` |
| Caching | `/assets/*` immutable for a year, `/data/*` for an hour |

Any static host works: the build uses a relative base (`./`), and all routing is in the URL hash.

## Testing first-visit behaviour

The welcome dialog and the tour show once per browser. To see them again, either click **Guide** (the tour only), or clear the keys in the console:

```js
["catchment.welcomed", "catchment.toured"].forEach((k) => localStorage.removeItem(k)); location.reload();
```

A private window works too.

## Conventions

**Code**
- **Model code is pure.** Nothing in `app/src/model/` may import React, map code or browser APIs. Put anything visual in `map/` or `ui/`.
- **Pipeline thresholds live in `config.py`.** Don't scatter magic numbers through the SQL.
- **Comments explain why, not what.** Data quirks in particular get a comment at the line that handles them.
- **Colours are tokens.** Add to both the light and dark token sets in `styles.css`. WebGL colours go in both palettes in `map/colors.ts` and `map/basemap.ts`.
- **Explanatory UI text uses `data-tip`.** Don't use `title`.

**Tests**
- Pipeline rules are tested on tiny synthetic tables, offline. Add a test with any new cleaning rule or signal.
- The planner and scorer are tested on synthetic H3 disks (`fakeMetro` in `model.test.ts`). Keep determinism tests passing: shared links depend on them.

**Commits**
- One logical change per commit, in build order.
- An imperative subject under ~72 characters.
- A body that explains *why*, names non-obvious decisions, and lists data findings.
- Every commit should build and pass CI on its own.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Map throws `Cannot read properties of undefined (reading 'height')` in `getViewport` | MapLibre 6 with deck.gl 9.4 interleaved mode. Keep `maplibre-gl@^5`. |
| `Worker failed to load` from MapLibre after changing its version | Vite's dependency cache is stale. Restart with `npx vite --force`. |
| DuckDB error about `geometry_always_xy` | Use `db.connect()`, which sets it. Overture geometries are lon/lat. |
| DuckDB `Relations no longer have fetchone()` | DuckDB 2.0: use `con.sql(q).fetchall()` or the `rows`/`scalar` helpers. |
| Extraction fails with `Could not resolve hostname` | Transient DNS or S3 hiccup. Re-run: finished layers are cached and skipped. |
| Map labels missing | The glyph host (`protomaps.github.io`) is unreachable. Data layers still work. |
| A metro shows few ZIPs or odd labels | Check the build log's ledger and `units_per_rooftop`, and read [data-pipeline.md §6](data-pipeline.md#6-data-realities-found-while-building). |
