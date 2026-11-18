import { WEIGHTS, type Weight, type Weights } from "../model/factors";

/** Everything needed to rebuild a plan exactly. Lives in the URL hash, so a link is a plan. */
export interface PlanState {
  metroId: string;
  profileId: string;
  weights: Weights;
  minHomes: number;
  pins: number;
  radiusMi: number;
}

export function encode(s: PlanState): string {
  const w = Object.entries(s.weights)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}.${v}`)
    .join(",");
  const q = new URLSearchParams({ p: s.profileId, w, n: String(s.pins), r: String(s.radiusMi), min: String(s.minHomes) });
  return `#/${encodeURIComponent(s.metroId)}?${q.toString().replace(/%2C/g, ",")}`;
}

export function decode(hash: string): Partial<PlanState> {
  const m = /^#\/([^?]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return {};
  let metroId: string;
  try {
    metroId = decodeURIComponent(m[1]);
  } catch {
    return {};
  }
  const out: Partial<PlanState> = { metroId };
  const q = new URLSearchParams(m[2] ?? "");
  const p = q.get("p");
  if (p) out.profileId = p;
  const w = q.get("w");
  if (w !== null) {
    const weights: Weights = {};
    for (const part of w.split(",").filter(Boolean)) {
      const [k, v] = part.split(".");
      const n = Number(v);
      if (k && WEIGHTS.includes(n as Weight)) weights[k] = n as Weight;
    }
    out.weights = weights;
  }
  const num = (key: string, lo: number, hi: number) => {
    const v = Number(q.get(key));
    return q.has(key) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  };
  const n = num("n", 1, 25);
  if (n !== undefined) out.pins = Math.round(n);
  const r = num("r", 1, 50);
  if (r !== undefined) out.radiusMi = r;
  const min = num("min", 0, 500);
  if (min !== undefined) out.minHomes = Math.round(min);
  return out;
}
