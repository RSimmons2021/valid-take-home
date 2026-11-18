import { type Metro, cellLabel, project } from "../data/metro";
import { pinChanges, releaseLabel } from "./changes";
import { pinName } from "./export";
import { WEIGHT_LABEL, type Weight, type Weights, factorsFor } from "./factors";
import { MILE, type Pin } from "./plan";

/**
 * The creative brief for one pin: the hand-off from media buying (where) to creative (what).
 * Everything in it is grounded: local references are real Overture places inside the pin,
 * angles were verified server-side, and places the user avoids are listed as "don't mention".
 * Pure, so the same brief comes out of the app, a test or an agent.
 */

export interface BriefAngle {
  angle: string;
  headline: string;
  title?: string;
  body: string;
  scene: string;
  cites: { id: string; name: string; kind: string }[];
}

export interface BriefInput {
  metro: Metro;
  pin: Pin;
  weights: Weights;
  business: { name: string; summary: string };
  angles?: BriefAngle[];
  link: string;
  date: Date;
}

export interface Ref {
  name: string;
  kind: string;
  id: string;
  distanceM: number;
  lat: number;
  lon: number;
}

/** Real places inside the pin for signals the user weighted, nearest first, one per name. */
export function pinPlaces(metro: Metro, pin: Pin, weights: Weights, want: "preferred" | "avoided", limit: number): Ref[] {
  const p = metro.places;
  const r = pin.radiusMi * MILE;
  const rows: Ref[] = [];
  for (let k = 0; k < p.n; k++) {
    const w = weights[metro.signals[p.signal[k]].id] ?? 0;
    if (want === "preferred" ? w <= 0 || p.confidence[k] < 0.7 : w >= 0) continue;
    const [x, y] = project(p.lat[k], p.lon[k], metro.info.center);
    const d = Math.hypot(x - metro.x[pin.cell], y - metro.y[pin.cell]);
    if (d <= r) rows.push({ name: p.name[k], kind: metro.signals[p.signal[k]].label, id: p.id[k], distanceM: d, lat: p.lat[k], lon: p.lon[k] });
  }
  rows.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase())).slice(0, limit);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function creativeBrief({ metro, pin, weights, business, angles, link, date }: BriefInput): string {
  const label = cellLabel(metro, pin.cell);
  const where = pinName(pin.label, pin.rank);
  const factors = new Map(factorsFor(metro).map((f) => [f.id, f.label]));
  const refs = pinPlaces(metro, pin, weights, "preferred", 12);
  const avoid = pinPlaces(metro, pin, weights, "avoided", 8);
  const changes = pinChanges(metro, pin, weights);
  const covered = pin.covered;
  const homes = covered.reduce((s, i) => s + metro.homes[i], 0);
  const roofs = covered.reduce((s, i) => s + metro.rooftops[i], 0);
  const detached = roofs ? covered.reduce((s, i) => s + metro.single[i] * metro.rooftops[i], 0) / roofs : 0;

  const L: string[] = [];
  L.push(`# Creative brief: ${business.name} · ${where}`);
  L.push("");
  L.push(`Pin ${pin.rank} of the plan · ${pin.radiusMi}-mile radius · ${label.zip ?? "no ZIP"} · ${metro.info.name}`);
  L.push(`Built with Catchment on Overture Maps ${metro.release} · ${date.toISOString().slice(0, 10)} · [open the plan](${link})`);
  L.push("");
  L.push("## Who we're talking to");
  if (business.summary) L.push(business.summary);
  L.push("");
  L.push(`- ${Math.round(homes).toLocaleString("en-US")} homes in reach, ${pct(pin.homes ? pin.onTargetHomes / pin.homes : 0)} in blocks that fit (mean fit ${Number.isNaN(pin.meanScore) ? "–" : Math.round(pin.meanScore)}/100)`);
  L.push(`- Housing: ${pct(detached)} of rooftops are detached houses`);
  const weighted = Object.entries(weights)
    .filter(([, w]) => w !== 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id, w]) => `${factors.get(id) ?? id} (${WEIGHT_LABEL[w as Weight].toLowerCase()})`);
  L.push(`- Targeting: ${weighted.join(", ")}`);
  L.push("");
  L.push("## Local references (real places inside the pin)");
  L.push("Use these to make the ad feel like it's from around here. Spell names exactly; don't make claims about them.");
  L.push("");
  if (refs.length) for (const r of refs) L.push(`- **${r.name}**: ${r.kind.toLowerCase()} · GERS \`${r.id}\``);
  else L.push("- No high-confidence places for your preferred signals inside this pin.");
  L.push("");

  if (angles?.length) {
    L.push("## Angles (verified against the places above)");
    angles.forEach((a, k) => {
      L.push("");
      L.push(`### ${k + 1}. ${a.angle}`);
      L.push(`**${a.headline}**`);
      if (a.title) L.push(`On-screen title: “${a.title}”`);
      L.push("");
      L.push(a.body);
      L.push("");
      L.push(`- Cites: ${a.cites.map((c) => c.name).join(", ")}`);
      L.push(`- Scene prompt (9:16, ~5 s): ${a.scene}`);
    });
    L.push("");
  } else {
    L.push("## Angles");
    L.push("Not generated yet. Use “Write 3 angles” on the pin card for grounded hooks and video scene prompts.");
    L.push("");
  }

  L.push("## Craft notes");
  L.push("- Vertical 9:16. The hook lands in the first 2 seconds (that's what hook rate measures).");
  L.push("- Captions on: most feeds autoplay muted.");
  L.push("- Speak about the place and the service, never the viewer's traits (Meta's personal attributes policy).");
  L.push("- No real people's likeness, logos or readable third-party signage in generated video.");
  if (avoid.length) {
    L.push(`- Don't mention: ${avoid.map((a) => a.name).join(", ")} (signals you avoid, including competitors).`);
  }
  L.push("");

  if (changes && changes.newCompetitors.length + changes.lostDemand.length + changes.newDemand.length + changes.closedCompetitors.length > 0) {
    L.push(`## Since Overture ${releaseLabel(changes.since)}`);
    const line = (n: number, text: string, list: { name: string }[]) =>
      n ? L.push(`- ${n} ${text}: ${list.slice(0, 5).map((p) => p.name).join(", ")}${n > 5 ? "…" : ""}`) : 0;
    line(changes.newCompetitors.length, "new listings you avoid", changes.newCompetitors);
    line(changes.lostDemand.length, "preferred places marked closed (don't reference them)", changes.lostDemand);
    line(changes.newDemand.length, "new preferred places", changes.newDemand);
    L.push("");
  }
  return `${L.join("\n")}\n`;
}
