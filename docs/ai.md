# AI features

Catchment uses OpenAI's `gpt-6.1-terra` for two features. Both follow one rule: **the model proposes, the engine decides, the user approves.** The model never produces a score, a pin, or a number on the map.

| Feature | Where | The model decides | The engine / user decides |
| --- | --- | --- | --- |
| **Brief → plan** | "Describe your business" box, Business panel | Which factors matter, which way, and why | The user reviews and applies (or undoes). The scorer and planner compute everything else. |
| **Local ad angles** | Pin card (click a pin) | Wording of 3 short ad hooks | Which places may be mentioned (server-chosen), and whether each hook is kept (server-verified) |

## Architecture

```
browser ──POST /api/brief──▶ server/main.ts ──▶ server/api.ts ──▶ server/ai/brief.ts ──▶ OpenAI Responses API
        ──POST /api/angles─▶                  (validate, cache,   server/ai/angles.ts      (gpt-6.1-terra,
        ──GET  /api/health─▶                   rate-limit, budget)                          Structured Outputs)
```

- **The key lives only on the server.** `OPENAI_API_KEY` is read by `server/main.ts`, never prefixed `VITE_`, and never sent to the browser. A check after building confirms neither the key nor its name appears in `dist/`.
- **Graceful without it.** `GET /api/health` reports `{ ai: false }` when there's no key, or when the app is hosted statically with no server. Then the brief box, the angles section and the AI tour step don't render. Everything else works.
- **Transport-free core.** `server/api.ts` is `(method, path, body, client) → result`. The model is injected as an `Llm` function, so tests run the real handlers against a fake model with no network.

### Files

| File | Role |
| --- | --- |
| `server/main.ts` | HTTP: static files (gzip, cache headers, path-traversal guard, hash-route fallback), JSON body cap, access log |
| `server/api.ts` | Routes, plus the shared guard: validate → cache → rate limit → budget → call → record cost |
| `server/ai/llm.ts` | The OpenAI call (`responses.parse` + `zodTextFormat`), error mapping, cost from usage |
| `server/ai/brief.ts` | Schema, instructions and post-validation for brief → plan |
| `server/ai/angles.ts` | Pin grounding context, schema, instructions, verification and lint for angles |
| `server/data.ts` | Reads the same committed metro files the browser loads; metro ids are checked against `index.json` |
| `server/guards.ts` | Sliding-window rate limiter, daily budget, LRU cache, canonical cache keys |
| `src/model/catalogue.ts` | Household factor labels and descriptions, shared by the client and the server |
| `src/ai/client.ts` | Typed fetch wrappers, cancellation and timeouts, usage formatting |
| `src/ai/store.ts` | AI UI state: health, brief, proposal, applied (with undo), angles per pin |
| `src/ai/BriefBox.tsx`, `src/ui/PinCard.tsx` | The two UIs |

## Brief → plan

1. **Request.** `{ brief }`, 8–500 characters, validated with zod before anything else.
2. **Model call.**
   - The instructions list every factor with the exact id, label and description the user sees: the two household factors from `catalogue.ts`, plus the 14 signals from the data file.
   - The response schema (strict JSON Schema, generated from zod) makes `factor` an **enum of those ids** and `weight` an **enum of −2, −1, 1, 2**. The model cannot name an unknown factor or an off-scale weight.
3. **Post-validation** (`finalizePlan`, pure, unit-tested):
   - duplicate factors are dropped (the first is kept), and at most 7 are allowed;
   - a named competitor that wasn't weighted is added at −1, and one weighted positively isn't called a competitor;
   - a plan with no positive weight is refused (422: "nothing to aim for");
   - strings are clipped;
   - `supported: false` (B2B-only, online-only, nonsense or harmful) comes back as a message with no weights.
4. **UI.**
   - The proposal shows as a card: the name, a summary, each weight with its reason, any competitor tag, the model's caveat, and "model · seconds · cost · schema-checked".
   - **Nothing changes until Apply.** Apply sets the weights (profile `custom`), adds a "✦ name" chip, and shows the model's reason inline on each factor while its weight is unchanged. **Undo** restores the previous weights and profile.
   - The URL holds the applied weights (`p=custom`), so a shared link reproduces the plan without any AI call.

Live measurement: about 900 input and 240 output tokens, 5–7 s, about $0.002 per brief.

## Local ad angles

Grounding is enforced three times, so copy can't invent places:

