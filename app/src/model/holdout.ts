import type { Metro } from "../data/metro";
import { mulberry32 } from "./calibrate";
import { plannedZips } from "./export";
import type { Weights } from "./factors";
import { scoreCells } from "./score";
import type { Plan } from "./plan";

/**
 * Lift test design: measure what the ads *caused*, not what they were near.
 *
 * Platform attribution credits conversions that happened near ads. A geo holdout answers
 * the real question by comparing areas that got ads with comparable areas that didn't.
 *
 * The obvious design is wrong here. The planner deliberately targets the best-fit ZIPs, so
 * controls drawn from the untargeted rest are worse by construction. On the real metros that
 * gave fit-score imbalances of 1.5–2.6 standard deviations, so the "lift" would mostly
 * measure the targeting.
 *
 * So this uses matched-pair randomisation *within* the plan's ZIPs, as geo experiments do:
 *  1. Pair the plan's ZIPs by similarity (fit score, log homes, detached share),
 *     greedy nearest-neighbour, largest first.
 *  2. Flip a seeded coin in each pair: one ZIP is advertised to (test), the other held out
 *     (control). An odd ZIP out stays in test and isn't compared.
 *  3. Report balance as standardised mean differences (|SMD| < 0.1 good, < 0.25 fair).
 *
 * The cost is explicit: the control half of the plan gets no ads during the test.
 */

export interface ZipUnit {
  zip: string;
  homes: number;
  score: number;
  detached: number;
}

export interface Pair {
  test: ZipUnit;
  control: ZipUnit;
  /** standardised distance between the two (lower is a closer match) */
  distance: number;
}

export interface Balance {
  covariate: "Fit score" | "Homes (log)" | "Detached share";
  test: number;
  control: number;
  smd: number | null;
  verdict: "good" | "fair" | "poor";
}

export interface LiftDesign {
  pairs: Pair[];
  /** an odd ZIP out: advertised to, not part of the comparison */
  unpaired: ZipUnit | null;
  balance: Balance[];
  testHomes: number;
  controlHomes: number;
  /** share of the plan's ZIP homes withheld from ads during the test */
  holdoutShare: number;
  quality: "good" | "fair" | "weak";
  notes: string[];
  seed: number;
}

const NAMES: Balance["covariate"][] = ["Fit score", "Homes (log)", "Detached share"];
const covariates = (u: ZipUnit) => [u.score, Math.log10(Math.max(1, u.homes)), u.detached];

function meanSd(v: number[]) {
  const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1));
  return { m, sd };
}

/** The plan's ZIPs (≥ minShare of their homes reached), described for matching. */
export function targetUnits(metro: Metro, plan: Plan, weights: Weights, minHomes: number, minShare = 0.5): ZipUnit[] {
  const { score } = scoreCells(metro, { weights, minHomes });
  const stats = metro.zips.map(() => ({ rooftops: 0, single: 0, scoredHomes: 0, weightedScore: 0 }));
  for (let i = 0; i < metro.n; i++) {
    const zip = stats[metro.zip[i]];
    if (!zip) continue;
    zip.rooftops += metro.rooftops[i];
    zip.single += metro.single[i] * metro.rooftops[i];
    if (Number.isFinite(score[i])) {
      zip.scoredHomes += metro.homes[i];
      zip.weightedScore += score[i] * metro.homes[i];
    }
  }
  const covered = new Set(plannedZips(metro, plan).filter((r) => r.share >= minShare).map((r) => r.code));
  return metro.zips.flatMap(({ code, homes }, i) => {
    const z = stats[i];
    if (!covered.has(code) || !z.scoredHomes || !z.rooftops) return [];
    return [{ zip: code, homes, score: z.weightedScore / z.scoredHomes, detached: z.single / z.rooftops }];
  })
    .sort((a, b) => b.homes - a.homes || a.zip.localeCompare(b.zip));
}

