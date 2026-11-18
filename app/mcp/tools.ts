import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { latLngToCell } from "h3-js";
import { z } from "zod";
import { type Metro, cellLabel, placesNear } from "../src/data/metro";
import type { IndexFile } from "../src/data/types";
import { googleRadiusLines, pinName, pinsCsv, planGeoJson, plannedZips } from "../src/model/export";
import { WEIGHT_LABEL, type Weight, type Weights, factorsFor } from "../src/model/factors";
import { bestShuffle, targetUnits } from "../src/model/holdout";
import { MAX_PINS, type Plan, RADIUS_OPTIONS_MI, planPins } from "../src/model/plan";
import { PROFILES, profileById } from "../src/model/profiles";
import { explain, scoreCells, verdict } from "../src/model/score";
import { encode } from "../src/state/url";

/**
 * Catchment as tools for agents. The same pure model the app runs, exposed over MCP so an
 * assistant can plan targeting, explain a location, export ZIPs or design a lift test
 * ("plan pet-care targeting in Denver and give me the ZIPs"). Every tool is read-only and
 * deterministic, and every plan comes back with a link that opens it in the app.
 */

export interface Deps {
  index: IndexFile;
  loadMetro: (id: string) => Promise<Metro>;
  /** where the app is hosted, for share links */
  appUrl: string;
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

const planShape = {
  metro: z.string().describe("Metro id, e.g. 'sf-bay', 'austin', 'chicago', 'denver' (see list_metros)"),
  profile: z.string().optional().describe("Business profile id (see describe_factors). Ignored if weights are given."),
  weights: z
    .record(z.string(), z.number().int().min(-2).max(2))
    .optional()
    .describe("Factor weights, -2 (avoid strongly) to 2 (prefer strongly). Factor ids from describe_factors."),
  pins: z.number().int().min(1).max(MAX_PINS).default(8).describe("Number of radius pins"),
  radius_mi: z
    .number()
    .refine((r) => (RADIUS_OPTIONS_MI as readonly number[]).includes(r), { message: `radius_mi must be one of ${RADIUS_OPTIONS_MI.join(", ")}` })
    .default(1.5)
    .describe(`Pin radius in miles: one of ${RADIUS_OPTIONS_MI.join(", ")} (1 mile is Meta's minimum)`),
  min_homes: z.number().int().min(0).max(500).default(25).describe("Only score cells with at least this many homes"),
};
type PlanArgs = { metro: string; profile?: string; weights?: Record<string, number>; pins: number; radius_mi: number; min_homes: number };

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

export function createCatchmentServer(deps: Deps): McpServer {
  const server = new McpServer({ name: "catchment", version: "1.0.0" });

  async function resolve(args: PlanArgs): Promise<{ metro: Metro; weights: Weights; profileId: string; plan: Plan; link: string } | string> {
    if (!deps.index.metros.some((m) => m.id === args.metro)) return `Unknown metro "${args.metro}". Use list_metros.`;
    const metro = await deps.loadMetro(args.metro);
    const known = new Set(factorsFor(metro).map((f) => f.id));
    let weights: Weights;
    let profileId: string;
    if (args.weights) {
      const unknown = Object.keys(args.weights).filter((k) => !known.has(k));
      if (unknown.length) return `Unknown factor(s): ${unknown.join(", ")}. Use describe_factors.`;
      weights = Object.fromEntries(Object.entries(args.weights).filter(([, w]) => w !== 0)) as Weights;
      if (!Object.values(weights).some((w) => w > 0)) return "Weights need at least one positive factor to aim for.";
      profileId = "custom";
    } else {
      const p = profileById(args.profile ?? PROFILES[0].id);
      if (!p) return `Unknown profile "${args.profile}". Use describe_factors.`;
      weights = { ...p.weights };
      profileId = p.id;
    }
    const result = scoreCells(metro, { weights, minHomes: args.min_homes });
    const plan = planPins(metro, result.score, { pins: args.pins, radiusMi: args.radius_mi });
    const link = `${deps.appUrl}${encode({ metroId: metro.info.id, profileId, weights, minHomes: args.min_homes, pins: args.pins, radiusMi: args.radius_mi })}`;
    return { metro, weights, profileId, plan, link };
  }

  server.registerTool(
    "list_metros",
    { title: "List metros", description: "The metros Catchment has data for, with their size and Overture release.", annotations: READ_ONLY },
    async () =>
      text({
        release: deps.index.release,
        metros: deps.index.metros.map((m) => ({ id: m.id, name: m.name, region: m.region, homes: m.homes, cells: m.cells, apartment_units_listed: m.units_per_rooftop >= 1.2 })),
      }),
  );

  server.registerTool(
    "describe_factors",
    {
      title: "Describe factors and profiles",
      description: "The factors a plan can weight (homes, detached houses, and place signals such as vets or gyms) and the preset business profiles.",
      annotations: READ_ONLY,
    },
    async () => {
      const metro = await deps.loadMetro(deps.index.metros[0].id);
      return text({
        weights: "integers from -2 (avoid strongly) to 2 (prefer strongly); omit a factor to ignore it",
        factors: factorsFor(metro).map((f) => ({ id: f.id, label: f.label, description: f.description })),
        profiles: PROFILES.map((p) => ({ id: p.id, label: p.label, description: p.blurb, competitor: p.competitor ?? null, weights: p.weights })),
      });
    },
  );

  server.registerTool(
    "plan_targeting",
    {
      title: "Plan geo-targeting",
      description:
        "Score every block of a metro for a business and place radius pins where they reach the most well-matched homes. Returns reach, on-target share, the pins and a link that opens the plan in Catchment.",
      inputSchema: planShape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const r = await resolve(args as PlanArgs);
      if (typeof r === "string") return fail(r);
      const { metro, plan, weights, link } = r;
      return text({
        metro: metro.info.name,
        weights: Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, `${w} (${WEIGHT_LABEL[w as Weight]})`])),
        homes_reached: Math.round(plan.homes),
        on_target_share: +(plan.homes ? plan.onTargetHomes / plan.homes : 0).toFixed(3),
        capture_of_metro_on_target_homes: +plan.capture.toFixed(3),
        pins: plan.pins.map((p) => ({
          rank: p.rank,
          name: pinName(p.label, p.rank),
          zip: p.label.zip,
          lat: +p.lat.toFixed(6),
          lon: +p.lon.toFixed(6),
          radius_mi: p.radiusMi,
          homes: Math.round(p.homes),
          on_target_share: +(p.homes ? p.onTargetHomes / p.homes : 0).toFixed(3),
          mean_fit: Number.isNaN(p.meanScore) ? null : Math.round(p.meanScore),
        })),
        open_in_app: link,
        note: "Homes are Overture address points, not audience sizes. Scores are relative within the metro.",
      });
    },
  );

  server.registerTool(
    "explain_location",
    {
      title: "Explain a location",
      description: "How well a point fits the business: its block's score (0-100), verdict, the factors behind it, and real Overture places nearby.",
      inputSchema: {
        metro: planShape.metro,
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        profile: planShape.profile,
        weights: planShape.weights,
        min_homes: planShape.min_homes,
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const r = await resolve({ ...args, pins: 1, radius_mi: 1 });
      if (typeof r === "string") return fail(r);
      const { metro, weights } = r;
      const cell = metro.index.get(latLngToCell(args.lat, args.lon, metro.file.h3_res));
      if (cell == null) return fail(`That point isn't in ${metro.info.name}'s data (outside the area, or no buildings or addresses there).`);
      const result = scoreCells(metro, { weights, minHomes: args.min_homes });
      const score = result.score[cell];
      const label = cellLabel(metro, cell);
      const near = placesNear(metro, cell);
      return text({
        place: [label.hood, label.city].filter(Boolean).join(", "),
        zip: label.zip,
        score: Number.isNaN(score) ? null : Math.round(score),
        verdict: verdict(score),
        homes: metro.homes[cell],
        why: explain(metro, result, cell).map((c) => ({ factor: c.factor.label, weight: WEIGHT_LABEL[c.weight as Weight], value: c.factor.format(c.raw), pushes: c.push >= 0 ? "up" : "down" })),
        nearby_places: [...near.entries()]
          .filter(([s]) => (weights[metro.signals[s].id] ?? 0) !== 0)
          .map(([s, list]) => ({ signal: metro.signals[s].label, count: list.length, examples: list.slice(0, 4).map((k) => ({ name: metro.places.name[k], gers_id: metro.places.id[k] })) })),
      });
    },
  );

  server.registerTool(
    "export_targeting",
    {
      title: "Export targeting",
      description:
        "Export a plan for ad platforms: 'zips' (one per line, for Meta or Google bulk location upload), 'google_radius' (Google Ads bulk radius lines), 'pins_csv', or 'geojson'.",
      inputSchema: {
        ...planShape,
        format: z.enum(["zips", "google_radius", "pins_csv", "geojson"]),
        min_zip_share: z.number().min(0).max(1).default(0.5).describe("For 'zips': keep ZIPs whose homes the pins reach at least this share of"),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const r = await resolve(args as PlanArgs);
      if (typeof r === "string") return fail(r);
      const { metro, plan, profileId, link } = r;
      switch (args.format) {
        case "zips":
          return text(
            plannedZips(metro, plan)
              .filter((z) => z.share >= args.min_zip_share)
              .map((z) => z.code)
              .join("\n"),
          );
        case "google_radius":
          return text(googleRadiusLines(plan));
        case "pins_csv":
          return text(pinsCsv(plan));
        case "geojson":
          return text(planGeoJson(plan, { metro, profile: profileId, link }));
      }
    },
  );

  server.registerTool(
    "design_lift_test",
    {
      title: "Design a lift test",
      description:
        "Split the plan's ZIPs into matched test/control pairs (matched-pair randomisation) so the buyer can measure incremental lift: advertise to test ZIPs, exclude control ZIPs, compare conversions per home.",
      inputSchema: {
        ...planShape,
        min_zip_share: z.number().min(0).max(1).default(0.5),
        shuffle: z.number().int().min(1).max(1000).default(1).describe("Start of the seeded shuffle batch; change it for a different split"),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const r = await resolve(args as PlanArgs);
      if (typeof r === "string") return fail(r);
      const { metro, plan, weights } = r;
      const d = bestShuffle(targetUnits(metro, plan, weights, args.min_homes, args.min_zip_share), args.shuffle);
      if (!d.pairs.length) return fail("Not enough of the plan's ZIPs are covered to pair them. Add pins or lower min_zip_share.");
      return text({
        quality: d.quality,
        pairs: d.pairs.map((p) => ({ test_zip: p.test.zip, control_zip: p.control.zip, test_homes: Math.round(p.test.homes), control_homes: Math.round(p.control.homes) })),
        balance: d.balance.map((b) => ({ covariate: b.covariate, smd: b.smd === null ? null : +b.smd.toFixed(3), verdict: b.verdict })),
        held_out_share: +d.holdoutShare.toFixed(3),
        notes: d.notes,
        how_to_run: "Target only the test ZIPs; exclude control ZIPs from all campaigns for 2-4 weeks; lift = test conversions per home / control conversions per home - 1.",
      });
    },
  );

  return server;
}
