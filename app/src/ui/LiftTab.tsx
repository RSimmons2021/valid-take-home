import { useMemo, useState } from "react";
import { AnimatedNumber } from "./motion";
import { bestShuffle, liftCsv, targetUnits } from "../model/holdout";
import { useStore } from "../state/store";
import { compact, copy, download, pct } from "./format";
import { toast } from "./toast";

const QUALITY: Record<string, string> = {
  good: "Well balanced, enough pairs",
  fair: "At least six pairs with acceptable balance",
  weak: "Too few pairs or poor balance",
};

/**
 * Export ▸ Lift test. Splits the plan's ZIPs into matched test/control pairs so a buyer can
 * measure incremental lift instead of trusting platform attribution. Design in model/holdout.ts.
 */
export function LiftTab({ minShare, base }: { minShare: number; base: string }) {
  const metro = useStore((s) => s.metro)!;
  const plan = useStore((s) => s.plan)!;
  const weights = useStore((s) => s.weights);
  const minHomes = useStore((s) => s.minHomes);
  const setLiftOverlay = useStore((s) => s.setLiftOverlay);
  const open = useStore((s) => s.open);
  const [start, setStart] = useState(1);

  const target = useMemo(() => targetUnits(metro, plan, weights, minHomes, minShare), [metro, plan, weights, minHomes, minShare]);
  const d = useMemo(() => bestShuffle(target, start), [target, start]);
  const testZips = [...d.pairs.map((p) => p.test.zip), ...(d.unpaired ? [d.unpaired.zip] : [])];
  const controlZips = d.pairs.map((p) => p.control.zip);
  const copyList = async (zips: string[], what: string) =>
    toast((await copy(zips.join("\n"))) ? `${zips.length} ${what} ZIPs copied` : "Couldn't copy");

  if (d.pairs.length === 0) {
    return (
      <div className="export">
        <p className="notice">
          A lift test needs at least two of the plan's ZIPs mostly covered by pins. Add pins, widen the radius, or lower the ZIP share
          threshold on the ZIP codes tab.
        </p>
      </div>
    );
  }

  return (
    <div className="lift">
      <div className="lift__intro">
        <p>
          Platform attribution counts conversions that happened <i>near</i> your ads. To know what the ads <i>caused</i>, advertise to half
          of the plan's ZIPs and hold out a matched half, then compare.
        </p>
        <span className={`quality quality--${d.quality}`} data-tip={QUALITY[d.quality]}>
          {d.quality} design
        </span>
      </div>

      <dl className="stats lift__stats">
        <div className="stat">
          <dt data-tip="Each pair is two similar ZIPs; a coin flip decides which one gets ads">Matched pairs</dt>
          <dd>{d.pairs.length}</dd>
        </div>
        <div className="stat">
          <dt>Test homes</dt>
          <dd>
            <AnimatedNumber value={d.testHomes} format={compact} ms={300} />
          </dd>
        </div>
        <div className="stat">
          <dt data-tip="Homes in control ZIPs: no ads reach them during the test">Held out</dt>
          <dd>
            <AnimatedNumber value={d.holdoutShare} format={pct} ms={300} />
          </dd>
        </div>
      </dl>

      <table className="balance">
        <thead>
          <tr>
            <th>Balance</th>
            <th>Test</th>
            <th>Control</th>
            <th data-tip="Standardised mean difference. Under 0.1 is good, under 0.25 acceptable.">SMD</th>
          </tr>
        </thead>
        {/* keyed by shuffle, so a reshuffle visibly re-deals the numbers */}
        <tbody key={d.seed} className="redeal">
          {d.balance.map((b) => (
            <tr key={b.covariate}>
              <td>{b.covariate}</td>
              <td>{b.covariate === "Detached share" ? pct(b.test) : b.test.toFixed(b.covariate === "Fit score" ? 0 : 2)}</td>
              <td>{b.covariate === "Detached share" ? pct(b.control) : b.control.toFixed(b.covariate === "Fit score" ? 0 : 2)}</td>
              <td>
                <span className={`smd smd--${b.verdict}`}>{b.smd?.toFixed(2) ?? "N/A"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.notes.map((n) => (
        <p key={n} className="hint">
          {n}
        </p>
      ))}

      <ol className="steps lift__steps">
        <li>
          <b>Target only the test ZIPs</b> for this campaign ({testZips.length}).
        </li>
        <li>
          <b>Exclude the control ZIPs</b> from every campaign for the test window ({controlZips.length}).
        </li>
        <li>Set the test window using historical conversion volume and keep the split fixed.</li>
        <li>
          Compare conversions per 1,000 homes: lift = test rate ÷ control rate − 1, pair by pair. The pairs CSV lists each pair's homes.
        </li>
      </ol>

      <div className="export__actions">
        <button type="button" className="btn btn--primary" onClick={() => copyList(testZips, "test")}>
          Copy test ZIPs
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => copyList(controlZips, "control")}>
          Copy control ZIPs
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => download(`${base}-lift-pairs.csv`, liftCsv(d), "text/csv")}>
          Pairs .csv
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setStart((s) => s + 20)}
          data-tip="Try another 20 random splits and keep the best balanced"
        >
          Reshuffle
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setLiftOverlay({ test: testZips, control: controlZips });
            open(null);
          }}
        >
          Show on map
        </button>
      </div>
      <p className="fineprint">
        Seeded and reproducible: shuffle #{d.seed} of this plan. Adjacent test and control ZIPs can leak a little delivery across borders;
        that biases lift towards zero, so a measured lift is conservative.
      </p>
    </div>
  );
}
