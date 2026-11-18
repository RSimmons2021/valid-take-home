import { describe, expect, it, vi } from "vitest";
import type { FactorInfo } from "../src/model/catalogue.ts";
import { type RawAngles, mentions, pinContext, verifyAngles } from "./ai/angles.ts";
import { type RawPlan, finalizePlan } from "./ai/brief.ts";
import type { Llm, Usage } from "./ai/llm.ts";
import { costOf } from "./ai/llm.ts";
import { createApi } from "./api.ts";
import type { DataStore, MetroData } from "./data.ts";
import { DailyBudget, LruCache, RateLimiter, cacheKey } from "./guards.ts";

const CATALOGUE: FactorInfo[] = [
  { id: "homes", label: "Homes", description: "" },
  { id: "single", label: "Detached houses", description: "" },
  { id: "pet_life", label: "Pet owners nearby", description: "" },
  { id: "pet_care", label: "Pet sitters & boarding", description: "" },
];

// A metro around (37.75, -122.43): signal 0 = pet_life, 1 = pet_care.
const METRO: MetroData = {
  id: "t",
  name: "Testville",
  signals: [
    { id: "pet_life", label: "Pet owners nearby", description: "" },
    { id: "pet_care", label: "Pet sitters & boarding", description: "" },
  ],
  places: {
    id: ["g1", "g2", "g3", "g4", "g5", "g6"],
    name: ["Upper Douglass Dog Park", "Seven Hills Vet", "Rival Dog Walkers", "Far Away Vet", "Shaky Pet Store", "Upper Douglass Dog Park"],
    signal: [0, 0, 1, 0, 0, 0],
    confidence: [0.95, 0.9, 0.95, 0.95, 0.4, 0.9],
    lat: [37.7502, 37.752, 37.751, 37.9, 37.7505, 37.7503],
    lon: [-122.4337, -122.432, -122.434, -122.43, -122.4335, -122.4338],
  },
};

const usage: Usage = { model: "fake", inputTokens: 100, cachedTokens: 0, outputTokens: 50, costUsd: 0.001, ms: 5 };

describe("brief → plan validation", () => {
  const raw = (over: Partial<RawPlan> = {}): RawPlan => ({
    supported: true,
    name: "Mobile Dog Grooming",
    summary: "Families with dogs",
    weights: [
      { factor: "pet_life", weight: 2, reason: "dogs live here" },
      { factor: "pet_life", weight: 1, reason: "duplicate" },
      { factor: "single", weight: 1, reason: "yards" },
    ],
    competitor: null,
    note: "",
    ...over,
  });

  it("drops duplicate factors, keeping the first", () => {
    const p = finalizePlan(raw(), CATALOGUE);
    expect(p.weights.map((w) => w.factor)).toEqual(["pet_life", "single"]);
  });

  it("adds a named competitor the model forgot to weight", () => {
    const p = finalizePlan(raw({ competitor: "pet_care" }), CATALOGUE);
    expect(p.weights.find((w) => w.factor === "pet_care")?.weight).toBe(-1);
    expect(p.competitor).toBe("pet_care");
  });

  it("doesn't call a positively weighted factor the competitor", () => {
    const p = finalizePlan(raw({ competitor: "single" }), CATALOGUE);
    expect(p.competitor).toBeNull();
  });

  it("refuses a plan with nothing to aim for", () => {
    expect(() => finalizePlan(raw({ weights: [{ factor: "pet_care", weight: -2, reason: "x" }] }), CATALOGUE)).toThrow(/nothing to aim for/);
  });

  it("passes through 'unsupported' with a note and no weights", () => {
    const p = finalizePlan(raw({ supported: false, note: "B2B only" }), CATALOGUE);
    expect(p).toMatchObject({ supported: false, weights: [], note: "B2B only" });
  });

  it("clips long strings", () => {
    const p = finalizePlan(raw({ name: "x".repeat(100) }), CATALOGUE);
    expect(p.name.length).toBeLessThanOrEqual(40);
  });
});

describe("pin grounding context", () => {
  const ctx = pinContext(METRO, { lat: 37.7502, lon: -122.4337, radiusMi: 1, weights: { pet_life: 2, pet_care: -1 } });

  it("keeps only confident places inside the radius", () => {
    const names = ctx.map((p) => p.name);
    expect(names).toContain("Seven Hills Vet");
    expect(names).not.toContain("Far Away Vet"); // ~17 km away
    expect(names).not.toContain("Shaky Pet Store"); // confidence 0.4
  });

  it("never offers places the user avoids (competitors) for ad copy", () => {
    expect(ctx.map((p) => p.name)).not.toContain("Rival Dog Walkers");
  });

  it("dedupes by name and numbers refs in order", () => {
    expect(ctx.filter((p) => p.name === "Upper Douglass Dog Park")).toHaveLength(1);
    expect(ctx.map((p) => p.ref)).toEqual(ctx.map((_, i) => `P${i + 1}`));
  });
});

