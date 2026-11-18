import { describe, expect, it } from "vitest";
import { pinChanges, releaseLabel } from "./changes";
import { planPins } from "./plan";
import { fakeMetro } from "./testkit";

describe("pin changes since the last release", () => {
  const m = fakeMetro({ k: 6 });
  const centre = { lat: m.lat[Math.floor(m.n / 2)], lon: m.lon[Math.floor(m.n / 2)] };
  m.signals.push({ id: "pet_care", label: "Pet sitters & boarding", description: "" });
  m.file.changes = {
    since: "2026-09-23.0",
    // signal 0 = pet_life (preferred), 1 = pet_care (avoided)
    added: { id: ["a1", "a2", "far"], name: ["New Walkers", "New Vet", "Far Walkers"], signal: [1, 0, 1], lat: [centre.lat, centre.lat, centre.lat + 1], lon: [centre.lon, centre.lon, centre.lon] },
    closed: { id: ["c1"], name: ["Old Vet"], signal: [0], lat: [centre.lat], lon: [centre.lon] },
    totals: { new_ids: 3, newly_closed: 1 },
  };
  const plan = planPins(m, new Float64Array(m.n).fill(100), { pins: 1, radiusMi: 2 });

  it("reads changes through the user's weights", () => {
    const c = pinChanges(m, plan.pins[0], { pet_life: 2, pet_care: -1 })!;
    expect(c.newCompetitors.map((p) => p.name)).toEqual(["New Walkers"]); // the far one is outside the pin
    expect(c.newDemand.map((p) => p.name)).toEqual(["New Vet"]);
    expect(c.lostDemand.map((p) => p.name)).toEqual(["Old Vet"]);
    expect(c.alerts).toBe(2);
  });

  it("ignores signals the user doesn't weight", () => {
    const c = pinChanges(m, plan.pins[0], { homes: 1 })!;
    expect(c.alerts).toBe(0);
    expect(c.newDemand).toHaveLength(0);
  });

  it("labels releases for people", () => {
    expect(releaseLabel("2026-09-23.0")).toBe("Sep 2026");
  });
});
