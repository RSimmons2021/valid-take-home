import { create } from "zustand";
import { type Metro, buildMetro } from "../data/metro";
import type { IndexFile, MetroFile } from "../data/types";
import type { Weight, Weights } from "../model/factors";
import { type Plan, planPins } from "../model/plan";
import { DEFAULT_PROFILE, profileById } from "../model/profiles";
import { type ScoreResult, scoreCells } from "../model/score";
import { type PlanState, decode, encode } from "./url";

export type Dialog = "export" | "data" | "welcome" | null;

interface Store extends PlanState {
  index: IndexFile | null;
  metro: Metro | null;
  loading: string | null;
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

  boot(): Promise<void>;
  setMetro(id: string): Promise<void>;
  setProfile(id: string): void;
  setWeight(factor: string, w: Weight): void;
  resetWeights(): void;
  setMinHomes(n: number): void;
  setPins(n: number): void;
  setRadius(mi: number): void;
  hover(cell: number | null): void;
  select(cell: number | null): void;
  focusPin(rank: number | null): void;
  open(d: Dialog): void;
  requestFrame(): void;
  setView3d(on: boolean): void;
}

const cache = new Map<string, Metro>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

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
  const recompute = (patch: Partial<Store> = {}) => {
    const s = { ...get(), ...patch };
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

  return {
    ...DEFAULTS,
    index: null,
    metro: null,
    loading: null,
    error: null,
    result: null,
    plan: null,
    hovered: null,
    selected: null,
    focusedPin: null,
    dialog: null,
    frameRequest: 0,
    view3d: false,

    async boot() {
      const fromUrl = decode(location.hash);
      const profile = profileById(fromUrl.profileId) ?? DEFAULT_PROFILE;
      set({
        ...DEFAULTS,
        ...fromUrl,
        profileId: profile.id,
        weights: fromUrl.weights ?? { ...profile.weights },
      });
      try {
        const index = await fetchJson<IndexFile>("./data/index.json");
        set({ index });
        const wanted = index.metros.some((m) => m.id === get().metroId) ? get().metroId : index.metros[0].id;
        await get().setMetro(wanted);
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), loading: null });
      }
      let seen = false;
      try {
        seen = localStorage.getItem("catchment.welcomed") === "1";
      } catch {
        /* storage blocked: show the welcome every time, which is harmless */
      }
      if (!seen && !fromUrl.metroId) set({ dialog: "welcome" });
    },

    async setMetro(id) {
      const summary = get().index?.metros.find((m) => m.id === id);
      set({ loading: summary?.name ?? id, error: null, selected: null, hovered: null, focusedPin: null });
      try {
        let metro = cache.get(id);
        if (!metro) {
          const file = await fetchJson<MetroFile>(`./data/${id}.json`);
          metro = buildMetro(file);
          cache.set(id, metro);
        }
        recompute({ metroId: id, metro, loading: null, frameRequest: get().frameRequest + 1 });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), loading: null });
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
    open(dialog) {
      if (get().dialog === "welcome" && dialog !== "welcome") {
        try {
          localStorage.setItem("catchment.welcomed", "1");
        } catch {
          /* ignore */
        }
      }
      set({ dialog });
    },
    requestFrame() {
      set({ frameRequest: get().frameRequest + 1 });
    },
    setView3d(view3d) {
      set({ view3d });
    },
  };
});

export function shareUrl(): string {
  return location.href;
}

export type { Weights };
