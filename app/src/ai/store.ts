import { create } from "zustand";
import { cellLabel } from "../data/metro";
import type { Weights } from "../model/factors";
import type { Pin } from "../model/plan";
import { profileById } from "../model/profiles";
import { CUSTOM_PROFILE, useStore } from "../state/store";
import { type AnglesRequest, type AnglesResponse, ApiError, type BriefResponse, type PlanProposal, health, suggestPlan, writeAngles } from "./client";

type Status = "idle" | "loading" | "done" | "error";

interface Applied {
  name: string;
  summary: string;
  /** factor → the model's reason, shown inline on the factor row while the weight is unchanged */
  reasons: Record<string, { weight: number; reason: string }>;
  competitor: string | null;
  /** what to restore on Undo */
  previous: { weights: Weights; profileId: string };
}

interface AnglesEntry {
  status: Status;
  data?: AnglesResponse;
  error?: string;
  attempt: number;
}

interface AiStore {
  /** null while checking; false on static hosts or without a key */
  available: boolean | null;
  /** the Catchment server is reachable (link previews), whether or not AI is configured */
  server: boolean;
  model: string | null;
  brief: string;
  briefStatus: Status;
  briefError: string | null;
  proposal: BriefResponse | null;
  applied: Applied | null;
  angles: Record<string, AnglesEntry>;

  checkHealth(): Promise<void>;
  setBrief(text: string): void;
  submitBrief(): Promise<void>;
  cancelBrief(): void;
  applyProposal(): void;
  discardProposal(): void;
  undoApplied(): void;
  requestAngles(pin: Pin, regenerate?: boolean): Promise<void>;
}

let briefAbort: AbortController | null = null;
const anglesAbort = new Map<string, AbortController>();

/**
 * A pin's angles depend on where it is, its radius, and what the user is targeting.
 * Keyed on all three, so changing weights shows fresh angles rather than stale copy.
 */
export function pinKey(pin: Pin): string {
  const s = useStore.getState();
  const w = Object.entries(s.weights)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join("");
  return `${s.metroId}:${pin.lat.toFixed(5)},${pin.lon.toFixed(5)}:${pin.radiusMi}:${w}`;
}

/** Who the ads are for: the AI-applied business if there is one, else the preset. */
/**
 * The angles request for a pin, exactly as the pin card sends it. Scene images reuse it,
 * so the server finds the same verified angles in its cache.
 */
export function anglesRequestFor(pin: Pin, attempt = useAi.getState().angles[pinKey(pin)]?.attempt ?? 0): AnglesRequest | null {
  const s = useStore.getState();
  if (!s.metro) return null;
  const label = cellLabel(s.metro, pin.cell);
  return {
    metroId: s.metroId,
    lat: pin.lat,
    lon: pin.lon,
    radiusMi: pin.radiusMi,
    weights: s.weights,
    business: currentBusiness(),
    area: { hood: label.hood, city: label.city },
    attempt,
  };
}

export function currentBusiness(): { name: string; summary: string } {
  const ai = useAi.getState().applied;
  const s = useStore.getState();
  if (ai && s.profileId === CUSTOM_PROFILE) return { name: ai.name, summary: ai.summary };
  const p = profileById(s.profileId);
  return p ? { name: p.label, summary: p.blurb } : { name: "Local service business", summary: "" };
}

export const useAi = create<AiStore>((set, get) => ({
  available: null,
  server: false,
  model: null,
  brief: "",
  briefStatus: "idle",
  briefError: null,
  proposal: null,
  applied: null,
  angles: {},

  async checkHealth() {
    // A sleeping free-tier server can take ~30–60 s to wake. Keep asking, patiently, in the
    // background; the AI controls appear when it answers. A static host answers "no" at once.
    let h = await health();
    for (let k = 0; h.retry && k < 4; k++) {
      set({ available: false, server: false });
      await new Promise((r) => setTimeout(r, 10_000));
      h = await health(25_000);
    }
    set({ available: h.ai, server: h.server, model: h.model });
  },

  setBrief(brief) {
    set({ brief });
  },

  async submitBrief() {
    const brief = get().brief.trim();
    if (brief.length < 8 || get().briefStatus === "loading") return;
    briefAbort?.abort();
    briefAbort = new AbortController();
    set({ briefStatus: "loading", briefError: null, proposal: null });
    try {
      const res = await suggestPlan(brief, briefAbort.signal);
      set({ briefStatus: "done", proposal: res });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return set({ briefStatus: "idle" });
      set({ briefStatus: "error", briefError: e instanceof ApiError ? e.message : "Something went wrong." });
    }
  },

  cancelBrief() {
    briefAbort?.abort();
    set({ briefStatus: "idle" });
  },

  applyProposal() {
    const res = get().proposal;
    if (!res?.plan.supported) return;
    const s = useStore.getState();
    const plan: PlanProposal = res.plan;
    const weights: Weights = {};
    const reasons: Applied["reasons"] = {};
    for (const w of plan.weights) {
      weights[w.factor] = w.weight;
      reasons[w.factor] = { weight: w.weight, reason: w.reason };
    }
    set({
      applied: {
        name: plan.name,
        summary: plan.summary,
        reasons,
        competitor: plan.competitor,
        previous: { weights: { ...s.weights }, profileId: s.profileId },
      },
      proposal: null,
      briefStatus: "idle",
    });
    s.setWeights(weights, CUSTOM_PROFILE);
  },

  discardProposal() {
    set({ proposal: null, briefStatus: "idle" });
  },

  undoApplied() {
    const a = get().applied;
    if (!a) return;
    useStore.getState().setWeights(a.previous.weights, a.previous.profileId);
    set({ applied: null });
  },

  async requestAngles(pin, regenerate = false) {
    const s = useStore.getState();
    if (!s.metro) return;
    const key = pinKey(pin);
    const prev = get().angles[key];
    if (prev?.status === "loading") return;
    const attempt = regenerate ? (prev?.attempt ?? 0) + 1 : (prev?.attempt ?? 0);
    anglesAbort.get(key)?.abort();
    const ctl = new AbortController();
    anglesAbort.set(key, ctl);
    set({ angles: { ...get().angles, [key]: { status: "loading", attempt, data: prev?.data } } });
    try {
      const data = await writeAngles(anglesRequestFor(pin, attempt)!, ctl.signal);
      set({ angles: { ...get().angles, [key]: { status: "done", data, attempt } } });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const error = e instanceof ApiError ? e.message : "Something went wrong.";
      set({ angles: { ...get().angles, [key]: { status: "error", error, attempt, data: prev?.data } } });
    }
  },
}));
