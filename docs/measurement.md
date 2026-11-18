# Measurement: learning from results and proving lift

Planning says where to spend. These two features close the loop: **did it work, and what should change?** Both live in `app/src/model/` (pure, unit-tested) and both were shaped by checks on real data that rejected the obvious approach first.

## Learn from results (`calibrate.ts`)

**Question:** given what a campaign delivered per ZIP, which weights would have ranked those ZIPs better?

**Input.** A CSV of conversions by ZIP, from an upload, a paste, or a template pre-filled with the plan's ZIPs. The parser:
- accepts common column names (zip / postal code, conversions / results / leads / purchases, impressions, spend);
- detects one delimiter per file, so `"1,200"` in a tab-separated export stays a number;
- sums repeated ZIPs and accepts ZIP+4;
- reports every skipped line with a reason.

**Method**

1. Each ZIP is described by the homes-weighted mean percentile of every factor across its cells (`zipFeatures`), and scored with the map's own formula.
2. Outcome = conversions per impression (else per dollar, else per home). ZIPs with fewer than 500 impressions or under $5 of spend are set aside and listed.
3. **Fit** = Spearman rank correlation between ZIP score and outcome ("does the plan rank ZIPs the way the results did?"), with a seeded bootstrap 95% interval.
4. **A greedy search over the decision itself.** Try every one-step weight change. Keep the best one only if it improves fit by at least 0.03 **and** improves it in at least 90% of 300 bootstrap resamples. Repeat, up to 4 changes. At least 8 ZIPs are required.

**What was rejected, and why.** Both alternatives were run against simulated campaigns with a known hidden truth on all four metros:

| Approach | What happened |
| --- | --- |
| Per-factor correlation | Density signals (nightlife, trades, errands) rise together, so each "predicted" results on its own. It recommended +2 on nightlife, trades, errands and retail at once. |
| Ridge regression (GCV-tuned) | ~50 ZIPs and 16 collinear factors. The chosen penalty shrank every effect to ~0.05 with deceptively tight intervals, so the collinearity problem came back in another form. |
| **Greedy search on fit (kept)** | Over 16 metro × profile simulations it never suggested a change on noise. It usually recovered the hidden factor ("Young families"), and dropped the dud where the data could show it. |

**In the UI.** The dialog shows fit before and after with interval bars, each change with its evidence ("fit 0.57 → 0.68 · better in 97% of resamples"), and an explicit note that the result is in-sample, to be confirmed with a lift test. With **Try simulated results**, it also reveals the hidden truth beside what calibration found, **including what it missed**. That's a check on the method as much as a demo of it.

## Lift test (`holdout.ts`)

**Question:** what did the ads *cause*? Platform attribution counts conversions that happened near ads.

**What was rejected.** The obvious design was to pick control ZIPs from the untargeted remainder. The planner deliberately targets the best-fit ZIPs, so the remainder is worse by construction. On the real metros the fit-score imbalance came out at **SMD 1.5–2.6** (good is under 0.1), so the "lift" would mostly have measured the targeting.

**Method: matched-pair randomisation within the plan's own ZIPs**

1. Take the ZIPs the pins mostly cover (at least 50% of their homes by default).
2. Pair them greedily by similarity on fit score, log homes and detached share (standardised), largest first.
3. Flip a seeded coin in each pair: one ZIP is advertised to (test), the other held out (control). An odd ZIP out stays in test and isn't compared.
4. **Re-randomise:** keep the best-balanced of 20 shuffles. Pairing is computed once, so this is instant.
5. Report balance as standardised mean differences (|SMD| < 0.1 good, < 0.25 fair), and rate the design good, fair or weak with notes on the number of pairs.

**Results on real data.** Balance is good or fair everywhere except Austin, which has too few pairs and says so. About half of the plan's homes get no ads during the test, and that cost is stated in the UI.

**Running it.** Target the test ZIPs, exclude the controls from every campaign for 2–4 weeks, then compute lift = test conversions per home ÷ control conversions per home − 1, pair by pair. Spillover across adjacent ZIPs biases lift towards zero, so a measured lift is conservative.

The Export ▸ Lift test tab copies both lists, downloads the pairs as CSV, reshuffles, and draws the split on the map. The MCP tool `design_lift_test` returns the same design.

## Tests

`calibrate.test.ts` covers parsing edge cases, Spearman, the PRNG, recovery of a planted factor, no changes on noise, the minimum-ZIP refusal, and simulator determinism. `holdout.test.ts` covers that each ZIP is used once, that about half the homes are held out, that seeds are deterministic, that re-randomisation never worsens balance, and the CSV shape.
