import { describe, expect, it } from "vitest";
import { creativeBrief, pinPlaces } from "./brief";
import { planPins } from "./plan";
import { fakeMetro } from "./testkit";

describe("creative brief", () => {
  const m = fakeMetro({ k: 6 });
  const c = { lat: m.lat[Math.floor(m.n / 2)], lon: m.lon[Math.floor(m.n / 2)] };
  m.signals.push({ id: "pet_care", label: "Pet sitters & boarding", description: "" });
  Object.assign(m.places, {
    n: 4,
    id: ["g1", "g2", "g3", "g4"],
    name: ["Dolores Dog Park", "Shaky Vet", "Rival Walkers", "Dolores Dog Park"],
    brand: [null, null, null, null],
    signal: Int32Array.from([0, 0, 1, 0]),
    confidence: Float64Array.from([0.9, 0.5, 0.9, 0.95]),
    lat: Float64Array.from([c.lat, c.lat, c.lat, c.lat + 0.0001]),
    lon: Float64Array.from([c.lon, c.lon, c.lon, c.lon]),
  });
  const weights = { pet_life: 2 as const, pet_care: -1 as const };
  const pin = planPins(m, new Float64Array(m.n).fill(90), { pins: 1, radiusMi: 2 }).pins[0];

  it("lists confident preferred places once, and avoided ones separately", () => {
    expect(pinPlaces(m, pin, weights, "preferred", 10).map((p) => p.name)).toEqual(["Dolores Dog Park"]);
    expect(pinPlaces(m, pin, weights, "avoided", 10).map((p) => p.name)).toEqual(["Rival Walkers"]);
  });

  it("writes a grounded brief with references, angles, craft notes and a don't-mention list", () => {
    const md = creativeBrief({
      metro: m,
      pin,
      weights,
      business: { name: "Mobile Dog Grooming", summary: "Busy dog owners." },
      angles: [{ angle: "Convenience", headline: "By Dolores Dog Park", body: "We come to you.", scene: "Sunny park, van arrives", cites: [{ id: "g1", name: "Dolores Dog Park", kind: "Pet owners nearby" }] }],
      link: "https://catchment.test/#/x",
      date: new Date("2026-11-18T00:00:00Z"),
    });
    expect(md).toMatch(/^# Creative brief: Mobile Dog Grooming/);
    expect(md).toContain("**Dolores Dog Park**");
    expect(md).toContain("Scene prompt (9:16, ~5 s): Sunny park, van arrives");
    expect(md).toContain("Don't mention: Rival Walkers");
    expect(md).toContain("2026-11-18");
    expect(md).not.toContain("Shaky Vet"); // below the confidence bar for references
  });

  it("says plainly when angles haven't been written", () => {
    const md = creativeBrief({ metro: m, pin, weights, business: { name: "X", summary: "" }, link: "l", date: new Date(0) });
    expect(md).toContain("Not generated yet");
  });
});
