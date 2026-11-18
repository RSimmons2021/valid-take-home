import { create } from "zustand";
import { currentBusiness, pinKey, useAi } from "../ai/store";
import { type BudgetLine, type PinScript, pinsForBudget, scriptFor, splitBudget } from "../model/campaign";
import { pinName } from "../model/export";
import { type LiftDesign, bestShuffle, targetUnits } from "../model/holdout";
import type { Pin } from "../model/plan";
import { snapshot } from "../state/history";
import { useStore } from "../state/store";
import type { PlanState } from "../state/url";
import type { FilmSpec } from "../video/film";
import { captureFrames } from "../video/stills";

/**
 * Autopilot: one brief and a budget in, a reviewable campaign kit out. It runs the steps a
 * person would (weights, pins, budget, scripts, videos, lift test) through the app's own
 * actions, so every change is visible on the map, recorded in undo history, and the whole
 * run can be undone in one step. The model only proposes words; everything else is the
 * deterministic engine. Nothing is launched or spent.
 */

export type StepId = "business" | "pins" | "budget" | "scripts" | "videos" | "lift";
export type StepState = "todo" | "active" | "done" | "skipped" | "error";
export interface Step {
  id: StepId;
  label: string;
  state: StepState;
  detail?: string;
}

export interface Kit {
  business: { name: string; summary: string };
  monthly: number | null;
  budget: BudgetLine[];
  scripts: PinScript[];
  films: Map<number, FilmSpec>;
  lift: LiftDesign | null;
}

type Status = "idle" | "running" | "done" | "canceled";

interface AutopilotStore {
  brief: string;
  monthly: string;
  status: Status;
  steps: Step[];
  kit: Kit | null;
  /** the plan (and any applied AI suggestion) before the run, for "Undo Autopilot" */
  before: PlanState | null;
  beforeAi: ReturnType<typeof useAi.getState>["applied"];
  setBrief(v: string): void;
  setMonthly(v: string): void;
  run(): Promise<void>;
  cancel(): void;
  undoAll(): void;
  reset(): void;
}

const STEPS: Omit<Step, "state">[] = [
  { id: "business", label: "Understand the business" },
  { id: "pins", label: "Place the pins" },
  { id: "budget", label: "Split the budget" },
  { id: "scripts", label: "Write a script for each pin" },
  { id: "videos", label: "Make each pin's video" },
  { id: "lift", label: "Design the lift test" },
];

const fresh = (): Step[] => STEPS.map((s) => ({ ...s, state: "todo" }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));

/** Parse "$1,500" / "1500" / "1.5k" into dollars, or null. */
export function parseBudget(text: string): number | null {
  const m = text.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k?)$/);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? 1000 : 1);
  return v >= 1 && v <= 10_000_000 ? Math.round(v) : null;
}

let runId = 0;

