import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { type Pt, type Rect, arrow, edgeToward, scribble } from "./sketch";
import { type Side, activeSteps } from "./steps";

const GAP = 110; // distance between target and note, room for the arrow
const MARGIN = 14; // keep notes inside the viewport

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function placeNote(target: Rect, note: { w: number; h: number }, side: Side, vw: number, vh: number): Pt {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  let p: Pt;
  switch (side) {
    case "right":
      p = { x: target.x + target.w + GAP, y: cy - note.h / 2 - 30 };
      break;
    case "left":
      p = { x: target.x - GAP - note.w, y: cy - note.h / 2 - 30 };
      break;
    case "top":
      p = { x: cx - note.w / 2 + 60, y: target.y - GAP - note.h };
      break;
    case "bottom":
      p = { x: cx - note.w / 2 + 40, y: target.y + target.h + GAP };
      break;
  }
  return {
    x: Math.min(vw - note.w - MARGIN, Math.max(MARGIN, p.x)),
    y: Math.min(vh - note.h - MARGIN, Math.max(MARGIN + 56, p.y)),
  };
}

/** Where the arrow leaves the note: the middle of the edge that faces the target. */
function noteAnchor(note: Rect, target: Rect): Pt {
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h / 2;
  if (tx > note.x + note.w) return { x: note.x + note.w + 4, y: note.y + note.h * 0.45 };
  if (tx < note.x) return { x: note.x - 4, y: note.y + note.h * 0.45 };
  if (ty < note.y) return { x: note.x + note.w * 0.4, y: note.y - 4 };
  return { x: note.x + note.w * 0.4, y: note.y + note.h + 4 };
}

/**
 * The guided tour: a handwritten note per step, with an arrow and a scribbled loop that
 * draw themselves onto the real control being explained, and a soft spotlight around it.
 * It points at the live interface rather than at screenshots, so it can't go stale.
 */
export function Tour() {
  const step = useStore((s) => s.tour);
  const setStep = useStore((s) => s.setTourStep);
  const endTour = useStore((s) => s.endTour);
  const noteRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<Rect | null>(null);
  const [mark, setMark] = useState<Rect | null>(null);
  const [noteSize, setNoteSize] = useState({ w: 300, h: 160 });
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Fixed for the tour's duration, so step numbers don't shift mid-tour.
  const steps = useMemo(() => (step == null ? [] : activeSteps()), [step == null]);
  const def = step == null ? null : (steps[step] ?? null);
  const narrow = viewport.w <= 900;

  const measure = useCallback(() => {
    if (!def) return;
    const el = document.querySelector(def.target);
    const markEl = def.mark ? document.querySelector(def.mark) : el;
    setTarget(el ? rectOf(el) : null);
    setMark(markEl ? rectOf(markEl) : null);
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    if (noteRef.current) setNoteSize({ w: noteRef.current.offsetWidth, h: noteRef.current.offsetHeight });
  }, [def]);

  // Enter a step: set up the app state it describes, then measure once things have moved
  // (the cell card animates in and the map pans, so measure again after they settle).
  useLayoutEffect(() => {
    if (!def) return;
    def.before?.();
    const el = document.querySelector(def.target);
    if (narrow) el?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const timers = [80, 420, 900].map((ms) => window.setTimeout(measure, ms));
    nextRef.current?.focus({ preventScroll: true });
    return () => timers.forEach(clearTimeout);
  }, [def, measure, narrow]);

  useEffect(() => {
    if (step == null) return;
    const onResize = () => measure();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") {
        if (step < steps.length - 1) setStep(step + 1);
        else endTour();
      }
      else if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [step, measure, endTour, setStep]);

  if (step == null || !def) return null;

  const side: Side = narrow ? (target && target.y > viewport.h / 2 ? "top" : "bottom") : def.side;
  const pos = target ? placeNote(target, noteSize, side, viewport.w, viewport.h) : { x: viewport.w / 2 - noteSize.w / 2, y: viewport.h / 3 };
  const note: Rect = { x: pos.x, y: pos.y, w: noteSize.w, h: noteSize.h };

  let marks: { loop: string; shaft: string[]; head: string } | null = null;
  if (target && mark) {
    const from = noteAnchor(note, mark);
    const to = edgeToward(mark, from, 18);
    const a = arrow(from, to, step * 7 + 3);
    marks = { loop: scribble(mark, step * 13 + 5, mark.h < 60 ? 10 : 6), shaft: a.shaft, head: a.head };
  }
  const last = step === steps.length - 1;
  const hole = target ? { x: target.x - 10, y: target.y - 10, w: target.w + 20, h: target.h + 20 } : null;

  return (
    <div className="tour" aria-live="polite">
      <svg className="tour__ink" width={viewport.w} height={viewport.h} aria-hidden="true">
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect className="tour__hole" x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="16" fill="black" />}
          </mask>
        </defs>
        <rect className="tour__dim" width="100%" height="100%" mask="url(#tour-hole)" />
        {marks && (
          <g key={step} className="tour__marks">
            <path className="sketch sketch--loop" d={marks.loop} pathLength={1} />
            <path className="sketch sketch--shaft" d={marks.shaft[0]} pathLength={1} />
            <path className="sketch sketch--shaft sketch--ghost" d={marks.shaft[1]} pathLength={1} />
            <path className="sketch sketch--head" d={marks.head} pathLength={1} />
          </g>
        )}
      </svg>

      <div
        key={`note-${step}`}
        ref={noteRef}
        className="tour__note"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) rotate(${step % 2 ? 1.2 : -1.2}deg)` }}
      >
        <p className="tour__count">
          {step + 1} <span>of {steps.length}</span>
        </p>
        <h2 id="tour-title" className="tour__title">
          {def.title}
        </h2>
        <p className="tour__body">{def.body}</p>
        <div className="tour__actions">
          <button type="button" className="link tour__skip" onClick={endTour}>
            {last ? "" : "Skip tour"}
          </button>
          <span className="tour__nav">
            {step > 0 && (
              <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className="btn btn--primary" onClick={() => (last ? endTour() : setStep(step + 1))}>
              {last ? "Start planning" : "Next"} <span aria-hidden="true">→</span>
            </button>
          </span>
        </div>
        <ol className="tour__dots" aria-hidden="true">
          {steps.map((_, k) => (
            <li key={k} data-on={k === step || undefined} />
          ))}
        </ol>
      </div>
    </div>
  );
}
