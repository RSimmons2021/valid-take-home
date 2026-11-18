import { useMemo, useState } from "react";
import { WEIGHTS, WEIGHT_LABEL, type Factor, type Weight, factorsFor } from "../model/factors";
import { PROFILES, isPristine, profileById } from "../model/profiles";
import { BriefBox } from "../ai/BriefBox";
import { useAi } from "../ai/store";
import { CUSTOM_PROFILE, useStore } from "../state/store";
import { Select } from "./Select";

const MIN_HOMES = [0, 10, 25, 50, 100];
const MIN_HOMES_DETAIL: Record<number, string> = {
  0: "Scores parks and industrial land too",
  10: "Includes very sparse blocks",
  25: "Recommended: skips parks and empty lots",
  50: "Only clearly residential blocks",
  100: "Dense neighbourhoods only",
};

export function BusinessPanel() {
  const metro = useStore((s) => s.metro);
  const profileId = useStore((s) => s.profileId);
  const weights = useStore((s) => s.weights);
  const minHomes = useStore((s) => s.minHomes);
  const { setProfile, setWeight, resetWeights, setMinHomes } = useStore.getState();
  const [showAll, setShowAll] = useState(false);
  const applied = useAi((s) => s.applied);
  const undoApplied = useAi((s) => s.undoApplied);
  const aiAvailable = useAi((s) => s.available);
  const aiActive = applied != null && profileId === CUSTOM_PROFILE;

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
        <BriefBox />
        {aiAvailable && <p className="profiles__lead">Or start from a type</p>}
        <div className="profiles" role="radiogroup" aria-label="Business type">
          {aiActive && (
            <button type="button" role="radio" aria-checked className="profile profile--ai" data-tip={applied.summary}>
              <span aria-hidden="true">✦</span> {applied.name}
            </button>
          )}
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === profileId}
              className="profile"
              onClick={() => setProfile(p.id)}
              data-tip={p.id === profileId ? undefined : `Switch to ${p.label.toLowerCase()} weights`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {aiActive ? (
          <p className="panel__blurb">
            {applied.summary}{" "}
            <button type="button" className="link" onClick={undoApplied} data-tip="Restore the weights you had before applying the suggestion">
              Undo
            </button>
          </p>
        ) : (
          profile && <p className="panel__blurb">{profile.blurb}</p>
        )}

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
            <FactorRow
              key={f.id}
              factor={f}
              weight={weights[f.id] ?? 0}
              competitor={aiActive ? applied.competitor === f.id : profile?.competitor === f.id}
              // The model's reason stays visible only while the weight is still the one it suggested.
              aiReason={aiActive && applied.reasons[f.id]?.weight === weights[f.id] ? applied.reasons[f.id].reason : undefined}
              onChange={setWeight}
            />
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
          <span className="field__label" id="min-homes-label">
            Only score cells with at least
          </span>
          <Select
            variant="field"
            label="Only score cells with at least"
            value={minHomes}
            options={MIN_HOMES.map((n) => ({
              value: n,
              label: n === 0 ? "Any number of homes" : `${n} homes`,
              detail: MIN_HOMES_DETAIL[n],
            }))}
            onChange={setMinHomes}
          />
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
  aiReason,
  onChange,
}: {
  factor: Factor;
  weight: Weight;
  competitor: boolean;
  aiReason?: string;
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
        {aiReason ? (
          <span className="factor__ai" data-tip={factor.description}>
            <span aria-hidden="true">✦</span> {aiReason}
          </span>
        ) : (
          <span className="factor__desc">{factor.description}</span>
        )}
      </div>
      <div className="weight" role="radiogroup" aria-labelledby={id}>
        {WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === weight}
            aria-label={WEIGHT_LABEL[w]}
            data-tip={WEIGHT_LABEL[w]}
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
