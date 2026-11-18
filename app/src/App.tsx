import { useEffect } from "react";
import { MapView } from "./map/MapView";
import { PALETTES, rampCss } from "./map/colors";
import { useStore } from "./state/store";
import { useTheme } from "./state/theme";
import { BusinessPanel } from "./ui/BusinessPanel";
import { CellCard } from "./ui/CellCard";
import { Dialogs } from "./ui/Dialogs";
import { PlanPanel } from "./ui/PlanPanel";
import { TopBar } from "./ui/TopBar";
import { useToasts } from "./ui/toast";

export function App() {
  const index = useStore((s) => s.index);
  const error = useStore((s) => s.error);
  const metro = useStore((s) => s.metro);

  useEffect(() => {
    void useStore.getState().boot();
    const onKey = (e: KeyboardEvent) => {
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
      </main>
      {metro && <BusinessPanel />}
      {metro && <PlanPanel />}
      <Dialogs />
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
  const lowUnits = metro.ledger.addresses.units_per_rooftop < 1.2;
  return (
    <div className="legend">
      <span className="legend__item">
        <i className="legend__low" aria-hidden="true" /> Below average
      </span>
      <span className="legend__ramp" title="Darker blue means a better fit for your customer">
        <span>Good fit</span>
        <i style={{ background: rampCss(PALETTES[theme]) }} aria-hidden="true" />
        <span>Best fit</span>
      </span>
      <span className="legend__item legend__muted">Unshaded: under {minHomes} homes</span>
      {lowUnits && (
        <button type="button" className="legend__warn" onClick={() => open("data")}>
          Apartment units not listed here ⓘ
        </button>
      )}
      <span className="segmented segmented--small legend__view" role="radiogroup" aria-label="Map view">
        <button type="button" role="radio" aria-checked={!view3d} onClick={() => setView3d(false)}>
          2D
        </button>
        <button type="button" role="radio" aria-checked={view3d} onClick={() => setView3d(true)} title="Raise each cell by its number of homes">
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
