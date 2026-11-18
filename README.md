# Catchment

Catchment helps a local-service media buyer choose where to advertise in a new city, inspect the Overture places behind each recommendation, and export ZIP codes or radius pins for a campaign.

## Try a plan

[Open Catchment](https://valid-take-home.vercel.app/)

Pick **San Francisco & Oakland** and choose **Pet care**. With eight 1.5-mile pins, the first pin lands in Western Addition. Click a dark blue block to inspect the nearby places that contributed to its score.

Open **Export plan**. At the default 50% coverage threshold, 34 ZIPs qualify. Raise it to 75% and 22 qualify. That gives the buyer a choice between a broader campaign and fewer ZIPs whose mapped homes are more concentrated inside the pins. Copy the ZIPs, or switch to **Radius pins** for a Google Ads Editor import CSV. Change a factor and use **Copy link** to share the revised plan.

For the creative handoff, **Autopilot** can turn the plan into a per-pin budget, local scripts and downloadable videos. The buyer reviews the kit before spending anything.

## Why I built it

A buyer can draw a circle around downtown in seconds. The hard part is explaining why the next dollar belongs there. I picked this problem because local businesses have different needs even on the same street. A cluster of pet services can be relevant to a dog walker, while a home-repair service may care more about single-address rooftops. Making those assumptions editable gives the buyer a way to challenge the map before committing spend.

## What goes into a pin

DuckDB extracts places, addresses, buildings and boundaries from Overture release `2026-10-21.0`. The pipeline removes closed, low-confidence and duplicate listings, records each rejection, and rolls the data into H3 cells. The browser ranks cells within the metro and places pins where they add the most well-matched homes beyond those already covered. The source and scoring rules are in the [extraction pipeline](pipeline/catchment/) and [planner](docs/scoring-and-planning.md).

## Trade-offs and cuts

- **Four static metros.** SF & Oakland, Austin, Chicago and Denver ship as precomputed files. Planning works without a server or API key. Adding a city requires another extract.
- **Fit is a hypothesis.** Homes are address points. Apartment units are undercounted in Austin and Chicago, and nearby places are proxies for demand. The app shows its inputs and offers matched ZIP holdouts for buyers who want to test the plan.
- **The buyer controls the account.** Export and sharing cover the handoff. OAuth, campaign launch and spend management are outside the product. Optional AI can suggest weights and local ad copy. The planner computes the pins.

## Run locally

With Node 22.18 or newer, the committed metro files are enough to run the planner.

```sh
cd app
npm ci
npm run dev
```

To reproduce the Austin extract from the repository root, run the following with uv installed.

```sh
cd pipeline
uv sync
uv run python -m catchment all austin
```

[Development, checks and deployment](docs/development.md) · [Data sources and cleaning](docs/data-pipeline.md) · [Design decisions](docs/decisions.md) · [Measurement](docs/measurement.md) · [Quality evals](docs/eval.md)

Data © Overture Maps Foundation and its sources. [Attribution](https://docs.overturemaps.org/attribution/)
