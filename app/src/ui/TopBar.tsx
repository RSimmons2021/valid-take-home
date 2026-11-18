import { useEffect, useRef, useState } from "react";
import { KEYS } from "./shortcuts";
import { useStore } from "../state/store";
import { type ThemePref, useTheme } from "../state/theme";
import { Select } from "./Select";
import { compact, copy } from "./format";
import { shareLink } from "./share";
import { toast } from "./toast";

export function TopBar() {
  const index = useStore((s) => s.index);
  const metroId = useStore((s) => s.metroId);
  const setMetro = useStore((s) => s.setMetro);
  const open = useStore((s) => s.open);
  const loading = useStore((s) => s.loading);
  const loadProgress = useStore((s) => s.loadProgress);
  const plan = useStore((s) => s.plan);
  const release = useStore((s) => s.metro?.release);
  const startTour = useStore((s) => s.startTour);

  return (
    <header className="top">
      <a className="mark" href="./" aria-label="Catchment, home">
        <Glyph />
        <span>Catchment</span>
      </a>
      <span className="top__sep" aria-hidden="true">
        /
      </span>
      <Select
        label="Metro"
        value={metroId}
        disabled={!index}
        tip="Switch city. Each one is a separate Overture extract."
        options={(index?.metros ?? []).map((m) => ({
          value: m.id,
          label: m.name,
          detail: `${m.region} · ${compact(m.homes)} homes · ${compact(m.places_kept)} places`,
        }))}
        onChange={(id) => void setMetro(id)}
      />
      {release && !loading && (
        <span className="top__release" data-tip="Every number on this page comes from this Overture Maps release">
          <i className="live" aria-hidden="true" /> Overture {release}
        </span>
      )}
      {loading && (
        <span className="top__status" role="status">
          <i className="spinner" aria-hidden="true" /> {loading}
          <span className="top__pct tabular">{loadProgress === "build" ? "building" : `${Math.round((loadProgress ?? 0) * 100)}%`}</span>
        </span>
      )}
      <nav className="top__actions" aria-label="Plan actions">
        <button
          type="button"
          className="btn btn--ghost top__search"
          onClick={() => window.dispatchEvent(new Event("catchment:palette"))}
          data-tip="Every action, metro and pin, by keyboard"
        >
          Search <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <button
          type="button"
          className="btn btn--ghost top__guide"
          onClick={startTour}
          disabled={!release}
          data-tip="Replay the guided tour"
        >
          <span className="top__guide-mark" aria-hidden="true">
            ?
          </span>
          Guide
        </button>
        <ThemeToggle />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => open("data")}
          data-tip="What was cleaned, what's covered, and how scores work"
        >
          About the data
        </button>
        <CopyLinkButton />
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => open("export")}
          disabled={!plan?.pins.length}
          data-tip="ZIP lists and radius pins for Meta and Google Ads"
          data-keys={KEYS.export}
        >
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

const THEME_LABEL: Record<ThemePref, string> = { system: "Theme: match system", light: "Theme: light", dark: "Theme: dark" };

function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const cycle = useTheme((s) => s.cycle);
  return (
    <button
      type="button"
      className="iconbtn"
      onClick={cycle}
      aria-label={`${THEME_LABEL[pref]}. Click to change.`}
      data-tip={`${THEME_LABEL[pref]} · click to change`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        {pref === "light" && (
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
          </g>
        )}
        {pref === "dark" && <path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" fill="currentColor" />}
        {pref === "system" && (
          <g>
            <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
          </g>
        )}
      </svg>
    </button>
  );
}

type CopyState = "idle" | "busy" | "done";

/**
 * Copy link answers where you clicked: "Copying…" while the plan's map snapshot uploads
 * for the preview card, then "Copied" with a check for a moment. All three labels share
 * one grid cell, so the button never changes width. Only a failure needs a toast.
 */
function CopyLinkButton() {
  const [state, setState] = useState<CopyState>("idle");
  const reset = useRef(0);
  useEffect(() => () => window.clearTimeout(reset.current), []);
  const run = async () => {
    if (state === "busy") return;
    window.clearTimeout(reset.current);
    setState("busy");
    const { url } = await shareLink();
    const ok = await copy(url);
    if (!ok) {
      setState("idle");
      toast("Couldn't copy. Use the address bar.");
      return;
    }
    setState("done");
    reset.current = window.setTimeout(() => setState("idle"), 1800);
  };
  return (
    <>
      <button
        type="button"
        className={`btn btn--ghost copylink copylink--${state}`}
        aria-label="Copy link"
        aria-busy={state === "busy" || undefined}
        data-tip="The link rebuilds this exact plan for whoever opens it, and shows a preview card in Slack or iMessage"
        onClick={() => void run()}
      >
        <span className="copylink__label copylink__label--idle" aria-hidden="true">
          Copy link
        </span>
        <span className="copylink__label copylink__label--busy" aria-hidden="true">
          <i className="spinner" aria-hidden="true" /> Copying…
        </span>
        <span className="copylink__label copylink__label--done" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2.5 6.3 5 8.6l4.6-5" />
          </svg>
          Copied
        </span>
      </button>
      <span className="sr-only" role="status">
        {state === "done" ? "Link copied" : ""}
      </span>
    </>
  );
}
