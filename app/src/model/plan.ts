import type { Metro } from "../data/metro";
import { cellLabel, unproject } from "../data/metro";

export const MILE = 1609.344;

/**
 * Meta's radius targeting starts at 1 mile (and caps at 50); smaller pins can't be
 * bought there, so the planner never proposes them.
 */
export const RADIUS_OPTIONS_MI = [1, 1.5, 2, 3, 5] as const;
export const MAX_PINS = 25;

/** Minimum distance between pin centres, in radii. */
export const SPACING = 1.5;

/** A cell at or above this score counts as on-target reach. */
export const ON_TARGET = 50;

export interface PlanOptions {
  pins: number;
  radiusMi: number;
}

export interface Pin {
  rank: number;
  /** cell the pin is centred on */
  cell: number;
  lat: number;
  lon: number;
  radiusMi: number;
  /** cells newly covered by this pin (cells already covered by a better pin aren't repeated) */
  covered: number[];
  homes: number;
  onTargetHomes: number;
  /** homes-weighted mean score of covered, scored cells */
  meanScore: number;
  label: { hood: string | null; city: string | null; zip: string | null };
}

export interface Plan {
  pins: Pin[];
  homes: number;
  onTargetHomes: number;
  /** on-target homes reached, as a share of all on-target homes in the metro */
  capture: number;
  metroOnTargetHomes: number;
}

/**
 * How much a cell is worth reaching: homes, weighted by fit above the median.
 * Below-median cells are worth nothing, so a pin is pulled towards strong cells and
 * pays nothing for crossing weak ones. It still reports them as off-target reach.
 */
export function cellValue(homes: number, score: number): number {
  if (Number.isNaN(score) || score < ON_TARGET) return 0;
  const fit = (score - ON_TARGET) / (100 - ON_TARGET);
  return homes * fit * fit;
}

/** Uniform grid over local metric coordinates for radius queries. */
class Buckets {
  private readonly size: number;
  private readonly map = new Map<string, number[]>();
  constructor(
    private readonly x: Float64Array,
    private readonly y: Float64Array,
    size: number,
  ) {
    this.size = size;
    for (let i = 0; i < x.length; i++) {
      const key = `${Math.floor(x[i] / size)},${Math.floor(y[i] / size)}`;
      const b = this.map.get(key);
      if (b) b.push(i);
      else this.map.set(key, [i]);
    }
  }
  within(cx: number, cy: number, r: number): number[] {
    const out: number[] = [];
    const r2 = r * r;
    const s = this.size;
    for (let gx = Math.floor((cx - r) / s); gx <= Math.floor((cx + r) / s); gx++) {
      for (let gy = Math.floor((cy - r) / s); gy <= Math.floor((cy + r) / s); gy++) {
        const b = this.map.get(`${gx},${gy}`);
        if (!b) continue;
        for (const i of b) {
          const dx = this.x[i] - cx;
          const dy = this.y[i] - cy;
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    }
    return out;
  }
}

/**
 * Greedy maximum coverage with lazy re-evaluation (CELF): pick the pin that adds the
 * most value, mark its cells covered, repeat. Greedy is within (1 − 1/e) of optimal for
 * this objective, and lazy evaluation makes it interactive. Deterministic: ties break on
 * cell index, so a shared link rebuilds exactly the same plan.
 */
export function planPins(metro: Metro, score: Float64Array, { pins, radiusMi }: PlanOptions): Plan {
  const r = radiusMi * MILE;
  const buckets = new Buckets(metro.x, metro.y, r);
  const value = new Float64Array(metro.n);
  let metroOnTargetHomes = 0;
  for (let i = 0; i < metro.n; i++) {
    value[i] = cellValue(metro.homes[i], score[i]);
    if (!Number.isNaN(score[i]) && score[i] >= ON_TARGET) metroOnTargetHomes += metro.homes[i];
  }

  // Candidates: centres on cells that are themselves worth reaching, best first.
  const candidates: number[] = [];
  for (let i = 0; i < metro.n; i++) if (value[i] > 0) candidates.push(i);
  candidates.sort((a, b) => value[b] - value[a] || a - b);
  const pool = candidates.slice(0, 4000);

  const covered = new Uint8Array(metro.n);
  const reach = new Map<number, number[]>();
  const reachOf = (c: number) => {
    let cells = reach.get(c);
    if (!cells) {
      cells = buckets.within(metro.x[c], metro.y[c], r);
      reach.set(c, cells);
    }
    return cells;
  };
  // Pins sit at least SPACING radii apart. Overlap isn't double-billed (platforms target the
  // union), but stacked circles read as one place split three ways; spacing makes every pin
  // a distinct area a buyer can name, budget and switch off.
  const chosen: number[] = [];
  const minGap2 = (SPACING * r) ** 2;
  const gain = (c: number) => {
    for (const p of chosen) {
      const dx = metro.x[p] - metro.x[c];
      const dy = metro.y[p] - metro.y[c];
      if (dx * dx + dy * dy < minGap2) return 0;
    }
    let g = 0;
    for (const i of reachOf(c)) if (!covered[i]) g += value[i];
    return g;
  };

  // Max-heap of [gain, candidate, round-when-computed].
  const heap: [number, number, number][] = pool.map((c) => [gain(c), c, 0]);
  const better = (a: [number, number, number], b: [number, number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] < b[1]);
  const down = (k: number) => {
    for (;;) {
      const l = 2 * k + 1;
      const rr = l + 1;
      let m = k;
      if (l < heap.length && better(heap[l], heap[m])) m = l;
      if (rr < heap.length && better(heap[rr], heap[m])) m = rr;
      if (m === k) return;
      [heap[k], heap[m]] = [heap[m], heap[k]];
      k = m;
    }
  };
  for (let k = (heap.length >> 1) - 1; k >= 0; k--) down(k);
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      down(0);
    }
    return top;
  };

