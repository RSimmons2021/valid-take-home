import { useMemo } from "react";
import { cellLabel, placesNear } from "../data/metro";
import { WEIGHT_LABEL, type Weight } from "../model/factors";
import { explain, verdict } from "../model/score";
import { useStore } from "../state/store";
import { copy, int } from "./format";
import { toast } from "./toast";

/** Verdict-first reading of one cell: how good, where, why, and the named places behind it. */
export function CellCard() {
  const metro = useStore((s) => s.metro);
  const result = useStore((s) => s.result);
  const selected = useStore((s) => s.selected);
  const plan = useStore((s) => s.plan);
  const select = useStore((s) => s.select);

  const data = useMemo(() => {
    if (!metro || !result || selected == null) return null;
    const why = explain(metro, result, selected);
    const near = placesNear(metro, selected);
    return { why, near, label: cellLabel(metro, selected) };
  }, [metro, result, selected]);

  if (!metro || !result || selected == null || !data) return null;
  const i = selected;
  const score = result.score[i];
  const v = verdict(score);
  const { label, why, near } = data;
  const pin = plan?.pins.find((p) => p.covered.includes(i));
  const height = metro.height[i];
  const maxPush = Math.max(0.5, ...why.map((c) => Math.abs(c.push)));
  const activeSignals = new Map(result.active.map((a) => [a.factor.id, a.weight]));

  return (
    <aside className="card" aria-labelledby="card-title">
      <button type="button" className="card__close" aria-label="Close" data-tip="Close (Esc)" onClick={() => select(null)}>
        ×
      </button>
      <p className="eyebrow">
        {[label.hood, label.city].filter((x, k, a) => x && a.indexOf(x) === k).join(" · ") || "Unnamed area"}
        {label.zip && <span className="muted"> · {label.zip}</span>}
      </p>
      <div className="card__verdict">
        <h3 id="card-title" data-verdict={v}>
          {v}
        </h3>
        {!Number.isNaN(score) && (
          <span className="card__score">
            {Math.round(score)}
            <small>/100</small>
          </span>
        )}
      </div>
      <p className="card__sub">
        {Number.isNaN(score)
          ? `Fewer homes than the floor you set, so it isn't scored.`
          : `Better than ${Math.round(score)}% of scored cells in ${metro.info.name}.`}
        {pin ? ` Inside pin ${pin.rank}.` : score >= 50 ? " Not inside a pin yet." : ""}
      </p>

      <dl className="facts">
        <div>
          <dt data-tip="Address points in this block; apartment units count separately where listed">Homes</dt>
          <dd>{int(metro.homes[i])}</dd>
        </div>
        <div>
          <dt data-tip="Share of rooftops with a single address and no units: houses, not apartment blocks">Detached</dt>
          <dd>{metro.rooftops[i] >= 5 ? `${Math.round(metro.single[i] * 100)}%` : "–"}</dd>
        </div>
        <div>
          <dt data-tip="Building footprints in this block, from Overture buildings">Buildings</dt>
          <dd>{int(metro.buildings[i])}</dd>
        </div>
        <div>
          <dt data-tip="Median building height in this block">Typical height</dt>
          <dd>{Number.isNaN(height) ? "–" : `${Math.round(height)} m`}</dd>
        </div>
      </dl>

      {why.length > 0 && !Number.isNaN(score) && (
        <>
          <p className="eyebrow card__section">Why</p>
          <ul className="why">
            {why.map((c) => (
              <li key={c.factor.id}>
                <span className="why__label">
                  {c.factor.label}
                  <small>
                    {WEIGHT_LABEL[c.weight as Weight].toLowerCase()} · {c.factor.format(c.raw)}
                  </small>
                </span>
                <span className="why__bar" aria-label={`${c.push >= 0 ? "raises" : "lowers"} the score`}>
                  <i
                    className={c.push >= 0 ? "pos" : "neg"}
                    style={{ width: `${(50 * Math.abs(c.push)) / maxPush}%`, [c.push >= 0 ? "left" : "right"]: "50%" }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {[...near.entries()].some(([s]) => activeSignals.has(metro.signals[s].id)) && (
        <>
          <p className="eyebrow card__section">
            Nearby, from Overture places
            <span className="card__key" aria-hidden="true">
              <i className="pos" /> prefer <i className="neg" /> avoid
            </span>
          </p>
          <p className="hint card__hint">Linked on the map to the cell they score.</p>
          <ul className="near">
            {[...near.entries()]
              .filter(([s]) => activeSignals.has(metro.signals[s].id))
              .sort(([a], [b]) => Math.abs(activeSignals.get(metro.signals[b].id)!) - Math.abs(activeSignals.get(metro.signals[a].id)!))
              .map(([s, list]) => (
                <li key={s}>
                  <span className="near__sig">
                    {metro.signals[s].label} <small>{list.length}</small>
                  </span>
                  <span className="near__names">
                    {list.slice(0, 4).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="placechip"
                        data-tip={`Overture GERS ID ${metro.places.id[k].slice(0, 8)}… · confidence ${metro.places.confidence[k].toFixed(2)} · click to copy the ID`}
                        onClick={async () => {
                          if (await copy(metro.places.id[k])) toast("GERS ID copied");
                        }}
                      >
                        {metro.places.name[k]}
                      </button>
                    ))}
                    {list.length > 4 && <span className="muted">+{list.length - 4}</span>}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </aside>
  );
}
