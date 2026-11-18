import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY = 800; // ms of resting on an element before its tooltip appears
const WARM_DELAY = 250; // a shorter wait when moving straight from one tooltip to the next
const WARM_WINDOW = 400; // how soon after a tooltip closes the next one counts as "straight from"
const TIP_ID = "app-tooltip";

interface Shown {
  el: HTMLElement;
  text: string;
}

/**
 * One tooltip for the whole app, driven by `data-tip` attributes.
 *
 * Any element with `data-tip="…"` gets a themed tooltip once the pointer rests on it
 * and immediately on keyboard focus. While it shows, the element points at it with
 * aria-describedby, so screen readers announce the same text. Delegating from the
 * document means components only declare text, with no wrapper elements and no
 * per-tooltip state. Escape, scrolling, pressing or leaving hides it.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let lastHidden = 0;
    let current: HTMLElement | null = null;
    let keyboard = false;

    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      current = el;
      const prev = el.getAttribute("aria-describedby");
      if (!prev?.includes(TIP_ID)) {
        el.dataset.tipPrevDescribedby = prev ?? "";
        el.setAttribute("aria-describedby", prev ? `${prev} ${TIP_ID}` : TIP_ID);
      }
      setShown({ el, text });
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (current) {
        const prev = current.dataset.tipPrevDescribedby;
        if (prev) current.setAttribute("aria-describedby", prev);
        else current.removeAttribute("aria-describedby");
        delete current.dataset.tipPrevDescribedby;
        current = null;
        lastHidden = Date.now();
      }
      setShown(null);
    };
    const tipTarget = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-tip]") as HTMLElement | null) : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // touch has no hover; tips stay out of the way
      const el = tipTarget(e.target);
      if (el === current) return;
      hide();
      if (!el) return;
      const warm = Date.now() - lastHidden < WARM_WINDOW;
      timer = window.setTimeout(() => show(el), warm ? WARM_DELAY : SHOW_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const to = tipTarget(e.relatedTarget);
      if (to !== current) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keyboard = true;
      if (e.key === "Escape" && current) hide();
    };
    const onPointerDown = () => {
      keyboard = false;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!keyboard) return; // only keyboard focus shows a tip; clicks shouldn't
      const el = tipTarget(e.target);
      if (el) show(el);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Place above the element, or below when there's no room; keep inside the viewport.
  useLayoutEffect(() => {
    if (!shown || !tipRef.current) {
      setPos(null);
      return;
    }
    const r = shown.el.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const below = r.top - t.height - 10 < 8;
    const x = Math.min(window.innerWidth - t.width / 2 - 8, Math.max(t.width / 2 + 8, r.left + r.width / 2));
    setPos({ x, y: below ? r.bottom + 9 : r.top - 9, below });
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={tipRef}
      id={TIP_ID}
      role="tooltip"
      className={`tooltip${pos?.below ? " tooltip--below" : ""}`}
      style={{
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {shown.text}
    </div>,
    document.body,
  );
}
