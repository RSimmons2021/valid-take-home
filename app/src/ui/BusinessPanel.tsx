import { useMemo, useState } from "react";
import { WEIGHTS, WEIGHT_LABEL, type Factor, type Weight, factorsFor } from "../model/factors";
import { PROFILES, isPristine, profileById } from "../model/profiles";
import { useStore } from "../state/store";

const MIN_HOMES = [0, 10, 25, 50, 100];

export function BusinessPanel() {
  const metro = useStore((s) => s.metro);
  const profileId = useStore((s) => s.profileId);
  const weights = useStore((s) => s.weights);
  const minHomes = useStore((s) => s.minHomes);
  const { setProfile, setWeight, resetWeights, setMinHomes } = useStore.getState();
  const [showAll, setShowAll] = useState(false);

  const profile = profileById(profileId);
  const factors = useMemo(() => (metro ? factorsFor(metro) : []), [metro]);
  const active = factors.filter((f) => (weights[f.id] ?? 0) !== 0);
  const rest = factors.filter((f) => (weights[f.id] ?? 0) === 0);
  const pristine = profile ? isPristine(profile, weights) : true;

  return (
    <section className="panel panel--left" aria-labelledby="business-title">
      <div className="panel__scroll">
        <p className="eyebrow">
          <b>01</b> Business
        </p>
        <h2 id="business-title">Who are you trying to reach?</h2>
        <div className="profiles" role="radiogroup" aria-label="Business type">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === profileId}
              className="profile"
              onClick={() => setProfile(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {profile && <p className="panel__blurb">{profile.blurb}</p>}

        <div className="panel__head">
          <p className="eyebrow">
            <b>02</b> What matters
          </p>
          {!pristine && (
            <button type="button" className="link" onClick={resetWeights}>
              Reset to {profile?.label}
            </button>
          )}
        </div>
        <ul className="factors">
          {active.map((f) => (
            <FactorRow key={f.id} factor={f} weight={weights[f.id] ?? 0} competitor={profile?.competitor === f.id} onChange={setWeight} />
          ))}
        </ul>
        <button type="button" className="disclosure" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          <span aria-hidden="true">{showAll ? "−" : "+"}</span> {showAll ? "Hide" : "Add"} other signals
          <span className="muted"> · {rest.length}</span>
        </button>
        {showAll && (
          <ul className="factors factors--rest">
            {rest.map((f) => (
              <FactorRow key={f.id} factor={f} weight={0} competitor={profile?.competitor === f.id} onChange={setWeight} />
            ))}
          </ul>
        )}

        <div className="field">
          <label htmlFor="min-homes">Only score cells with at least</label>
          <select id="min-homes" value={minHomes} onChange={(e) => setMinHomes(Number(e.target.value))}>
            {MIN_HOMES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "any number of" : n} homes
              </option>
            ))}
          </select>
          <p className="hint">Cells are ~0.1 km². Sparse cells (parks, industrial land, water) stay unscored.</p>
        </div>
      </div>
    </section>
  );
}

function FactorRow({
  factor,
  weight,
  competitor,
  onChange,
}: {
  factor: Factor;
  weight: Weight;
  competitor: boolean;
  onChange: (id: string, w: Weight) => void;
}) {
  const id = `f-${factor.id}`;
  return (
    <li className="factor">
      <div className="factor__text">
        <span className="factor__label" id={id}>
          {factor.label}
          {competitor && <span className="tag">competition</span>}
        </span>
        <span className="factor__desc">{factor.description}</span>
      </div>
      <div className="weight" role="radiogroup" aria-labelledby={id}>
        {WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === weight}
            aria-label={WEIGHT_LABEL[w]}
            title={WEIGHT_LABEL[w]}
            className={`weight__step weight__step--${w < 0 ? "neg" : w > 0 ? "pos" : "zero"}`}
            data-mag={Math.abs(w)}
            onClick={() => onChange(factor.id, w)}
          />
        ))}
        <span className="weight__label" aria-hidden="true">
          {WEIGHT_LABEL[weight]}
        </span>
      </div>
    </li>
  );
}
