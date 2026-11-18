import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => 1 - (1 - t) ** 3;
/** The CSS tokens, for WAAPI (which can't read custom properties). */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

/**
 * A number that rolls to its new value instead of snapping, so a change reads as a change.
 * Tabular figures keep the width steady; reduced motion shows the final value at once.
 */
export function AnimatedNumber({ value, format, ms = 450 }: { value: number; format: (v: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || !Number.isFinite(value) || !Number.isFinite(from.current)) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = a + (value - a) * ease(t);
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className="tabular">{format(shown)}</span>;
}

/**
 * FLIP reordering: children with `data-flip-key` glide from their old position to their
 * new one when the list re-sorts, so you can follow a pin as it moves up or down. With
 * `enter`, keys that weren't there before fade up into place (never on first render), so
 * rows that appear don't just pop in while their neighbours glide.
 */
export function useFlip(container: RefObject<HTMLElement | null>, deps: unknown[], { enter = false } = {}) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>("[data-flip-key]")];
    const next = new Map<string, number>();
    for (const item of items) {
      const key = item.dataset.flipKey!;
      const top = item.getBoundingClientRect().top;
      next.set(key, top);
      const before = last.current.get(key);
      if (reduced()) continue;
      if (before === undefined) {
        if (enter && last.current.size > 0) {
          item.animate(
            [
              { opacity: 0, transform: "translateY(4px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 220, easing: EASE_OUT, delay: 60 },
          );
        }
        continue;
      }
      const dy = before - top;
      if (Math.abs(dy) < 1) continue;
      // --ease-in-out: the row is moving on screen, not arriving
      item.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 280, easing: EASE_IN_OUT });
    }
    last.current = next;
  }, deps);
}

/**
 * Height that follows its content smoothly. When what's inside grows or shrinks (a tab
 * swaps, examples collapse, a suggestion arrives), the box eases to the new height instead
 * of shoving everything below it in one frame.
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    let last = i.offsetHeight;
    let running: Animation | null = null;
    const ro = new ResizeObserver(() => {
      const next = i.offsetHeight;
      // mid-animation, start from where the box visibly is, not where it was headed
      const from = running ? o.getBoundingClientRect().height : last;
      last = next;
      if (Math.abs(from - next) < 1 || reduced()) return;
      running?.cancel();
      o.style.overflow = "hidden";
      running = o.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: 240, easing: EASE_OUT });
      running.onfinish = () => {
        o.style.overflow = "";
        running = null;
      };
    });
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className={className}>
      <div ref={inner} className="autoheight__inner">
        {children}
      </div>
    </div>
  );
}

/**
 * Content that's swapped out (another tab, cell or pin) fades in, sliding a few pixels in
 * the direction of travel when there is one. The first render doesn't animate: the
 * container's own entrance already covers it.
 */
export function Swap({
  k,
  dir = 0,
  children,
  className = "",
}: {
  k: string | number;
  dir?: number;
  children: ReactNode;
  className?: string;
}) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  // The direction belongs to the swap that happened, not to later re-renders: if it changed
  // while the content stayed, the animation name would change and replay the entrance.
  const settled = useRef({ k, dir });
  if (settled.current.k !== k) settled.current = { k, dir };
  const d = settled.current.dir;
  return (
    <div
      key={k}
      className={`${className} ${mounted.current ? "swap" : ""}`.trim()}
      data-dir={d > 0 ? "next" : d < 0 ? "prev" : undefined}
    >
      {children}
    </div>
  );
}

/**
 * A selection indicator that slides between options (a tab's underline, a segmented
 * control's thumb). It writes the chosen option's box to CSS variables on the container;
 * the first placement and any resize are instant, so it never slides in from nowhere.
 */
export function useIndicator(container: RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const place = (el: HTMLElement) => {
    const on = el.querySelector<HTMLElement>(selector);
    if (!on) return el.style.setProperty("--ind-o", "0");
    el.style.setProperty("--ind-x", `${on.offsetLeft}px`);
    el.style.setProperty("--ind-w", `${on.offsetWidth}px`);
    el.style.setProperty("--ind-o", "1");
  };
  // Selection changed: slide (transitions are live after the first placement).
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    place(el);
    if (!el.dataset.ind) requestAnimationFrame(() => (el.dataset.ind = "live"));
  }, deps);
  // Layout changed (fonts loading, a resize): jump, don't slide.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      delete el.dataset.ind;
      place(el);
      requestAnimationFrame(() => (el.dataset.ind = "live"));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
}

/** Drop-in indicator: place inside a segmented control or tab list as its first child. */
export function Indicator({
  value,
  selector = '[aria-checked="true"]',
  className = "segmented__thumb",
}: {
  value: unknown;
  selector?: string;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const parent = useRef<{ readonly current: HTMLElement | null }>({
    get current() {
      return ref.current?.parentElement ?? null;
    },
  }).current;
  useIndicator(parent, selector, [value]);
  return <i ref={ref} className={className} aria-hidden="true" />;
}