/** Pair similar ZIPs (independent of the coin flips, so computed once per plan). */
function pairUp(target: ZipUnit[]): { pairs: [ZipUnit, ZipUnit, number][]; unpaired: ZipUnit | null } {
  const stats = NAMES.map((_, j) => meanSd(target.map((u) => covariates(u)[j])));
  const z = (u: ZipUnit) => covariates(u).map((v, j) => (stats[j].sd ? (v - stats[j].m) / stats[j].sd : 0));
  const left = [...target];
  const pairs: [ZipUnit, ZipUnit, number][] = [];
  while (left.length >= 2) {
    const a = left.shift()!;
    const za = z(a);
    let bi = 0;
    let bd = Number.POSITIVE_INFINITY;
    left.forEach((u, k) => {
      const zu = z(u);
      const d = Math.hypot(za[0] - zu[0], za[1] - zu[1], za[2] - zu[2]);
      if (d < bd) {
        bd = d;
        bi = k;
      }
    });
    const [b] = left.splice(bi, 1);
    pairs.push([a, b, bd]);
  }
  return { pairs, unpaired: left[0] ?? null };
}

/** Assign one ZIP of each pair to test with a seeded coin, and measure the result. */
export function assign(target: ZipUnit[], seed = 1): LiftDesign {
  const { pairs: raw, unpaired } = pairUp(target);
  const rand = mulberry32(seed);
  const pairs: Pair[] = raw.map(([a, b, distance]) => (rand() < 0.5 ? { test: a, control: b, distance } : { test: b, control: a, distance }));

  const balance: Balance[] = NAMES.map((covariate, j) => {
    const T = meanSd(pairs.map((p) => covariates(p.test)[j]));
    const C = meanSd(pairs.map((p) => covariates(p.control)[j]));
    const pooled = Math.sqrt((T.sd ** 2 + C.sd ** 2) / 2);
    const smd = pooled ? (T.m - C.m) / pooled : pairs.length && T.m === C.m ? 0 : null;
    const a = Math.abs(smd ?? Infinity);
    return { covariate, test: T.m, control: C.m, smd, verdict: a < 0.1 ? "good" : a < 0.25 ? "fair" : "poor" };
  });

  const testHomes = pairs.reduce((s, p) => s + p.test.homes, 0) + (unpaired?.homes ?? 0);
  const controlHomes = pairs.reduce((s, p) => s + p.control.homes, 0);
  const worst = Math.max(0, ...balance.map((b) => Math.abs(b.smd ?? Infinity)));
  const quality: LiftDesign["quality"] = pairs.length >= 10 && worst < 0.1 ? "good" : pairs.length >= 6 && worst < 0.25 ? "fair" : "weak";

  const notes: string[] = [];
  if (pairs.length < 10) notes.push(`Only ${pairs.length} matched pair${pairs.length === 1 ? "" : "s"}. Check historical conversion volume and variability before choosing a test duration.`);
  if (pairs.length && worst >= 0.25) notes.push("A covariate is poorly balanced in this shuffle. Reshuffle, or treat the measured lift as directional.");

  return {
    pairs,
    unpaired,
    balance,
    testHomes,
    controlHomes,
    holdoutShare: testHomes + controlHomes ? controlHomes / (testHomes + controlHomes) : 0,
    quality,
    notes,
    seed,
  };
}

export function designLiftTest(metro: Metro, plan: Plan, weights: Weights, minHomes: number, minShare = 0.5, seed = 1): LiftDesign {
  return assign(targetUnits(metro, plan, weights, minHomes, minShare), seed);
}

/** Best-balanced of `tries` shuffles starting at `start`: re-randomisation, a standard fix for small designs. */
export function bestShuffle(target: ZipUnit[], start = 1, tries = 20): LiftDesign {
  const worst = (d: LiftDesign) => Math.max(0, ...d.balance.map((b) => Math.abs(b.smd ?? Infinity)));
  let best = assign(target, start);
  for (let s = start + 1; s < start + tries; s++) {
    const d = assign(target, s);
    if (worst(d) < worst(best)) best = d;
  }
  return best;
}

export function liftCsv(d: LiftDesign): string {
  const rows = d.pairs.map((p, k) =>
    [k + 1, p.test.zip, Math.round(p.test.homes), Math.round(p.test.score), p.control.zip, Math.round(p.control.homes), Math.round(p.control.score)].join(","),
  );
  return `pair,test_zip,test_homes,test_score,control_zip,control_homes,control_score\n${rows.join("\n")}\n`;
}
