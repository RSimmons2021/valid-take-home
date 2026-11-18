import { useStore } from "../state/store";
import { copy } from "./format";
import { toast } from "./toast";

export function TopBar() {
  const index = useStore((s) => s.index);
  const metroId = useStore((s) => s.metroId);
  const setMetro = useStore((s) => s.setMetro);
  const open = useStore((s) => s.open);
  const loading = useStore((s) => s.loading);
  const plan = useStore((s) => s.plan);

  return (
    <header className="top">
      <a className="mark" href="./" aria-label="Catchment, home">
        <Glyph />
        <span>Catchment</span>
      </a>
      <span className="top__sep" aria-hidden="true">
        /
      </span>
      <label className="metro-select">
        <span className="sr-only">Metro</span>
        <select value={metroId} onChange={(e) => void setMetro(e.target.value)} disabled={!index}>
          {index?.metros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </label>
      {loading && (
        <span className="top__status" role="status">
          <i className="spinner" aria-hidden="true" /> Loading {loading}…
        </span>
      )}
      <nav className="top__actions" aria-label="Plan actions">
        <button type="button" className="btn btn--ghost" onClick={() => open("data")}>
          About the data
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={async () => toast((await copy(location.href)) ? "Link copied. It rebuilds this exact plan." : "Couldn't copy. Use the address bar.")}
        >
          Copy link
        </button>
        <button type="button" className="btn btn--primary" onClick={() => open("export")} disabled={!plan?.pins.length}>
          Export plan <span aria-hidden="true">↓</span>
        </button>
      </nav>
    </header>
  );
}

export function Glyph({ size = 18 }: { size?: number }) {
  // a hex cell inside a radius ring
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="glyph">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.2" />
      <path d="M12 6.2 17 9.1v5.8L12 17.8 7 14.9V9.1z" fill="var(--blue)" />
    </svg>
  );
}
