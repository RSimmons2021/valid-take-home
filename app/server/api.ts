import { z } from "zod";
import { AnglesRequest, anglesForPin } from "./ai/angles.ts";
import { BriefRequest, planFromBrief } from "./ai/brief.ts";
import { AiError, type Llm, type Usage } from "./ai/llm.ts";
import type { DataStore } from "./data.ts";
import { type DailyBudget, type LruCache, type RateLimiter, cacheKey } from "./guards.ts";

export interface ApiDeps {
  data: DataStore;
  /** null when no API key is configured: AI routes answer 503 and the UI hides AI */
  llm: Llm | null;
  limiter: RateLimiter;
  budget: DailyBudget;
  cache: LruCache<unknown>;
  model: string;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** for the access log: never the user's text, only shape and cost */
  log?: { costUsd?: number; cached?: boolean; code?: string };
}

const fail = (status: number, code: string, message: string, headers?: Record<string, string>): ApiResult => ({
  status,
  body: { error: { code, message } },
  headers,
  log: { code },
});

/**
 * Transport-free API: (method, path, body, client) → result. main.ts does the HTTP;
 * tests call this directly with a fake model.
 */
export function createApi(deps: ApiDeps) {
  async function guarded<T extends z.ZodType>(
    route: string,
    schema: T,
    body: unknown,
    client: string,
    run: (input: z.infer<T>) => Promise<{ result: Record<string, unknown>; usage: Usage }>,
  ): Promise<ApiResult> {
    if (!deps.llm) return fail(503, "ai_disabled", "AI features aren't configured on this server.");
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");

    // Cached answers are free and instant, so they skip the rate limit and budget.
    const key = cacheKey(route, parsed.data);
    const hit = deps.cache.get(key);
    if (hit) return { status: 200, body: { ...(hit as object), cached: true }, log: { cached: true } };

    const wait = deps.limiter.take(client);
    if (wait > 0) return fail(429, "rate_limited", `Too many AI requests. Try again in ${wait}s.`, { "Retry-After": String(wait) });
    if (!deps.budget.canSpend()) return fail(429, "budget_reached", "Today's AI budget for this demo is used up. Everything else still works.");

    try {
      const { result, usage } = await run(parsed.data);
      deps.budget.record(usage.costUsd);
      const payload = { ...result, usage };
      deps.cache.set(key, payload);
      return { status: 200, body: { ...payload, cached: false }, log: { costUsd: usage.costUsd } };
    } catch (e) {
      if (e instanceof AiError) return fail(e.status, e.code, e.message);
      throw e;
    }
  }

  return async function handle(method: string, path: string, body: unknown, client: string): Promise<ApiResult> {
    if (method === "GET" && path === "/api/health") {
      return { status: 200, body: { ok: true, ai: deps.llm != null, model: deps.llm ? deps.model : null } };
    }
    if (method === "POST" && path === "/api/brief") {
      return guarded("brief", BriefRequest, body, client, async ({ brief }) => {
        const { plan, usage } = await planFromBrief(brief, await deps.data.catalogue(), deps.llm!);
        return { result: { plan }, usage };
      });
    }
    if (method === "POST" && path === "/api/angles") {
      return guarded("angles", AnglesRequest, body, client, async (input) => {
        if (!(await deps.data.has(input.metroId))) throw new AiError("Unknown metro.", 400, "invalid_request");
        const { angles, rejected, grounded, usage } = await anglesForPin(input, await deps.data.metro(input.metroId), deps.llm!);
        return { result: { angles, rejected, grounded }, usage };
      });
    }
    return fail(404, "not_found", "No such endpoint.");
  };
}
