import { type Metro, project } from "../data/metro";
import type { ChangedPlaces } from "../data/types";
import type { Weights } from "./factors";
import { MILE, type Pin } from "./plan";

/**
 * What changed inside a pin since the previous Overture release, read through the user's
 * weights: a new listing of a signal they *avoid* is new competition; a closure of a signal
 * they *prefer* is lost demand. Those two are the alerts; the opposites are good news.
 * Signals they ignore aren't reported.
 */

export interface ChangedPlace {
  id: string;
  name: string;
  signal: string;
  signalLabel: string;
}

export interface PinChanges {
  since: string;
  /** new listings of signals the user avoids (competitors, nightlife…) */
  newCompetitors: ChangedPlace[];
  /** closures of signals the user prefers */
  lostDemand: ChangedPlace[];
  newDemand: ChangedPlace[];
  closedCompetitors: ChangedPlace[];
  /** alerts: new avoided listings + lost preferred places */
  alerts: number;
}

function inside(metro: Metro, pin: Pin, set: ChangedPlaces): number[] {
  const r2 = (pin.radiusMi * MILE) ** 2;
  const out: number[] = [];
  for (let k = 0; k < set.id.length; k++) {
    const [x, y] = project(set.lat[k], set.lon[k], metro.info.center);
    if ((x - metro.x[pin.cell]) ** 2 + (y - metro.y[pin.cell]) ** 2 <= r2) out.push(k);
  }
  return out;
}

export function pinChanges(metro: Metro, pin: Pin, weights: Weights): PinChanges | null {
  const c = metro.file.changes;
  if (!c) return null;
  const to = (set: ChangedPlaces) => (k: number): ChangedPlace => {
    const s = metro.signals[set.signal[k]];
    return { id: set.id[k], name: set.name[k], signal: s.id, signalLabel: s.label };
  };
  const added = inside(metro, pin, c.added).map(to(c.added));
  const closed = inside(metro, pin, c.closed).map(to(c.closed));
  const w = (p: ChangedPlace) => weights[p.signal] ?? 0;
  const result = {
    since: c.since,
    newCompetitors: added.filter((p) => w(p) < 0),
    lostDemand: closed.filter((p) => w(p) > 0),
    newDemand: added.filter((p) => w(p) > 0),
    closedCompetitors: closed.filter((p) => w(p) < 0),
  };
  return { ...result, alerts: result.newCompetitors.length + result.lostDemand.length };
}

/** "2026-09-23.0" → "Sep 2026" */
export function releaseLabel(release: string): string {
  const d = new Date(`${release.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? release : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
