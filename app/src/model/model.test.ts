import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { buildMetro } from "../data/metro";
import type { MetroFile } from "../data/types";
import { googleRadiusLines, pinsCsv, plannedZips, toCsv } from "./export";
import { ON_TARGET, cellValue, planPins } from "./plan";
import { explain, percentileRanks, scoreCells, verdict } from "./score";

/** A synthetic metro: a disk of cells around a centre, with per-cell overrides. */
function fakeMetro(opts: {
  k?: number;
  homes?: (i: number, id: string) => number;
  vets?: (i: number) => number;
  zip?: (i: number) => number;
}): ReturnType<typeof buildMetro> {
  const centre: [number, number] = [-122.42, 37.77];
  const ids = gridDisk(latLngToCell(centre[1], centre[0], 9), opts.k ?? 6).sort();
  const homes = ids.map((id, i) => opts.homes?.(i, id) ?? 100);
  const file: MetroFile = {
    metro: { id: "t", name: "Test", region: "CA", bbox: [-123, 37, -122, 38], center: centre, zoom: 12 },
    release: "test",
    schema: "2.0.0",
    h3_res: 9,
    built_at: "",
    signals: [{ id: "pet_life", label: "Pet owners", description: "" }],
    ledger: {} as MetroFile["ledger"],
    names: ["Hood"],
    zips: [
      { code: "94110", homes: 0 },
      { code: "94114", homes: 0 },
    ],
    hexes: {
      id: ids,
      homes,
      rooftops: homes.map((h) => h / 2),
      single: ids.map(() => 50),
      buildings: ids.map(() => 10),
      height: ids.map(() => 8),
      footprint: ids.map(() => 1000),
      zip: ids.map((_, i) => opts.zip?.(i) ?? 0),
      hood: ids.map(() => 0),
      city: ids.map(() => -1),
      signals: { pet_life: ids.map((_, i) => opts.vets?.(i) ?? 0) },
    },
    places: { id: [], name: [], brand: [], signal: [], confidence: [], lon: [], lat: [] },
  };
  for (const z of file.zips) z.homes = 0;
  ids.forEach((_, i) => {
    file.zips[file.hexes.zip[i]].homes += homes[i];
  });
  return buildMetro(file);
}

describe("percentileRanks", () => {
  it("ranks 0..1 with ties sharing the average rank", () => {
    const r = percentileRanks([10, 20, 20, 30], new Uint8Array([1, 1, 1, 1]));
    expect(Array.from(r)).toEqual([0, 0.5, 0.5, 1]);
  });

  it("ignores ineligible and NaN values", () => {
    const r = percentileRanks([5, Number.NaN, 1, 9], new Uint8Array([1, 1, 1, 0]));
    expect(r[0]).toBe(1);
    expect(r[2]).toBe(0);
    expect(Number.isNaN(r[1])).toBe(true);
    expect(Number.isNaN(r[3])).toBe(true);
  });

  it("gives a lone value the middle", () => {
    expect(percentileRanks([7], new Uint8Array([1]))[0]).toBe(0.5);
  });
});

describe("scoreCells", () => {
  it("leaves cells under the homes floor unscored", () => {
    const m = fakeMetro({ homes: (i) => (i === 0 ? 3 : 100) });
    const r = scoreCells(m, { weights: { homes: 1 }, minHomes: 25 });
    expect(Number.isNaN(r.score[0])).toBe(true);
    expect(r.scored).toBe(m.n - 1);
  });

  it("orders cells by a preferred factor and reverses for an avoided one", () => {
    const m = fakeMetro({ homes: (i) => 50 + i });
    const prefer = scoreCells(m, { weights: { homes: 2 }, minHomes: 0 });
    const avoid = scoreCells(m, { weights: { homes: -2 }, minHomes: 0 });
    expect(prefer.order[0]).toBe(m.n - 1);
    expect(avoid.order[0]).toBe(0);
    expect(prefer.score[m.n - 1]).toBe(100);
  });

  it("explains a score by the factors that pushed it", () => {
    const m = fakeMetro({ homes: (i) => 50 + i, vets: (i) => (i % 2 ? 3 : 0) });
    const r = scoreCells(m, { weights: { homes: 1, pet_life: 2 }, minHomes: 0 });
    const best = r.order[0];
    const why = explain(m, r, best);
    expect(why).toHaveLength(2);
    expect(why[0].factor.id).toBe("pet_life"); // weight 2 dominates
    expect(why.every((c) => c.push >= 0)).toBe(true);
  });

  it("maps scores to verdicts", () => {
    expect(verdict(90)).toBe("Strong fit");
    expect(verdict(70)).toBe("Good fit");
    expect(verdict(50)).toBe("Mixed");
    expect(verdict(10)).toBe("Weak fit");
    expect(verdict(Number.NaN)).toBe("Not scored");
  });
});

