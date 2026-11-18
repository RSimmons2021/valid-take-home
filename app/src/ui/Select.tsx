import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface Option<T> {
  value: T;
  label: string;
  /** secondary line shown in the menu (and as the option's description to screen readers) */
  detail?: string;
}

interface Props<T> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** accessible name of the control */
  label: string;
  /** "plain" sits in the top bar; "field" is a bordered form control */
  variant?: "plain" | "field";
  disabled?: boolean;
  tip?: string;
  id?: string;
  /** optional custom rendering of the selected value on the trigger */
  renderValue?: (o: Option<T>) => ReactNode;
}

const MENU_GAP = 6;
const MENU_MAX = 320;

/**
 * A themed select. Native <select> menus are drawn by the OS and ignore the app's type,
 * colour and dark mode, so this renders its own listbox.
 *
 * Follows the WAI-ARIA listbox pattern: the trigger is a button with aria-haspopup, the
 * menu is a focusable listbox using aria-activedescendant. Arrow keys, Home/End, type-ahead,
 * Enter/Space to choose, Escape/Tab to close. The menu is portalled to <body> and
 * positioned against the viewport, so scrolling panels can't clip it, and it opens
 * upwards when there is no room below.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  variant = "plain",
  disabled,
  tip,
  id,
  renderValue,
}: Props<T>) {
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (k: number) => `${uid}-opt-${k}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  const choose = (k: number) => {
    const o = options[k];
    if (o && o.value !== value) onChange(o.value);
    close();
  };

  const openMenu = (at = selectedIndex) => {
    if (disabled) return;
    setActive(at);
    setOpen(true);
  };

  // Position against the viewport each time it opens.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(MENU_MAX, options.length * 44 + 16) && r.top > below;
    setPlace({ left: r.left, top: up ? r.top - MENU_GAP : r.bottom + MENU_GAP, width: r.width, up });
  }, [open, options.length]);

  // Move focus into the menu once it exists, so arrow keys and type-ahead go to it.
  useEffect(() => {
    if (open && place) list.current?.focus({ preventScroll: true });
  }, [open, place]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
  });

  // Close on outside press, resize, or scroll of anything but the menu itself.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  const typeAhead = (key: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const from = t.text.length === 1 ? active + 1 : active;
    for (let i = 0; i < options.length; i++) {
      const k = (from + i) % options.length;
      if (options[k].label.toLowerCase().startsWith(t.text.toLowerCase())) return k;
    }
    return -1;
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : selectedIndex);
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const move = (k: number) => {
      e.preventDefault();
      setActive(Math.min(last, Math.max(0, k)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "Enter":
      case " ":
        e.preventDefault();
        return choose(active);
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't also clear the map selection
        return close();
      case "Tab":
        return close(false);
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const k = typeAhead(e.key);
          if (k >= 0) setActive(k);
        }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`select select--${variant}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        data-tip={open ? undefined : tip}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="select__value">{selected ? (renderValue ? renderValue(selected) : selected.label) : ""}</span>
        <svg className="select__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={optId(active)}
            className={`menu${place.up ? " menu--up" : ""}`}
            style={{
              left: place.left,
              top: place.up ? undefined : place.top,
              bottom: place.up ? window.innerHeight - place.top : undefined,
              minWidth: place.width,
              maxHeight: MENU_MAX,
            }}
            onKeyDown={onListKey}
          >
            {options.map((o, k) => (
              <li
                key={String(o.value)}
                id={optId(k)}
                role="option"
                aria-selected={k === selectedIndex}
                data-active={k === active || undefined}
                className="menu__option"
                onPointerMove={() => setActive(k)}
                onClick={() => choose(k)}
              >
                <span className="menu__check" aria-hidden="true">
                  {k === selectedIndex && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <span className="menu__text">
                  <span className="menu__label">{o.label}</span>
                  {o.detail && <span className="menu__detail">{o.detail}</span>}
                </span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
