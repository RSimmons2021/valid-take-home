import { useEffect, useMemo, useRef, useState } from "react";
import { useAi } from "../ai/store";
import { pinName } from "../model/export";
import { RADIUS_OPTIONS_MI } from "../model/plan";
import { PROFILES } from "../model/profiles";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import { copy } from "./format";
import { fuzzyScore } from "./fuzzy";
import { shareLink } from "./share";
import { toast } from "./toast";

interface Command {
  id: string;
  group: "Actions" | "Metros" | "Business" | "Pins" | "Plan";
  label: string;
  hint?: string;
  keys?: string;
  run: () => void | Promise<void>;
}

import { KEYS } from "./shortcuts";

export function undoToast(what: string | null, verb: "Undid" | "Redid") {
  toast(what ? `${verb} ${what} change` : `Nothing to ${verb === "Undid" ? "undo" : "redo"}`);
}

/** ⌘K: every action in the app, by keyboard. ARIA combobox + listbox, grouped results. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const s = useStore();
  const ai = useAi();
  const cycleTheme = useTheme((t) => t.cycle);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) restoreFocus.current = document.activeElement as HTMLElement;
          return !o;
        });
      }
    };
    const onOpen = () => {
      restoreFocus.current = document.activeElement as HTMLElement;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("catchment:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("catchment:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else restoreFocus.current?.focus?.();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [
      { id: "export", group: "Actions", label: "Export plan", hint: "ZIPs, radius pins, lift test, files", keys: KEYS.export, run: () => s.open("export") },
      { id: "results", group: "Actions", label: "Learn from results", hint: "Calibrate weights from campaign data", run: () => s.open("results") },
      { id: "copy", group: "Actions", label: "Copy link to this plan", run: async () => toast((await copy((await shareLink()).url)) ? "Link copied" : "Couldn't copy") },
      { id: "print", group: "Actions", label: "Client one-pager (print or PDF)", keys: KEYS.print, run: () => void window.dispatchEvent(new Event("catchment:print")) },
      { id: "undo", group: "Actions", label: "Undo", keys: KEYS.undo, run: async () => undoToast(await s.undo(), "Undid") },
      { id: "redo", group: "Actions", label: "Redo", keys: KEYS.redo, run: async () => undoToast(await s.redo(), "Redid") },
      { id: "fit", group: "Actions", label: "Fit all pins in view", keys: KEYS.fit, run: () => s.requestFrame() },
      { id: "3d", group: "Actions", label: s.view3d ? "Switch to 2D map" : "Switch to 3D map", keys: KEYS.view3d, run: () => s.setView3d(!s.view3d) },
      ...(s.plan?.pins.length
        ? [
            { id: "next-pin", group: "Actions" as const, label: "Next pin", keys: KEYS.nextPin, run: () => s.focusPin(((s.focusedPin ?? 0) % s.plan!.pins.length) + 1) },
            {
              id: "prev-pin",
              group: "Actions" as const,
              label: "Previous pin",
              keys: KEYS.prevPin,
              run: () => {
                const n = s.plan!.pins.length;
                s.focusPin((((s.focusedPin ?? 1) - 2 + n) % n) + 1);
              },
            },
          ]
        : []),
      { id: "theme", group: "Actions", label: "Change theme", hint: "System → light → dark", run: cycleTheme },
      { id: "data", group: "Actions", label: "About the data", run: () => s.open("data") },
      { id: "guide", group: "Actions", label: "Replay the guided tour", run: () => s.startTour() },
    ];
    if (ai.available) {
      c.push({
        id: "brief",
        group: "Actions",
        label: "Describe your business (AI)",
        run: () => document.getElementById("brief-input")?.focus(),
      });
    }
    for (const m of s.index?.metros ?? []) {
      if (m.id !== s.metroId) c.push({ id: `metro-${m.id}`, group: "Metros", label: `Go to ${m.name}`, hint: m.region, run: () => void s.setMetro(m.id) });
    }
    for (const p of PROFILES) {
      c.push({ id: `profile-${p.id}`, group: "Business", label: `Plan for ${p.label.toLowerCase()}`, hint: p.id === s.profileId ? "current" : undefined, run: () => s.setProfile(p.id) });
    }
    for (const p of s.plan?.pins ?? []) {
      c.push({ id: `pin-${p.rank}`, group: "Pins", label: `Pin ${p.rank}: ${pinName(p.label, p.rank)}`, hint: p.label.zip ?? undefined, run: () => s.focusPin(p.rank) });
    }
    for (const r of RADIUS_OPTIONS_MI) {
      if (r !== s.radiusMi) c.push({ id: `radius-${r}`, group: "Plan", label: `Radius ${r} mi`, run: () => s.setRadius(r) });
    }
    for (const n of [4, 6, 8, 10, 12, 15, 20]) {
      if (n !== s.pins) c.push({ id: `pins-${n}`, group: "Plan", label: `${n} pins`, run: () => s.setPins(n) });
    }
    return c;
  }, [s, ai.available, cycleTheme]);

  const results = useMemo(() => {
    if (!query.trim()) return commands.filter((c) => c.group !== "Plan");
    return commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, `${c.label} ${c.hint ?? ""}`) - 1) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
  }, [commands, query]);

  if (!open) return null;
  const run = async (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    await c.run();
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          placeholder="Search actions, metros, pins…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void run(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <ul className="palette__list" id="palette-list" role="listbox" aria-label="Commands">
          {results.length === 0 && <li className="palette__empty">No matches. Try “export”, “denver” or “pin 2”.</li>}
          {results.map((c, k) => {
            const heading = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {heading && !query && <p className="palette__group">{heading}</p>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={k === active}
                  className="palette__item"
                  onMouseMove={() => setActive(k)}
                  onClick={() => void run(c)}
                >
                  <span className="palette__label">{c.label}</span>
                  {c.hint && <span className="palette__hint">{c.hint}</span>}
                  {c.keys && <kbd>{c.keys}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="palette__foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>↵</kbd> run · <kbd>esc</kbd> close
        </p>
      </div>
    </div>
  );
}
