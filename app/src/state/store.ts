import { create } from "zustand";
import { type Metro, buildMetro } from "../data/metro";
import type { IndexFile, MetroFile } from "../data/types";
import type { Weight, Weights } from "../model/factors";
import { type Plan, planPins } from "../model/plan";
import { DEFAULT_PROFILE, profileById } from "../model/profiles";
import { type ScoreResult, scoreCells } from "../model/score";
import { type Stacks, describeChange, record, snapshot } from "./history";
import { type PlanState, decode, encode } from "./url";
import type { CellClass } from "../map/colors";

export type Dialog = "export" | "data" | "welcome" | "results" | null;

interface Store extends PlanState {
  index: IndexFile | null;
  metro: Metro | null;
  loading: string | null;
  /** while a metro loads: share of its file downloaded (0..1), then "build" while cells are made */
  loadProgress: number | "build" | null;
  error: string | null;
  result: ScoreResult | null;
  plan: Plan | null;
  hovered: number | null;
  selected: number | null;
  focusedPin: number | null;
  dialog: Dialog;
  /** bumps whenever the camera should frame the plan */
  frameRequest: number;
  /** cells extruded by homes, camera pitched. A view preference, so it isn't in the URL. */
  view3d: boolean;
  /** current step of the guided tour, or null when it isn't showing */
  tour: number | null;
  /** undo/redo stacks of plan snapshots */
  history: Stacks;
  /** lift-test ZIPs drawn on the map, or null */
  liftOverlay: { test: string[]; control: string[] } | null;
  /** pin rank highlighted together on the map and in the list (hover), not a plan input */
  hotPin: number | null;
  /** legend item being hovered: the map spotlights that class of cell */
  peek: CellClass | null;

  boot(): Promise<void>;
  setMetro(id: string): Promise<void>;
  setProfile(id: string): void;
  setWeight(factor: string, w: Weight): void;
  resetWeights(): void;
  /** replace every weight at once (AI suggestions, undo); profileId "custom" marks them as not a preset */
  setWeights(weights: Weights, profileId: string): void;
  setMinHomes(n: number): void;
  setPins(n: number): void;
  setRadius(mi: number): void;
  hover(cell: number | null): void;
  select(cell: number | null): void;
  focusPin(rank: number | null): void;
  setHotPin(rank: number | null): void;
  setPeek(c: CellClass | null): void;
  open(d: Dialog): void;
  requestFrame(): void;
  setView3d(on: boolean): void;
  startTour(): void;
  setLiftOverlay(o: { test: string[]; control: string[] } | null): void;
  /** returns what was undone/redone ("weights", "radius"…), or null if there was nothing */
  undo(): Promise<string | null>;
  redo(): Promise<string | null>;
  setTourStep(step: number): void;
  endTour(): void;
}

const SEEN_WELCOME = "catchment.welcomed";
const SEEN_TOUR = "catchment.toured";

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked: treat as a first visit, which only means showing help again
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

const cache = new Map<string, Metro>();

/** Profile id for weights that didn't come from a preset (AI suggestion or hand-tuned from one). */
export const CUSTOM_PROFILE = "custom";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * Fetch JSON while reporting real progress. The index records each file's uncompressed size,
 * which is what the stream yields (Content-Length would be the gzipped size), so the bar
 * measures bytes, not time. Without a readable body it falls back to a plain fetch.
 */
async function fetchJsonWithProgress<T>(url: string, totalBytes: number | undefined, onProgress: (share: number) => void): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  if (!res.body || !totalBytes) return (await res.json()) as T;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const share = Math.min(1, received / totalBytes);
    if (share - reported >= 0.02) {
      reported = share;
      onProgress(share);
    }
  }
  const all = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return JSON.parse(new TextDecoder().decode(all)) as T;
}

/** Bumped by each metro load, so a slower earlier load can't overwrite a newer one. */
let metroRequest = 0;

