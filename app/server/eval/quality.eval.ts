import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { IndexFile, MetroFile } from "../../src/data/types";
import { profileById } from "../../src/model/profiles";
import { DataStore } from "../data";
import { evalModel, evaluateAngles, evaluateBriefs, live, liveModel } from "./ai";
import { evaluatePlanner, plannerCases } from "./planner";

const dir = new URL("../../public/data/", import.meta.url);
const data = new DataStore(fileURLToPath(dir));
const passed = ({ checks }: { checks: Record<string, boolean> }) => Object.values(checks).every(Boolean);

test("Catchment quality on representative planning and AI cases", { timeout: live ? 360_000 : 30_000 }, async () => {
  const llm = liveModel();
  const index = JSON.parse(await readFile(new URL("index.json", dir), "utf8")) as IndexFile;
  const planRuns = [];
  const angles = [];

  for (const scenario of plannerCases) {
    const file = JSON.parse(await readFile(new URL(`${scenario.metro}.json`, dir), "utf8")) as MetroFile;
    const run = evaluatePlanner(file, scenario);
    planRuns.push(run.metrics);

    if ((scenario.metro === "sf-bay" || scenario.metro === "chicago") && run.pin) {
      const profile = profileById(scenario.profile)!;
      const { lat, lon, radiusMi, label } = run.pin;
      angles.push(await evaluateAngles(data, {
        metroId: scenario.metro,
        lat,
        lon,
        radiusMi,
        weights: profile.weights,
        business: { name: profile.label, summary: profile.blurb },
        area: { hood: label.hood, city: label.city },
        attempt: 0,
      }, llm));
    }
  }

  const briefs = await evaluateBriefs(data, llm);
  const all = [...planRuns.map((row) => ({ id: row.metro, ...row })), ...briefs, ...angles];
  const aiRuns = [...briefs, ...angles];
  const signalCount = briefs.reduce((sum, row) => sum + row.expectedSignals, 0);
  const report = {
    release: index.release,
    mode: live ? "live" : "offline",
    model: evalModel,
    summary: {
      passed: all.filter(passed).length,
      cases: all.length,
      briefSignalRecall: briefs.reduce((sum, row) => sum + row.matchedSignals, 0) / signalCount,
      acceptedAngles: angles.reduce((sum, row) => sum + row.accepted, 0),
      rejectedDrafts: angles.reduce((sum, row) => sum + row.rejected.length, 0),
      liveReportedCostUsd: live ? aiRuns.reduce((sum, row) => sum + (row.usage?.costUsd ?? 0), 0) : null,
    },
    planner: planRuns,
    briefs,
    angles,
  };
  console.table(planRuns.map(({ checks, ...row }) => ({
    ...row,
    objective: Math.round(row.objective),
    densityObjective: Math.round(row.densityObjective),
    onTargetShare: row.onTargetShare.toFixed(3),
    densityOnTargetShare: row.densityOnTargetShare.toFixed(3),
    capture: row.capture.toFixed(3),
    pass: passed({ checks }),
  })));
  console.table(briefs.map((row) => ({
    case: row.id, signals: `${row.matchedSignals}/${row.expectedSignals}`, elapsedMs: row.elapsedMs, error: row.error, pass: passed(row),
  })));
  console.table(angles.map((row) => ({
    case: row.id, accepted: row.accepted, rejected: row.rejected.length,
    grounded: `${row.eligibleCites}/${row.citations}`, elapsedMs: row.elapsedMs, error: row.error, pass: passed(row),
  })));
  console.log(`Overture ${report.release} · ${report.mode} (${report.model})`, report.summary);

  const output = process.env.CATCHMENT_EVAL_REPORT?.trim();
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");

  expect(angles).toHaveLength(2);
  const failures = all.flatMap((row) => Object.entries(row.checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => `${row.id}: ${key}`));
  expect(failures).toEqual([]);
});
