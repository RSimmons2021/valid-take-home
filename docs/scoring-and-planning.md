# Scoring and planning

All of this lives in `app/src/model/` and is pure TypeScript: no React, no map, no browser APIs. Tests are in `model.test.ts`.

## Factors (`factors.ts`)

A factor is a per-cell number the user can weight.

| Factor id | Value per cell | Notes |
| --- | --- | --- |
| `homes` | address points | Raw count. Ranking (below) makes the scale irrelevant. |
| `single` | detached-house share, 0–1 | `NaN` (no information) when the cell has fewer than 5 rooftops |
| each signal id | places of that signal in the cell + its 6 neighbours | `metro.near[signal]`, roughly "within 450 m" |

Weights are one of five steps, not a free number: `-2` *avoid strongly*, `-1` *avoid*, `0` *ignore*, `+1` *prefer*, `+2` *prefer strongly*. Steps are easier to reason about than sliders, and they make URLs short and exact.

**Profiles** (`profiles.ts`) are starting weights for a kind of business. Each names its competitor signal, which gets a "competition" tag in the UI:

| Profile | Weights | Competitor |
| --- | --- | --- |
| Home repair | homes +1, single +2, home_retail +1, moving +1, home_trades −1, nightlife −1 | home_trades |
| Home cleaning | homes +2, premium_grocers +1, daily_needs +1, offices +1, home_cleaning −1 | home_cleaning |
| Pet care | homes +1, pet_life +2, single +1, pet_care −1 | pet_care |
| Fitness studio | homes +2, daily_needs +2, offices +1, premium_grocers +1, fitness −1 | fitness |
| Tutoring & childcare | homes +1, families +2, single +1, tutoring −1, nightlife −2 | tutoring |

## Score (`score.ts` → `scoreCells`)

1. **Eligibility.** A cell is scored only if `homes ≥ minHomes` (default 25; options 0/10/25/50/100). This keeps parks, rail yards and water out of the rankings.
2. **Rank each active factor.** `percentileRanks(values, eligible)` sorts the eligible, non-NaN values and gives each its rank as a fraction in [0, 1]. Tied values share the average of their ranks, so all the zeros in a sparse signal get the same middling rank instead of an arbitrary order. A lone value gets 0.5.
   *Why ranks rather than min-max scaling:* one dense downtown cell with 3,000 homes would otherwise squash every other cell to near zero. Ranking also puts very differently scaled factors (homes in the hundreds, vets in single digits) on the same footing.
3. **Composite.** For each eligible cell:
   `raw = Σ wᵢ · (pᵢ − 0.5) / Σ |wᵢ|`, over the factors where `pᵢ` is not NaN.
   Centring on 0.5 means "average" pushes neither way, and a factor with no information for a cell drops out of that cell's average instead of counting as average.
4. **Score.** `score = 100 · percentileRank(raw)`, rounded to 0.1. A score of 90 means the cell beats 90% of scored cells in this metro for these weights. Scores are relative to the metro, so don't compare them across cities.
5. **Order.** Cells sorted by score, then homes, both descending. `order[0]` is the best cell (the tour opens it).

**Verdicts** (`verdict`): ≥ 85 *Strong fit*, ≥ 65 *Good fit*, ≥ 40 *Mixed*, below that *Weak fit*, and *Not scored* when ineligible.

**Explanations** (`explain(metro, result, cell)`) return each active factor's `push = weight · (pct − 0.5)`, sorted by size. The cell card draws these as diverging bars: blue raises the score, red lowers it.

## Plan (`plan.ts` → `planPins`)

The question the planner answers: *with N radius pins of radius r, where do I reach the most well-matched homes?*

**Value of a cell**

```
value(cell) = homes · fit²,   fit = (score − 50) / 50   if score ≥ 50
            = 0                                          otherwise
```

Below-median cells are worth nothing, so a pin is never *rewarded* for covering weak cells. Squaring fit makes a 90 worth far more than a 60, which pulls pins towards the strongest clusters. Weak cells a pin happens to cover still show up in its stats as off-target reach (the "spill" a buyer pays for anyway).

**Algorithm: greedy maximum coverage with lazy evaluation (CELF)**