describe("angle verification", () => {
  const places = pinContext(METRO, { lat: 37.7502, lon: -122.4337, radiusMi: 1, weights: { pet_life: 2 } });
  const ref = (name: string) => places.find((p) => p.name === name)!.ref;
  const a = (headline: string, body: string, cites: string[]) => ({ angle: "Test", headline, body, cites });

  it("keeps grounded angles and reports why others were dropped", () => {
    const raw: RawAngles = {
      angles: [
        a("Grooming by Upper Douglass Dog Park", "We come to you.", [ref("Upper Douglass Dog Park")]),
        a("Fresh coats near the park", "We come to you.", [ref("Seven Hills Vet")]), // cites but doesn't name
        a("Are you a dog owner near Seven Hills Vet?", "We come to you.", [ref("Seven Hills Vet")]),
        a("Seven Hills Vet neighbours 🐶", "We come to you.", [ref("Seven Hills Vet")]),
      ],
    };
    const { angles, rejected } = verifyAngles(raw, places);
    expect(angles).toHaveLength(1);
    expect(angles[0].cites[0]).toMatchObject({ id: "g1", name: "Upper Douglass Dog Park" });
    expect(rejected).toEqual(["cited a place it doesn't name", "addresses the reader's personal traits", "contains emoji"]);
  });

  it("rejects copy over the length limits", () => {
    const raw: RawAngles = { angles: [a("Seven Hills Vet " + "x".repeat(80), "ok", [ref("Seven Hills Vet")])] };
    expect(verifyAngles(raw, places).rejected).toEqual(["over the length limit"]);
  });

  it("recognises a place by its full name or its first two words", () => {
    expect(mentions("Right by Upper Douglass Dog Park today", "Upper Douglass Dog Park")).toBe(true);
    expect(mentions("Right by Upper Douglass, every week", "Upper Douglass Dog Park")).toBe(true);
    expect(mentions("Right by the park", "Upper Douglass Dog Park")).toBe(false);
  });
});

describe("guards", () => {
  it("rate-limits per client within a sliding window", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("a", 0)).toBe(0);
    expect(rl.take("a", 10)).toBe(0);
    expect(rl.take("a", 20)).toBeGreaterThan(0);
    expect(rl.take("b", 20)).toBe(0);
    expect(rl.take("a", 1500)).toBe(0); // window passed
  });

  it("caps spend per UTC day and resets the next day", () => {
    const b = new DailyBudget(0.01);
    const d1 = new Date("2026-11-18T10:00:00Z");
    b.record(0.02, d1);
    expect(b.canSpend(d1)).toBe(false);
    expect(b.canSpend(new Date("2026-11-19T00:00:01Z"))).toBe(true);
  });

  it("evicts the least recently used entry", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
  });

  it("keys requests the same regardless of property order", () => {
    expect(cacheKey("r", { a: 1, b: { c: 2, d: 3 } })).toBe(cacheKey("r", { b: { d: 3, c: 2 }, a: 1 }));
    expect(cacheKey("r", { a: 1 })).not.toBe(cacheKey("s", { a: 1 }));
  });

  it("prices cached input tokens at the cached rate", () => {
    expect(costOf(1_000_000, 0, 0)).toBeCloseTo(1);
    expect(costOf(1_000_000, 1_000_000, 0)).toBeCloseTo(0.05);
    expect(costOf(0, 0, 1_000_000)).toBeCloseTo(5);
  });
});

describe("api", () => {
  const data = { has: async (id: string) => id === "t", metro: async () => METRO, catalogue: async () => CATALOGUE } as unknown as DataStore;
  const planLlm = () =>
    vi.fn(async () => ({
      data: {
        supported: true,
        name: "Dog Grooming",
        summary: "Dog owners",
        weights: [{ factor: "pet_life", weight: 2, reason: "dogs" }],
        competitor: null,
        note: "",
      },
      usage,
    })) as unknown as Llm & ReturnType<typeof vi.fn>;
  const make = (llm: Llm | null, limit = 10, budget = 1) =>
    createApi({ data, llm, limiter: new RateLimiter(limit, 60_000), budget: new DailyBudget(budget), cache: new LruCache(10), model: "fake" });

  it("reports whether AI is available", async () => {
    expect((await make(null)("GET", "/api/health", undefined, "c")).body).toMatchObject({ ai: false });
    expect((await make(planLlm())("GET", "/api/health", undefined, "c")).body).toMatchObject({ ai: true, model: "fake" });
  });

  it("answers 503 without a key, and 400 on bad input before calling the model", async () => {
    expect((await make(null)("POST", "/api/brief", { brief: "dog grooming van" }, "c")).status).toBe(503);
    const llm = planLlm();
    expect((await make(llm)("POST", "/api/brief", { brief: "x" }, "c")).status).toBe(400);
    expect(llm).not.toHaveBeenCalled();
  });

  it("serves a repeat request from cache without calling the model again", async () => {
    const llm = planLlm();
    const api = make(llm);
    const first = await api("POST", "/api/brief", { brief: "mobile dog grooming" }, "c");
    const second = await api("POST", "/api/brief", { brief: "mobile dog grooming" }, "c");
    expect(first.body).toMatchObject({ cached: false, plan: { name: "Dog Grooming" } });
    expect(second.body).toMatchObject({ cached: true });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("rate-limits and enforces the daily budget", async () => {
    const limited = make(planLlm(), 1);
    await limited("POST", "/api/brief", { brief: "dog grooming one" }, "c");
    const r = await limited("POST", "/api/brief", { brief: "dog grooming two" }, "c");
    expect(r.status).toBe(429);
    expect(r.headers?.["Retry-After"]).toBeDefined();

    const broke = make(planLlm(), 10, 0);
    expect((await broke("POST", "/api/brief", { brief: "dog grooming three" }, "c")).body).toMatchObject({ error: { code: "budget_reached" } });
  });

  it("rejects unknown metros for angles", async () => {
    const r = await make(planLlm())(
      "POST",
      "/api/angles",
      { metroId: "nope", lat: 37.75, lon: -122.43, radiusMi: 1, weights: {}, business: { name: "Dogs", summary: "" }, area: { hood: null, city: null } },
      "c",
    );
    expect(r.status).toBe(400);
  });
});
