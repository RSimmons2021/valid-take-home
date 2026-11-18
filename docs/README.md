# Catchment documentation

Catchment is a geo-targeting planner for local-service advertising. It turns [Overture Maps](https://overturemaps.org) open data into a score for every ~0.1 km² block of a city ("is this where my customer lives?"), places radius pins where they reach the most well-matched homes, and exports ZIP lists and pins for Meta and Google Ads.

The project has two halves that meet at one file per metro:

- **`pipeline/`** (Python, DuckDB) reads Overture once, cleans it, and rolls it up to H3 cells.
- **`app/`** (React, TypeScript, MapLibre, deck.gl) loads those files and does all scoring, planning and exporting in the browser. There is no backend.

## Read in this order

| If you want to… | Read |
| --- | --- |
| Understand the whole system in 5 minutes | [architecture.md](architecture.md) |
| Know where the numbers come from, or change them | [data-pipeline.md](data-pipeline.md) |
| Read or produce the metro data files | [data-format.md](data-format.md) |
| Understand how a score and a plan are computed | [scoring-and-planning.md](scoring-and-planning.md) |
| Work on the interface | [frontend.md](frontend.md) |
| Know *why* something is the way it is | [decisions.md](decisions.md) |
| Run, test, deploy or extend it | [development.md](development.md) |

Coding agents should start with [`../AGENTS.md`](../AGENTS.md). It is a one-page map of the repo, the commands, and the invariants that must not break.

## Glossary

| Term | Meaning |
| --- | --- |
| **Cell / block** | An H3 hexagon at resolution 9 (~0.1 km², ~175 m edge). The unit everything is scored on. The UI says "block", the code says "cell". |
| **Metro** | One extracted area (a bounding box), for example `sf-bay`. Each has its own data file. |
| **Homes** | Overture address points in a cell. Apartment units count separately *when the county feed lists them*. |
| **Rooftop** | A distinct (street, number) pair. Rooftops with one address and no units are treated as detached houses. |
| **Signal** | A category of place that tells you something about who lives nearby (vets → pet owners, preschools → young families) or about competition. 14 signals, defined in `pipeline/catchment/signals.py`. |
| **Factor** | Something the user can weight: `homes`, `single` (detached share), or any signal. |
| **Profile** | A preset set of factor weights for one kind of business (home repair, pet care…). |
| **Score** | A cell's 0–100 percentile among scored cells in its metro, for the current weights. |
| **On target** | A cell scoring 50 or more. Homes in such cells are "on-target homes". |
| **Pin** | A radius target (centre plus radius in miles) placed by the planner. |
| **Capture** | On-target homes the plan reaches, as a share of all on-target homes in the metro. |
| **GERS ID** | Overture's stable feature ID. Places in the app carry it, so a place can be referenced across releases. |
| **Release** | The Overture data version every number comes from: `2026-10-21.0`, schema `2.0.0`. |
