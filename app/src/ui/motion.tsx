import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => 1 - (1 - t) ** 3;

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
 * new one when the list re-sorts, so you can follow a pin as it moves up or down.
 */
export function useFlip(container: RefObject<HTMLElement | null>, deps: unknown[]) {
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
      if (before === undefined || reduced()) continue;
      const dy = before - top;
      if (Math.abs(dy) < 1) continue;
      // --ease-in-out: the row is moving on screen, not arriving
      item.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 280, easing: "cubic-bezier(0.77, 0, 0.175, 1)" });
    }
    last.current = next;
  }, deps);
}
