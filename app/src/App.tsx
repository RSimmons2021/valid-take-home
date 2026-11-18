import { useEffect, useRef, useState } from "react";
import { MapView } from "./map/MapView";
import { PALETTES, rampCss } from "./map/colors";
import { useStore } from "./state/store";
import { useTheme } from "./state/theme";
import { BusinessPanel } from "./ui/BusinessPanel";
import { useAi } from "./ai/store";
import { CellCard } from "./ui/CellCard";
import { CommandPalette, undoToast } from "./ui/CommandPalette";
import { Dialogs } from "./ui/Dialogs";
import { PinCard } from "./ui/PinCard";
import { PlanPanel } from "./ui/PlanPanel";
import { TooltipLayer } from "./ui/Tooltip";
import { TopBar } from "./ui/TopBar";
import { Tour } from "./ui/tour/Tour";
import { useToasts } from "./ui/toast";

export function App() {
  const index = useStore((s) => s.index);
  const error = useStore((s) => s.error);
  const metro = useStore((s) => s.metro);

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
    <div className="app">
      <TopBar />
      <main className="stage">
        {index && <MapView />}
        {!metro && !error && (
          <div className="boot" role="status">
            <i className="spinner" aria-hidden="true" /> Loading Overture data…
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
  const lowUnits = metro.ledger.addresses.units_per_rooftop < 1.2;
  return (
    <div className="legend">
      <span className="legend__item" data-tip="Blocks below the city median for your customer. Pins ignore them.">
        <i className="legend__low" aria-hidden="true" /> Below average
      </span>
      <span className="legend__ramp" data-tip="Darker blue means a better fit for your customer">
        <span>Good fit</span>
        <i style={{ background: rampCss(PALETTES[theme]) }} aria-hidden="true" />
        <span>Best fit</span>
      </span>
      <span className="legend__item legend__muted" data-tip="Raise or lower this floor in the Business panel">Unshaded: under {minHomes} homes</span>
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
        <button type="button" role="radio" aria-checked={!view3d} onClick={() => setView3d(false)} data-tip="Flat map">
          2D
        </button>
        <button type="button" role="radio" aria-checked={view3d} onClick={() => setView3d(true)} data-tip="Raise each block by its number of homes">
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
        <div key={t.id} className="toast">
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
