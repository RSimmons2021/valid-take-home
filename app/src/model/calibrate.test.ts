import { describe, expect, it } from "vitest";
import { MIN_ZIPS, calibrate, mulberry32, parseResults, resultsTemplate, simulateResults, spearman } from "./calibrate";
import { fakeMetro } from "./testkit";

describe("parseResults", () => {
  it("reads common export shapes: names, ZIP+4, currency, tabs, repeated ZIPs", () => {
    const csv = "Postal Code\tImpressions\tResults\tAmount spent (USD)\n94110-1234\t1,200\t3\t$12.50\n94110\t800\t1\t$7.50\n94114\t2000\t5\t$20\n";
    const r = parseResults(csv);
    expect(r.exposure).toBe("impressions");
    expect(r.rows).toEqual([
      { zip: "94110", impressions: 2000, conversions: 4, spend: 20 },
      { zip: "94114", impressions: 2000, conversions: 5, spend: 20 },
    ]);
  });

  it("uses complete spend when a daily row is missing impressions", () => {
    const rows = ["94110,2,100,5", "94110,3,,10"];
    for (const ordered of [rows, [...rows].reverse()]) {
      const result = parseResults(["zip,conversions,impressions,spend", ...ordered].join("\n"));
      expect(result.exposure).toBe("spend");
      expect(result.rows[0]).toMatchObject({ conversions: 5, impressions: undefined, spend: 15 });
    }
  });

  it("reports bad lines instead of guessing", () => {
    const r = parseResults("zip,conversions\nhello,1\n94110,-2\n94114,3\n");
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([
      { line: 2, reason: "not a 5-digit ZIP" },
      { line: 3, reason: "conversions missing or invalid" },
    ]);
    expect(r.exposure).toBe("homes"); // no impressions or spend: fall back to per-home rates
  });

  it("explains a missing column", () => {
    expect(() => parseResults("postcode,clicks\n94110,3\n")).toThrow(/conversions column/);
    expect(() => parseResults("region,conversions\nx,3\n")).toThrow(/ZIP column/);
  });

  it("writes a template with the plan's ZIPs", () => {
    expect(resultsTemplate(["94110", "94114"])).toBe("zip,impressions,conversions,spend\n94110,,,\n94114,,,\n");
  });
});

describe("statistics", () => {
  it("spearman is ±1 for monotonic data and handles ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [9, 7, 5, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });

  it("the PRNG is deterministic per seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("calibrate", () => {
  // 12 ZIPs in vertical bands; vets increase from west to east; homes are flat.
  const metro = fakeMetro({ k: 14, zipCount: 12, vets: (i) => i % 7 });
  const zipOf = (x: number) => Math.min(11, Math.max(0, Math.floor(((x + 3500) / 7000) * 12)));
  const m = fakeMetro({ k: 14, zipCount: 12, zip: (i) => zipOf(metro.x[i]), vets: (i) => (metro.x[i] > 0 ? 3 + (i % 3) : i % 2) });
  const codes = m.zips.map((z) => z.code);

  function results(rate: (zipIndex: number) => number): string {
    return `zip,impressions,conversions\n${codes.map((c, k) => `${c},10000,${Math.round(10000 * rate(k))}`).join("\n")}\n`;
  }

  it("suggests adding the factor that actually drove results", () => {
    // conversions rise eastwards, where the vets are; the user weighted only homes
    const cal = calibrate(m, parseResults(results((k) => 0.001 + k * 0.0004)), { homes: 1 }, 0);
    expect(cal.changes[0]?.id).toBe("pet_life");
    expect(cal.changes[0].to).toBeGreaterThan(0);
    expect(cal.suggestedFit.rho).toBeGreaterThan(cal.currentFit.rho);
    expect(cal.changes.every((c) => c.robustness >= 0.9)).toBe(true);
  });

  it("changes nothing when results are noise", () => {
    const rand = mulberry32(3);
    const cal = calibrate(m, parseResults(results(() => 0.002 + rand() * 0.0001)), { homes: 1, pet_life: 1 }, 0);
    expect(cal.changes.length).toBeLessThanOrEqual(1);
  });

  it("refuses to calibrate on too few ZIPs", () => {
    const few = `zip,impressions,conversions\n${codes.slice(0, MIN_ZIPS - 1).map((c) => `${c},10000,5`).join("\n")}\n`;
    expect(() => calibrate(m, parseResults(few), { homes: 1 }, 0)).toThrow(/at least 8/);
  });

  it("drops under-delivered ZIPs and reports unknown ones", () => {
    const csv = results(() => 0.002).replace(`${codes[0]},10000`, `${codes[0]},100`) + "60601,10000,4\n";
    const cal = calibrate(m, parseResults(csv), { homes: 1 }, 0);
    expect(cal.dropped).toEqual([{ zip: codes[0], reason: "fewer than 500 impressions" }]);
    expect(cal.unmatched).toEqual(["60601"]);
  });

  it("simulates labelled results from a hidden truth, deterministically", () => {
    const a = simulateResults(m, { homes: 1, pet_life: 2 }, 0, codes);
    const b = simulateResults(m, { homes: 1, pet_life: 2 }, 0, codes);
    expect(a.csv).toBe(b.csv);
    expect(a.truth.homes).toBeUndefined(); // the weakest preferred factor is the dud
    expect(a.csv.split("\n")[0]).toBe("zip,impressions,conversions,spend");
  });
});
