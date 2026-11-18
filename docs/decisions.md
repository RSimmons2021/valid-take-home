# Decisions

The choices that shape the project, why they were made, and what they cost. Newest last. When you change one of these, add an entry rather than editing history.

---

### 1. Product: a geo-targeting planner for local-service ads

**Context.** The brief: build anything on Overture data, for a real user problem.
**Decision.** Serve a growth marketer or media buyer launching a local-service brand in a city. The output is the thing they paste into Meta or Google on Monday: ZIPs and radius pins.
**Why.** The user and workflow are concrete. Overture is strong at exactly the inputs needed (addresses, places, buildings, divisions). And data-quality honesty changes the answer, which makes for a real product instead of a map demo.
**Cost.** Scores are proxies, not measured audiences. The app says so in the export dialog, the ledger and the README.

### 2. Static data, no backend

**Decision.** Pre-compute one columnar JSON file per metro, and do all scoring and planning in the browser.
**Why.** It's free to host, there's nothing to keep alive, and it's instant to use (< ~60 ms per change). A reviewer can open it with no setup.
**Cost.** Adding a city means running the pipeline. There are no saved plans or accounts. The URL holds the plan instead.

### 3. DuckDB over GeoParquet for extraction; no DuckDB-WASM in the app

**Decision.** Use DuckDB (Python) against Overture's S3 GeoParquet, pruning with the `bbox` struct.
**Why.** It reads only the row groups that overlap each metro, with no planet download and no credentials. Python matches the team's day-to-day stack.
**Rejected.** DuckDB-WASM in the browser. About 12k cells per metro don't need a query engine, and it would add several MB to first load.

### 4. H3 resolution 9

**Why.** ~0.1 km² shows block-level differences while holding dozens of addresses per cell. Resolution 8 blurs neighbourhoods together, and resolution 10 makes most cells too sparse to rank.

### 5. Check operating status before confidence

**Context.** The schema says closed places have confidence 0. In this release, most closed places in SF have confidence ≥ 0.6.
**Decision.** Drop on status first, then on confidence < 0.5.
**Why.** A confidence filter alone would keep about 8,000 closed SF businesses.

### 6. Use the new taxonomy, not `categories`

**Why.** `categories` was removed in the September 2026 schema (v2.0.0). Signals are defined on `basic_category`, `taxonomy.primary` and brand.

### 7. Don't invent apartment units

**Context.** Austin's and Chicago's county address feeds list buildings, not units.
**Decision.** Record `units_per_rooftop`, and warn in the legend and the ledger. Don't estimate units from building volume.
**Why.** Building class is mostly missing, so a volume model would count offices as homes. An honest caveat beats a confident guess.

### 8. Rank factors by percentile, not scale them

**Why.** It is robust to outliers (one 3,000-home tower would flatten min-max scaling), puts factors of very different magnitudes on the same footing, and gives scores a plain meaning: "beats 90% of blocks here".
**Cost.** Scores are relative within a metro and not comparable across cities.

### 9. Five-step weights instead of sliders

**Why.** "Prefer strongly" is a decision a marketer can make, while 0.73 isn't. Steps also make URLs short and exact, and profiles easy to read.

### 10. Greedy coverage with lazy evaluation for pins

**Why.** It's simple, deterministic, provably within (1 − 1/e) of optimal, and fast enough to run on every click.
**Value function.** `homes · fit²` above the median, 0 below. Pins chase strong clusters and are never rewarded for weak cells, which are still reported as spill.

### 11. Pins at least 1.5 radii apart; radius ≥ 1 mile

**Why.** Platforms target the union of pins, so overlap isn't double-billed. But stacked circles read as one place split three ways, and buyers budget and pause pins individually. One mile is Meta's minimum radius.

### 12. ZIP backfill only from trusted place postcodes

**Context.** Alameda County addresses have no postcodes, and place postcodes include out-of-state mailing ZIPs.
**Decision.** Use a place postcode only if the address feed has that ZIP or at least 20 places agree on it. Then fill gaps from the nearest labelled ring.

