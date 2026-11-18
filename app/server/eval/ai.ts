import { anglesForPin, mentions, type AnglesInput, type RawAngles } from "../ai/angles";
import { planFromBrief } from "../ai/brief";
import { MODEL, AiError, openAiLlm, type Llm, type Usage } from "../ai/llm";
import type { DataStore, MetroData } from "../data";
import { briefCases } from "./cases";

export const live = process.env.CATCHMENT_EVAL_LIVE === "1";

export function liveModel(): Llm | undefined {
  if (!live) return undefined;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Load OPENAI_API_KEY into the environment for a live eval.");
  return openAiLlm(key);
}

/** Send fixtures through the same response schema and meaning checks as live model output. */
function fixtureModel(output: (input: string) => unknown): Llm {
  return async (req) => ({
    data: req.schema.parse(output(req.input)),
    usage: { model: "fixture", inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ms: 0 },
  });
}

async function observe<T>(
  llm: Llm,
  run: (model: Llm) => Promise<T>,
): Promise<{ result: T | null; elapsedMs: number; usage: Usage | null; error: string | null }> {
  const start = performance.now();
  let usage: Usage | null = null;
  const measured: Llm = async (request) => {
    const reply = await llm(request);
    if (live) usage = reply.usage;
    return reply;
  };
  try {
    return { result: await run(measured), elapsedMs: Math.round(performance.now() - start), usage, error: null };
  } catch (error) {
    return {
      result: null,
      elapsedMs: Math.round(performance.now() - start),
      usage,
      error: error instanceof AiError ? error.code : "eval_error",
    };
  }
}

export async function evaluateBriefs(data: DataStore, llm: Llm | undefined) {
  const catalogue = await data.catalogue();
  const results = [];
  for (const scenario of briefCases) {
    const { supported } = scenario;
    const { result, ...run } = await observe(llm ?? fixtureModel(() => scenario.fixture), (model) =>
      planFromBrief(scenario.brief, catalogue, model),
    );
    const plan = result?.plan;
    const weights = new Map(plan?.weights.map(({ factor, weight }) => [factor, weight]));
    const matchedSignals = scenario.mustPrefer.filter((signal) => (weights.get(signal) ?? 0) > 0).length;
    const checks = {
      support: plan?.supported === supported,
      expectedSignals: matchedSignals === scenario.mustPrefer.length,
      competition: plan?.competitor === scenario.competitor && (!scenario.competitor || (weights.get(scenario.competitor) ?? 0) < 0),
      usable: supported
        ? !!plan?.weights.length && plan.weights.every(({ reason }) => reason.trim().length > 0)
        : !!plan?.note && weights.size === 0,
    };
    results.push({ id: scenario.id, expectedSignals: scenario.mustPrefer.length, matchedSignals, checks, ...run });
  }
  return results;
}

function angleFixture(input: string): RawAngles {
  const { places } = JSON.parse(input) as { places: { ref: string; name: string }[] };
  const place = places.find(({ name }) => name.length < 48 && /[a-z]/i.test(name))!;
  const { ref, name } = place;
  const scene = "Morning light on a residential street as a service van pulls up.";
  const draft = {
    angle: "Convenience",
    headline: `Right by ${name}`,
    title: "Service that comes to you",
    body: "Book a visit at home.",
    cites: [ref],
    scene,
  };
  return {
    angles: [
      { ...draft, headline: "Book a visit at home" },
      { ...draft, scene: `A van driving past ${name}` },
      draft,
      { ...draft, angle: "Timing", headline: `A free afternoon near ${name}` },
    ],
  };
}

function isEligible(metro: MetroData, pin: AnglesInput, id: string, name: string): boolean {
  const places = metro.places;
  const i = places.id.indexOf(id);
  if (i < 0 || places.name[i] !== name || places.confidence[i] < 0.7) return false;
  const weight = pin.weights[metro.signals[places.signal[i]].id] ?? 0;
  const k = Math.PI / 180;
  const a = Math.sin((places.lat[i] - pin.lat) * k / 2) ** 2
    + Math.cos(pin.lat * k) * Math.cos(places.lat[i] * k) * Math.sin((places.lon[i] - pin.lon) * k / 2) ** 2;
  const distanceM = 2 * 6_371_008.8 * Math.asin(Math.sqrt(a));
  return weight >= 0 && distanceM <= pin.radiusMi * 1609.344;
}

export async function evaluateAngles(data: DataStore, pin: AnglesInput, llm: Llm | undefined) {
  const metro = await data.metro(pin.metroId);
  const { result, ...run } = await observe(llm ?? fixtureModel(angleFixture), (model) => anglesForPin(pin, metro, model));
  const angles = result?.angles ?? [];
  const rejected = result?.rejected ?? [];
  const cites = angles.flatMap((angle) => angle.cites.map((cite) => ({ ...cite, copy: `${angle.headline} ${angle.body}` })));
  const eligibleCites = cites.filter(({ id, name, copy }) => isEligible(metro, pin, id, name) && mentions(copy, name)).length;
  const checks = {
    deliverable: angles.length >= 2,
    grounded: angles.every((angle) => angle.cites.length > 0) && eligibleCites === cites.length && cites.length > 0,
    rejection: live || (rejected.includes("cited a place it doesn't name") && rejected.includes("scene names a real place")),
  };
  return {
    id: pin.metroId,
    accepted: angles.length,
    rejected,
    contextPlaces: result?.grounded ?? 0,
    eligibleCites,
    citations: cites.length,
    checks,
    ...run,
  };
}

export const evalModel = live ? MODEL : "fixture";
