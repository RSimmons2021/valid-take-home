import { useAi } from "../../ai/store";
import { useStore } from "../../state/store";

export type Side = "right" | "left" | "top" | "bottom";

export interface Step {
  /** CSS selector of the thing being explained (first match); it gets the spotlight */
  target: string;
  /** a smaller element inside the target to circle and point at, when the target is large */
  mark?: string;
  /** where the note sits relative to the target on wide screens */
  side: Side;
  /** handwritten headline */
  title: string;
  body: string;
  /** put the app in the state this step talks about */
  before?: () => void;
  /** only include the step when this holds (e.g. AI is configured) */
  when?: () => boolean;
}

const closeCard = () => useStore.getState().select(null);

/**
 * The tour follows the three-panel flow a buyer actually takes: business → what matters →
 * read the map → why one block → where the pins went → export. Step 4 opens a real cell (the
 * best one) instead of describing a card that isn't on screen.
 */
export const STEPS: Step[] = [
  {
    target: ".brief",
    side: "right",
    title: "Say it in your own words",
    body: "Describe the business and AI suggests which signals matter, with a reason for each. You review it before anything changes.",
    before: closeCard,
    when: () => useAi.getState().available === true,
  },
  {
    target: ".profiles",
    side: "right",
    title: "Or pick a type",
    body: "Each business type starts with sensible weights you can change.",
    before: closeCard,
  },
  {
    target: ".factors .weight",
    side: "right",
    title: "Say what matters",
    body: "Blue squares mean prefer, red means avoid. The map rescores the moment you click.",
    before: closeCard,
  },
  {
    target: ".legend__ramp",
    side: "top",
    title: "Darker blue = better fit",
    body: "Pale blocks are a weaker match, grey ones are below average. Areas with too few homes stay unshaded.",
    before: closeCard,
  },
  {
    target: ".card",
    mark: ".card__verdict",
    side: "right",
    title: "Every block explains itself",
    body: "Click any block to see why it scored that way, and the real Overture places behind it. Lines on the map link them.",
    before: () => {
      const s = useStore.getState();
      const best = s.result?.order[0];
      if (best != null) s.select(best);
    },
  },
  {
    target: ".stats",
    side: "left",
    title: "Pins go where the fit is",
    body: "Radius pins land where they reach the most well-matched homes. Click a pin for local ad ideas grounded in the places inside it.",
    before: () => {
      closeCard();
      useStore.getState().requestFrame(); // pull back from the cell to show every pin
    },
  },
  {
    target: ".panel__foot .btn",
    side: "left",
    title: "Then take it to your ads",
    body: "Export ZIP codes and radius pins that paste straight into Meta and Google Ads.",
    before: closeCard,
  },
];

/** The steps that apply right now (AI steps only when AI is available). */
export function activeSteps(): Step[] {
  return STEPS.filter((s) => !s.when || s.when());
}