### 13. The basemap is Overture PMTiles, pinned to the data release

**Why.** The map and the numbers come from the same data on the same date. There's no third-party tile key, and it shows off more of Overture.
**Cost.** It depends on Overture's public bucket staying available (it is the documented distribution path).

### 14. MapLibre 5, not 6

**Context.** deck.gl 9.4's interleaved mode reads `map.transform`, which MapLibre 6 removed, so the map threw on every frame.
**Decision.** Pin `maplibre-gl@^5` until deck.gl supports v6.

### 15. Columnar JSON, committed to the repo

**Why.** It is one `JSON.parse` straight into typed arrays, 0.8–1.5 MB gzipped per metro, and the app builds and deploys with no Python or S3 access.
**Cost.** About 12 MB of data in git. It is acceptable for four metros, but moving to an object store would make sense beyond ~20.

### 16. Every visual effect must explain the data

**Context.** Motion and style come from the Radar application site.
**Decision.** Keep only effects that answer a question:
- evidence links: why this score?
- colour fades: what did my change do?
- new-pin pulses: what's new in the plan?
- 3D: where are the homes?
- the establishing shot: where am I?

Radar's literal cursor lens was left out, because on a planning tool hiding part of the score map hurts readability.

### 17. Darker means better, in both themes

**Context.** The first dark theme ramped from indigo to bright cyan, so the best cells were the lightest.
**Decision.** Ramp from pale to deep, saturated blue in both themes, with pale also translucent in dark mode.

### 18. Guidance points at the live UI

**Decision.** The guided tour spotlights and annotates real controls, and opens a real cell, rather than showing screenshots or a video.
**Why.** It can't go stale as the UI changes, and a first-time reviewer learns by seeing the actual thing respond.

### 19. Own the select and tooltip components

**Why.** Native `<select>` menus and `title` tooltips are drawn by the OS. They ignore the app's type, colour and dark mode, and `title` is unreliable for keyboard and screen-reader users. Both components follow WAI-ARIA patterns.

### 20. AI proposes inputs; the engine computes; the user approves

**Context.** Adding `gpt-6.1-terra` to a planning tool whose value is trustworthy numbers.
**Decision.**
- Brief → plan returns *weights with reasons*, shown as a diff the user applies and can undo.
- Ad angles return *wording* only.
- Neither touches scores, pins or exports.

**Why.** It keeps every number reproducible and explainable, and keeps a shared link working without any AI call. It turns the model's strength (judgement from language) into a structured input, instead of asking it for a number it can't justify.

### 21. A small server instead of a client-side key

**Context.** The app was static, and an API key in the browser is public.
**Decision.** A Node server serves `dist/` and `/api`. It runs TypeScript directly on Node 22.18+, with no build step. Render becomes a web service.
**Cost.** One process to run. Mitigated by graceful degradation: without the server or key, the AI controls simply don't render.

### 22. Grounding by construction, then verification

**Decision.**
- The server chooses the places an ad may mention.
- The response schema restricts citations to those refs.
- Every angle must name a cited place and pass a lint, and failures are dropped and reported.
- Competitor places are never offered.

**Why.** Prompting alone ("only use these places") is a request, not a guarantee. Schema enums plus a post-check make invented places impossible to ship.

### 23. Spend and abuse controls on a public demo

**Decision.** A per-client rate limit, a daily budget estimated from token usage, an LRU cache, timeouts, `store: false`, and logs with no user text.
**Why.** A reviewer will share the link. A runaway loop or a bot must not drain the key, and a cached answer should cost nothing.

### 24. The AI copy follows ad policy, not just style

**Decision.** The angle lint rejects personal-trait phrasing ("Are you a dog owner?"), which Meta's personal-attributes policy disallows, as well as emoji and hashtags.
**Why.** Copy that gets an ad rejected is worse than no copy. The rule is enforced in code, not left to the prompt.

### 25. Calibrate by searching the decision, not by modelling every factor