  let round = 0;
  while (chosen.length < pins && heap.length) {
    const top = heap[0];
    if (top[2] === round) {
      pop();
      if (top[0] <= 0) break;
      chosen.push(top[1]);
      for (const i of reachOf(top[1])) covered[i] = 1;
      round++;
    } else {
      top[0] = gain(top[1]);
      top[2] = round;
      down(0);
    }
  }

  // Describe each pin by the cells it newly covers, in pick order.
  const seen = new Uint8Array(metro.n);
  const out: Pin[] = chosen.map((c, k) => {
    const cells = reachOf(c).filter((i) => !seen[i]);
    for (const i of cells) seen[i] = 1;
    let homes = 0;
    let on = 0;
    let sw = 0;
    let sh = 0;
    for (const i of cells) {
      homes += metro.homes[i];
      if (!Number.isNaN(score[i])) {
        sw += score[i] * metro.homes[i];
        sh += metro.homes[i];
        if (score[i] >= ON_TARGET) on += metro.homes[i];
      }
    }
    const [lat, lon] = [metro.lat[c], metro.lon[c]];
    return {
      rank: k + 1,
      cell: c,
      lat,
      lon,
      radiusMi,
      covered: cells,
      homes,
      onTargetHomes: on,
      meanScore: sh ? sw / sh : Number.NaN,
      label: cellLabel(metro, c),
    };
  });

  const homes = out.reduce((a, p) => a + p.homes, 0);
  const onTargetHomes = out.reduce((a, p) => a + p.onTargetHomes, 0);
  return {
    pins: out,
    homes,
    onTargetHomes,
    capture: metroOnTargetHomes ? onTargetHomes / metroOnTargetHomes : 0,
    metroOnTargetHomes,
  };
}

/** Polygon ring approximating a pin's circle, for GeoJSON export and drawing. */
export function circle(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const origin: [number, number] = [lon, lat];
  const ring: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (2 * Math.PI * k) / steps;
    const [la, lo] = unproject(Math.cos(a) * radiusM, Math.sin(a) * radiusM, origin);
    ring.push([lo, la]);
  }
  return ring;
}
