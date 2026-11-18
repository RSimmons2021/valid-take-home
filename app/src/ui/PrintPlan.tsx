import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { currentBusiness, useAi } from "../ai/store";
import { mapIdle, snapshotMap } from "../map/snapshot";
import { pinName, plannedZips } from "../model/export";
import { WEIGHT_LABEL, type Weight, factorsFor } from "../model/factors";
import { bestShuffle, targetUnits } from "../model/holdout";
import { useStore } from "../state/store";
import { Glyph } from "./TopBar";
import { compact, int, pct } from "./format";

/**
 * The client one-pager: what an agency actually sends. It exists only in print (⌘P, the
 * command palette, or Export ▸ Files) and is built from live state, so it's always the plan
 * on screen. The map image is the real map, snapshotted the moment printing starts.
 */
export function PrintPlan() {
  const metro = useStore((s) => s.metro);
  const plan = useStore((s) => s.plan);
  const weights = useStore((s) => s.weights);
  const minHomes = useStore((s) => s.minHomes);
  useAi((s) => s.applied); // re-render when an AI business is applied
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    // ⌘P or the browser menu: capture synchronously so the image is in the printed page.
    const before = () => flushSync(() => setImage(snapshotMap(1600, 900, "image/jpeg", 0.9)));
    // From the app (palette or Export): frame every pin first, then print.
    const fromApp = async () => {
      useStore.getState().select(null);
      useStore.getState().requestFrame();
      await new Promise((r) => setTimeout(r, 950));
      await mapIdle();
      flushSync(() => setImage(snapshotMap(1600, 900, "image/jpeg", 0.9)));
      window.print();
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("catchment:print", fromApp);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("catchment:print", fromApp);
    };
  }, []);

  const lift = useMemo(
    () => (metro && plan ? bestShuffle(targetUnits(metro, plan, weights, minHomes, 0.5)) : null),
    [metro, plan, weights, minHomes],
  );
  if (!metro || !plan) return null;

  const business = currentBusiness();
  const labels = new Map(factorsFor(metro).map((f) => [f.id, f.label]));
  const zips = plannedZips(metro, plan).filter((z) => z.share >= 0.5);
  const on = plan.homes ? plan.onTargetHomes / plan.homes : 0;
  const lowUnits = metro.ledger.addresses.units_per_rooftop < 1.2;
  const weightList = Object.entries(weights)
    .filter(([, w]) => w !== 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <article className="print-plan" aria-hidden="true">
      <header className="pp__head">
        <span className="pp__brand">
          <Glyph size={16} /> Catchment
        </span>
        <span className="pp__meta">
          {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · Overture Maps {metro.release}
        </span>
      </header>
      <h1 className="pp__title">
        {business.name} targeting plan: {metro.info.name}
      </h1>
      {business.summary && <p className="pp__lede">{business.summary}</p>}

      <dl className="pp__stats">
        <div>
          <dt>Homes reached</dt>
          <dd>{compact(plan.homes)}</dd>
        </div>
        <div>
          <dt>On target</dt>
          <dd>{pct(on)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{pct(plan.capture)}</dd>
        </div>
        <div>
          <dt>Pins</dt>
          <dd>
            {plan.pins.length} × {plan.pins[0]?.radiusMi ?? "–"} mi
          </dd>
        </div>
      </dl>

      {image && <img className="pp__map" src={image} alt="" />}

      <div className="pp__cols">
        <section>
          <h2>Pins, best first</h2>
          <table className="pp__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Area</th>
                <th>ZIP</th>
                <th>Homes</th>
                <th>On target</th>
                <th>Fit</th>
              </tr>
            </thead>
            <tbody>
              {plan.pins.map((p) => (
                <tr key={p.cell}>
                  <td>{p.rank}</td>
                  <td>{pinName(p.label, p.rank)}</td>
                  <td>{p.label.zip ?? "–"}</td>
                  <td>{int(p.homes)}</td>
                  <td>{pct(p.homes ? p.onTargetHomes / p.homes : 0)}</td>
                  <td>{Number.isNaN(p.meanScore) ? "–" : Math.round(p.meanScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Why these areas</h2>
          <ul className="pp__weights">
            {weightList.map(([id, w]) => (
              <li key={id}>
                <b>{labels.get(id) ?? id}</b>: {WEIGHT_LABEL[w as Weight].toLowerCase()}
              </li>
            ))}
          </ul>
          <p className="pp__note">
            Each block (~0.1 km²) is scored against every other block in {metro.info.name}. Pins go where they reach the most well-matched
            homes and stay at least 1.5 radii apart.
          </p>
          {lift && lift.pairs.length > 0 && (
            <>
              <h2>Measuring it</h2>
              <p className="pp__note">
                Lift test ready: {lift.pairs.length} matched ZIP pairs ({lift.quality} design). Advertise to the test ZIPs, hold out the
                controls for 2–4 weeks, and compare conversions per home.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="pp__zips">
        <h2>ZIP codes ({zips.length}, ≥ 50% of homes reached)</h2>
        <p>{zips.map((z) => z.code).join(" · ")}</p>
      </section>

      <footer className="pp__foot">
        <p>
          Homes are Overture address points, not audience sizes; platforms estimate reach from their own users.
          {lowUnits && ` ${metro.info.name}'s county address feed doesn't list apartment units, so dense blocks are under-counted.`} Data ©
          Overture Maps Foundation and its sources.
        </p>
        <p className="pp__link">{location.href}</p>
      </footer>
    </article>
  );
}