**Context.** Turning campaign results into weight changes on ~50 ZIPs with 16 collinear factors.
**Decision.** A greedy search over one-step weight changes. A change is kept only if fit (Spearman, ZIP score vs. conversion rate) improves by at least 0.03 and wins in at least 90% of bootstrap resamples.
**Rejected.** Per-factor correlation recommended every density signal at once. GCV-tuned ridge shrank effects to noise with falsely tight intervals. Both were tested against simulations with a known truth; details are in [measurement.md](measurement.md).
**Cost.** Changes are conservative and in-sample. The UI says so and points to the lift test.

### 26. Lift tests randomise within the plan, not against the leftovers

**Context.** The planner targets the best ZIPs, so untargeted ZIPs are worse by construction (SMD 1.5–2.6 on real data).
**Decision.** Matched-pair randomisation inside the plan's ZIPs, with re-randomisation (best of 20).
**Cost.** About half of the planned homes get no ads during the test. That's stated in the UI.

### 27. Diff releases by GERS id, and word it honestly

**Decision.** Report places new to Overture and places newly marked closed. Don't report vanished ids. Say "new in Overture", not "opened".
**Why.** The release added three data sources, and removal is ambiguous. Being precise about what the data can claim matters more than a bigger number.

### 28. One model behind three surfaces

**Decision.** The app, the AI server and the MCP server all call `app/src/model/`. MCP tools are read-only and return `open_in_app` links.
**Why.** An agent's plan must be the plan a person sees. The link lets a human check an agent's work in one click.

### 29. Previews by snapshot, stored in memory

**Decision.** The browser uploads a map snapshot; the server keeps an in-memory LRU of previews and falls back to a default card.
**Why.** No storage service to run. A restart degrades to the default card, never to a broken image. Inputs are validated by magic bytes, size and rate.

### 30. axe in CI, not Lighthouse

**Decision.** A Playwright + axe audit (WCAG 2.1 AA, both themes) fails CI on serious violations. Lighthouse CI was dropped.
**Why.** The axe audit is deterministic and found real contrast bugs (fixed). Lighthouse waits for network quiet, which a live WebGL map rarely reaches: it hung for over 400 s.

### 31. Separate tokens for blue fills and blue text

**Decision.** `--blue` for fills, `--blue-text` for text (`#8a92ff` in dark, at least 5.8:1). `--muted` is darkened to `#63666d`.
**Why.** The brand blue on near-black was 3.65:1. Lightening `--blue` itself would have broken white-on-blue buttons.

### 32. Markers are an anchor and a pin, keyed by cell

**Context.** Pins drifted below their circles, worse for higher ranks, and trailed the map while panning.
**Cause.** `.pin { position: relative }` (added for the pulse ring) overrode MapLibre's `position: absolute`, so markers stacked in page flow, and a `transform` transition fought MapLibre's positioning transform.
**Decision.** MapLibre gets an outer anchor it owns completely; the inner button carries every animation. Markers are keyed by cell and updated in place. An e2e test asserts every anchor is absolutely positioned.

### 33. One extra map colour, with a reason behind it

**Decision.** Below-median cells whose main drag is an avoided signal get a coral wash; hovering one names the signal. Pin reach gets a legend entry. The legend's entries spotlight their class.
**Why.** "Low" was ambiguous: no customers, or something the user doesn't want nearby (bars, competitors)? That's the difference between "skip it" and "skip it because of X". Only one new hue was added, and it's always lighter than fit, so "darker blue = better" still holds.
**Rejected.** Highlighting strong cells outside the pins: hundreds of outlined hexes was noise, and the pin list already says where reach stops.

### 34. Motion is chosen by frequency

**Decision.** There is one set of easing and duration tokens. The palette opens instantly; warm tooltips skip their fade; exits are faster than entrances; reduced motion keeps fades and drops travel and loops.
**Why.** Animation on something used a hundred times a day is latency. The old reduced-motion rule (every duration set to 0.01 ms) also removed the fades that explain state changes.
