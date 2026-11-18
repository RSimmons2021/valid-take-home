import { type ReactNode, useEffect, useState } from "react";

/**
 * Progress for a wait we can't measure (an AI call): the stages the server really goes
 * through, the real elapsed time, and the shape of the answer that's coming.
 *
 * Stages advance on an estimate, but the last one never "finishes" by timer: it stays
 * active until the answer arrives and this unmounts, so the UI never claims to be done
 * before it is. Past ~1.6× the estimate it says so plainly instead of pretending.
 * Screen readers hear each stage once (polite), not the ticking seconds.
 */
export function StagedProgress({ steps, estimateMs, children }: { steps: string[]; estimateMs: number; children?: ReactNode }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), 250);
    return () => window.clearInterval(id);
  }, []);

  const share = estimateMs / steps.length;
  const active = Math.min(steps.length - 1, Math.floor(elapsed / share));
  const slow = elapsed > estimateMs * 1.6;
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="progress" aria-busy="true">
      <div className="progress__track" aria-hidden="true">
        <i />
      </div>
      <ol className="progress__steps">
        {steps.map((s, k) => {
          const state = k < active ? "done" : k === active ? "active" : "todo";
          return (
            <li key={s} className={`progress__step progress__step--${state}`}>
              <span className="progress__mark" aria-hidden="true">
                {state === "done" && (
                  <svg viewBox="0 0 12 12" width="12" height="12">
                    <path d="M2.5 6.3 5 8.6l4.6-5" />
                  </svg>
                )}
              </span>
              {s}
            </li>
          );
        })}
      </ol>
      <p className="progress__meta">
        <span className="tabular">{seconds} s</span>
        {slow && <span> · taking longer than usual, still working</span>}
      </p>
      <p className="sr-only" role="status">
        {steps[active]}
        {slow ? ". Taking longer than usual." : ""}
      </p>
      {children && (
        <div className="progress__preview" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  );
}

/** A grey stand-in line for text that's on its way. */
export function Bone({ w = "100%", h = 10 }: { w?: string; h?: number }) {
  return <i className="bone" style={{ width: w, height: h }} />;
}

/** Share loaded and a label, from the store's metro-loading state. */
export function loadLabel(progress: number | "build" | null, bytes?: number, cells?: number) {
  if (progress === "build") return cells ? `Building ${cells.toLocaleString("en-US")} blocks…` : "Building blocks…";
  const p = progress ?? 0;
  if (!bytes) return `${Math.round(p * 100)}%`;
  const mb = (b: number) => (b / 1e6).toFixed(1);
  return `${mb(p * bytes)} of ${mb(bytes)} MB`;
}

/**
 * A thin bar under the top bar while a metro loads. It measures real bytes, holds full
 * while blocks are built, and only appears after 150 ms, so a cached switch never flashes.
 */
export function LoadBar({ progress }: { progress: number | "build" | null }) {
  if (progress === null) return null;
  const p = progress === "build" ? 1 : progress;
  return (
    <div className="loadbar" aria-hidden="true">
      <i style={{ transform: `scaleX(${Math.max(0.04, p)})` }} />
    </div>
  );
}