1. **Candidates** are cells with value > 0, best first, capped at 4,000. Pins are centred on cells that are themselves worth reaching.
2. **Reach** of a candidate is every cell whose centre lies within r of it. A uniform bucket grid over the metric `x`/`y` coordinates (bucket size = r) makes each query touch at most a 3×3 block of buckets.
3. **Gain** is the summed value of reached cells not yet covered by a chosen pin. It is 0 if the candidate is within `SPACING · r` (1.5 radii) of a chosen pin.
4. A max-heap holds `[gain, candidate, round computed]`. Pop the top: if its gain was computed this round, choose it, mark its cells covered and start a new round. Otherwise recompute its gain and push it back down. Gains can only fall as coverage grows (the objective is submodular), so a fresh top is the true best, and most candidates are never recomputed.
5. Stop at N pins, or when the best gain is 0. In that case the panel explains that more pins would only re-reach the same cells.

Greedy is guaranteed to reach at least (1 − 1/e) ≈ 63% of the optimal coverage for this kind of objective, and in practice it's much closer.

**Determinism.** Ties break on the lower cell index, and nothing is random, so the same metro, weights, pins and radius always give the same plan. Shared links rely on this.

**Spacing.** Overlapping circles aren't double-billed (ad platforms target the union), but three stacked pins read as one place split three ways. Keeping centres 1.5 radii apart makes each pin a distinct area a buyer can name, budget and switch off.

**Radius options** are 1, 1.5, 2, 3 and 5 miles. Meta's radius targeting starts at 1 mile, so nothing smaller is offered.

**Pin stats** (`Pin`) count only the cells a pin *newly* covers, in pick order, so the totals never double-count:

| Field | Meaning |
| --- | --- |
| `homes` | All homes in the newly covered cells |
| `onTargetHomes` | Those in cells scoring ≥ 50 |
| `meanScore` | Homes-weighted mean score of the covered, scored cells |
| `label` | Neighbourhood, city and ZIP of the centre cell |

**Plan stats.** `homes` and `onTargetHomes` are sums over pins. `capture` is `onTargetHomes / metroOnTargetHomes`. The UI shows "On target" as `onTargetHomes / homes`.

**Performance** (measured in Node on Chicago's 11,758 cells): scoring takes 17–29 ms and planning 55–58 ms. San Francisco (3,741 cells) takes 5–17 ms and 16–29 ms. These timings predate pin spacing, which adds one distance check per chosen pin to each gain. That is fast enough to run on every click with no debounce or worker.

## Exports (`export.ts`)

| Export | Format | Where it goes |
| --- | --- | --- |
| ZIP list | One US ZIP per line, filtered by mapped-home coverage (50% by default) | Google Ads → Locations → Add locations in bulk. In Meta, review matches if bulk postal-code entry is available. |
| Google radius CSV | `Campaign,Location` header and one proximity target per pin, such as `(1.5mi:37.774900:-122.419400)` | Google Ads Editor → Account → Import → From file |
| Pins CSV | `rank,name,latitude,longitude,radius,unit,homes,on_target_homes,mean_score,zip` | Any spreadsheet; recreate pins in any platform |
| ZIP report CSV | `zip,homes_reached,homes_in_zip,share_reached` | Analysis |
| GeoJSON | A 64-step circle polygon per pin, with its stats, plus the release, profile and a link back to the plan | GIS tools, other map apps |

`plannedZips` attributes each covered cell's homes to that cell's ZIP. A ZIP's share is reached homes ÷ its total, so a ZIP the plan only clips can be left out.

Google documents one location per line for [bulk location targeting](https://support.google.com/google-ads/answer/1722043) and the proximity syntax for [Google Ads Editor CSV imports](https://support.google.com/google-ads/editor/answer/30573). Meta documents [ZIP targeting](https://developers.facebook.com/docs/ad-targeting-dataset/table-schema/). Meta bulk paste and acceptance by individual ad accounts remain unverified.

## Limits worth knowing

- Scores are **relative within a metro**. "Top 10% of Austin" and "top 10% of Chicago" are different absolute things.
- **Homes are addresses, not households or audiences.** Where a county doesn't list units (Austin, Chicago), dense blocks are under-counted and detached share is overstated. The app warns about this.
- **Signals are proxies.** A vet nearby suggests pets; it doesn't prove them. That's why every weight is visible, and why the cell card shows the actual places behind a score.
