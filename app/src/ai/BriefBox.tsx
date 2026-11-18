import { useMemo, useState } from "react";
import { WEIGHT_LABEL, type Weight, factorsFor } from "../model/factors";
import { useStore } from "../state/store";
import { BRIEF_MAX } from "./limits";
import { usageLine } from "./client";
import { Bone, StagedProgress } from "../ui/Progress";
import { AutoHeight } from "../ui/motion";
import { useAutopilot } from "../autopilot/store";
import { BRIEF_EXAMPLES as EXAMPLES } from "./examples";
import { useAi } from "./store";



/**
 * "Describe your business" → suggested weights. The suggestion is shown as a reviewable
 * diff with a reason per factor; nothing changes until the user applies it, and Apply can
 * be undone. The model proposes inputs; the map's numbers still come from the engine.
 */
export function BriefBox() {
  const ai = useAi();
  const metro = useStore((s) => s.metro);
  const labels = useMemo(() => new Map((metro ? factorsFor(metro) : []).map((f) => [f.id, f.label])), [metro]);
  // bumps when an example fills the field, replaying a brief highlight so the eye follows the text
  const [filled, setFilled] = useState(0);

  if (ai.available !== true) return null;
  const loading = ai.briefStatus === "loading";
  const res = ai.proposal;

  return (
    <div className={`brief${loading ? " brief--loading" : ""}`}>
      <label className="brief__label" htmlFor="brief-input">
        <span className="ai-mark" aria-hidden="true">
          ✦
        </span>
        Describe your business
      </label>
      <div className={`brief__field${loading ? " brief__field--reading" : ""}`}>
        <textarea
          id="brief-input"
          rows={2}
          maxLength={BRIEF_MAX}
          placeholder="e.g. Premium mobile dog grooming for busy families with yards"
          value={ai.brief}
          disabled={loading}
          onChange={(e) => ai.setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void ai.submitBrief();
            }
          }}
        />
        {filled > 0 && <span key={filled} className="brief__flash" aria-hidden="true" />}
        <div className="brief__bar">
          <span className="brief__count" aria-live="off">
            {ai.brief.length}/{BRIEF_MAX}
          </span>
          {loading ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={ai.cancelBrief}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={ai.brief.trim().length < 8}
              onClick={() => void ai.submitBrief()}
              data-tip="Suggest weights for this business (Ctrl+Enter)"
            >
              Suggest weights
            </button>
          )}
        </div>
      </div>

      <AutoHeight>
        {!ai.brief && ai.briefStatus === "idle" && !res && (
          <div className="brief__examples" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip"
                onClick={() => {
                  ai.setBrief(ex);
                  setFilled((n) => n + 1);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {ai.brief.trim().length >= 8 && ai.briefStatus === "idle" && !res && (
          <p className="brief__autopilot appear">
            Or{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                useAutopilot.getState().setBrief(ai.brief);
                useStore.getState().open("autopilot");
              }}
            >
              let Autopilot build the whole campaign
            </button>
            : pins, budget, a script and video for every pin.
          </p>
        )}

        {loading && (
          <StagedProgress
            estimateMs={8000}
            steps={[
              "Reading your brief",
              `Matching it to the map's ${labels.size} factors`,
              "Choosing weights, with a reason for each",
              "Checking the reply against the schema",
            ]}
          >
            {/* the shape of the suggestion that's coming */}
            <Bone w="45%" h={12} />
            <Bone w="90%" />
            {[78, 64, 84].map((w) => (
              <span key={w} className="bone-row">
                <Bone w="26px" h={18} />
                <Bone w={`${w}%`} />
              </span>
            ))}
          </StagedProgress>
        )}

        {ai.briefStatus === "error" && (
          <p className="notice" role="alert">
            {ai.briefError}{" "}
            <button type="button" className="link" onClick={() => void ai.submitBrief()}>
              Try again
            </button>
          </p>
        )}

        {res && !res.plan.supported && (
          <div className="proposal proposal--unsupported" role="status">
            <p>{res.plan.note}</p>
            <button type="button" className="link" onClick={ai.discardProposal}>
              Dismiss
            </button>
          </div>
        )}

        {res?.plan.supported && (
          <div className="proposal" role="region" aria-label="Suggested weights">
            <p className="proposal__name">{res.plan.name}</p>
            <p className="proposal__summary">{res.plan.summary}</p>
            <ul className="proposal__list">
              {res.plan.weights.map((w) => (
                <li key={w.factor}>
                  <span className={`proposal__w proposal__w--${w.weight > 0 ? "pos" : "neg"}`} data-tip={WEIGHT_LABEL[w.weight as Weight]}>
                    {w.weight > 0 ? `+${w.weight}` : w.weight}
                  </span>
                  <span className="proposal__factor">
                    {labels.get(w.factor) ?? w.factor}
                    {res.plan.competitor === w.factor && <span className="tag">competition</span>}
                    <small>{w.reason}</small>
                  </span>
                </li>
              ))}
            </ul>
            {res.plan.note && <p className="proposal__note">{res.plan.note}</p>}
            <div className="proposal__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={ai.applyProposal}>
                Apply to map
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={ai.discardProposal}>
                Discard
              </button>
            </div>
            <p
              className="ai-meta"
              data-tip="Model, response time and cost of this suggestion. The reply is schema-checked before it's shown."
            >
              {usageLine(res.usage, res.cached)} · schema-checked
            </p>
          </div>
        )}
      </AutoHeight>
    </div>
  );
}
