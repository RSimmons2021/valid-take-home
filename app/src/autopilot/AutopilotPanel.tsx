import { useCallback, useState } from "react";
import { currentBusiness, useAi } from "../ai/store";
import { campaignKit, pinsForBudget } from "../model/campaign";
import { pinName } from "../model/export";
import { useStore } from "../state/store";
import { download, slug } from "../ui/format";
import { toast } from "../ui/toast";
import { encodeFilm } from "../video/encode";
import type { FilmSpec } from "../video/film";
import { FilmPlayer } from "../video/FilmPlayer";
import { type Step, parseBudget, useAutopilot } from "./store";

/** The Autopilot dialog: ask (brief, budget), show the run, then hand over the kit. */
export function AutopilotPanel() {
  const ap = useAutopilot();
  if (ap.kit && ap.status === "done") return <KitView />;
  if (ap.status === "running" || ap.status === "done" || ap.status === "canceled") return <RunView />;
  return <AskView />;
}

function AskView() {
  const ap = useAutopilot();
  const aiOn = useAi((s) => s.available) === true;
  const metro = useStore((s) => s.metro);
  const pins = useStore((s) => s.pins);
  const budget = parseBudget(ap.monthly);
  const business = currentBusiness().name;
  return (
    <form
      className="autopilot"
      onSubmit={(e) => {
        e.preventDefault();
        void ap.run();
      }}
    >
      <p className="eyebrow">
        <span className="ai-mark" aria-hidden="true">
          ✦
        </span>{" "}
        Autopilot · {metro?.info.name}
      </p>
      <h2>Build the whole campaign</h2>
      <p className="lede">
        Autopilot picks the weights, places pins your budget can feed, splits the budget, writes a script and makes a video for every pin,
        and designs the lift test. You review everything; nothing is launched or spent, and one click undoes it all.
      </p>
      {aiOn ? (
        <label className="autopilot__field">
          <span>Describe the business</span>
          <textarea
            rows={2}
            maxLength={500}
            value={ap.brief}
            placeholder="e.g. Mobile dog grooming for busy families with yards"
            onChange={(e) => ap.setBrief(e.target.value)}
          />
          <small>Leave it empty to keep {business}.</small>
        </label>
      ) : (
        <p className="notice">AI isn't connected here, so Autopilot keeps {business} and writes each script from the data: real places, no AI.</p>
      )}
      <label className="autopilot__field autopilot__field--budget">
        <span>Monthly budget</span>
        <span className="autopilot__money">
          <i aria-hidden="true">$</i>
          <input inputMode="numeric" value={ap.monthly} onChange={(e) => ap.setMonthly(e.target.value)} aria-describedby="budget-hint" />
        </span>
        <small id="budget-hint">
          {budget
            ? pinsForBudget(budget, pins) < pins
              ? `Each pin needs about $5 a day, so this funds ${pinsForBudget(budget, pins)} of your ${pins} pins.`
              : `Funds all ${pins} pins at $5 a day or more.`
            : "Optional. Leave empty to skip the budget split."}
        </small>
      </label>
      <div className="autopilot__actions">
        <button type="submit" className="btn btn--primary">
          Build my campaign
        </button>
        <span className="fineprint">About {aiOn ? "a minute" : "20 seconds"}. You can close this; it keeps working.</span>
      </div>
    </form>
  );
}

const MARK: Record<Step["state"], string> = { todo: "", active: "", done: "✓", skipped: "–", error: "!" };

