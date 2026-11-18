# Catchment

**Find the neighbourhoods worth paying for.** Catchment scores every block of a city for a local-service business's customer, using Overture Maps data, then exports a geo-targeting plan (ZIP lists and radius pins) that pastes straight into Meta and Google Ads.

Metros: San Francisco & Oakland, Austin, Chicago, Denver · Overture release `2026-10-21.0`

## Why this

Local-service brands (home repair, cleaning, pet care, fitness, tutoring) buy ads for places, not people. A media buyer launching one of them in a new city usually guesses: a ring around downtown, the ZIPs a founder knows, whatever the platform's "people living in" box suggests. The result pays to reach apartment towers for a handyman subscription, or ZIPs where three competitors already sit on every corner.

Overture is unusually good at exactly the inputs this needs: county address points (how many homes, and whether they're houses or units), 88M places with a fresh taxonomy (where vets, hardware stores, preschools and competitors are), and buildings. Catchment turns those into one question per cell, "is this a place my customer lives?", and one artifact a buyer can act on: the export.

I picked it because the user and the workflow are concrete (paste a ZIP list into Ads Manager on Monday), and because it's a problem where being honest about data quality changes the answer.

## Using it

First-time visitors get a welcome card, then a guided tour drawn in hand-written notes, arrows and circles over the real controls. It opens a live cell rather than showing screenshots, so it can't go stale. The **Guide** button replays it.

1. **Pick a business.** Each profile is a starting set of weights, all visible and editable.
2. **Say what matters.** Every factor takes one of five steps, from *avoid strongly* to *prefer strongly*. The map rescores instantly, with cells fading to their new colour. Darker blue means a better fit in both themes. Click any cell for a verdict, the factors that pushed it, and the named Overture places behind it, linked on the map by lines (blue for prefer, red for avoid).
3. **Plan.** Choose the number of pins and a radius (1 mile minimum, Meta's smallest). Pins are placed where they add the most well-fit homes not already reached. The panel reports reach, **on-target share** (how much of what you'd pay for actually fits) and **capture** (how much of the city's fit you'd reach).
4. **Export.** ZIP list (with how much of each ZIP the pins really cover), Google's bulk radius lines, a pins CSV, or GeoJSON. The URL is the plan: copy the link and it rebuilds exactly.

## Autopilot: the whole campaign from one sentence

Click **Build the campaign with Autopilot** above Export (or press `A`, or pick "Let Autopilot build…" under any business type), describe the business, give a monthly budget, and it runs the steps a media buyer and a creative team would, live on the map:

1. **Understand the business:** the brief becomes weights, each with a reason.
2. **Place the pins:** as many as the budget can feed at $5 a day or more.
3. **Split the budget:** a floor per pin, then the rest by the well-matched homes each one reaches.
4. **Write a script per pin:** an on-screen title that passes the sound-off test (8 words or fewer), a hook and a close, citing only verified places inside the pin.
5. **Make each pin's video:** a 10 s, 9:16 ad in four beats:
   - **Hook:** the service, happening. It's an AI photo of the pin's verified scene (no text, logos or real places), or a hand-drawn illustration of the business without AI, with the title readable in under a second.
   - **Proof:** the pin's real map opens out, with blocks coloured by fit and arrows to the real places it names.
   - **Benefit:** back to the scene, with what the business does for you.
   - **Close:** who, where, and a call to action.

   Composed and encoded to MP4 (H.264) in the browser. A scene photo costs about half a cent.
6. **Design the lift test:** matched ZIP pairs, as in Export.

It ends in a **campaign kit**: a video player and download per pin, each pin's script and budget, a kit `.md` that labels every number *verified*, *estimated* or *unknown*, and **Undo Autopilot**, which puts the plan back in one step. Nothing is launched or spent. Close the dialog and it keeps working, with a pill in the top bar.

The AI writes words only. Scores, pins, money and pictures come from the deterministic engine, and without an AI key Autopilot still runs: scripts come from the data, naming real places, never people.

## Closing the loop: plan → run → measure → better plan

A map that says where to spend is half a tool. The rest is what an agency does next:

- **Prove it worked: Export ▸ Lift test.** It splits the plan's ZIPs into matched test and control pairs, so the buyer can measure what the ads *caused* rather than trusting platform attribution. The first design (controls from untargeted ZIPs) was measured and rejected: the planner picks the best ZIPs, so leftovers were worse by 1.5–2.6 standard deviations. Matched-pair randomisation inside the plan gives balance by construction.
- **Get smarter from results: Learn from results.** Bring conversions by ZIP (or try simulated results with a hidden truth) and see which weight changes would have ranked those ZIPs better. A change is suggested only if it improves fit and holds in at least 90% of bootstrap resamples. The simulator reveals the truth beside what was found, including misses. Methods and rejected alternatives are in [docs/measurement.md](docs/measurement.md).
- **Know what moved: Since Sep 2026.** Places are followed across Overture releases by GERS id. Each pin flags new listings of signals you avoid (competitors) and closures of places you prefer, worded honestly ("new in Overture", not "opened").
- **Hand off to creative: Brief .md.** Each pin produces a grounded creative brief: audience, verified local references, angles with AI-video scene prompts, a don't-mention list, and the changes since the last release.
- **Hand off to the client: ⌘P.** A printable one-pager with the real map, pins, ZIPs, reasoning, the lift-test design and caveats. Shared links unfurl in Slack with a picture of the plan.
- **Hand off to agents: MCP.** The same planner as six read-only tools ("plan pet-care targeting in Denver and give me the ZIPs"). Every plan comes back with a link that opens it in the app. See [docs/mcp.md](docs/mcp.md).

Power-user details: **⌘K** for everything, **⌘Z / ⇧⌘Z** across every change, stats that roll and a pin list that animates reorders, screen-reader announcements, WCAG AA contrast in both themes (enforced by an axe audit in CI), an offline banner, and an error boundary that never leaves a blank page.

## AI features (optional)

With an `OPENAI_API_KEY`, the app adds two `gpt-6.1-terra` features. Both are built so the model proposes, the engine decides, and the user approves:

- **Describe your business.** Plain words in, a reviewable set of weights out, each with a reason. Apply it (and undo it) like any other change. The scores and pins still come from the deterministic engine.
- **Local ad angles per pin.** Three hooks written only from real Overture places inside the pin. The server chooses the places, the schema restricts citations to them, and each hook is checked to name a cited place and to avoid personal-trait phrasing that Meta's ad policy disallows. Competitors are never mentioned.

The key stays on a small Node server, behind rate limits, a daily budget, a response cache and timeouts. Each result shows its cost (about $0.002). Without a key, the AI controls simply don't appear. Details are in [docs/ai.md](docs/ai.md).

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
- **Not built:** comparing two plans side by side, custom profiles saved by name, and computing the lift from test results in-app (the pairs CSV has what a spreadsheet needs).
- **No Lighthouse in CI.** It waits for network quiet, which a live WebGL map rarely reaches. The axe audit covers accessibility deterministically.

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
npm run dev:server                        # optional: AI + API on :8787 (needs OPENAI_API_KEY in ../.env)
npm test && npm run typecheck && npm run lint   # 89 unit tests
npm run build                             # static site in app/dist
npm run e2e                               # Playwright flows + axe audit (light and dark)
npm run mcp:build                         # MCP server → app/dist-mcp/catchment-mcp.js
```

Deploy either as one small Node web service (`render.yaml`: `npm start`, with `OPENAI_API_KEY` set in the host's dashboard), or as a static site on Vercel (`app/vercel.json`) that forwards `/api/*` and `/s` to that Render service. Without the server, `app/dist` still works on any static host, minus the AI features. Autopilot and its videos work everywhere: they run in the browser. Details are in [docs/development.md](docs/development.md#deploying).

## Documentation

Full docs are in [`docs/`](docs/README.md): [architecture](docs/architecture.md), [AI](docs/ai.md), [measurement](docs/measurement.md), [MCP](docs/mcp.md), [data pipeline](docs/data-pipeline.md), [data format](docs/data-format.md), [scoring and planning](docs/scoring-and-planning.md), [frontend](docs/frontend.md), [decisions](docs/decisions.md) and [development](docs/development.md). Coding agents should start with [`AGENTS.md`](AGENTS.md).

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
