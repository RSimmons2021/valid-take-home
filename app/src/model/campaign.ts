import { type Metro, cellLabel } from "../data/metro";
import { type BriefAngle, type Ref, pinPlaces } from "./brief";
import { pinName } from "./export";
import type { Weights } from "./factors";
import type { LiftDesign } from "./holdout";
import type { Pin, Plan } from "./plan";

/**
 * The campaign kit Autopilot assembles: how to split a budget across pins, what each pin's
 * video says, and the hand-off document. Pure and deterministic, like the rest of the model:
 * AI may supply a pin's words, but money, places and numbers are computed here.
 */

/** Below this a pin's ad set rarely gets enough delivery to learn anything. */
export const MIN_DAILY = 5;
const DAYS = 30;

export interface BudgetLine {
  rank: number;
  monthly: number;
  daily: number;
  /** share of the budget, by well-matched homes reached */
  share: number;
}

/** The most pins a monthly budget can fund at MIN_DAILY each, never more than requested. */
export function pinsForBudget(monthly: number, requested: number): number {
  return Math.max(1, Math.min(requested, Math.floor(monthly / DAYS / MIN_DAILY)));
}

/**
 * Split a monthly budget across pins. Each pin first gets the minimum that lets it learn
 * (MIN_DAILY a day, when the budget covers it), then the rest goes in proportion to the
 * well-matched homes each reaches (pins with none fall back to all homes). Whole dollars,
 * and the lines add up to the budget exactly: the remainder goes to the largest fractional
 * parts, ties to the higher-ranked pin.
 */
export function splitBudget(pins: Pin[], monthly: number): BudgetLine[] {
  if (!pins.length || monthly <= 0) return [];
  const weight = (p: Pin) => p.onTargetHomes || p.homes || 1;
  const total = pins.reduce((s, p) => s + weight(p), 0);
  const budget = Math.round(monthly);
  const floor = budget >= pins.length * MIN_DAILY * DAYS ? MIN_DAILY * DAYS : 0;
  const pool = budget - floor * pins.length;
  const exact = pins.map((p) => floor + (pool * weight(p)) / total);
  const floors = exact.map(Math.floor);
  let left = budget - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, k) => ({ k, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.k - b.k);
  for (const { k } of order) {
    if (left <= 0) break;
    floors[k]++;
    left--;
  }
  return pins.map((p, k) => ({
    rank: p.rank,
    monthly: floors[k],
    daily: Math.round((floors[k] / DAYS) * 100) / 100,
    share: weight(p) / total,
  }));
}

export interface Callout {
  name: string;
  kind: string;
  id: string;
  lat: number;
  lon: number;
}

export interface PinScript {
  rank: number;
  /** on-screen title: what a silent viewer reads in the first two seconds */
  title: string;
  hook: string;
  body: string;
  /** real places the video points at: cited by the AI, or the nearest preferred ones */
  callouts: Callout[];
  cta: string;
  source: "ai" | "data";
  /** the sound-off test: a title of at most eight words */
  silentReadable: boolean;
}

export const TITLE_WORDS = 8;

/**
 * Overture lists individual practitioners as places ("Jane Doe, MD"). An ad shouldn't
 * point at a person, so the data fallback skips names that look like one.
 */
const PERSONAL = /\b(MD|M\.D\.|DDS|DMD|DO|DVM|PhD|LCSW|LMFT|NP|PA-C|RN|Dr\.?)\b|^[A-Z][a-z]+ [A-Z]\.? ?[A-Z][a-z]+,/;
export const looksPersonal = (name: string) => PERSONAL.test(name);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clipWords = (s: string, n: number) => words(s).slice(0, n).join(" ");

/**
 * One pin's script. With a verified AI angle, its title, hook and cited places are used;
 * without one (no AI, or the pin has too few known places), the script is written from
 * the data alone, so a video can always be made and never names anything that isn't there.
 */
export function scriptFor(metro: Metro, pin: Pin, weights: Weights, business: { name: string }, angle?: BriefAngle): PinScript {
  const label = cellLabel(metro, pin.cell);
  const where = label.hood ?? label.city ?? metro.info.name;
  const near = pinPlaces(metro, pin, weights, "preferred", 12);
  const toCallout = (r: Ref): Callout => ({ name: r.name, kind: r.kind, id: r.id, lat: r.lat, lon: r.lon });
  let callouts: Callout[] = [];
  if (angle) {
    // The AI may cite any verified place inside the pin, not only the nearest few.
    const p = metro.places;
    for (const c of angle.cites) {
      const k = p.id.indexOf(c.id);
      if (k >= 0) callouts.push({ name: p.name[k], kind: metro.signals[p.signal[k]].label, id: p.id[k], lat: p.lat[k], lon: p.lon[k] });
    }
  }
  for (const r of near) {
    if (callouts.length >= 3) break;
    if (!callouts.some((c) => c.id === r.id) && !looksPersonal(r.name)) callouts.push(toCallout(r));
  }
  callouts = callouts.slice(0, 3);

  const cta = "Book today";
  if (angle) {
    const title = angle.title?.trim() || clipWords(angle.headline, TITLE_WORDS);
    return { rank: pin.rank, title, hook: angle.headline, body: angle.body, callouts, cta, source: "ai", silentReadable: words(title).length <= TITLE_WORDS };
  }
  const title = clipWords(`${business.name} in ${where}`, TITLE_WORDS);
  const named = callouts.slice(0, 2).map((c) => c.name);
  const hook = named.length ? `Right by ${named.join(" and ")}` : `Serving ${where}`;
  return {
    rank: pin.rank,
    title,
    hook,
    body: `${business.name} for the blocks around ${where}.`,
    callouts,
    cta,
    source: "data",
    silentReadable: words(title).length <= TITLE_WORDS,
  };
}

