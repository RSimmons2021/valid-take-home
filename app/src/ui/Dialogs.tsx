import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { googleRadiusLines, pinsCsv, planGeoJson, plannedZips, zipsCsv } from "../model/export";
import { profileById } from "../model/profiles";
import { useStore } from "../state/store";
import { LiftTab } from "./LiftTab";
import { ResultsDialog } from "./ResultsDialog";
import { Glyph } from "./TopBar";
import { activeSteps } from "./tour/steps";
import { compact, copy, download, int, pct, slug } from "./format";
import { toast } from "./toast";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " modal--wide" : ""}`}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close();
      }}
    >
      <div className="modal__body">
        <button type="button" className="modal__close" aria-label="Close" data-tip="Close (Esc)" onClick={() => ref.current?.close()}>
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const open = useStore((s) => s.open);
  const close = () => open(null);
  if (dialog === "export") return <ExportDialog onClose={close} />;
  if (dialog === "data") return <DataDialog onClose={close} />;
  if (dialog === "welcome") return <WelcomeDialog onClose={close} />;
  if (dialog === "results")
    return (
      <Modal title="Learn from results" onClose={close} wide>
        <ResultsDialog />
      </Modal>
    );
  return null;
}

type Tab = "zips" | "google" | "lift" | "files";

function ExportDialog({ onClose }: { onClose: () => void }) {
  const metro = useStore((s) => s.metro)!;
  const plan = useStore((s) => s.plan)!;
  const profileId = useStore((s) => s.profileId);
  const [tab, setTab] = useState<Tab>("zips");
  const [minShare, setMinShare] = useState(0.5);

  const zips = useMemo(() => plannedZips(metro, plan), [metro, plan]);
  const kept = zips.filter((z) => z.share >= minShare);
  const profile = profileById(profileId)?.label ?? "Custom";
  const base = `catchment-${metro.info.id}-${slug(profile)}`;
  const zipText = kept.map((z) => z.code).join("\n");
  const googleText = googleRadiusLines(plan);

  const copyText = async (text: string, what: string) => toast((await copy(text)) ? `${what} copied` : "Couldn't copy");

  return (
    <Modal title="Export plan" onClose={onClose} wide>
      <p className="eyebrow">Export · {metro.info.name} · {profile}</p>
      <h2>Take the plan to your ad accounts</h2>
      <p className="lede">
        {plan.pins.length} pins · {compact(plan.homes)} homes · {pct(plan.homes ? plan.onTargetHomes / plan.homes : 0)} on target. Pick
        the format your campaign uses.
      </p>
      <div className="tabs" role="tablist">
        {(
          [
            ["zips", "ZIP codes", "Meta & Google"],
            ["google", "Radius pins", "Google Ads bulk"],
            ["lift", "Lift test", "Prove it worked"],
            ["files", "Files", "CSV · GeoJSON"],
          ] as const
        ).map(([id, label, sub]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            <small>{sub}</small>
          </button>
        ))}
      </div>

      {tab === "zips" && (
        <div className="export">
          <div className="export__side">
            <p>
              ZIP targeting is coarser than pins. Keep the ZIPs the pins mostly cover, so you don't pay for the far side of a ZIP the plan
              only clips.
            </p>
            <div className="segmented segmented--small" role="radiogroup" aria-label="Minimum share of ZIP reached">
              {[0.25, 0.5, 0.75].map((s) => (
                <button key={s} type="button" role="radio" aria-checked={minShare === s} onClick={() => setMinShare(s)}>
                  ≥ {pct(s)}
                </button>
              ))}
            </div>
            <ol className="steps">
              <li>
                <b>Meta Ads Manager</b> · Ad set ▸ Audience ▸ Locations ▸ <i>Add locations in bulk</i> ▸ Postal code. Paste.
              </li>
              <li>
                <b>Google Ads</b> · Campaign settings ▸ Locations ▸ <i>Advanced search</i> ▸ Bulk locations. Paste.
              </li>
            </ol>
            <div className="export__actions">
              <button type="button" className="btn btn--primary" onClick={() => copyText(zipText, `${kept.length} ZIPs`)} disabled={!kept.length}>
                Copy {kept.length} ZIPs
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => download(`${base}-zips.csv`, zipsCsv(zips), "text/csv")}>
                ZIP report .csv
              </button>
            </div>
          </div>
          <div className="export__preview">
            <table className="ziptable">
              <thead>
                <tr>
                  <th>ZIP</th>
                  <th>Reached</th>
                  <th>Of ZIP</th>
                </tr>
              </thead>
              <tbody>
                {zips.map((z) => (
                  <tr key={z.code} data-out={z.share < minShare || undefined}>
                    <td>{z.code}</td>
                    <td>{int(z.reached)}</td>
                    <td>
                      <span className="minibar">
                        <i style={{ width: pct(Math.min(1, z.share)) }} />
                      </span>
                      {pct(Math.min(1, z.share))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "google" && (
        <div className="export">
          <div className="export__side">
            <p>One line per pin in Google's bulk radius format: radius, latitude, longitude.</p>
            <ol className="steps">
              <li>Campaign settings ▸ Locations ▸ Advanced search ▸ Radius ▸ Bulk.</li>
              <li>Paste the lines and add them as targeted locations.</li>
            </ol>
            <p className="hint">For Meta pins, use the CSV under Files: it has each pin's coordinates and radius.</p>
            <div className="export__actions">
              <button type="button" className="btn btn--primary" onClick={() => copyText(googleText, `${plan.pins.length} pins`)}>
                Copy {plan.pins.length} lines
              </button>
            </div>
          </div>
          <pre className="export__code">{googleText}</pre>
        </div>
      )}

      {tab === "lift" && <LiftTab minShare={minShare} base={base} />}

      {tab === "files" && (
        <div className="export export--files">
          <button type="button" className="filecard" onClick={() => download(`${base}-pins.csv`, pinsCsv(plan), "text/csv")}>
            <b>Pins .csv</b>
            <span>Rank, name, coordinates, radius, homes and score for each pin. Opens in any spreadsheet.</span>
          </button>
          <button
            type="button"
            className="filecard"
            onClick={() =>
              download(`${base}.geojson`, planGeoJson(plan, { metro, profile, link: location.href }), "application/geo+json")
            }
          >
            <b>Plan .geojson</b>
            <span>Pin circles as polygons with their stats, plus the Overture release and a link back to this plan.</span>
          </button>
          <button type="button" className="filecard" onClick={() => download(`${base}-zips.csv`, zipsCsv(zips), "text/csv")}>
            <b>ZIP report .csv</b>
            <span>Every ZIP the plan touches, with how many of its homes the pins reach.</span>
          </button>
        </div>
      )}
      <p className="fineprint">
        Homes are Overture address points (units counted where the county lists them), not audience sizes. Platforms estimate reach from
        their own users.
      </p>
    </Modal>
  );
}

function DataDialog({ onClose }: { onClose: () => void }) {
  const metro = useStore((s) => s.metro)!;
  const L = metro.ledger;
  const p = L.places;
  const reasons: [keyof typeof p.dropped, string, string][] = [
    ["closed", "Closed", "operating_status is permanently or temporarily closed"],
    ["low_confidence", "Low confidence", `confidence below ${p.min_confidence} (or missing)`],
    ["uncategorized", "Uncategorized", "no taxonomy.primary"],
    ["duplicate", "Duplicates", `same name within ${p.dedupe_meters} m of a better-scored listing`],
  ];
  const lowUnits = L.addresses.units_per_rooftop < 1.2;
  const signals = [...metro.signals].sort((a, b) => (L.signal_places[b.id] ?? 0) - (L.signal_places[a.id] ?? 0));

  return (
    <Modal title="About the data" onClose={onClose} wide>
      <p className="eyebrow">
        Overture Maps {metro.release} · schema {metro.schema} · built {metro.builtAt.slice(0, 10)}
      </p>
      <h2>What {metro.info.name} is made of</h2>
      <p className="lede">
        Every number here comes from Overture's open data, extracted once with DuckDB and rolled up to {int(L.cells)} H3 cells (resolution
        9, ~0.1 km²). Nothing is fetched at runtime except basemap tiles.
      </p>

      <div className="ledger">
        <section>
          <h3>Places</h3>
          <p className="ledger__big">
            {int(p.kept)} <small>kept of {int(p.raw)}</small>
          </p>
          <div className="funnel" aria-hidden="true">
            <i className="funnel__kept" style={{ flex: p.kept }} />
            {reasons.map(([k]) => (
              <i key={k} className={`funnel__${k}`} style={{ flex: p.dropped[k] }} />
            ))}
          </div>
          <ul className="reasons">
            {reasons.map(([k, label, why]) => (
              <li key={k}>
                <i className={`dot funnel__${k}`} aria-hidden="true" />
                <b>{label}</b> {int(p.dropped[k])}
                <small>{why}</small>
              </li>
            ))}
          </ul>
          <p className="hint">
            Status is checked before confidence on purpose: in this release most closed places still carry a confidence of 0.6 or more,
            although the schema says closed means 0.
          </p>
        </section>
        <section>
          <h3>Homes</h3>
          <p className="ledger__big">
            {int(L.addresses.in_metro)} <small>address points</small>
          </p>
          <ul className="kv">
            <li>
              <span>Rooftops</span>
              <b>{int(L.addresses.rooftops)}</b>
            </li>
            <li>
              <span>Addresses per rooftop</span>
              <b>{L.addresses.units_per_rooftop.toFixed(2)}</b>
            </li>
            <li>
              <span>With a postcode</span>
              <b>{pct(L.addresses.with_postcode / Math.max(1, L.addresses.in_metro))}</b>
            </li>
            <li>
              <span>Buildings</span>
              <b>{int(L.buildings.in_metro)}</b>
            </li>
          </ul>
          {lowUnits ? (
            <p className="notice">
              This county's address feed lists buildings, not apartment units, so dense blocks read low on Homes. Detached-house share is
              also overstated. Compare cells within {metro.info.name}, not across metros.
            </p>
          ) : (
            <p className="hint">Apartment units are listed as separate addresses here, so Homes approximates households.</p>
          )}
          <p className="hint">ZIPs missing from the address feed are filled from place addresses, then from the nearest labelled cells.</p>
        </section>
        <section>
          <h3>Signals</h3>
          <ul className="kv kv--signals">
            {signals.map((s) => (
              <li key={s.id} data-tip={s.description}>
                <span>{s.label}</span>
                <b>{int(L.signal_places[s.id] ?? 0)}</b>
              </li>
            ))}
          </ul>
          {metro.file.changes && (
            <p className="hint">
              Since the {metro.file.changes.since} release: {int(metro.file.changes.totals.new_ids)} new place ids kept,{" "}
              {int(metro.file.changes.totals.newly_closed)} places newly marked closed (matched by GERS id).
            </p>
          )}
          <p className="hint">Places map to signals through Overture's new taxonomy (basic_category and taxonomy.primary), not the removed categories field.</p>
        </section>
      </div>
      <details className="method">
        <summary>How a score is made</summary>
        <ol>
          <li>Each factor is ranked across scored cells (percentile, ties averaged), so one dense downtown cell can't flatten the map.</li>
          <li>Place signals count the cell and its six neighbours (~450 m), so a vet one block over still counts.</li>
          <li>The score is the weighted mean of centred ranks, re-ranked to 0–100: a 90 beats 90% of cells in this metro.</li>
          <li>
            Pins are placed greedily: each one goes where it adds the most well-fit homes not already reached. Cells under 50 add nothing,
            but still show up as spill.
          </li>
        </ol>
      </details>
    </Modal>
  );
}

function WelcomeDialog({ onClose }: { onClose: () => void }) {
  const index = useStore((s) => s.index);
  const metroId = useStore((s) => s.metroId);
  const setMetro = useStore((s) => s.setMetro);
  const open = useStore((s) => s.open);
  return (
    <Modal title="Welcome to Catchment" onClose={onClose}>
      <div className="welcome">
        <Glyph size={34} />
        <h2>Find the neighbourhoods worth paying for.</h2>
        <p className="lede">
          Catchment turns Overture's open map data into a geo-targeting plan for local-service ads: which areas fit your customer, and the
          ZIPs and radius pins to paste into Meta and Google.
        </p>
        <ol className="welcome__steps">
          <li>
            <span>
              <b>Pick a business.</b> Each one starts with sensible weights.
            </span>
          </li>
          <li>
            <span>
              <b>Say what matters.</b> Houses or apartments, pet owners, competition.
            </span>
          </li>
          <li>
            <span>
              <b>Export the plan.</b> ZIP lists and radius pins, ready to paste.
            </span>
          </li>
        </ol>
        <p className="eyebrow">Pick a city to start in</p>
        <div className="welcome__metros">
          {index?.metros.map((m) => (
            <button
              key={m.id}
              type="button"
              className="metrocard"
              aria-pressed={m.id === metroId}
              onClick={() => {
                if (m.id !== metroId) void setMetro(m.id);
                open(null);
              }}
            >
              <b>{m.name}</b>
              <span>
                {compact(m.homes)} homes · {compact(m.places_kept)} places
              </span>
            </button>
          ))}
        </div>
        <p className="welcome__after">
          <span className="hand">Then a {activeSteps().length}-step tour shows you around</span> · about a minute, skippable, and the <b>Guide</b> button
          replays it.
        </p>
      </div>
    </Modal>
  );
}
