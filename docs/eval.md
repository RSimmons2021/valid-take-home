# Evaluate planner and AI quality

Run from the app directory.

```sh
npm run eval
CATCHMENT_EVAL_REPORT=/tmp/catchment-eval.json npm run eval
```

Both commands print per-case metrics. The second also writes a JSON report with the Overture release, eval mode, outcomes and failure reasons. A failed check exits nonzero. CI runs the offline suite on each push.

## Planner

The suite runs fixed campaigns on the four shipped extracts. It compares each plan against a baseline that places pins in the densest eligible cells using the same radius, pin budget and minimum spacing. An independent pass over cell centres counts the homes inside the union of the circles.

| Metric | What it measures |
| --- | --- |
| On-target share | Share of reached address points in cells scoring at least 50 |
| Capture | Share of all on-target address points in the metro that the pins reach |
| Fit-weighted reach | Sum of each reached cell's address count weighted by fit, using the planner objective. The suite reports it for both plans and checks that Catchment reaches at least as much fit-weighted value as the density baseline. |
| Exportable ZIPs | ZIPs covering at least half their mapped homes inside the pins |
| Planner time | One local measurement of scoring and planning, in milliseconds |

Each case also checks full pin count, repeatability and reconciliation against the independent reach count. The results measure outcomes under the chosen weights and extracts. Actual campaign outcomes require delivery and conversion data.

## AI

Three labelled briefs check local-service suitability, expected positive signals, and the treatment of direct competition. Two local ad cases use the first pins from the Bay Area and Chicago plans. The suite counts usable angles and rejected drafts and independently reconciles returned citations with the source places, distance, confidence and weights. Each pin needs at least two usable angles with eligible citations.

Offline mode sends authored response fixtures through the production schema and validators, including drafts with missing copy citations and named places in scene prompts. Its pass rate measures those checks. Use live mode to measure the configured model against the same expectations.

```sh
CATCHMENT_EVAL_LIVE=1 npm run eval
```

Live mode needs `OPENAI_API_KEY` in the environment. To load it from the repo's local environment file, run the following from the app directory.

```sh
CATCHMENT_EVAL_LIVE=1 node --env-file=../.env node_modules/vitest/vitest.mjs run --config server/eval/vitest.config.ts
```

A live run makes five text requests before any provider retries and reports observed latency, returned token usage and estimated cost. Provider errors may leave token usage unavailable. The report excludes request text and credentials. Timing and cost are observations, so the quality checks can run on different machines.
