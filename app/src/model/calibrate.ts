import type { Metro } from "../data/metro";
import { type Weight, type Weights, factorsFor } from "./factors";
import { percentileRanks, scoreCells } from "./score";

/**
 * Learn from results: given what a campaign actually delivered per ZIP, which weights would
 * have ranked those ZIPs better? This closes the loop: plan → run → measure → better plan.
 *
 * Method, chosen to be honest at small n and explainable to a media buyer:
 *  1. Describe each ZIP by the homes-weighted mean percentile of every factor across its cells,
 *     and score it with the same formula the map uses (weighted mean of centred percentiles).
 *  2. Outcome = conversions per unit of exposure (impressions, else spend, else homes).
 *  3. Fit = Spearman rank correlation between ZIP score and outcome: "does the plan rank
 *     ZIPs the way the results did?"
 *  4. Greedy search over the decision itself: try every one-step weight change, keep the one
 *     that improves fit most, but only if the gain is ≥ 0.03 and holds in ≥ 90% of seeded
 *     bootstrap resamples of the ZIPs. Repeat (at most 4 changes).
 *
 * Why not per-factor correlation or a regression? Place-density signals (nightlife, trades,
 * errands) rise together, so each one "predicts" results on its own even when only one
 * matters, and a regression on ~50 ZIPs with 16 collinear factors is unstable and hard to
 * explain. Searching weight changes handles that naturally: once one density signal is in,
 * a near-duplicate no longer improves the ranking, so it isn't suggested.
 */

export interface ResultRow {
  zip: string;
  conversions: number;
  impressions?: number;
  spend?: number;
}

export type Exposure = "impressions" | "spend" | "homes";

export interface ParsedResults {
  rows: ResultRow[];
  exposure: Exposure;
  skipped: { line: number; reason: string }[];
}

const HEADER: Record<keyof ResultRow, RegExp> = {
  zip: /^(zip|zip ?code|zipcode|postal ?code|postcode|postal)$/i,
  conversions: /^(conversions?|results?|purchases?|leads?|signups?|sign ?ups?|installs?)$/i,
  impressions: /^(impressions?|impr\.?)$/i,
  spend: /^(spend|amount ?spent.*|cost|spend ?\(usd\))$/i,
};

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const num = (s: string | undefined) => {
  if (s == null || s === "") return undefined;
  const v = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? v : Number.NaN;
};

/**
 * Parse an ads-platform export (or a hand-made sheet). Accepts comma, tab or semicolon
 * separators, common column names, currency formatting, and ZIP+4. Reports every skipped
 * line with a reason instead of guessing.
 */
