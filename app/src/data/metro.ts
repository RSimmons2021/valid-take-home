import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import type { MetroFile, MetroInfo, SignalDef } from "./types";

const EARTH = 6_371_008.8;

/** A metro ready for scoring: typed arrays, local metric coordinates and neighbour lists. */
export interface Metro {
  info: MetroInfo;
  release: string;
  schema: string;
  builtAt: string;
  signals: SignalDef[];
  ledger: MetroFile["ledger"];
  file: MetroFile;
  n: number;
  ids: string[];
  index: Map<string, number>;
  lat: Float64Array;
  lon: Float64Array;
  /** metres east / north of the metro centre (equirectangular; fine at city scale) */
  x: Float64Array;
  y: Float64Array;
  homes: Float64Array;
  rooftops: Float64Array;
  /** share of rooftops that hold exactly one address, 0..1 */
  single: Float64Array;
  buildings: Float64Array;
  height: Float64Array; // NaN when unknown
  zip: Int32Array;
  hood: Int32Array;
  city: Int32Array;
  names: string[];
  zips: { code: string; homes: number }[];
  /** place counts per signal, in the cell itself */
  counts: Record<string, Float64Array>;
  /** place counts per signal within one ring (the cell + 6 neighbours, ~0.7 km²) */
  near: Record<string, Float64Array>;
  totalHomes: number;
  places: Places;
}

export interface Places {
  n: number;
  id: string[];
  name: string[];
  brand: (string | null)[];
  signal: Int32Array;
  confidence: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** cell index of each place, -1 when the cell isn't part of the metro grid */
  cell: Int32Array;
}

export function project(lat: number, lon: number, origin: [number, number]): [number, number] {
  const [lon0, lat0] = origin;
  const k = Math.PI / 180;
  return [EARTH * (lon - lon0) * k * Math.cos(lat0 * k), EARTH * (lat - lat0) * k];
}

export function unproject(x: number, y: number, origin: [number, number]): [number, number] {
  const [lon0, lat0] = origin;
  const k = Math.PI / 180;
  return [lat0 + y / EARTH / k, lon0 + x / (EARTH * Math.cos(lat0 * k)) / k];
}

export function buildMetro(file: MetroFile): Metro {
  const h = file.hexes;
  const n = h.id.length;
  const index = new Map<string, number>();
  h.id.forEach((id, i) => index.set(id, i));

  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [la, lo] = cellToLatLng(h.id[i]);
    lat[i] = la;
    lon[i] = lo;
    [x[i], y[i]] = project(la, lo, file.metro.center);
  }

  const neighbours: number[][] = h.id.map((id) =>
    gridDisk(id, 1)
      .map((c) => index.get(c))
      .filter((j): j is number => j !== undefined),
  );

  const counts: Record<string, Float64Array> = {};
  const near: Record<string, Float64Array> = {};
  for (const s of file.signals) {
    const c = h.signals[s.id] ? Float64Array.from(h.signals[s.id]) : new Float64Array(n);
    const m = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const j of neighbours[i]) sum += c[j];
      m[i] = sum;
    }
    counts[s.id] = c;
    near[s.id] = m;
  }

  const p = file.places;
  const places: Places = {
    n: p.id.length,
    id: p.id,
    name: p.name,
    brand: p.brand,
    signal: Int32Array.from(p.signal),
    confidence: Float64Array.from(p.confidence),
    lat: Float64Array.from(p.lat),
    lon: Float64Array.from(p.lon),
    cell: Int32Array.from(p.lat, (la, k) => index.get(latLngToCell(la, p.lon[k], file.h3_res)) ?? -1),
  };

  const homes = Float64Array.from(h.homes);
  const metro: Metro = {
    info: file.metro,
    release: file.release,
    schema: file.schema,
    builtAt: file.built_at,
    signals: file.signals,
    ledger: file.ledger,
    file,
    n,
    ids: h.id,
    index,
    lat,
    lon,
    x,
    y,
    homes,
    rooftops: Float64Array.from(h.rooftops),
    single: Float64Array.from(h.single, (v) => v / 100),
    buildings: Float64Array.from(h.buildings),
    height: Float64Array.from(h.height, (v) => (v == null ? Number.NaN : v)),
    zip: Int32Array.from(h.zip),
    hood: Int32Array.from(h.hood),
    city: Int32Array.from(h.city),
    names: file.names,
    zips: file.zips,
    counts,
    near,
    totalHomes: homes.reduce((a, b) => a + b, 0),
    places,
  };
  return metro;
}

/** Places within one ring of a cell, grouped by signal, best-confidence first. */
export function placesNear(metro: Metro, cell: number): Map<number, number[]> {
  const ring = new Set(
    gridDisk(metro.ids[cell], 1)
      .map((c) => metro.index.get(c))
      .filter((j): j is number => j !== undefined),
  );
  const out = new Map<number, number[]>();
  const p = metro.places;
  for (let k = 0; k < p.n; k++) {
    if (!ring.has(p.cell[k])) continue;
    const s = p.signal[k];
    const list = out.get(s);
    if (list) list.push(k);
    else out.set(s, [k]);
  }
  for (const list of out.values()) list.sort((a, b) => p.confidence[b] - p.confidence[a]);
  return out;
}

export function cellLabel(metro: Metro, i: number): { hood: string | null; city: string | null; zip: string | null } {
  return {
    hood: metro.hood[i] >= 0 ? metro.names[metro.hood[i]] : null,
    city: metro.city[i] >= 0 ? metro.names[metro.city[i]] : null,
    zip: metro.zip[i] >= 0 ? metro.zips[metro.zip[i]].code : null,
  };
}

export function cellPolygon(id: string): [number, number][] {
  return cellToBoundary(id, true) as [number, number][];
}
