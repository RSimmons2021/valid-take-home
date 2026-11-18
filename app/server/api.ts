import { z } from "zod";
import { type Angle, AnglesRequest, anglesForPin } from "./ai/angles.ts";
import { BriefRequest, planFromBrief } from "./ai/brief.ts";
import { AiError, type Llm, type Usage } from "./ai/llm.ts";
import { type ImageGen, SceneRequest, scenePrompt } from "./ai/scene.ts";
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
  /** scene photos for pin videos; null when not configured (videos fall back to illustrations) */
  image?: ImageGen | null;
  /** images are big and come in batches (one per pin), so they get their own cache and limit */
  imageCache?: LruCache<unknown>;
  imageLimiter?: RateLimiter;
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
    { cache = deps.cache, limiter = deps.limiter }: { cache?: LruCache<unknown>; limiter?: RateLimiter } = {},
  ): Promise<ApiResult> {
    if (!deps.llm) return fail(503, "ai_disabled", "AI features aren't configured on this server.");
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");

    // Cached answers are free and instant, so they skip the rate limit and budget.
    const key = cacheKey(route, parsed.data);
    const hit = cache.get(key);
    if (hit) return { status: 200, body: { ...(hit as object), cached: true }, log: { cached: true } };

    const wait = limiter.take(client);
    if (wait > 0) return fail(429, "rate_limited", `Too many AI requests. Try again in ${wait}s.`, { "Retry-After": String(wait) });
    if (!deps.budget.canSpend()) return fail(429, "budget_reached", "Today's AI budget for this demo is used up. Everything else still works.");

    try {
      const { result, usage } = await run(parsed.data);
      deps.budget.record(usage.costUsd);
      const payload = { ...result, usage };
      cache.set(key, payload);
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
    if (method === "POST" && path === "/api/scene") {
      if (!deps.image) return fail(503, "images_disabled", "Scene images aren't configured on this server.");
      const parsed = SceneRequest.safeParse(body);
      if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
      // The scene comes from the pin's verified angles (normally a cache hit), never from the client.
      const { angle, ...anglesInput } = parsed.data;
      const angles = await handle("POST", "/api/angles", anglesInput, client);
      if (angles.status !== 200) return angles;
      const chosen = (angles.body as { angles: Angle[] }).angles[angle];
      if (!chosen) return fail(404, "no_such_angle", "This pin has fewer verified angles than that.");
      return guarded(
        "scene",
        SceneRequest,
        parsed.data,
        client,
        async () => {
          const { jpeg, usage } = await deps.image!(scenePrompt(chosen.scene));
          return { result: { image: `data:image/jpeg;base64,${jpeg.toString("base64")}`, scene: chosen.scene }, usage };
        },
        { cache: deps.imageCache ?? deps.cache, limiter: deps.imageLimiter ?? deps.limiter },
      );
    }
    return fail(404, "not_found", "No such endpoint.");
  };
}
