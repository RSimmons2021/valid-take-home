# Catchment

**Find the neighbourhoods worth paying for.** Catchment scores every block of a city for a local-service business's customer, using Overture Maps data, then exports a geo-targeting plan (ZIP lists and radius pins) that pastes straight into Meta and Google Ads.

Metros: San Francisco & Oakland, Austin, Chicago, Denver · Overture release `2026-10-21.0`

## Why this

Local-service brands (home repair, cleaning, pet care, fitness, tutoring) buy ads for places, not people. A media buyer launching one of them in a new city usually guesses: a ring around downtown, the ZIPs a founder knows, whatever the platform's "people living in" box suggests. The result pays to reach apartment towers for a handyman subscription, or ZIPs where three competitors already sit on every corner.

Overture is unusually good at exactly the inputs this needs: county address points (how many homes, and whether they're houses or units), 88M places with a fresh taxonomy (where vets, hardware stores, preschools and competitors are), and buildings. Catchment turns those into one question per cell, "is this a place my customer lives?", and one artifact a buyer can act on: the export.

I picked it because the user and the workflow are concrete (paste a ZIP list into Ads Manager on Monday), and because it's a problem where being honest about data quality changes the answer.

## Using it

First-time visitors get a welcome card, then a six-step guided tour drawn in hand-written notes, arrows and circles over the real controls. It opens a live cell rather than showing screenshots, so it can't go stale. The **Guide** button replays it.

1. **Pick a business.** Each profile is a starting set of weights, all visible and editable.
2. **Say what matters.** Every factor takes one of five steps, from *avoid strongly* to *prefer strongly*. The map rescores instantly, with cells fading to their new colour. Darker blue means a better fit in both themes. Click any cell for a verdict, the factors that pushed it, and the named Overture places behind it, linked on the map by lines (blue for prefer, red for avoid).
3. **Plan.** Choose the number of pins and a radius (1 mile minimum, Meta's smallest). Pins are placed where they add the most well-fit homes not already reached. The panel reports reach, **on-target share** (how much of what you'd pay for actually fits) and **capture** (how much of the city's fit you'd reach).
4. **Export.** ZIP list (with how much of each ZIP the pins really cover), Google's bulk radius lines, a pins CSV, or GeoJSON. The URL is the plan: copy the link and it rebuilds exactly.

## How it works

```
Overture GeoParquet (S3) ──DuckDB──▶ raw slices per metro ──▶ clean ──▶ H3 res-9 cells ──▶ app/public/data/<metro>.json
                                                                                               │
Overture PMTiles (S3) ─────────────────────────── basemap (base, transportation, buildings) ──┤
                                                                                               ▼
                                                    browser: rank → score → greedy plan → export
```

**Pipeline** (`pipeline/`, Python, DuckDB + spatial + H3 extensions)

- `extract.py` reads only the row groups overlapping each metro (Overture's `bbox` struct), and caches raw slices. All four metros extract in about 4 minutes.
- `clean.py` gives every dropped place exactly one recorded reason, which the app shows as a ledger: closed, low confidence (< 0.5), uncategorized, or duplicate (same normalised name within 40 m of a better-scored listing).
  - **Status is checked before confidence on purpose.** The schema says closed places carry confidence 0, but in this release most closed places in SF score ≥ 0.6. A confidence filter alone would have kept 8,000 closed businesses.
- `signals.py` maps Overture's new `basic_category` / `taxonomy.primary` (the old `categories` field was removed in September 2026) onto 14 signals a growth team reasons about. A Python twin of the SQL classifier is tested against it.
- `aggregate.py` rolls up to H3 cells:
  - **homes** are address points, with units counted separately.
  - **detached share** is rooftops with one address and no units.
  - It also records buildings and median height, signal counts, ZIP, neighbourhood and city.
  - Two fixes for real data problems:
    - Some county feeds have no postcodes, so ZIPs are backfilled from place addresses, but only when the address feed or ≥ 20 places agree (place postcodes include mailing ZIPs from other states).
    - Neighbourhood labels prefer real neighbourhood polygons over plazas tagged as microhoods and Chicago police beats tagged as neighbourhoods.

**App** (`app/`, React + TypeScript, MapLibre + deck.gl, Vite)

- `model/score.ts`: each factor is ranked to a percentile across scored cells (ties averaged), so one dense downtown cell can't flatten the map. The score is the weighted mean of centred ranks, re-ranked to 0–100: a 90 beats 90% of cells in that metro. Place signals count the cell plus its 6 neighbours (~450 m).
- `model/plan.ts`: greedy maximum coverage with lazy evaluation (CELF).
  - A cell's value is homes × fit², and zero below the median, so pins chase strong cells and don't get paid for weak ones.
  - Pins stay 1.5 radii apart, so each is a distinct area you can budget and switch off.
  - Ties break on cell index, so a shared link always rebuilds the same plan.
  - Scoring plus planning take under 60 ms on Chicago's 12k cells, so everything recomputes on every click.
- **Look and motion** come from the Radar application site. The camera opens on an establishing shot, pitched over the clay city, and settles into the plan. New pins drop in with one pulse. A 3D view raises each cell by its homes. Dark mode follows the system setting (or a toggle) and turns the map into Radar's machine view, with ink land and cyan signal. The basemap is recoloured in place, with no reload. All motion is skipped under `prefers-reduced-motion`.
- The basemap is Overture too: base, transportation, buildings and divisions PMTiles, read by range request from Overture's bucket and pinned to the same release as the numbers.

## Trade-offs and cuts

- **Static data, no backend.** Each metro is one columnar JSON file (0.8–1.5 MB gzipped). Scoring runs in the browser, so it's free to host, instant to use, and has nothing to keep alive. The cost is that adding a city means running the pipeline. I considered DuckDB-WASM over Parquet in the browser and cut it: 12k cells don't need a query engine, and it would add ~6 MB to first load.
- **Four metros, not the US.** Enough to show the method generalises and to expose real data differences, without a tiling and serving story.
- **Homes are address points, not households.** Austin's and Chicago's county feeds list buildings, not apartment units (1.04–1.06 addresses per rooftop, against 1.6 in SF and Denver). Dense blocks read low there and detached share reads high. The app says so in the legend and the ledger rather than inventing units from building volume, which would be guessing.
- **Signals are proxies.** A vet nearby suggests pets, and a Whole Foods suggests spending power. That's why every factor is visible and editable, and why the card shows the actual places behind a score.
- **No ad-platform integration.** The export is copy-paste and files, not an API push. Writing to someone's ad account needs OAuth, review and a lot of trust. The formats are the ones the platforms' bulk tools accept: ZIP lists for both, and `(radius mi:lat:lng)` for Google.
- **No accounts or saved plans.** The URL holds the whole plan, which covers sharing and bookmarking without a database.
- **Not built:** comparing two plans side by side, a "what changed since the last Overture release" view (GERS IDs make it possible, and the place chips already carry them), and custom profiles saved by name.

## Run it

```bash
# data (optional: built files are committed in app/public/data)
cd pipeline
uv sync
uv run python -m catchment all            # extract + build every metro
uv run python -m catchment build austin   # rebuild one from cached raw slices
uv run pytest && uv run ruff check .

# app
cd app
npm ci
npm run dev                               # http://localhost:5173
npm test && npm run typecheck && npm run lint
npm run build                             # static site in app/dist
```

Deploys as a static site. `render.yaml` describes the Render setup, and any static host works.

## Layout

```
pipeline/catchment/   config (release, metros, thresholds) · extract · clean · signals · aggregate · cells
pipeline/tests/       cleaning rules, classifier parity, address roll-up, ZIP backfill
app/src/data/         file types, metro loader (typed arrays, neighbour sums, place → cell index)
app/src/model/        factors, profiles, scoring, planner, exports (+ tests)
app/src/map/          basemap style and themes, colour ramps (OKLab), MapView
app/src/ui/           panels, cell card, dialogs
```

Data © Overture Maps Foundation and its sources ([attribution](https://docs.overturemaps.org/attribution/)).
