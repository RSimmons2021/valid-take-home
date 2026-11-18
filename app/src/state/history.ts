import type { PlanState } from "./url";

/**
 * Undo/redo for the plan. History holds PlanState snapshots: the same inputs the URL
 * holds, so every step is a reproducible plan. Pure helpers here; the store owns the stacks.
 */

export const HISTORY_LIMIT = 100;
/** Changes of the same kind within this window collapse into one step (rapid clicking). */
export const COALESCE_MS = 600;

export function snapshot(s: PlanState): PlanState {
  return { metroId: s.metroId, profileId: s.profileId, weights: { ...s.weights }, minHomes: s.minHomes, pins: s.pins, radiusMi: s.radiusMi };
}

function sameWeights(a: PlanState["weights"], b: PlanState["weights"]): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

export function same(a: PlanState, b: PlanState): boolean {
  return (
    a.metroId === b.metroId &&
    a.profileId === b.profileId &&
    a.minHomes === b.minHomes &&
    a.pins === b.pins &&
    a.radiusMi === b.radiusMi &&
    sameWeights(a.weights, b.weights)
  );
}

/** What kind of change led from `a` to `b`, in words for the undo toast. */
export function describeChange(a: PlanState, b: PlanState): string {
  if (a.metroId !== b.metroId) return "metro";
  if (a.profileId !== b.profileId) return "business type";
  if (!sameWeights(a.weights, b.weights)) return "weights";
  if (a.pins !== b.pins) return "pin count";
  if (a.radiusMi !== b.radiusMi) return "radius";
  if (a.minHomes !== b.minHomes) return "homes floor";
  return "change";
}

export interface Stacks {
  past: PlanState[];
  future: PlanState[];
  /** kind + time of the last recorded step, for coalescing */
  last: { kind: string; at: number } | null;
}

/** Record a step from `before` to `after`. Returns new stacks (or the same ones if nothing changed). */
export function record(st: Stacks, before: PlanState, after: PlanState, now: number): Stacks {
  if (same(before, after)) return st;
  const kind = describeChange(before, after);
  if (st.last && st.last.kind === kind && now - st.last.at < COALESCE_MS && st.past.length) {
    return { past: st.past, future: [], last: { kind, at: now } }; // keep the older "before"
  }
  return { past: [...st.past, snapshot(before)].slice(-HISTORY_LIMIT), future: [], last: { kind, at: now } };
}
