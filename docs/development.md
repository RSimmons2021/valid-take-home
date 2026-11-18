# Development

## Prerequisites

| Tool | Version used | For |
| --- | --- | --- |
| Node | 22 | the app |
| npm | 10+ | the app (lockfile is `app/package-lock.json`) |
| Python | 3.12+ | the pipeline |
| [uv](https://docs.astral.sh/uv/) | latest | Python env and lockfile (`pipeline/uv.lock`) |
| OpenAI API key | optional | AI features; put `OPENAI_API_KEY=…` in the repo-root `.env` (gitignored; see `.env.example`) |

The pipeline is only needed to change data. The app builds from the committed files in `app/public/data/`.

## Commands

```bash
# app
cd app
npm ci
npm run dev          # http://localhost:5173 (proxies /api to :8787)
npm run dev:server   # AI + static server on :8787, reads ../.env, restarts on change
npm start            # production server: serves dist/ and /api
npm test             # vitest: model, server, MCP, history, matcher (89)
npm run e2e          # Playwright flows + axe audit on dist/ (run npm run build first)
npm run mcp:build    # bundle the MCP server → dist-mcp/catchment-mcp.js
npm run typecheck    # tsc -b
npm run lint         # oxlint src server
npm run build        # static site → app/dist (relative base, deployable anywhere)
npm run preview      # serve app/dist on :4173

# pipeline
cd pipeline
uv sync
uv run pytest -q                       # 28 tests, offline
uv run ruff check . && uv run ruff format --check .
uv run python -m catchment all         # extract + build all metros
uv run python -m catchment build denver
```

CI (`.github/workflows/ci.yml`) runs exactly these checks on every push and PR: ruff, ruff format and pytest for the pipeline; lint, typecheck, test, build and the MCP build for the app; and an e2e job (Playwright + axe, traces uploaded on failure).

## Deploying

`render.yaml` describes a Render **web service**: one Node process serving the app and the AI API.

| Setting | Value |
| --- | --- |
| Root | `app/` |
| Build | `npm ci && npm run build` |
| Start | `npm start` (`node server/main.ts`) |
| Health check | `/api/health` |
| Environment | `NODE_VERSION=22.22.0`, `OPENAI_API_KEY` (set it in the dashboard, never in the file), `AI_DAILY_BUDGET_USD=3` |

The server sets cache headers itself: `/assets/*` immutable, `/data/*` for an hour, the page always revalidated. It also gzips text responses.

### Vercel front end, Render API

`app/vercel.json` builds the static site on Vercel and **rewrites `/api/*` and `/s` to the Render service**, so the browser only ever talks to one origin: no CORS, and the AI key stays on Render.

1. Deploy the Render service from `render.yaml` and set `OPENAI_API_KEY` in its dashboard.
2. If Render gives the service a URL other than `https://catchment.onrender.com`, change the two `destination`s in `app/vercel.json`.
3. Import the repo on Vercel with **Root Directory `app`**. No environment variables are needed there.

Notes:
- The server builds share-page URLs from `X-Forwarded-Host`, so previews point at the Vercel domain.
- Rate limits use the first `X-Forwarded-For` address, which is the visitor.
- Render's free tier sleeps when idle. The app's health check keeps retrying for about a minute, and the AI controls appear once the server wakes.

**Static hosting still works** (`app/dist` on any static host). The AI health check fails, the AI controls hide, and everything else behaves the same.

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
| No "Describe your business" box | `/api/health` reports `ai: false`: the server isn't running (`npm run dev:server`), or `OPENAI_API_KEY` is missing from `../.env`. |
| `/s` links or `/api/previews` return 404 locally | The AI server is running old code. Node's `--watch` can miss changes on some mounts (it did on an SD card), so restart `npm run dev:server`. |
| AI answers look stale after editing a prompt | The server caches responses by request. Restart it (the cache is in memory), or click Regenerate for angles. |
| A metro shows few ZIPs or odd labels | Check the build log's ledger and `units_per_rooftop`, and read [data-pipeline.md §6](data-pipeline.md#6-data-realities-found-while-building). |
