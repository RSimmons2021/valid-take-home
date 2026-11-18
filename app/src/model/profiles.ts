import type { Weights } from "./factors";

/**
 * Starting points for common local-service businesses. Each says who the customer is
 * (households and the places that exist where they live) and who you compete with.
 * They are defaults to edit, not answers: the panel shows every weight.
 */
export interface Profile {
  id: string;
  label: string;
  blurb: string;
  /** competitor signal, shown with a "competition" tag in the factor list */
  competitor?: string;
  weights: Weights;
}

export const PROFILES: Profile[] = [
  {
    id: "home-repair",
    label: "Home repair",
    blurb: "Handyman and repair subscriptions. Owners of houses, near hardware stores and moving activity.",
    competitor: "home_trades",
    weights: { homes: 1, single: 2, home_retail: 1, moving: 1, home_trades: -1, nightlife: -1 },
  },
  {
    id: "cleaning",
    label: "Home cleaning",
    blurb: "Recurring cleaning. Dense, busy households with money to spend and few local cleaners.",
    competitor: "home_cleaning",
    weights: { homes: 2, premium_grocers: 1, daily_needs: 1, offices: 1, home_cleaning: -1 },
  },
  {
    id: "pet-care",
    label: "Pet care",
    blurb: "Dog walking, sitting and boarding. Where vets, groomers and dog parks cluster.",
    competitor: "pet_care",
    weights: { homes: 1, pet_life: 2, single: 1, pet_care: -1 },
  },
  {
    id: "fitness",
    label: "Fitness studio",
    blurb: "A boutique studio or class pass. Walkable, busy streets with few gyms nearby.",
    competitor: "fitness",
    weights: { homes: 2, daily_needs: 2, offices: 1, premium_grocers: 1, fitness: -1 },
  },
  {
    id: "family",
    label: "Tutoring & childcare",
    blurb: "Tutors, after-school and childcare. Where schools, playgrounds and pediatricians are.",
    competitor: "tutoring",
    weights: { homes: 1, families: 2, single: 1, tutoring: -1, nightlife: -2 },
  },
];

export const DEFAULT_PROFILE = PROFILES[0];

export function profileById(id: string | null | undefined): Profile | undefined {
  return PROFILES.find((p) => p.id === id);
}

/** Does `weights` still match the profile it started from? */
export function isPristine(profile: Profile, weights: Weights): boolean {
  const keys = new Set([...Object.keys(profile.weights), ...Object.keys(weights)]);
  for (const k of keys) if ((profile.weights[k] ?? 0) !== (weights[k] ?? 0)) return false;
  return true;
}
