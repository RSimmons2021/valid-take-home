import { useMemo, useRef, useState } from "react";
import { type Calibration, type Simulation, calibrate, parseResults, resultsTemplate, simulateResults } from "../model/calibrate";
import { plannedZips } from "../model/export";
import { WEIGHT_LABEL, type Weight, factorsFor } from "../model/factors";
import { CUSTOM_PROFILE, useStore } from "../state/store";
import { download, slug } from "./format";
import { toast } from "./toast";

type View = { kind: "input"; error?: string } | { kind: "result"; cal: Calibration; source: string; sim?: Simulation; skipped: number };

const fmt = (r: number) => (Number.isNaN(r) ? "–" : r.toFixed(2));

/**
 * Learn from results. Takes what a campaign delivered per ZIP and suggests weight changes
 * that would have ranked those ZIPs better, with the evidence for each. Nothing changes
 * until Apply. See model/calibrate.ts for the method and why it's built this way.
 */
export function ResultsDialog() {
  const metro = useStore((s) => s.metro)!;
  const plan = useStore((s) => s.plan)!;
  const weights = useStore((s) => s.weights);
  const minHomes = useStore((s) => s.minHomes);
  const setWeights = useStore((s) => s.setWeights);
  const open = useStore((s) => s.open);
  const [view, setView] = useState<View>({ kind: "input" });
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const zips = useMemo(() => plannedZips(metro, plan).map((z) => z.code), [metro, plan]);
  const labels = useMemo(() => new Map(factorsFor(metro).map((f) => [f.id, f.label])), [metro]);

  const analyse = (csv: string, source: string, sim?: Simulation) => {
    try {
      const parsed = parseResults(csv);
      const cal = calibrate(metro, parsed, weights, minHomes);
      setView({ kind: "result", cal, source, sim, skipped: parsed.skipped.length });
    } catch (e) {
      setView({ kind: "input", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const readFile = async (file: File) => {
    if (file.size > 2_000_000) return setView({ kind: "input", error: "That file is over 2 MB. Export ZIP-level totals only." });
    const t = await file.text();
    setText(t);
    analyse(t, file.name);
  };

  if (view.kind === "input") {
    return (
      <div className="results">
        <p className="eyebrow">Learn from results · {metro.info.name}</p>
        <h2>What did the campaign actually do?</h2>
        <p className="lede">
          Bring conversions by ZIP from Meta or Google. Catchment checks which weights would have ranked those ZIPs best, and suggests
          changes only where the evidence holds up.
        </p>

        <div
          className={`drop${dragging ? " drop--over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void readFile(f);
          }}
        >
          <p>
            <b>Drop a CSV here</b> or{" "}
            <button type="button" className="link" onClick={() => fileRef.current?.click()}>
              choose a file
            </button>
          </p>
          <p className="hint">Columns: zip, conversions, and impressions or spend. Extra columns are ignored.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <label className="field__label results__paste-label" htmlFor="results-paste">
          Or paste
        </label>
        <textarea
          id="results-paste"
          className="results__paste"
          rows={4}
          placeholder={"zip,impressions,conversions\n94110,12000,31\n…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {view.error && (
          <p className="notice" role="alert">
            {view.error}
          </p>
        )}
        <div className="results__actions">
          <button type="button" className="btn btn--primary" disabled={!text.trim()} onClick={() => analyse(text, "pasted data")}>
            Analyse
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              const sim = simulateResults(metro, weights, minHomes, zips);
              setText(sim.csv);
              analyse(sim.csv, "simulated results", sim);
            }}
            data-tip="Generates realistic results from a hidden 'true' weighting, so you can see whether calibration finds it"
          >
            Try simulated results
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => download(`catchment-${metro.info.id}-results-template.csv`, resultsTemplate(zips), "text/csv")}
            data-tip={`A CSV with this plan's ${zips.length} ZIPs, ready to fill in`}
          >
            Template ↓
          </button>
        </div>
      </div>
    );
  }

  const { cal, sim } = view;
  const name = (id: string) => labels.get(id) ?? id;
  const weightName = (w: number) => WEIGHT_LABEL[w as Weight];
  const truthRows = sim
    ? Object.keys({ ...sim.truth, ...weights })
        .filter((id) => (sim.truth[id] ?? 0) !== (weights[id] ?? 0))
        .map((id) => ({ id, truth: sim.truth[id] ?? 0, mine: weights[id] ?? 0, found: cal.suggested[id] ?? 0 }))
    : [];

  return (
    <div className="results">
      <p className="eyebrow">
        Learn from results · {view.source}
        {sim && <span className="tag tag--sim">simulated</span>}
      </p>
      <h2>{cal.changes.length ? `${cal.changes.length} change${cal.changes.length > 1 ? "s" : ""} would have ranked these ZIPs better` : "Your weights hold up"}</h2>
      <p className="lede">
        {cal.n} ZIPs analysed, using conversions per {cal.exposure === "homes" ? "home (no impressions or spend given)" : cal.exposure === "impressions" ? "impression" : "dollar"}.
        {cal.dropped.length + cal.unmatched.length + view.skipped > 0 && (
          <span
            className="muted"
            data-tip={[
              cal.dropped.length ? `${cal.dropped.length} under-delivered (${cal.dropped.map((d) => d.zip).join(", ")})` : "",
              cal.unmatched.length ? `${cal.unmatched.length} not in ${metro.info.name} (${cal.unmatched.slice(0, 6).join(", ")}${cal.unmatched.length > 6 ? "…" : ""})` : "",
              view.skipped ? `${view.skipped} unreadable line${view.skipped > 1 ? "s" : ""}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {" "}
            {cal.dropped.length + cal.unmatched.length + view.skipped} rows set aside ⓘ
          </span>
        )}
      </p>

      <div className="fit">
        <FitBar label="Your weights" rho={cal.currentFit.rho} ci={cal.currentFit.ci} />
        {cal.changes.length > 0 && <FitBar label="Suggested" rho={cal.suggestedFit.rho} ci={cal.suggestedFit.ci} strong />}
        <p className="hint">
          Fit is the rank correlation between each ZIP's score and its conversion rate: 1 means the plan ranked ZIPs exactly as the
          results did. Bars show the 95% interval.
        </p>
      </div>

      {cal.changes.length > 0 ? (
        <ol className="changes">
          {cal.changes.map((c) => (
            <li key={`${c.id}${c.to}`}>
              <span className="changes__what">
                <b>{c.label}</b>: {weightName(c.from)} → <b>{weightName(c.to)}</b>
              </span>
              <span className="changes__why">
                fit {fmt(c.before)} → {fmt(c.after)} · better in {Math.round(c.robustness * 100)}% of resamples
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="panel__blurb">
          Every one-step weight change was tested ({cal.tested} in all). None improved the ranking reliably, so nothing is suggested. That
          is a result too: the current targeting is consistent with what the campaign did.
        </p>
      )}

      {sim && (
        <div className="truth">
          <p className="eyebrow">The simulation's hidden truth</p>
          <p className="hint">These results were generated with: {sim.story}. Here is how close calibration got.</p>
          <ul>
            {truthRows.map((r) => (
              <li key={r.id}>
                <span>{name(r.id)}</span>
                <span>
                  truth {weightName(r.truth).toLowerCase()} · yours {weightName(r.mine).toLowerCase()} ·{" "}
                  {r.found === r.mine ? (
                    <b className="miss" data-tip="The evidence wasn't strong enough to move this weight">not detected</b>
                  ) : (
                    <b className={Math.sign(r.found) === Math.sign(r.truth) ? "ok" : "miss"}>found {weightName(r.found).toLowerCase()}</b>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="fineprint">
        In-sample: suggestions are tuned on these same ZIPs, so the "Suggested" fit is optimistic. Confirm with a holdout before scaling
        spend (Export ▸ Lift test).
      </p>
      <div className="results__actions">
        {cal.changes.length > 0 && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setWeights(cal.suggested, CUSTOM_PROFILE);
              open(null);
              toast(`Applied ${cal.changes.length} change${cal.changes.length > 1 ? "s" : ""} from results. ⌘Z to undo.`);
            }}
          >
            Apply {cal.changes.length} change{cal.changes.length > 1 ? "s" : ""}
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => setView({ kind: "input" })}>
          Use other data
        </button>
        {sim && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => download(`catchment-${slug(metro.info.name)}-simulated-results.csv`, sim.csv, "text/csv")}
          >
            Download this CSV
          </button>
        )}
      </div>
    </div>
  );
}

function FitBar({ label, rho, ci, strong }: { label: string; rho: number; ci: [number, number]; strong?: boolean }) {
  // map rho in [-1, 1] to [0, 100]%
  const x = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;
  return (
    <div className={`fitbar${strong ? " fitbar--strong" : ""}`}>
      <span className="fitbar__label">{label}</span>
      <span className="fitbar__track" aria-hidden="true">
        <i className="fitbar__zero" />
        <i className="fitbar__ci" style={{ left: x(ci[0]), width: `calc(${x(ci[1])} - ${x(ci[0])})` }} />
        <i className="fitbar__dot" style={{ left: x(rho) }} />
      </span>
      <span className="fitbar__value">
        ρ {fmt(rho)} <small>
          ({fmt(ci[0])} to {fmt(ci[1])})
        </small>
      </span>
    </div>
  );
}
