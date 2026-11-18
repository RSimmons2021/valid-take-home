import type { Metro } from "../data/metro";
import { type Plan, MILE, circle } from "./plan";

export interface ZipRow {
  code: string;
  /** homes in this ZIP that the plan's pins reach */
  reached: number;
  /** all homes the pipeline assigned to this ZIP */
  total: number;
  share: number;
}

/**
 * ZIPs the plan touches. ZIP targeting is coarser than pins, so each ZIP reports how
 * much of it the pins actually reach; the export keeps ZIPs at or above `minShare`.
 */
export function plannedZips(metro: Metro, plan: Plan): ZipRow[] {
  const reached = new Map<number, number>();
  for (const pin of plan.pins) {
    for (const i of pin.covered) {
      const z = metro.zip[i];
      if (z < 0) continue;
      reached.set(z, (reached.get(z) ?? 0) + metro.homes[i]);
    }
  }
  return [...reached.entries()]
    .map(([z, n]) => {
      const total = metro.zips[z].homes;
      return { code: metro.zips[z].code, reached: n, total, share: total ? n / total : 0 };
    })
    .filter((r) => r.reached > 0)
    .sort((a, b) => b.share - a.share || b.reached - a.reached);
}

const fmt = (v: number, d = 6) => v.toFixed(d);
const miles = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));

/**
 * Google Ads bulk radius format, one per line: (radius unit : lat : lng).
 * Paste into Locations ▸ Advanced search ▸ Radius ▸ Bulk.
 */
export function googleRadiusLines(plan: Plan): string {
  return plan.pins.map((p) => `(${miles(p.radiusMi)}mi:${fmt(p.lat)}:${fmt(p.lon)})`).join("\n");
}

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** One row per pin: what a media buyer needs to recreate the plan in any ad platform. */
export function pinsCsv(plan: Plan): string {
  return toCsv([
    ["rank", "name", "latitude", "longitude", "radius", "unit", "homes", "on_target_homes", "mean_score", "zip"],
    ...plan.pins.map((p) => [
      p.rank,
      pinName(p.label, p.rank),
      fmt(p.lat),
      fmt(p.lon),
      miles(p.radiusMi),
      "mi",
      Math.round(p.homes),
      Math.round(p.onTargetHomes),
      Number.isNaN(p.meanScore) ? null : Math.round(p.meanScore),
      p.label.zip,
    ]),
  ]);
}

export function zipsCsv(rows: ZipRow[]): string {
  return toCsv([
    ["zip", "homes_reached", "homes_in_zip", "share_reached"],
    ...rows.map((r) => [r.code, Math.round(r.reached), Math.round(r.total), r.share.toFixed(3)]),
  ]);
}

export function pinName(label: { hood: string | null; city: string | null }, rank: number): string {
  const parts = [label.hood, label.city].filter((x, i, a) => x && a.indexOf(x) === i);
  return parts.length ? parts.join(", ") : `Pin ${rank}`;
}

export interface PlanMeta {
  metro: Metro;
  profile: string;
  link: string;
}

export function planGeoJson(plan: Plan, { metro, profile, link }: PlanMeta): string {
  const features = plan.pins.map((p) => ({
    type: "Feature",
    properties: {
      rank: p.rank,
      name: pinName(p.label, p.rank),
      radius_mi: p.radiusMi,
      homes: Math.round(p.homes),
      on_target_homes: Math.round(p.onTargetHomes),
      mean_score: Number.isNaN(p.meanScore) ? null : Math.round(p.meanScore),
      center: [Number(fmt(p.lon)), Number(fmt(p.lat))],
    },
    geometry: { type: "Polygon", coordinates: [circle(p.lat, p.lon, p.radiusMi * MILE)] },
  }));
  return JSON.stringify(
    {
      type: "FeatureCollection",
      properties: {
        generator: "Catchment",
        metro: metro.info.name,
        profile,
        overture_release: metro.release,
        link,
      },
      features,
    },
    null,
    2,
  );
}