export interface KitInput {
  metro: Metro;
  plan: Plan;
  business: { name: string; summary: string };
  budget: BudgetLine[];
  monthly: number | null;
  scripts: PinScript[];
  lift: LiftDesign | null;
  link: string;
  date: Date;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The campaign kit as Markdown: one document a buyer, a creative and a client can all read.
 * Every number says how sure it is: verified (read from the data), estimated (computed,
 * method stated) or unknown (nothing here can know it, so it's never shown as zero).
 */
export function campaignKit({ metro, plan, business, budget, monthly, scripts, lift, link, date }: KitInput): string {
  const L: string[] = [];
  L.push(`# Campaign kit: ${business.name} · ${metro.info.name}`);
  L.push("");
  L.push(`Built by Catchment Autopilot on Overture Maps ${metro.release} · ${date.toISOString().slice(0, 10)} · [open the plan](${link})`);
  L.push("");
  L.push("Nothing here has been launched or spent. Review it, then take it to Meta and Google.");
  L.push("");
  L.push("## The plan");
  if (business.summary) L.push(business.summary);
  L.push("");
  L.push(`- ${plan.pins.length} radius pins, ${plan.pins[0]?.radiusMi ?? "–"} mi each`);
  L.push(`- ${plan.homes.toLocaleString("en-US")} homes reached, ${pct(plan.homes ? plan.onTargetHomes / plan.homes : 0)} in blocks that fit · **estimated** from Overture address points`);
  L.push(`- ${pct(plan.capture)} of the city's well-matched homes · **estimated**`);
  L.push("- Audience size on Meta or Google · **unknown** (the platforms report their own)");
  L.push("- Conversions · **unknown** until the campaign runs (use the lift test below)");
  L.push("");
  if (monthly) {
    L.push(`## Budget: ${money(monthly)} a month`);
    L.push("Split by the well-matched homes each pin reaches · **proposed**, adjust freely.");
    L.push("");
    L.push("| Pin | Where | Per month | Per day | Share |");
    L.push("| ---: | --- | ---: | ---: | ---: |");
    for (const b of budget) {
      const pin = plan.pins.find((p) => p.rank === b.rank)!;
      L.push(`| ${b.rank} | ${pinName(pin.label, pin.rank)} | ${money(b.monthly)} | ${money(b.daily)} | ${pct(b.share)} |`);
    }
    L.push("");
  }
  L.push("## Scripts and videos");
  L.push(`Each video is 8 s, 9:16, made from the pin's real map and real places. The title passes the sound-off test (at most ${TITLE_WORDS} words).`);
  for (const s of scripts) {
    const pin = plan.pins.find((p) => p.rank === s.rank)!;
    L.push("");
    L.push(`### Pin ${s.rank} · ${pinName(pin.label, pin.rank)}`);
    L.push(`- Title (on screen): **${s.title}**`);
    L.push(`- Hook: ${s.hook}`);
    L.push(`- Body: ${s.body}`);
    L.push(`- Points at: ${s.callouts.map((c) => `${c.name} (${c.kind.toLowerCase()}, GERS \`${c.id}\`)`).join("; ") || "no named places"}`);
    L.push(`- Close: ${s.cta}`);
    L.push(`- Written ${s.source === "ai" ? "by AI from verified local places" : "from the data alone"}`);
  }
  L.push("");
  if (lift) {
    L.push("## Prove it worked: lift test");
    L.push(`${lift.pairs.length} matched ZIP pairs · ${lift.quality} design · ${pct(lift.holdoutShare)} of the plan's homes held out.`);
    L.push(`- Advertise to: ${lift.pairs.map((p) => p.test.zip).join(", ")}${lift.unpaired ? `, ${lift.unpaired.zip}` : ""}`);
    L.push(`- Hold out: ${lift.pairs.map((p) => p.control.zip).join(", ")}`);
    L.push("- Run 2–4 weeks, then compare conversions per home, pair by pair.");
    L.push("");
  }
  return `${L.join("\n")}\n`;
}
