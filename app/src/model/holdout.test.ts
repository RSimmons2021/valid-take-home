import { describe, expect, it } from "vitest";
import type { Weights } from "./factors";
import { bestShuffle, designLiftTest, liftCsv, targetUnits } from "./holdout";
import { planPins } from "./plan";
import { scoreCells } from "./score";
import { fakeMetro } from "./testkit";

describe("lift test design", () => {
  // A wide synthetic metro with 40 ZIPs in vertical bands; vets vary so scores vary.
  const probe = fakeMetro({ k: 26 });
  const span = Math.max(...Array.from(probe.x, Math.abs)) * 2 + 1;
  const zipOf = (x: number) => Math.min(39, Math.floor(((x + span / 2) / span) * 40));
  const m = fakeMetro({ k: 26, zipCount: 40, zip: (i) => zipOf(probe.x[i]), vets: (i) => (i * 7) % 5, homes: (i) => 80 + (i % 9) * 10 });
  const weights: Weights = { homes: 1, pet_life: 2 };
  const plan = planPins(m, scoreCells(m, { weights, minHomes: 0 }).score, { pins: 6, radiusMi: 1 });
  const d = designLiftTest(m, plan, weights, 0, 0.1, 1);

  it("splits the plan's own ZIPs into test and control pairs, each ZIP used once", () => {
    expect(d.pairs.length).toBeGreaterThan(0);
    const zips = d.pairs.flatMap((p) => [p.test.zip, p.control.zip]);
    expect(new Set(zips).size).toBe(zips.length);
  });

  it("withholds roughly half the plan's homes", () => {
    expect(d.holdoutShare).toBeGreaterThan(0.3);
    expect(d.holdoutShare).toBeLessThan(0.7);
  });

  it("reports balance per covariate", () => {
    expect(d.balance.map((b) => b.covariate)).toEqual(["Fit score", "Homes (log)", "Detached share"]);
  });

  it("is deterministic for a seed and changes with it", () => {
    const again = designLiftTest(m, plan, weights, 0, 0.1, 1);
    const key = (x: typeof d) => x.pairs.map((p) => `${p.test.zip}>${p.control.zip}`).join(" ");
    expect(key(again)).toBe(key(d));
    const others = [2, 3, 4, 5].map((s) => key(designLiftTest(m, plan, weights, 0, 0.1, s)));
    expect(others.some((k) => k !== key(d))).toBe(true);
  });

  it("re-randomisation never makes balance worse", () => {
    const worst = (x: typeof d) => Math.max(...x.balance.map((b) => Math.abs(b.smd)));
    expect(worst(bestShuffle(targetUnits(m, plan, weights, 0, 0.1), 1, 15))).toBeLessThanOrEqual(worst(d));
  });

  it("writes one CSV row per pair", () => {
    const lines = liftCsv(d).trim().split("\n");
    expect(lines[0]).toBe("pair,test_zip,test_homes,test_score,control_zip,control_homes,control_score");
    expect(lines).toHaveLength(d.pairs.length + 1);
  });
});
