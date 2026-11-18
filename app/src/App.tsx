import { useEffect, useRef, useState } from "react";
import { MapView } from "./map/MapView";
import { type CellClass, PALETTES, css, rampCss } from "./map/colors";
import { useStore } from "./state/store";
import { useTheme } from "./state/theme";
import { BusinessPanel } from "./ui/BusinessPanel";
import { useAi } from "./ai/store";
import { CellCard } from "./ui/CellCard";
import { CommandPalette, undoToast } from "./ui/CommandPalette";
import { Dialogs } from "./ui/Dialogs";
import { PinCard } from "./ui/PinCard";
import { PrintPlan } from "./ui/PrintPlan";
import { LoadBar, loadLabel } from "./ui/Progress";
import { Indicator } from "./ui/motion";
import { Glyph } from "./ui/TopBar";
import { DocumentTitle, OfflineBanner } from "./ui/edges";
import { PlanPanel } from "./ui/PlanPanel";
import { TooltipLayer } from "./ui/Tooltip";
import { TopBar } from "./ui/TopBar";
import { Tour } from "./ui/tour/Tour";
import { KEYS, singleKey } from "./ui/shortcuts";
import { useToasts } from "./ui/toast";

export function App() {
  const index = useStore((s) => s.index);
  const error = useStore((s) => s.error);
  const metro = useStore((s) => s.metro);
  const loading = useStore((s) => s.loading);
  const loadProgress = useStore((s) => s.loadProgress);
  const loadingSummary = useStore((s) => s.index?.metros.find((m) => m.name === s.loading));

  useEffect(() => {
    void useStore.getState().boot();
    void useAi.getState().checkHealth();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const mod = e.metaKey || e.ctrlKey;
      // Undo/redo the plan, unless the user is editing text (where the browser's undo belongs).
      if (mod && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const s = useStore.getState();
        if (e.shiftKey) void s.redo().then((w) => undoToast(w, "Redid"));
        else void s.undo().then((w) => undoToast(w, "Undid"));
        return;
      }
      if (mod && !typing && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void useStore.getState().redo().then((w) => undoToast(w, "Redid"));
        return;
      }
      const short = singleKey(e);
      if (short) {
        const s = useStore.getState();
        const pins = s.plan?.pins ?? [];
        e.preventDefault();
        if (short === "export") s.open("export");
        else if (short === "autopilot") s.open("autopilot");
        else if (short === "fit") s.requestFrame();
        else if (short === "view3d") s.setView3d(!s.view3d);
        else if (pins.length) {
          // [ and ] walk the pins in rank order, wrapping, from whichever is focused
          const at = s.focusedPin ?? (short === "nextPin" ? 0 : pins.length + 1);
          const next = short === "nextPin" ? (at % pins.length) + 1 : ((at - 2 + pins.length) % pins.length) + 1;
          s.focusPin(next);
        }
        return;
      }
      if (e.key === "Escape") {
        const s = useStore.getState();
        if (s.selected != null) s.select(null);
        else if (s.focusedPin != null) s.focusPin(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" aria-busy={loading ? true : undefined}>
      <TopBar />
      <LoadBar progress={loadProgress} />
      <main className="stage">
        {index && <MapView />}
        {!metro && !error && (
          <div className="boot" role="status">
            <div className="boot__card">
              <Glyph size={28} />
              <p className="boot__title">{loading ? `Loading ${loading}` : "Loading Overture data"}</p>
              <div className="boot__bar" aria-hidden="true">
                <i
                  className={loadProgress === null ? "boot__bar--wait" : undefined}
                  style={{ transform: `scaleX(${loadProgress === "build" ? 1 : Math.max(0.04, loadProgress ?? 0)})` }}
                />
              </div>
              <p className="boot__meta tabular">
                {loadProgress === null ? "Finding the metros…" : loadLabel(loadProgress, loadingSummary?.bytes, loadingSummary?.cells)}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="boot boot--error" role="alert">
            <b>Couldn't load the data.</b> {error}
            <button type="button" className="btn btn--ghost" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        )}
        {metro && <Legend />}
        <CellCard />
        <PinCard />
      </main>
      {metro && <BusinessPanel />}
      {metro && <PlanPanel />}
      <Dialogs />
      <Tour />
      <CommandPalette />
      <PrintPlan />
      <DocumentTitle />
      <OfflineBanner />
      <PlanAnnouncer />
      <TooltipLayer />
      <Toasts />
    </div>
  );
}

function Legend() {
  const minHomes = useStore((s) => s.minHomes);
  const metro = useStore((s) => s.metro)!;
  const open = useStore((s) => s.open);
  const view3d = useStore((s) => s.view3d);
  const setView3d = useStore((s) => s.setView3d);
  const theme = useTheme((s) => s.theme);
  const liftOverlay = useStore((s) => s.liftOverlay);
  const setLiftOverlay = useStore((s) => s.setLiftOverlay);
  const weights = useStore((s) => s.weights);
  const setPeek = useStore((s) => s.setPeek);
  const lowUnits = metro.ledger.addresses.units_per_rooftop < 1.2;
  const avoids = Object.values(weights).some((w) => (w ?? 0) < 0);
  const palette = PALETTES[theme];
  // Hover (or focus) peeks at one kind of block; a click keeps the spotlight on.
  const [hover, setHover] = useState<CellClass | null>(null);
  const [kept, setKept] = useState<CellClass | null>(null);
  useEffect(() => setPeek(hover ?? kept), [hover, kept, setPeek]);
  useEffect(() => () => setPeek(null), [setPeek]);
  useEffect(() => {
    if (kept === "held" && !avoids) setKept(null);
  }, [avoids, kept]);
  const peekable = (c: CellClass) => ({
    "aria-pressed": kept === c,
    onPointerEnter: () => setHover(c),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(c),
    onBlur: () => setHover(null),
    onClick: () => setKept((k) => (k === c ? null : c)),
  });
  return (
    <div className="legend">
      <button
        type="button"
        className="legend__item legend__key"
        data-tip="Blocks below the city median for your customer. Pins ignore them. Click to spotlight."
        {...peekable("low")}
      >
        <i className="legend__chip" style={{ background: css(palette.low), boxShadow: "inset 0 0 0 1px var(--line)" }} aria-hidden="true" />{" "}
        Below average
      </button>
      {avoids && (
        <button
          type="button"
          className="legend__item legend__key"
          data-tip="Below average mainly because of something you chose to avoid nearby. Hover a block to see what. Click to spotlight."
          {...peekable("held")}
        >
          <i
            className="legend__chip"
            style={{ background: css([palette.held[0], palette.held[1], palette.held[2], Math.min(255, palette.held[3] * 2.4)]) }}
            aria-hidden="true"
          />{" "}
          Avoided nearby
        </button>
      )}
      <button
        type="button"
        className="legend__ramp legend__key"
        data-tip="Darker blue means a better fit for your customer. Click to spotlight."
        {...peekable("fit")}
      >
        <span>Good</span>
        <i style={{ background: rampCss(palette) }} aria-hidden="true" />
        <span>Best fit</span>
      </button>
      <button
        type="button"
        className="legend__item legend__key"
        data-tip="What your pins reach. Click to spotlight."
        {...peekable("reach")}
      >
        <i className="legend__ring" aria-hidden="true" /> Pin reach
      </button>
      <span
        className="legend__item legend__muted"
        data-tip={`Blocks with fewer than ${minHomes} homes aren't scored. Raise or lower this floor in the Business panel.`}
        tabIndex={0}
      >
        Blank: &lt;{minHomes} homes
      </span>
      {lowUnits && (
        <button type="button" className="legend__warn" onClick={() => open("data")}>
          Apartment units not listed here ⓘ
        </button>
      )}
      {liftOverlay && (
        <span className="legend__lift">
          <i className="legend__swatch legend__swatch--test" aria-hidden="true" /> test
          <i className="legend__swatch legend__swatch--control" aria-hidden="true" /> control
          <button type="button" className="link" onClick={() => setLiftOverlay(null)} data-tip="Hide the lift test ZIPs">
            Hide
          </button>
        </span>
      )}
      <span className="segmented segmented--small legend__view" role="radiogroup" aria-label="Map view">
        <Indicator value={view3d} />
        <button
          type="button"
          role="radio"
          aria-checked={!view3d}
          onClick={() => setView3d(false)}
          data-tip="Flat map"
          data-keys={KEYS.view3d}
        >
          2D
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view3d}
          onClick={() => setView3d(true)}
          data-tip="Raise each block by its number of homes"
          data-keys={KEYS.view3d}
        >
          3D
        </button>
      </span>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.leaving ? " toast--leaving" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Screen readers hear what changed after an edit settles ("Plan updated: 8 pins, 340k homes,
 * 80% on target"), not every intermediate state. Silent on first load.
 */
function PlanAnnouncer() {
  const plan = useStore((s) => s.plan);
  const [text, setText] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (!plan) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      const on = plan.homes ? Math.round((plan.onTargetHomes / plan.homes) * 100) : 0;
      setText(`Plan updated: ${plan.pins.length} pins, ${Math.round(plan.homes).toLocaleString("en-US")} homes, ${on}% on target.`);
    }, 800);
    return () => clearTimeout(id);
  }, [plan]);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {text}
    </div>
  );
}