export const useAutopilot = create<AutopilotStore>((set, get) => {
  const step = (id: StepId, state: StepState, detail?: string) =>
    set({ steps: get().steps.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s)) });

  return {
    brief: "",
    monthly: "1500",
    status: "idle",
    steps: fresh(),
    kit: null,
    before: null,
    beforeAi: null,
    setBrief: (brief) => set({ brief }),
    setMonthly: (monthly) => set({ monthly }),

    async run() {
      const app = useStore.getState();
      if (!app.metro || get().status === "running") return;
      const id = ++runId;
      const live = () => id === runId && get().status === "running";
      set({ status: "running", steps: fresh(), kit: null, before: snapshot(app), beforeAi: useAi.getState().applied });
      const monthly = parseBudget(get().monthly);
      const ai = useAi.getState();

      // 1. Business → weights. With AI, the brief becomes weights (applied, so they're undoable
      //    and their reasons show in the panel). Without it, the current business type stands.
      step("business", "active");
      const brief = get().brief.trim();
      if (ai.available && brief.length >= 8) {
        useAi.getState().setBrief(brief);
        await useAi.getState().submitBrief();
        if (!live()) return;
        const res = useAi.getState().proposal;
        if (res?.plan.supported) {
          useAi.getState().applyProposal();
          step("business", "done", `${res.plan.name}: ${res.plan.weights.length} signals weighted, each with a reason`);
        } else {
          const why = res?.plan.note || useAi.getState().briefError || "The brief didn't map onto the map's signals";
          useAi.getState().discardProposal();
          step("business", "skipped", `${why}. Kept ${currentBusiness().name} weights.`);
        }
      } else {
        step("business", "skipped", ai.available ? `No brief given: using ${currentBusiness().name} weights.` : `AI is off here: using ${currentBusiness().name} weights.`);
      }

      // 2. Pins: as many as the budget can feed at a useful daily spend.
      step("pins", "active");
      const s1 = useStore.getState();
      if (monthly) {
        const n = pinsForBudget(monthly, s1.pins);
        if (n !== s1.pins) s1.setPins(n);
      }
      const plan = useStore.getState().plan;
      if (!plan || plan.pins.length === 0) {
        step("pins", "error", "Nothing scores above the median with these weights. Loosen a weight and run again.");
        set({ status: "done" });
        return;
      }
      step("pins", "done", `${plan.pins.length} pins · ${compact(plan.homes)} homes · ${pct(plan.homes ? plan.onTargetHomes / plan.homes : 0)} on target`);
      useStore.getState().requestFrame();

      // 3. Budget.
      step("budget", "active");
      const budget = monthly ? splitBudget(plan.pins, monthly) : [];
      step(
        "budget",
        monthly ? "done" : "skipped",
        monthly ? `$${monthly.toLocaleString("en-US")}/mo · $${Math.min(...budget.map((b) => b.daily)).toFixed(0)}–$${Math.max(...budget.map((b) => b.daily)).toFixed(0)} a day per pin` : "No budget given",
      );

      // 4. Scripts: AI angles where it can, the data where it can't. Two pins at a time.
      step("scripts", "active");
      const s2 = useStore.getState();
      const business = currentBusiness();
      const scripts: PinScript[] = [];
      let byAi = 0;
      const one = async (pin: Pin) => {
        let angle;
        if (useAi.getState().available) {
          await useAi.getState().requestAngles(pin);
          angle = useAi.getState().angles[pinKey(pin)]?.data?.angles[0];
        }
        if (angle) byAi++;
        scripts.push(scriptFor(s2.metro!, pin, s2.weights, business, angle));
        if (live()) step("scripts", "active", `${scripts.length} of ${plan.pins.length}`);
      };
      const queue = [...plan.pins];
      await Promise.all(
        [0, 1].map(async () => {
          while (queue.length && live()) await one(queue.shift()!);
        }),
      );
      if (!live()) return;
      scripts.sort((a, b) => a.rank - b.rank);
      step("scripts", "done", byAi ? `${byAi} written by AI from verified places${byAi < scripts.length ? `, ${scripts.length - byAi} from the data` : ""}` : "Written from the data: real places, no AI");

      // 5. Videos: photograph each pin, then each film is drawn on demand.
      step("videos", "active");
      const films = new Map<number, FilmSpec>();
      try {
        const frames = await captureFrames(
          s2.metro!,
          s2.result!.score,
          s2.metro!.release,
          plan.pins.map((pin) => ({ pin, callouts: scripts.find((x) => x.rank === pin.rank)!.callouts })),
          (done) => live() && step("videos", "active", `${done} of ${plan.pins.length} neighbourhoods photographed`),
        );
        if (!live()) return;
        for (const pin of plan.pins) {
          const f = frames.get(pin.rank);
          const sc = scripts.find((x) => x.rank === pin.rank)!;
          if (!f) continue;
          films.set(pin.rank, {
            ...f,
            eyebrow: `${business.name} · ${pinName(pin.label, pin.rank)}`,
            title: sc.title,
            hook: sc.hook,
            business: business.name,
            where: pin.label.hood ?? pin.label.city ?? s2.metro!.info.name,
            stat: `${compact(pin.homes)} homes within ${pin.radiusMi} mi`,
            cta: sc.cta,
            seed: pin.cell,
          });
        }
        step("videos", "done", `${films.size} videos · 8 s · 9:16, drawn from the real map`);
      } catch (e) {
        step("videos", "error", e instanceof Error ? e.message : "Couldn't draw the map for the videos");
      }

      // 6. Lift test.
      step("lift", "active");
      const s3 = useStore.getState();
      const target = targetUnits(s3.metro!, plan, s3.weights, s3.minHomes);
      const lift = target.length >= 2 ? bestShuffle(target) : null;
      step("lift", lift ? "done" : "skipped", lift ? `${lift.pairs.length} matched ZIP pairs · ${lift.quality} design` : "Too few ZIPs to pair");

      set({ status: "done", kit: { business, monthly, budget, scripts, films, lift } });
    },

    cancel() {
      if (get().status !== "running") return;
      runId++;
      useAi.getState().cancelBrief();
      set({ status: "canceled", steps: get().steps.map((s) => (s.state === "active" ? { ...s, state: "skipped", detail: "Stopped" } : s)) });
    },

    undoAll() {
      const before = get().before;
      if (before) useStore.getState().applyPlan(before);
      useAi.setState({ applied: get().beforeAi });
      set({ status: "idle", steps: fresh(), kit: null, before: null });
    },

    reset() {
      set({ status: "idle", steps: fresh(), kit: null });
    },
  };
});
