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
