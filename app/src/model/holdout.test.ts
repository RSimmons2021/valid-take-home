import { describe, expect, it } from "vitest";
import type { Weights } from "./factors";
import { assign, bestShuffle, designLiftTest, liftCsv, targetUnits } from "./holdout";
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
  const minShare = 0.1;
  const target = targetUnits(m, plan, weights, 0, minShare);
  const d = designLiftTest(m, plan, weights, 0, minShare, 1);

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

  it("uses full ZIP homes and the physical share of single-address rooftops", () => {
    const metro = fakeMetro({ homes: (i) => i % 2 ? 120 + i : 20 });
    metro.single.fill(0.8);
    const pins = planPins(metro, scoreCells(metro, { weights, minHomes: 50 }).score, { pins: 1, radiusMi: 1 });
    const [unit] = targetUnits(metro, pins, weights, 50, 0);
    expect(unit.homes).toBe(metro.zips[0].homes);
    expect(unit.detached).toBeCloseTo(0.8);
  });

  it("does not report perfect balance for unequal constant groups", () => {
    const d = assign([{ zip: "A", homes: 100, score: 40, detached: 0.5 }, { zip: "B", homes: 100, score: 60, detached: 0.5 }]);
    expect(d.balance[0]).toMatchObject({ smd: null, verdict: "poor" });
    expect(d.balance[1]).toMatchObject({ smd: 0, verdict: "good" });
  });

  it("is deterministic for a seed and changes with it", () => {
    const first = assign(target, 1);
    expect(assign(target, 1)).toEqual(first);
    expect(assign(target, 2).pairs).not.toEqual(first.pairs);
  });

  it("re-randomisation never makes balance worse", () => {
    const worst = (x: typeof d) => Math.max(...x.balance.map((b) => Math.abs(b.smd ?? Infinity)));
    expect(worst(bestShuffle(target, 1, 15))).toBeLessThanOrEqual(worst(d));
  });

  it("writes one CSV row per pair", () => {
    const lines = liftCsv(d).trim().split("\n");
    expect(lines[0]).toBe("pair,test_zip,test_homes,test_score,control_zip,control_homes,control_score");
    expect(lines).toHaveLength(d.pairs.length + 1);
  });
});
