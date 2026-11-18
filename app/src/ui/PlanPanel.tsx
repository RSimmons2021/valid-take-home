import { MAX_PINS, RADIUS_OPTIONS_MI } from "../model/plan";
import { pinName } from "../model/export";
import { useStore } from "../state/store";
import { compact, int, pct } from "./format";

export function PlanPanel() {
  const metro = useStore((s) => s.metro);
  const plan = useStore((s) => s.plan);
  const pins = useStore((s) => s.pins);
  const radiusMi = useStore((s) => s.radiusMi);
  const focusedPin = useStore((s) => s.focusedPin);
  const { setPins, setRadius, focusPin, open, requestFrame } = useStore.getState();

  const onShare = plan && plan.homes ? plan.onTargetHomes / plan.homes : 0;

  return (
    <section className="panel panel--right" aria-labelledby="plan-title">
      <div className="panel__scroll">
        <p className="eyebrow">
          <b>03</b> Plan
        </p>
        <h2 id="plan-title">Where to spend</h2>

        <div className="controls">
          <div className="control">
            <span className="control__label" id="pins-label">
              Pins
            </span>
            <div className="stepper" role="group" aria-labelledby="pins-label">
              <button type="button" aria-label="Fewer pins" data-tip="Fewer pins" onClick={() => setPins(Math.max(1, pins - 1))} disabled={pins <= 1}>
                −
              </button>
              <output aria-live="polite">{pins}</output>
              <button
                type="button"
                aria-label="More pins"
                data-tip="More pins"
                onClick={() => setPins(Math.min(MAX_PINS, pins + 1))}
                disabled={pins >= MAX_PINS}
              >
                +
              </button>
            </div>
          </div>
          <div className="control">
            <span className="control__label" id="radius-label">
              Radius
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="radius-label">
              {RADIUS_OPTIONS_MI.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={r === radiusMi}
                  onClick={() => setRadius(r)}
                  data-tip={r === 1 ? "1 mile: the smallest radius Meta allows" : `Each pin covers a ${r}-mile radius`}
                >
                  {r}
                  <small> mi</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        {plan && metro && (
          <>
            <dl className="stats">
              <div className="stat stat--lead">
                <dt data-tip="Addresses inside the pins, with apartment units counted where the county lists them">Homes reached</dt>
                <dd>{compact(plan.homes)}</dd>
              </div>
              <div className="stat">
                <dt data-tip="Share of reached homes in cells scoring 50 or more. The rest is spill you'd pay for anyway.">On target</dt>
                <dd>{pct(onShare)}</dd>
              </div>
              <div className="stat">
                <dt data-tip={`How many of the ${int(plan.metroOnTargetHomes)} well-matched homes in ${metro.info.name} these pins reach`}>
                  Captured
                </dt>
                <dd>{pct(plan.capture)}</dd>
              </div>
            </dl>
            <div className="bar" aria-hidden="true">
              <i style={{ width: pct(onShare) }} />
            </div>
            <p className="hint">
              {pct(onShare)} of the homes these pins reach are in cells that fit. Radius pins start at 1 mile, the smallest Meta allows.
            </p>

            {plan.pins.length < pins && (
              <p className="notice">
                Only {plan.pins.length} pin{plan.pins.length === 1 ? "" : "s"} add new on-target homes. More would only re-reach the same
                cells.
              </p>
            )}

            <div className="panel__head">
              <p className="eyebrow">Pins, best first</p>
              <button type="button" className="link" onClick={requestFrame} data-tip="Zoom out to show every pin">
                Fit all
              </button>
            </div>
            <ol className="pins">
              {plan.pins.map((p) => {
                const on = p.homes ? p.onTargetHomes / p.homes : 0;
                return (
                  <li key={p.rank}>
                    <button
                      type="button"
                      className="pinrow"
                      aria-pressed={focusedPin === p.rank}
                      onClick={() => focusPin(focusedPin === p.rank ? null : p.rank)}
                    >
                      <span className="pinrow__rank">{p.rank}</span>
                      <span className="pinrow__main">
                        <span className="pinrow__name">{pinName(p.label, p.rank)}</span>
                        <span className="pinrow__meta">
                          {p.label.zip ?? "no ZIP"} · {compact(p.homes)} homes · {pct(on)} on target
                        </span>
                      </span>
                      <span className="pinrow__score" data-tip="Average fit score inside this pin, weighted by homes">
                        {Number.isNaN(p.meanScore) ? "–" : Math.round(p.meanScore)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {plan.pins.length === 0 && (
              <p className="empty">Nothing scores above the median with these weights. Loosen a weight or lower the homes floor.</p>
            )}
          </>
        )}
      </div>
      <div className="panel__foot">
        <button type="button" className="btn btn--primary btn--block" onClick={() => open("export")} disabled={!plan?.pins.length}>
          Export to Meta &amp; Google <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--block panel__secondary"
          onClick={() => open("results")}
          disabled={!plan?.pins.length}
          data-tip="Ran this plan? Bring conversions by ZIP and see which weights would have ranked them better"
        >
          Learn from results
        </button>
      </div>
    </section>
  );
}
