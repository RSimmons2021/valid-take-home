import { usageLine } from "../ai/client";
import { currentBusiness, pinKey, useAi } from "../ai/store";
import { pinName } from "../model/export";
import { useStore } from "../state/store";
import { compact, copy, pct } from "./format";
import { toast } from "./toast";

/**
 * One pin, opened from the plan list or its marker: its reach, and local ad angles written
 * from the real places inside it. Shares the cell card's slot; the two are exclusive.
 */
export function PinCard() {
  const plan = useStore((s) => s.plan);
  const focusedPin = useStore((s) => s.focusedPin);
  const focusPin = useStore((s) => s.focusPin);
  useStore((s) => s.weights); // re-render when targeting changes: angles are keyed on it
  const ai = useAi();

  const pin = plan?.pins.find((p) => p.rank === focusedPin);
  if (!pin) return null;
  const on = pin.homes ? pin.onTargetHomes / pin.homes : 0;
  const entry = ai.angles[pinKey(pin)];
  const data = entry?.data;
  const loading = entry?.status === "loading";
  const business = currentBusiness();

  return (
    <aside className="card card--pin" aria-labelledby="pin-title">
      <button type="button" className="card__close" aria-label="Close" data-tip="Close (Esc)" onClick={() => focusPin(null)}>
        ×
      </button>
      <p className="eyebrow">
        Pin {pin.rank} · {pin.radiusMi} mi radius{pin.label.zip && <span className="muted"> · {pin.label.zip}</span>}
      </p>
      <h3 id="pin-title" className="pincard__title">
        {pinName(pin.label, pin.rank)}
      </h3>
      <dl className="facts">
        <div>
          <dt data-tip="Homes newly reached by this pin (not counted by a better pin)">Homes</dt>
          <dd>{compact(pin.homes)}</dd>
        </div>
        <div>
          <dt data-tip="Share of those homes in blocks scoring 50 or more">On target</dt>
          <dd>{pct(on)}</dd>
        </div>
        <div>
          <dt data-tip="Average fit score inside this pin, weighted by homes">Fit</dt>
          <dd>{Number.isNaN(pin.meanScore) ? "–" : Math.round(pin.meanScore)}</dd>
        </div>
        <div>
          <dt data-tip="Rank in the plan: earlier pins add more well-matched homes">Rank</dt>
          <dd>#{pin.rank}</dd>
        </div>
      </dl>

      {ai.available && (
        <section className="angles" aria-labelledby="angles-title">
          <div className="angles__head">
            <p className="eyebrow" id="angles-title">
              <span className="ai-mark" aria-hidden="true">
                ✦
              </span>{" "}
              Local ad angles
            </p>
            {data && !loading && (
              <button type="button" className="link" onClick={() => void ai.requestAngles(pin, true)} data-tip="Write a fresh set">
                Regenerate
              </button>
            )}
          </div>

          {!data && !loading && entry?.status !== "error" && (
            <div className="angles__empty">
              <p>
                Hooks for <b>{business.name.toLowerCase()}</b> ads in this pin, written only from real places inside it.
              </p>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => void ai.requestAngles(pin)}>
                Write 3 angles
              </button>
            </div>
          )}

          {loading && (
            <div className="brief__loading" role="status">
              <i className="shimmer" />
              <i className="shimmer shimmer--short" />
              <span>Finding local places and checking every claim… about 6 s</span>
            </div>
          )}

          {entry?.status === "error" && (
            <p className="notice" role="alert">
              {entry.error}{" "}
              <button type="button" className="link" onClick={() => void ai.requestAngles(pin, true)}>
                Try again
              </button>
            </p>
          )}

          {data && !loading && (
            <>
              <ol className="angles__list">
                {data.angles.map((a) => (
                  <li key={a.headline} className="angle">
                    <span className="angle__type">{a.angle}</span>
                    <p className="angle__headline">{a.headline}</p>
                    <p className="angle__body">{a.body}</p>
                    <div className="angle__foot">
                      <span className="angle__cites">
                        {a.cites.map((c) => (
                          <span key={c.id} className="placechip" data-tip={`${c.kind} · Overture GERS ${c.id.slice(0, 8)}… · verified inside this pin`}>
                            {c.name}
                          </span>
                        ))}
                      </span>
                      <button
                        type="button"
                        className="link"
                        onClick={async () => toast((await copy(`${a.headline}\n${a.body}`)) ? "Angle copied" : "Couldn't copy")}
                      >
                        Copy
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="ai-meta">
                Grounded in {data.grounded} places inside this pin
                {data.rejected.length > 0 && (
                  <span data-tip={`Dropped: ${data.rejected.join("; ")}`}>
                    {" "}
                    · {data.rejected.length} draft{data.rejected.length > 1 ? "s" : ""} rejected
                  </span>
                )}{" "}
                · {usageLine(data.usage, data.cached)}
              </p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
