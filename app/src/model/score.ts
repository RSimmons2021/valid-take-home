import type { Metro } from "../data/metro";
import { type Factor, type Weights, factorsFor } from "./factors";

/**
 * Percentile rank (0..1) of each eligible value; ties share their average rank.
 * Ineligible or NaN entries get NaN. Ranking, rather than scaling, keeps one dense
 * downtown cell from flattening the rest of the map.
 */
export function percentileRanks(values: ArrayLike<number>, eligible: Uint8Array): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(Number.NaN);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (eligible[i] && !Number.isNaN(values[i])) idx.push(i);
  idx.sort((a, b) => values[a] - values[b]);
  const m = idx.length;
  if (m === 0) return out;
  if (m === 1) {
    out[idx[0]] = 0.5;
    return out;
  }
  let start = 0;
  while (start < m) {
    let end = start;
    while (end + 1 < m && values[idx[end + 1]] === values[idx[start]]) end++;
    const rank = (start + end) / 2 / (m - 1);
    for (let k = start; k <= end; k++) out[idx[k]] = rank;
    start = end + 1;
  }
  return out;
}

export interface ScoreResult {
  /** 0..100, the cell's percentile among scored cells; NaN when not scored */
  score: Float64Array;
  eligible: Uint8Array;
  scored: number;
  /** percentile per active factor, for explanations */
  pct: Map<string, Float64Array>;
  active: { factor: Factor; weight: number }[];
  /** cells sorted best-first */
  order: Int32Array;
}

export interface ScoreOptions {
  weights: Weights;
  minHomes: number;
}

export function scoreCells(metro: Metro, { weights, minHomes }: ScoreOptions): ScoreResult {
  const n = metro.n;
  const eligible = new Uint8Array(n);
  for (let i = 0; i < n; i++) eligible[i] = metro.homes[i] >= minHomes ? 1 : 0;

  const active = factorsFor(metro)
    .filter((f) => (weights[f.id] ?? 0) !== 0)
    .map((factor) => ({ factor, weight: weights[factor.id] as number }));

  const pct = new Map<string, Float64Array>();
  for (const { factor } of active) pct.set(factor.id, percentileRanks(factor.value(metro), eligible));

  // Composite: weighted mean of centred percentiles. A factor with no information for a
  // cell (NaN) drops out of that cell's mean instead of counting as average.
  const raw = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    if (!eligible[i]) continue;
    let num = 0;
    let den = 0;
    for (const { factor, weight } of active) {
      const p = pct.get(factor.id)![i];
      if (Number.isNaN(p)) continue;
      num += weight * (p - 0.5);
      den += Math.abs(weight);
    }
    raw[i] = den === 0 ? 0 : num / den;
  }
  const rank = percentileRanks(raw, eligible);
  const score = Float64Array.from(rank, (r) => (Number.isNaN(r) ? Number.NaN : Math.round(r * 1000) / 10));

  const scoredIdx: number[] = [];
  for (let i = 0; i < n; i++) if (eligible[i]) scoredIdx.push(i);
  scoredIdx.sort((a, b) => score[b] - score[a] || metro.homes[b] - metro.homes[a]);

  return { score, eligible, scored: scoredIdx.length, pct, active, order: Int32Array.from(scoredIdx) };
}

export interface Contribution {
  factor: Factor;
  weight: number;
  /** cell's percentile on this factor, 0..1 (NaN = no information) */
  pct: number;
  /** signed push on the composite, in "percentile points × weight" */
  push: number;
  raw: number;
}

/** Why a cell scored what it did: each active factor's push, largest first. */
export function explain(metro: Metro, result: ScoreResult, i: number): Contribution[] {
  return result.active
    .map(({ factor, weight }) => {
      const pct = result.pct.get(factor.id)![i];
      return {
        factor,
        weight,
        pct,
        push: Number.isNaN(pct) ? 0 : weight * (pct - 0.5),
        raw: factor.value(metro)[i],
      };
    })
    .sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
}

export type Verdict = "Strong fit" | "Good fit" | "Mixed" | "Weak fit" | "Not scored";

export function verdict(score: number): Verdict {
  if (Number.isNaN(score)) return "Not scored";
  if (score >= 85) return "Strong fit";
  if (score >= 65) return "Good fit";
  if (score >= 40) return "Mixed";
  return "Weak fit";
}