export function parseResults(text: string): ParsedResults {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("Expected a header row and at least one data row.");
  // One delimiter per file, detected from the header, so "1,200" in a tab-separated export stays one number.
  const sep = lines[0].includes("\t") ? "\t" : (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitCsvLine(lines[0], sep);
  const col = (k: keyof ResultRow) => header.findIndex((h) => HEADER[k].test(h));
  const zi = col("zip");
  const ci = col("conversions");
  if (zi < 0) throw new Error('No ZIP column found. Name it "zip" or "postal code".');
  if (ci < 0) throw new Error('No conversions column found. Name it "conversions", "results", "leads" or "purchases".');
  const ii = col("impressions");
  const si = col("spend");

  const byZip = new Map<string, ResultRow>();
  const skipped: ParsedResults["skipped"] = [];
  lines.slice(1).forEach((line, k) => {
    const cells = splitCsvLine(line, sep);
    const zip = /^(\d{5})(-\d{4})?$/.exec(cells[zi] ?? "")?.[1];
    const conversions = num(cells[ci]);
    const impressions = ii >= 0 ? num(cells[ii]) : undefined;
    const spend = si >= 0 ? num(cells[si]) : undefined;
    const why = !zip
      ? "not a 5-digit ZIP"
      : conversions == null || Number.isNaN(conversions) || conversions < 0
        ? "conversions missing or invalid"
        : [impressions, spend].some((v) => v != null && (Number.isNaN(v) || v < 0))
          ? "impressions or spend invalid"
          : null;
    if (why) return skipped.push({ line: k + 2, reason: why });
    // Platforms sometimes split a ZIP across rows (by day or ad); sum them.
    const prev = byZip.get(zip!);
    byZip.set(zip!, {
      zip: zip!,
      conversions: (prev?.conversions ?? 0) + conversions!,
      // A missing denominator on any day makes the ZIP total incomplete.
      impressions: impressions == null || (prev && prev.impressions == null) ? undefined : (prev?.impressions ?? 0) + impressions,
      spend: spend == null || (prev && prev.spend == null) ? undefined : (prev?.spend ?? 0) + spend,
    });
  });
  const rows = [...byZip.values()];
  const exposure: Exposure = rows.every((r) => (r.impressions ?? 0) > 0)
    ? "impressions"
    : rows.every((r) => (r.spend ?? 0) > 0)
      ? "spend"
      : "homes";
  return { rows, exposure, skipped };
}

/** Average ranks (1..n) with ties sharing their mean rank. */
function ranks(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const r: number[] = Array.from({ length: v.length }, () => 0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function spearman(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return Number.NaN;
  const rx = ranks(x);
  const ry = ranks(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

/** Deterministic PRNG so the same upload always gives the same intervals. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95% interval for Spearman's rho, resampling ZIPs. */
export function bootstrapRho(x: number[], y: number[], draws = 400, seed = 7): [number, number] {
  const n = x.length;
  const rand = mulberry32(seed);
  const out: number[] = [];
  for (let b = 0; b < draws; b++) {
    const bx: number[] = [];
    const by: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(rand() * n);
      bx.push(x[k]);
      by.push(y[k]);
    }
    const r = spearman(bx, by);
    if (!Number.isNaN(r)) out.push(r);
  }
  out.sort((a, b) => a - b);
  const q = (p: number) => out[Math.min(out.length - 1, Math.max(0, Math.round(p * (out.length - 1))))];
  return [q(0.025), q(0.975)];
}

export interface ZipFeatures {
  zip: string;
  homes: number;
  /** homes-weighted mean percentile (0..1) per factor id */
  factors: Record<string, number>;
  /** homes-weighted mean score (0..100) under the given weights */
  score: number;
}

/** Describe every ZIP in the metro by its cells. Pure; used by calibration and the lift test. */
export function zipFeatures(metro: Metro, weights: Weights, minHomes: number): Map<string, ZipFeatures> {
  const eligible = new Uint8Array(metro.n);
  for (let i = 0; i < metro.n; i++) eligible[i] = metro.homes[i] >= minHomes ? 1 : 0;
  const factors = factorsFor(metro);
  const pct = factors.map((f) => percentileRanks(f.value(metro), eligible));
  const score = scoreCells(metro, { weights, minHomes }).score;

  const acc = new Map<number, { homes: number; f: number[]; fw: number[]; s: number; sw: number }>();
  for (let i = 0; i < metro.n; i++) {
    const z = metro.zip[i];
    if (z < 0 || !eligible[i]) continue;
    const h = metro.homes[i];
    let a = acc.get(z);
    if (!a) {
      a = { homes: 0, f: factors.map(() => 0), fw: factors.map(() => 0), s: 0, sw: 0 };
      acc.set(z, a);
    }
    a.homes += h;
    factors.forEach((_, k) => {
      const p = pct[k][i];
      if (!Number.isNaN(p)) {
        a!.f[k] += p * h;
        a!.fw[k] += h;
      }
    });
    if (!Number.isNaN(score[i])) {
      a.s += score[i] * h;
      a.sw += h;
    }
  }
  const out = new Map<string, ZipFeatures>();
  for (const [z, a] of acc) {
    const code = metro.zips[z].code;
    out.set(code, {
      zip: code,
      homes: a.homes,
      factors: Object.fromEntries(factors.map((f, k) => [f.id, a.fw[k] ? a.f[k] / a.fw[k] : 0.5])),
      score: a.sw ? a.s / a.sw : Number.NaN,
    });
  }
  return out;
}

export interface Change {
  id: string;
  label: string;
  from: Weight;
  to: Weight;
  /** fit (Spearman rho) before and after this change */
  before: number;
  after: number;
  /** share of bootstrap resamples in which the change improved fit */
  robustness: number;
}

export interface Calibration {
  n: number;
  exposure: Exposure;
  unmatched: string[];
  dropped: { zip: string; reason: string }[];
  /** how well the current weights rank ZIPs by actual performance, with a 95% interval */
  currentFit: { rho: number; ci: [number, number] };
  /** after the suggested changes (in-sample, so optimistic: confirm with a lift test) */
  suggestedFit: { rho: number; ci: [number, number] };
  changes: Change[];
  /** factors that were tried and gave no reliable gain, for the "we checked" list */
  tested: number;
  suggested: Weights;
}

export const MIN_ZIPS = 8;
const MIN_IMPRESSIONS = 500;
const MIN_SPEND = 5;
const MIN_GAIN = 0.03;
const MIN_ROBUSTNESS = 0.9;
const MAX_CHANGES = 4;
const DRAWS = 300;

/** ZIP-level score with the map's formula: weighted mean of centred factor percentiles. */
function zipComposite(features: ZipFeatures[], weights: Weights): number[] {
  const active = Object.entries(weights).filter(([, w]) => w !== 0);
  const den = active.reduce((s, [, w]) => s + Math.abs(w), 0) || 1;
  return features.map((f) => active.reduce((s, [id, w]) => s + w * ((f.factors[id] ?? 0.5) - 0.5), 0) / den);
}

/** Share of bootstrap resamples (same resamples for both) in which `b` ranks better than `a`. */
function robustness(a: number[], b: number[], y: number[], draws: number, seed: number): number {
  const n = y.length;
  const rand = mulberry32(seed);
  let wins = 0;
  for (let d = 0; d < draws; d++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n));
    const yy = idx.map((k) => y[k]);
    if (spearman(idx.map((k) => b[k]), yy) > spearman(idx.map((k) => a[k]), yy)) wins++;
  }
  return wins / draws;
}

export function calibrate(metro: Metro, parsed: ParsedResults, weights: Weights, minHomes: number): Calibration {
  const features = zipFeatures(metro, weights, minHomes);
  const unmatched: string[] = [];
  const dropped: Calibration["dropped"] = [];
  const used: { f: ZipFeatures; rate: number }[] = [];

  for (const r of parsed.rows) {
    const f = features.get(r.zip);
    if (!f) {
      unmatched.push(r.zip);
      continue;
    }
    let exposure: number;
    if (parsed.exposure === "impressions") {
      exposure = r.impressions ?? 0;
      if (exposure < MIN_IMPRESSIONS) {
        dropped.push({ zip: r.zip, reason: `fewer than ${MIN_IMPRESSIONS} impressions` });
        continue;
      }
    } else if (parsed.exposure === "spend") {
      exposure = r.spend ?? 0;
      if (exposure < MIN_SPEND) {
        dropped.push({ zip: r.zip, reason: `less than $${MIN_SPEND} spend` });
        continue;
      }
    } else {
      exposure = f.homes;
    }
    used.push({ f, rate: r.conversions / exposure });
  }

  if (used.length < MIN_ZIPS) {
    throw new Error(
      `Only ${used.length} ZIP${used.length === 1 ? "" : "s"} matched this metro with enough delivery. ` +
        `Calibration needs at least ${MIN_ZIPS} to say anything honest.`,
    );
  }

  const y = used.map((u) => u.rate);
  const feats = used.map((u) => u.f);
  const factors = factorsFor(metro);
  const fitOf = (w: Weights) => spearman(zipComposite(feats, w), y);

  let w: Weights = { ...weights };
  let current = zipComposite(feats, w);
  let fit = spearman(current, y);
  const startFit = { rho: fit, ci: bootstrapRho(current, y) };
  const changes: Change[] = [];
  let tested = 0;

  for (let step = 0; step < MAX_CHANGES; step++) {
    let best: (Change & { vec: number[]; next: Weights }) | null = null;
    for (const f of factors) {
      const from = (w[f.id] ?? 0) as Weight;
      for (const d of [-1, 1]) {
        const to = (from + d) as Weight;
        if (to < -2 || to > 2) continue;
        const next = { ...w, [f.id]: to };
        if (to === 0) delete next[f.id];
        if (!Object.values(next).some((v) => v > 0)) continue; // a plan needs something to aim for
        tested++;
        const after = fitOf(next);
        if (after - fit < MIN_GAIN || (best && after <= best.after)) continue;
        const vec = zipComposite(feats, next);
        const rob = robustness(current, vec, y, DRAWS, 17 + step);
        if (rob < MIN_ROBUSTNESS) continue;
        best = { id: f.id, label: f.label, from, to, before: fit, after, robustness: rob, vec, next };
      }
    }
    if (!best) break;
    changes.push({ id: best.id, label: best.label, from: best.from, to: best.to, before: best.before, after: best.after, robustness: best.robustness });
    w = best.next;
    current = best.vec;
    fit = best.after;
  }

  return {
    n: used.length,
    exposure: parsed.exposure,
    unmatched,
    dropped,
    currentFit: startFit,
    suggestedFit: { rho: fit, ci: bootstrapRho(current, y) },
    changes,
    tested,
    suggested: w,
  };
}

/* ---------------------------------------------------------------------------------------- */

export interface Simulation {
  csv: string;
  /** the hidden weights that generated the data, revealed after calibration */
  truth: Weights;
  story: string;
}

/**
 * Simulated campaign results for the demo, generated from a hidden "true" weighting that
 * differs from the user's: one of their preferred factors turns out not to matter, and one
 * they didn't weight turns out to matter. Calibration should recover that, which is a
 * check on the method as much as a demo of it. Always labelled as simulated in the UI.
 */
export function simulateResults(metro: Metro, weights: Weights, minHomes: number, zips: string[], seed = 42): Simulation {
  const rand = mulberry32(seed);
  const all = factorsFor(metro).map((f) => f.id);
  const positives = Object.entries(weights)
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => a - b);
  const truth: Weights = { ...weights };
  const dud = positives.length > 1 ? positives[0][0] : null;
  if (dud) delete truth[dud];
  const candidates = ["families", "premium_grocers", "daily_needs", "pet_life", "single", "homes", "fitness"];
  const hidden = candidates.find((c) => all.includes(c) && !(weights[c] ?? 0)) ?? null;
  if (hidden) truth[hidden] = 2;

  const features = zipFeatures(metro, truth, minHomes);
  const label = (id: string | null) => factorsFor(metro).find((f) => f.id === id)?.label ?? id;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const lines = ["zip,impressions,conversions,spend"];
  for (const z of zips) {
    const f = features.get(z);
    if (!f) continue;
    const impressions = Math.round(f.homes * (18 + rand() * 14));
    // conversion propensity rises with the truth score; multiplicative noise keeps it realistic
    const rate = 0.0015 * Math.exp(2.2 * ((f.score || 50) / 100 - 0.5) + 0.25 * gauss());
    const expected = impressions * rate;
    // Poisson draw (Knuth for small means, normal approximation above)
    let conversions: number;
    if (expected < 40) {
      const L = Math.exp(-expected);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rand();
      } while (p > L);
      conversions = k - 1;
    } else conversions = Math.max(0, Math.round(expected + Math.sqrt(expected) * gauss()));
    const spend = ((impressions / 1000) * (9 + rand() * 4)).toFixed(2);
    lines.push(`${z},${impressions},${conversions},${spend}`);
  }
  const story = [
    dud ? `${label(dud)} doesn't actually drive results` : null,
    hidden ? `${label(hidden)} matters a lot, and you weren't using it` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return { csv: `${lines.join("\n")}\n`, truth, story: story || "the truth matches your weights" };
}

/** A CSV template with this plan's ZIPs, so a buyer knows exactly what to fill in. */
export function resultsTemplate(zips: string[]): string {
  return `zip,impressions,conversions,spend\n${zips.map((z) => `${z},,,`).join("\n")}\n`;
}
