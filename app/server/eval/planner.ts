import { buildMetro, type Metro } from "../../src/data/metro";
import type { MetroFile } from "../../src/data/types";
import { plannedZips } from "../../src/model/export";
import { MILE, ON_TARGET, SPACING, cellValue, planPins } from "../../src/model/plan";
import { profileById } from "../../src/model/profiles";
import { scoreCells } from "../../src/model/score";

export const plannerCases = [
  { metro: "sf-bay", profile: "pet-care", pins: 8, radiusMi: 1.5 },
  { metro: "austin", profile: "cleaning", pins: 6, radiusMi: 2 },
  { metro: "chicago", profile: "home-repair", pins: 12, radiusMi: 1.5 },
  { metro: "denver", profile: "fitness", pins: 8, radiusMi: 1.5 },
] as const;

function distanceSquared(metro: Metro, a: number, b: number): number {
  return (metro.x[a] - metro.x[b]) ** 2 + (metro.y[a] - metro.y[b]) ** 2;
}

/** A buyer prioritising dense areas gets the same pin budget, radius and spacing. */
function densityPins(metro: Metro, homesFloor: number, pins: number, radius: number): number[] {
  const ranked = Array.from(metro.homes.keys())
    .filter((i) => metro.homes[i] >= homesFloor)
    .sort((a, b) => metro.homes[b] - metro.homes[a] || a - b);
  const centres: number[] = [];
  for (const cell of ranked) {
    if (!centres.every((other) => distanceSquared(metro, cell, other) >= (radius * SPACING) ** 2)) continue;
    centres.push(cell);
    if (centres.length === pins) break;
  }
  return centres;
}

function measure(metro: Metro, score: Float64Array, centres: number[], radius: number) {
  let homes = 0;
  let onTargetHomes = 0;
  let objective = 0;
  let eligibleHomes = 0;
  for (let i = 0; i < metro.n; i++) {
    if (score[i] >= ON_TARGET) eligibleHomes += metro.homes[i];
    if (!centres.some((centre) => distanceSquared(metro, i, centre) <= radius ** 2)) continue;
    homes += metro.homes[i];
    if (score[i] >= ON_TARGET) onTargetHomes += metro.homes[i];
    objective += cellValue(metro.homes[i], score[i]);
  }
  return { homes, onTargetHomes, objective, capture: eligibleHomes ? onTargetHomes / eligibleHomes : 0 };
}

export function evaluatePlanner(file: MetroFile, scenario: (typeof plannerCases)[number]) {
  const metro = buildMetro(file);
  const profile = profileById(scenario.profile)!;
  const minHomes = 25;
  const options = { pins: scenario.pins, radiusMi: scenario.radiusMi };
  const start = performance.now();
  const { score } = scoreCells(metro, { weights: profile.weights, minHomes });
  const plan = planPins(metro, score, options);
  const elapsedMs = Math.round(performance.now() - start);
  const radius = options.radiusMi * MILE;
  const actual = measure(metro, score, plan.pins.map((pin) => pin.cell), radius);
  const baseline = measure(metro, score, densityPins(metro, minHomes, options.pins, radius), radius);
  const repeat = planPins(metro, score, options);
  const zipCount = plannedZips(metro, plan).filter((zip) => zip.share >= 0.5).length;
  const checks = {
    deterministic: JSON.stringify(plan) === JSON.stringify(repeat),
    reachReconciles: actual.homes === plan.homes && actual.onTargetHomes === plan.onTargetHomes && actual.capture === plan.capture,
    beatsDensity: actual.objective >= baseline.objective,
    exportable: plan.pins.length === options.pins && zipCount > 0,
  };
  return {
    pin: plan.pins[0],
    metrics: {
      metro: scenario.metro,
      profile: profile.id,
      pins: plan.pins.length,
      radiusMi: options.radiusMi,
      homes: actual.homes,
      onTargetShare: actual.homes ? actual.onTargetHomes / actual.homes : 0,
      capture: actual.capture,
      zipCount,
      objective: actual.objective,
      densityObjective: baseline.objective,
      densityOnTargetShare: baseline.homes ? baseline.onTargetHomes / baseline.homes : 0,
      elapsedMs,
      checks,
    },
  };
}
