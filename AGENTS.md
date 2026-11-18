# AGENTS.md

Orientation for coding agents working in this repo. Humans: start with [README.md](README.md) and [docs/](docs/README.md).

## What this is

Catchment is a geo-targeting planner for local-service ads, built on Overture Maps data. A Python pipeline (`pipeline/`) extracts and aggregates Overture data to H3 cells and writes `app/public/data/<metro>.json`. A React app (`app/`) scores cells, places radius pins and exports ZIPs and pins, all in the browser. A small Node server (`app/server/`) serves the build and an AI API (`gpt-6.1-terra`) for brief → plan and grounded ad angles.

## Where things are

| Need | Look in |
| --- | --- |
| Overture release, metros, thresholds | `pipeline/catchment/config.py` |
| Place cleaning rules | `pipeline/catchment/clean.py` |
| Signal definitions (taxonomy → signal) | `pipeline/catchment/signals.py` |
| Cell roll-up, labels, ZIPs, output file | `pipeline/catchment/aggregate.py` |
| Data file schema (writer ↔ reader) | `docs/data-format.md`, `app/src/data/types.ts` |
| Scoring / planning / exports | `app/src/model/` (pure TS) |
| App state and URL | `app/src/state/` |
| Map rendering | `app/src/map/` |
| UI components, tour, tooltips, select | `app/src/ui/` |
| AI server: prompts, schemas, validation, guards | `app/server/` (see `docs/ai.md`) |
| AI client, store, brief box | `app/src/ai/` |
| Why something is the way it is | `docs/decisions.md` |

## Commands

```bash
cd app && npm ci && npm test && npm run typecheck && npm run lint && npm run build
cd app && npm run dev:server   # AI server on :8787 (needs OPENAI_API_KEY in ../.env)
cd pipeline && uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
cd pipeline && uv run python -m catchment build <metro>   # rebuild data from cache
```

Run the checks for whichever side you touched before finishing. CI runs all of them.

## Invariants: don't break these

1. **The model layer is pure.** `app/src/model/*` must not import React, map libraries or browser APIs.
2. **Plans are deterministic.** The same metro file and URL must give the same pins. Don't add randomness, and keep ties breaking on cell index.
3. **The data contract.** Changing a field in `aggregate.py` means changing `app/src/data/types.ts` and `data/metro.ts`, rebuilding every metro, and updating `docs/data-format.md`.
4. **One Overture release everywhere.** `config.RELEASE`, the data files and the basemap tiles must match.
5. **Every dropped place has exactly one ledger reason.** `raw == kept + sum(dropped)`.
6. **Darker blue = better fit** in both themes. Every colour exists in both palettes (CSS tokens, `map/colors.ts`, `map/basemap.ts`).
7. **Explanatory text uses `data-tip`, not `title`.** Dropdowns use `ui/Select.tsx`, not native `<select>`.
8. **Respect `prefers-reduced-motion`** for any new animation.
9. **`maplibre-gl` stays on v5** until deck.gl's interleaved mode supports v6.
10. **The OpenAI key is server-only.** Read it in `app/server/` only, never with a `VITE_` prefix, and never commit `.env`.
11. **AI proposes inputs, never outputs.** Models may suggest weights or wording; scores, pins and exports stay deterministic. New AI routes go through `guarded()` in `server/api.ts` (validation, cache, rate limit, budget) and use schema enums wherever the answer must come from a known set.
12. **Ad copy is grounded.** Angles may only cite server-chosen places, and they must pass `verifyAngles`. Don't loosen this to make the copy "better".

## Gotchas

- DuckDB 2.0: `con.sql(q).fetchall()` (relations don't keep results), and `geometry_always_xy` must be set (`db.connect()` does it).
- deck.gl layers accept `beforeId` at runtime but not in their types. Use the `UNDER_BUILDINGS` spread in `MapView.tsx`.
- Overture quirks are documented in `docs/data-pipeline.md` §6. Read that before "fixing" cleaning or labelling logic.
- The tour's `before()` hooks change app state (selecting a cell, re-framing). Keep their selectors valid when you restructure the UI.

## Commit style

One logical change per commit. An imperative subject under ~72 characters. A body that explains why and names the non-obvious decisions. Every commit builds and passes CI. Don't add AI co-author or attribution trailers.