function RunView() {
  const ap = useAutopilot();
  const running = ap.status === "running";
  return (
    <div className="autopilot" aria-busy={running}>
      <p className="eyebrow">Autopilot</p>
      <h2>{running ? "Building your campaign" : ap.status === "canceled" ? "Stopped" : "Couldn't finish"}</h2>
      <ol className="runsteps">
        {ap.steps.map((s) => (
          <li key={s.id} className={`runstep runstep--${s.state}`}>
            <span className="runstep__mark" aria-hidden="true">
              {MARK[s.state]}
            </span>
            <span className="runstep__text">
              {s.label}
              {s.detail && <small>{s.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">
        {ap.steps.find((s) => s.state === "active")?.label ?? ""}
      </p>
      <div className="autopilot__actions">
        {running ? (
          <button type="button" className="btn btn--ghost" onClick={ap.cancel}>
            Stop
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--primary" onClick={() => void ap.run()}>
              Run again
            </button>
            {ap.before && (
              <button type="button" className="btn btn--ghost" onClick={ap.undoAll}>
                Undo Autopilot
              </button>
            )}
          </>
        )}
        {running && <span className="fineprint">The map updates as each step lands. You can close this; it keeps working.</span>}
      </div>
    </div>
  );
}

function KitView() {
  const ap = useAutopilot();
  const kit = ap.kit!;
  const metro = useStore((s) => s.metro)!;
  const plan = useStore((s) => s.plan)!;
  const open = useStore((s) => s.open);
  const [playing, setPlaying] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<number, number>>({});
  const base = `catchment-${metro.info.id}-${slug(kit.business.name)}`;
  // The kit belongs to the plan it was built for; if the plan has moved on since, say so.
  const stale = kit.scripts.length !== plan.pins.length || kit.scripts.some((s, k) => s.rank !== plan.pins[k]?.rank);

  const save = useCallback(
    async (rank: number, spec: FilmSpec) => {
      setBusy((b) => ({ ...b, [rank]: 0 }));
      try {
        const { blob, ext } = await encodeFilm(spec, (p) => setBusy((b) => ({ ...b, [rank]: p })));
        download(`${base}-pin-${rank}.${ext}`, blob);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Couldn't make the video file");
      } finally {
        setBusy((b) => {
          const { [rank]: _, ...rest } = b;
          return rest;
        });
      }
    },
    [base],
  );

  const saveAll = async () => {
    for (const [rank, spec] of kit.films) await save(rank, spec);
  };

  return (
    <div className="autopilot autopilot--kit">
      <p className="eyebrow">
        <span className="ai-mark" aria-hidden="true">
          ✦
        </span>{" "}
        Campaign kit · {metro.info.name}
      </p>
      <h2>{kit.business.name}: ready for review</h2>
      <ol className="runsteps runsteps--done">
        {ap.steps.map((s) => (
          <li key={s.id} className={`runstep runstep--${s.state}`}>
            <span className="runstep__mark" aria-hidden="true">
              {MARK[s.state]}
            </span>
            <span className="runstep__text">
              {s.label}
              {s.detail && <small>{s.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
      {stale && <p className="notice">The plan has changed since this kit was built. Run Autopilot again to match it.</p>}
      <div className="autopilot__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() =>
            download(
              `${base}-kit.md`,
              campaignKit({ metro, plan, business: kit.business, budget: kit.budget, monthly: kit.monthly, scripts: kit.scripts, lift: kit.lift, link: location.href, date: new Date() }),
              "text/markdown",
            )
          }
        >
          Campaign kit .md
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => void saveAll()} disabled={Object.keys(busy).length > 0}>
          Download all videos
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => open("export")}>
          Export targeting
        </button>
        <button type="button" className="btn btn--ghost" onClick={ap.undoAll} data-tip="Put the plan back the way it was before Autopilot ran">
          Undo Autopilot
        </button>
      </div>

      <ul className="kit">
        {kit.scripts.map((s) => {
          const pin = plan.pins.find((p) => p.rank === s.rank);
          const film = kit.films.get(s.rank);
          const money = kit.budget.find((b) => b.rank === s.rank);
          const name = pin ? pinName(pin.label, pin.rank) : `Pin ${s.rank}`;
          const progress = busy[s.rank];
          return (
            <li key={s.rank} className="kit__pin">
              {film ? (
                <FilmPlayer spec={film} label={name} playing={playing === s.rank} onPlayingChange={(on) => setPlaying(on ? s.rank : null)} />
              ) : (
                <div className="film film--missing">No video</div>
              )}
              <div className="kit__body">
                <p className="kit__where">
                  <span className="pinrow__rank">{s.rank}</span> {name}
                </p>
                {money && (
                  <p className="kit__money" data-tip="Split by the well-matched homes each pin reaches. A proposal: adjust freely.">
                    ${money.daily.toFixed(2)}/day · ${money.monthly.toLocaleString("en-US")}/mo
                  </p>
                )}
                <p className="kit__title">{s.title}</p>
                <p className="kit__hook">{s.hook}</p>
                {s.callouts.length > 0 && <p className="kit__places">Points at {s.callouts.map((c) => c.name).join(" · ")}</p>}
                <p className="kit__tags">
                  <span className={`tag${s.silentReadable ? " tag--ok" : ""}`} data-tip="The title is at most 8 words: readable in two seconds with the sound off">
                    {s.silentReadable ? "✓ sound-off readable" : "title too long"}
                  </span>
                  <span className="tag" data-tip={s.source === "ai" ? "Written by AI, checked to cite only real places inside the pin" : "Written from the data: real places, no AI"}>
                    {s.source === "ai" ? "✦ AI, verified" : "from the data"}
                  </span>
                </p>
                {film && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void save(s.rank, film)} disabled={progress !== undefined}>
                    {progress !== undefined ? `Making video… ${Math.round(progress * 100)}%` : "Download video"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {kit.lift && (
        <p className="kit__lift">
          <b>Lift test:</b> {kit.lift.pairs.length} matched ZIP pairs, {kit.lift.quality} design. It's in the kit and under Export ▸ Lift test.
        </p>
      )}
    </div>
  );
}

/** While a run continues with the dialog closed, a pill in the top bar shows progress and reopens it. */
export function AutopilotPill() {
  const status = useAutopilot((s) => s.status);
  const steps = useAutopilot((s) => s.steps);
  const dialog = useStore((s) => s.dialog);
  const open = useStore((s) => s.open);
  const kit = useAutopilot((s) => s.kit);
  const [seen, setSeen] = useState<object | null>(null);
  if (dialog === "autopilot") return null;
  const running = status === "running";
  const fresh = status === "done" && kit && seen !== kit;
  if (!running && !fresh) return null;
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  return (
    <button
      type="button"
      className={`appill${running ? " appill--running" : ""}`}
      onClick={() => {
        setSeen(kit);
        open("autopilot");
      }}
    >
      {running ? <i className="spinner" aria-hidden="true" /> : <span aria-hidden="true">✦</span>}
      {running ? `Autopilot ${done}/${steps.length}` : "Campaign kit ready"}
    </button>
  );
}