/** Let the browser paint (a progress state) before a long synchronous step. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const DEFAULTS: PlanState = {
  metroId: "sf-bay",
  profileId: DEFAULT_PROFILE.id,
  weights: { ...DEFAULT_PROFILE.weights },
  minHomes: 25,
  pins: 8,
  radiusMi: 1.5,
};

export const useStore = create<Store>((set, get) => {
  /** Rescore and replan from the current inputs. Both are pure and fast (≤ 60 ms on 12k cells). */
  let restoring = false;
  const recompute = (patch: Partial<Store> = {}) => {
    const before = get();
    const s = { ...before, ...patch };
    // Every plan change is an undo step, except the first load and undo/redo themselves.
    if (before.metro && !restoring) patch = { ...patch, history: record(before.history, before, s, Date.now()) };
    if (!s.metro) {
      set(patch);
      return;
    }
    const result = scoreCells(s.metro, { weights: s.weights, minHomes: s.minHomes });
    const plan = planPins(s.metro, result.score, { pins: s.pins, radiusMi: s.radiusMi });
    set({ ...patch, result, plan });
    writeUrl();
  };

  const writeUrl = () => {
    const s = get();
    const hash = encode(s);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  };

  /** Apply a snapshot without recording it (undo/redo), loading another metro if needed. */
  const restore = async (snap: PlanState) => {
    restoring = true;
    try {
      if (snap.metroId !== get().metroId) await get().setMetro(snap.metroId);
      recompute({ profileId: snap.profileId, weights: { ...snap.weights }, minHomes: snap.minHomes, pins: snap.pins, radiusMi: snap.radiusMi, focusedPin: null, selected: null });
    } finally {
      restoring = false;
    }
  };

  return {
    ...DEFAULTS,
    index: null,
    metro: null,
    loading: null,
    loadProgress: null,
    error: null,
    result: null,
    plan: null,
    hovered: null,
    hotPin: null,
    peek: null,
    selected: null,
    focusedPin: null,
    dialog: null,
    frameRequest: 0,
    view3d: false,
    tour: null,
    liftOverlay: null,
    history: { past: [], future: [], last: null },

    async boot() {
      const fromUrl = decode(location.hash);
      const profile = profileById(fromUrl.profileId) ?? DEFAULT_PROFILE;
      const custom = fromUrl.profileId === CUSTOM_PROFILE && fromUrl.weights;
      set({
        ...DEFAULTS,
        ...fromUrl,
        profileId: custom ? CUSTOM_PROFILE : profile.id,
        weights: fromUrl.weights ?? { ...profile.weights },
      });
      try {
        const index = await fetchJson<IndexFile>("./data/index.json");
        set({ index });
        const wanted = index.metros.some((m) => m.id === get().metroId) ? get().metroId : index.metros[0].id;
        await get().setMetro(wanted);
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), loading: null, loadProgress: null });
      }
      // First visit, even through a shared link: a reviewer opening a plan someone sent
      // still gets the welcome, then the guided tour.
      if (!remembered(SEEN_WELCOME)) set({ dialog: "welcome" });
    },

    async setMetro(id) {
      const summary = get().index?.metros.find((m) => m.id === id);
      const ticket = ++metroRequest;
      const current = () => ticket === metroRequest;
      set({ loading: summary?.name ?? id, loadProgress: 0, error: null, selected: null, hovered: null, focusedPin: null, hotPin: null, liftOverlay: null });
      try {
        let metro = cache.get(id);
        if (!metro) {
          const file = await fetchJsonWithProgress<MetroFile>(`./data/${id}.json`, summary?.bytes, (p) => {
            if (current()) set({ loadProgress: p });
          });
          // Building typed arrays and neighbour sums blocks for a moment; say so first.
          if (!current()) return;
          set({ loadProgress: "build" });
          await nextFrame();
          metro = buildMetro(file);
          cache.set(id, metro);
        }
        if (!current()) return;
        recompute({ metroId: id, metro, loading: null, loadProgress: null, frameRequest: get().frameRequest + 1 });
      } catch (e) {
        if (current()) set({ error: e instanceof Error ? e.message : String(e), loading: null, loadProgress: null });
      }
    },

    setProfile(id) {
      const p = profileById(id);
      if (!p) return;
      recompute({ profileId: p.id, weights: { ...p.weights }, selected: null, focusedPin: null });
    },
    setWeight(factor, w) {
      const weights = { ...get().weights, [factor]: w };
      if (w === 0) delete weights[factor];
      recompute({ weights, focusedPin: null });
    },
    resetWeights() {
      const p = profileById(get().profileId) ?? DEFAULT_PROFILE;
      recompute({ weights: { ...p.weights } });
    },
    setWeights(weights, profileId) {
      const clean: Weights = {};
      for (const [k, w] of Object.entries(weights)) if (w !== 0) clean[k] = w;
      recompute({ weights: clean, profileId, selected: null, focusedPin: null, frameRequest: get().frameRequest + 1 });
    },
    setMinHomes(minHomes) {
      recompute({ minHomes });
    },
    setPins(pins) {
      recompute({ pins, focusedPin: null });
    },
    setRadius(radiusMi) {
      recompute({ radiusMi, focusedPin: null });
    },
    hover(hovered) {
      if (get().hovered !== hovered) set({ hovered });
    },
    select(selected) {
      set({ selected, focusedPin: null });
    },
    focusPin(focusedPin) {
      set({ focusedPin, selected: null });
    },
    setHotPin(hotPin) {
      if (get().hotPin !== hotPin) set({ hotPin });
    },
    setPeek(peek) {
      if (get().peek !== peek) set({ peek });
    },
    open(dialog) {
      const closingWelcome = get().dialog === "welcome" && dialog !== "welcome";
      set({ dialog });
      if (closingWelcome) {
        remember(SEEN_WELCOME);
        if (!remembered(SEEN_TOUR)) get().startTour();
      }
    },
    requestFrame() {
      set({ frameRequest: get().frameRequest + 1 });
    },
    setView3d(view3d) {
      set({ view3d });
    },
    async undo() {
      const { history: h } = get();
      const prev = h.past[h.past.length - 1];
      if (!prev) return null;
      const now = snapshot(get());
      const label = describeChange(prev, now);
      set({ history: { past: h.past.slice(0, -1), future: [...h.future, now], last: null } });
      await restore(prev);
      return label;
    },
    async redo() {
      const { history: h } = get();
      const next = h.future[h.future.length - 1];
      if (!next) return null;
      const now = snapshot(get());
      const label = describeChange(now, next);
      set({ history: { past: [...h.past, now], future: h.future.slice(0, -1), last: null } });
      await restore(next);
      return label;
    },
    setLiftOverlay(liftOverlay) {
      set({ liftOverlay });
    },
    startTour() {
      if (!get().metro) return;
      set({ tour: 0, dialog: null, focusedPin: null });
    },
    setTourStep(tour) {
      set({ tour });
    },
    endTour() {
      remember(SEEN_TOUR);
      set({ tour: null });
    },
  };
});

export function shareUrl(): string {
  return location.href;
}

export type { Weights };
