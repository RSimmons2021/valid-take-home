import { usageLine } from "../ai/client";
import { Bone, StagedProgress } from "./Progress";
import { currentBusiness, pinKey, useAi } from "../ai/store";
import { creativeBrief } from "../model/brief";
import { type ChangedPlace, pinChanges, releaseLabel } from "../model/changes";
import { pinName } from "../model/export";
import { useStore } from "../state/store";
import { compact, copy, download, pct, slug } from "./format";
import { toast } from "./toast";

/**
 * One pin, opened from the plan list or its marker: its reach, and local ad angles written
 * from the real places inside it. Shares the cell card's slot; the two are exclusive.
 */
export function PinCard() {
  const plan = useStore((s) => s.plan);
  const focusedPin = useStore((s) => s.focusedPin);
  const focusPin = useStore((s) => s.focusPin);
  const weights = useStore((s) => s.weights); // angles and changes depend on targeting
  const metro = useStore((s) => s.metro);
  const ai = useAi();

  const pin = plan?.pins.find((p) => p.rank === focusedPin);
  if (!pin) return null;
  const on = pin.homes ? pin.onTargetHomes / pin.homes : 0;
  const entry = ai.angles[pinKey(pin)];
  const data = entry?.data;
  const loading = entry?.status === "loading";
  const business = currentBusiness();
  const changes = metro ? pinChanges(metro, pin, weights) : null;

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

      {changes && (
        <section className="changes-since" aria-labelledby="changes-title">
          <p
            className="eyebrow"
            id="changes-title"
            data-tip={`Matched by Overture GERS id against the ${releaseLabel(changes.since)} release. "New" means new to Overture: a new business, or one a new data source added.`}
          >
            Since {releaseLabel(changes.since)}
          </p>
          {changes.newCompetitors.length + changes.lostDemand.length + changes.newDemand.length + changes.closedCompetitors.length === 0 ? (
            <p className="hint">No changes to the places you weighted inside this pin.</p>
          ) : (
            <ul className="since">
              <ChangeRows kind="alert" verb="new" places={changes.newCompetitors} />
              <ChangeRows kind="alert" verb="closed" places={changes.lostDemand} />
              <ChangeRows kind="good" verb="new" places={changes.newDemand} />
              <ChangeRows kind="good" verb="closed" places={changes.closedCompetitors} />
            </ul>
          )}
        </section>
      )}

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
            <StagedProgress
              estimateMs={6000}
              steps={["Finding real places inside this pin", "Writing three hooks from them", "Checking every claim names a real place"]}
            >
              {[0, 1, 2].map((k) => (
                <span key={k} className="bone-card">
                  <Bone w="30%" h={8} />
                  <Bone w="92%" />
                  <Bone w="70%" />
                </span>
              ))}
            </StagedProgress>
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
                    {a.scene && (
                      <details className="angle__scene">
                        <summary data-tip="A prompt for AI video tools: vertical 9:16, about 5 seconds, no names or signage">Scene prompt</summary>
                        <p>{a.scene}</p>
                      </details>
                    )}
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
      {metro && (
        <div className="pincard__brief">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-tip="Audience, verified local references, angles, video scene prompts and do/don't notes for the creative team"
            onClick={async () => {
              const md = creativeBrief({ metro, pin, weights, business, angles: data?.angles, link: location.href, date: new Date() });
              toast((await copy(md)) ? "Creative brief copied (Markdown)" : "Couldn't copy");
            }}
          >
            Copy brief
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              download(
                `catchment-brief-${slug(business.name)}-${slug(pinName(pin.label, pin.rank))}.md`,
                creativeBrief({ metro, pin, weights, business, angles: data?.angles, link: location.href, date: new Date() }),
                "text/markdown",
              )
            }
          >
            Brief .md ↓
          </button>
          {!data && ai.available && <span className="hint">Write angles first to include them.</span>}
        </div>
      )}
    </aside>
  );
}

/** One row per signal: "2 new Pet sitters & boarding listings", "1 Pet owners nearby place marked closed". */
function ChangeRows({ kind, verb, places }: { kind: "alert" | "good"; verb: "new" | "closed"; places: ChangedPlace[] }) {
  const groups = new Map<string, ChangedPlace[]>();
  for (const p of places) groups.set(p.signalLabel, [...(groups.get(p.signalLabel) ?? []), p]);
  return [...groups.entries()].map(([signal, list]) => (
    <li key={`${verb}${signal}`} className={`since__row since__row--${kind}`}>
      <span className="since__count">{list.length}</span>
      <span>
        {verb === "new" ? (
          <>
            new <b>{signal}</b> listing{list.length > 1 ? "s" : ""}
          </>
        ) : (
          <>
            <b>{signal}</b> {list.length > 1 ? "places" : "place"} marked closed
          </>
        )}
        <span className="since__names">
          {list.slice(0, 3).map((p) => (
            <span key={p.id} className="placechip" data-tip={`GERS ${p.id.slice(0, 8)}…`}>
              {p.name}
            </span>
          ))}
          {list.length > 3 && <span className="muted">+{list.length - 3}</span>}
        </span>
      </span>
    </li>
  ));
}
