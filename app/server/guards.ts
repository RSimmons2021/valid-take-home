import { createHash } from "node:crypto";

/**
 * Cost and abuse guards for the AI endpoints. In-memory is deliberate: one small
 * instance, no shared store to run. A restart resets them, which errs on the side of
 * availability; the daily budget is the hard ceiling on spend.
 */

/** Sliding-window limit per client: at most `max` requests in `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  /** Returns seconds to wait, or 0 if allowed (and records the hit). */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return Math.ceil((this.windowMs - (now - recent[0])) / 1000);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // bound memory under abuse
    return 0;
  }
}

/** Estimated spend per UTC day; refuses new calls once the cap is reached. */
export class DailyBudget {
  private day = "";
  private spent = 0;
  readonly capUsd: number;
  constructor(capUsd: number) {
    this.capUsd = capUsd;
  }
  private roll(now: Date) {
    const d = now.toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.spent = 0;
    }
  }
  canSpend(now = new Date()): boolean {
    this.roll(now);
    return this.spent < this.capUsd;
  }
  record(usd: number, now = new Date()): void {
    this.roll(now);
    this.spent += usd;
  }
  get spentToday(): number {
    return this.spent;
  }
}

/** Small LRU for identical requests: repeat demos are instant and free. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, v);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
}

/** Stable key for a request: route + canonical JSON (sorted keys). */
export function cacheKey(route: string, body: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256").update(`${route}\n${JSON.stringify(canon(body))}`).digest("hex");
}
