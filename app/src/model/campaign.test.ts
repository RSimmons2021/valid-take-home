import { describe, expect, it } from "vitest";
import { MIN_DAILY, TITLE_WORDS, campaignKit, looksPersonal, pinsForBudget, scriptFor, splitBudget } from "./campaign";
import type { Weights } from "./factors";
import { planPins } from "./plan";
import { scoreCells } from "./score";
import { fakeMetro } from "./testkit";

const metro = fakeMetro({ k: 8, homes: (i) => 40 + (i % 9) * 30, vets: (i) => (i % 3 === 0 ? 4 : 0) });
const weights: Weights = { homes: 1, pet_life: 2 };
const result = scoreCells(metro, { weights, minHomes: 0 });
const plan = planPins(metro, result.score, { pins: 4, radiusMi: 1 });

describe("budget", () => {
  it("funds as many pins as the budget allows at the minimum daily spend", () => {
    expect(pinsForBudget(1500, 8)).toBe(8);
    expect(pinsForBudget(600, 8)).toBe(4); // $20/day ÷ $5
    expect(pinsForBudget(50, 8)).toBe(1); // never zero pins
    expect(pinsForBudget(30 * MIN_DAILY * 3, 8)).toBe(3);
  });

  it("splits in whole dollars that add up to the budget exactly", () => {
    for (const monthly of [1000, 1499, 7, 2500]) {
      const lines = splitBudget(plan.pins, monthly);
      expect(lines).toHaveLength(plan.pins.length);
      expect(lines.reduce((s, l) => s + l.monthly, 0)).toBe(monthly);
      for (const l of lines) expect(Number.isInteger(l.monthly)).toBe(true);
    }
  });

  it("gives every pin at least the minimum daily spend when the budget allows", () => {
    for (const l of splitBudget(plan.pins, 1500)) expect(l.monthly).toBeGreaterThanOrEqual(MIN_DAILY * 30);
  });

  it("gives more to pins that reach more well-matched homes", () => {
    const lines = splitBudget(plan.pins, 1000);
    const byRank = (r: number) => lines.find((l) => l.rank === r)!.monthly;
    const [a, b] = [...plan.pins].sort((x, y) => y.onTargetHomes - x.onTargetHomes);
    expect(byRank(a.rank)).toBeGreaterThanOrEqual(byRank(b.rank));
    expect(splitBudget(plan.pins, 1000)).toEqual(lines); // deterministic
  });
});

describe("scripts", () => {
  const pin = plan.pins[0];

  it("writes a silent-readable script from the data alone, naming only real places", () => {
    const s = scriptFor(metro, pin, weights, { name: "Pet care" });
    expect(s.source).toBe("data");
    expect(s.title.split(" ").length).toBeLessThanOrEqual(TITLE_WORDS);
    expect(s.silentReadable).toBe(true);
    const real = new Set(Array.from({ length: metro.places.n }, (_, k) => metro.places.id[k]));
    for (const c of s.callouts) expect(real.has(c.id)).toBe(true);
    expect(s.callouts.length).toBeLessThanOrEqual(3);
  });

  it("uses a verified AI angle's title and cited places, and clips a missing title", () => {
    const base = scriptFor(metro, pin, weights, { name: "Pet care" });
    const cite = base.callouts[0];
    const angle = { angle: "Routine", headline: "Walks that start at the park on your corner every single morning", body: "We come to you.", scene: "", cites: cite ? [cite] : [] };
    const s = scriptFor(metro, pin, weights, { name: "Pet care" }, angle);
    expect(s.source).toBe("ai");
    expect(s.title.split(" ")).toHaveLength(TITLE_WORDS); // clipped from the headline
    if (cite) expect(s.callouts[0].id).toBe(cite.id);
    const titled = scriptFor(metro, pin, weights, { name: "Pet care" }, { ...angle, title: "Walks from the corner park" });
    expect(titled.title).toBe("Walks from the corner park");
  });
});

describe("people aren't places to point at", () => {
  it("recognises practitioner listings", () => {
    for (const n of ["Melissa Weinberg, MD: Endocrinologist", "Dr. Dawn L. Rosenberg, Md", "Paws Clinic DVM", "Sam Lee, LCSW"]) expect(looksPersonal(n)).toBe(true);
    for (const n of ["Jefferson Square Park", "Joby's Dog Run Area", "Montessori House Of Children", "VIP Petcare Vaccination Clinic"]) expect(looksPersonal(n)).toBe(false);
  });
});

describe("campaign kit", () => {
  it("labels how sure every number is and says nothing was launched", () => {
    const scripts = plan.pins.map((p) => scriptFor(metro, p, weights, { name: "Pet care" }));
    const md = campaignKit({
      metro,
      plan,
      business: { name: "Pet care", summary: "Dog walking." },
      budget: splitBudget(plan.pins, 1200),
      monthly: 1200,
      scripts,
      lift: null,
      link: "https://example.test/#/t",
      date: new Date("2026-11-18T00:00:00Z"),
    });
    expect(md).toContain("Nothing here has been launched or spent");
    expect(md).toContain("**estimated**");
    expect(md).toContain("**unknown**");
    expect(md).toContain("$1,200 a month");
    for (const p of plan.pins) expect(md).toContain(`### Pin ${p.rank}`);
  });
});