describe("cellValue", () => {
  it("is zero below the on-target line and grows with fit", () => {
    expect(cellValue(100, ON_TARGET - 1)).toBe(0);
    expect(cellValue(100, Number.NaN)).toBe(0);
    expect(cellValue(100, 100)).toBe(100);
    expect(cellValue(100, 75)).toBeLessThan(cellValue(100, 90));
  });
});

describe("planPins", () => {
  const strongEast = (m: ReturnType<typeof fakeMetro>) => {
    // score rises from west to east: the best pin belongs on the east edge
    const score = new Float64Array(m.n);
    const xs = Array.from(m.x);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    for (let i = 0; i < m.n; i++) score[i] = (100 * (m.x[i] - min)) / (max - min);
    return score;
  };

  it("puts the first pin where the strong homes are", () => {
    const m = fakeMetro({ k: 10 });
    const plan = planPins(m, strongEast(m), { pins: 1, radiusMi: 1 });
    expect(plan.pins).toHaveLength(1);
    expect(m.x[plan.pins[0].cell]).toBeGreaterThan(0);
  });

  it("never counts a cell twice across pins", () => {
    const m = fakeMetro({ k: 12 });
    const plan = planPins(m, strongEast(m), { pins: 5, radiusMi: 1 });
    const all = plan.pins.flatMap((p) => p.covered);
    expect(new Set(all).size).toBe(all.length);
    expect(plan.homes).toBe(all.reduce((a, i) => a + m.homes[i], 0));
  });

  it("is deterministic", () => {
    const m = fakeMetro({ k: 10 });
    const s = strongEast(m);
    const a = planPins(m, s, { pins: 4, radiusMi: 1 }).pins.map((p) => p.cell);
    const b = planPins(m, s, { pins: 4, radiusMi: 1 }).pins.map((p) => p.cell);
    expect(a).toEqual(b);
  });

  it("stops early instead of placing pins with nothing to gain", () => {
    const m = fakeMetro({ k: 3 });
    const flat = new Float64Array(m.n).fill(10); // nothing on target
    expect(planPins(m, flat, { pins: 5, radiusMi: 1 }).pins).toHaveLength(0);
  });

  it("reports capture against all on-target homes", () => {
    const m = fakeMetro({ k: 4 });
    const all = new Float64Array(m.n).fill(100);
    const plan = planPins(m, all, { pins: 3, radiusMi: 2 });
    expect(plan.capture).toBeCloseTo(1); // a 2-mile pin swallows this tiny metro
    expect(plan.onTargetHomes).toBe(m.totalHomes);
  });
});

describe("exports", () => {
  it("writes Google's bulk radius format", () => {
    const m = fakeMetro({ k: 4 });
    const plan = planPins(m, new Float64Array(m.n).fill(100), { pins: 1, radiusMi: 1.5 });
    expect(googleRadiusLines(plan)).toMatch(/^\(1\.5mi:37\.\d{6}:-122\.\d{6}\)$/);
  });

  it("escapes CSV cells", () => {
    expect(toCsv([["a,b", 'say "hi"', null, 3]])).toBe('"a,b","say ""hi""",,3\n');
  });

  it("writes a header and a row per pin", () => {
    const m = fakeMetro({ k: 6 });
    const plan = planPins(m, new Float64Array(m.n).fill(90), { pins: 2, radiusMi: 1 });
    const lines = pinsCsv(plan).trim().split("\n");
    expect(lines[0]).toBe("rank,name,latitude,longitude,radius,unit,homes,on_target_homes,mean_score,zip");
    expect(lines).toHaveLength(1 + plan.pins.length);
  });

  it("reports how much of each ZIP a plan reaches", () => {
    // west half 94110, east half 94114; strong cells only in the east
    const probe = fakeMetro({ k: 8 });
    const m2 = fakeMetro({ k: 8, zip: (i) => (probe.x[i] > 0 ? 1 : 0) });
    const score = Float64Array.from(m2.x, (x) => (x > 0 ? 95 : 0));
    const zips = plannedZips(m2, planPins(m2, score, { pins: 1, radiusMi: 1 }));
    expect(zips[0].code).toBe("94114");
    expect(zips[0].share).toBeGreaterThan(0);
    expect(zips[0].share).toBeLessThanOrEqual(1);
  });
});

describe("pin spacing", () => {
  it("keeps pin centres at least SPACING radii apart", async () => {
    const { SPACING, MILE } = await import("./plan");
    const m = fakeMetro({ k: 14 });
    const plan = planPins(m, new Float64Array(m.n).fill(100), { pins: 6, radiusMi: 1 });
    expect(plan.pins.length).toBeGreaterThan(1);
    for (const a of plan.pins)
      for (const b of plan.pins) {
        if (a === b) continue;
        const d = Math.hypot(m.x[a.cell] - m.x[b.cell], m.y[a.cell] - m.y[b.cell]);
        expect(d).toBeGreaterThanOrEqual(SPACING * MILE - 1);
      }
  });
});