1. **The server picks the places** (`pinContext`). It keeps places inside the pin's radius (haversine) with confidence ≥ 0.7, and **never from a signal the user weighted negatively**, because you don't name competitors in your own ads. It orders them by the user's weight, then by distance, dedupes names, and caps them at 24. Each gets a short ref (`P1…`). The client sends only the pin's centre, radius and weights; it can't inject places.
2. **The schema constrains citations.** `cites` is an enum of exactly those refs.
3. **Every angle is verified** (`verifyAngles`, pure, unit-tested). The model is asked for 4; the server keeps up to 3 that:
   - name at least one cited place in the headline or body (full name, or its first two significant words);
   - fit the limits: headline ≤ 70 characters, body ≤ 180;
   - aren't duplicates;
   - pass the lint: no personal-trait phrasing ("Are you a dog owner?", "As a parent…", which Meta's personal-attributes policy disallows), no emoji, no hashtags, no "!!".

   Dropped drafts are counted and their reasons shown in the UI ("1 draft rejected" with a tooltip). They are never silently fixed.

The prompt asks for performance-creative hooks: a hook a scroller gets in two seconds, one concrete benefit, a light call to action, a different route per angle (convenience, routine, local pride, timing), and the business category used as a category, not a brand.

**Regenerate** bumps an `attempt` number. The model doesn't see it, but it changes the cache key, so you get fresh copy. Angles are cached per pin + radius + weights in the browser, so changing targeting never shows stale copy.

Live measurement: about 1,000 input and 170 output tokens, about 5 s, about $0.002 per pin.

## Guards

| Guard | Setting | Why |
| --- | --- | --- |
| Request validation | zod schemas, 8 KB body cap | Reject junk before it costs anything |
| Rate limit | 12 AI calls per client per 5 min (sliding window, client = first `X-Forwarded-For` hop) | Stop a loop or a bot from draining the key |
| Daily budget | `AI_DAILY_BUDGET_USD`, default $3, estimated from usage × price | A hard ceiling on spend for a public demo. Non-AI features keep working when it's reached. |
| Cache | LRU, 300 entries, key = route + canonical JSON | Repeat demos are instant and free. Cached answers skip the limit and budget. |
| Timeouts | 25 s server-side (1 SDK retry), 40 s client-side, Cancel button | A slow call never hangs the UI |
| Retention | `store: false` on every call | Briefs aren't stored for later retrieval through the API |
| Logging | One JSON line per API call: route, status, ms, cost, cached, error code | Observability with **no user text** |
| Model pin | `MODEL = "gpt-6.1-terra"` in code | Changing the model is a reviewed change, not an environment surprise |

Error codes the UI turns into messages: `ai_disabled` (503), `invalid_request` (400), `rate_limited` / `budget_reached` / `upstream_rate_limit` (429), `timeout` (504), `upstream_error` / `incomplete` / `no_output` / `all_rejected` (502), `no_positive_weight` / `too_few_places` (422).

## Cost

Prices come from OpenAI's model page (checked 2026-11-18): $1.00 per 1M input tokens, $0.05 cached, $5.00 output. They live in `server/ai/llm.ts` (`PRICE_PER_M`) and feed both the cost shown in the UI and the daily budget. At about $0.002 per call, the default $3 budget allows roughly 1,500 calls a day.

## Testing

- `server/server.test.ts` (22 tests, no network) covers plan post-validation, pin grounding (radius, confidence, competitor exclusion, dedupe), angle verification and lint, name matching, rate limiting, the budget's day roll-over, LRU eviction, cache-key canonicalisation, pricing, and API behaviour: health, 503 without a key, 400 before the model is called, cache hits not calling the model, 429s, and unknown metros.
- Live checks (run manually, they cost about $0.002 each):

  ```bash
  cd app && npm run dev:server     # reads ../.env
  curl -s localhost:8787/api/health
  curl -s -X POST localhost:8787/api/brief -H 'content-type: application/json' \
    -d '{"brief":"Premium mobile dog grooming for busy families with yards"}'
  ```

## Extending

- **A new AI feature.** Write a pure module in `server/ai/`: request schema, response schema with enums wherever the answer must come from a known set, instructions, and post-validation. Add a route in `api.ts` through `guarded(...)`, so it inherits validation, cache, limits and budget for free. Add tests with a fake `Llm`.
- **Changing models.** Edit `MODEL` and `PRICE_PER_M` together. Re-run the live checks, and read a few outputs before shipping.
