import type { Metro } from "../data/metro";

/** A weight is a preference, not a coefficient: users pick one of five steps. */
export type Weight = -2 | -1 | 0 | 1 | 2;
export const WEIGHTS: Weight[] = [-2, -1, 0, 1, 2];
export const WEIGHT_LABEL: Record<Weight, string> = {
  [-2]: "Avoid strongly",
  [-1]: "Avoid",
  0: "Ignore",
  1: "Prefer",
  2: "Prefer strongly",
};

export type Weights = Record<string, Weight>;

export interface Factor {
  id: string;
  label: string;
  description: string;
  group: "households" | "places";
  /** the per-cell value the factor ranks on; NaN means "no information" */
  value: (m: Metro) => Float64Array;
  /** how to print a cell's raw value */
  format: (v: number) => string;
}

const HOUSEHOLD_FACTORS: Factor[] = [
  {
    id: "homes",
    label: "Homes",
    description: "Addresses in the cell, with apartment units counted separately where the county lists them.",
    group: "households",
    value: (m) => m.homes,
    format: (v) => `${Math.round(v).toLocaleString()} homes`,
  },
  {
    id: "single",
    label: "Detached houses",
    description:
      "Share of rooftops with a single address and no units: houses rather than apartment blocks. A proxy for owners, yards and garages.",
    group: "households",
    value: (m) => Float64Array.from(m.single, (v, i) => (m.rooftops[i] >= 5 ? v : Number.NaN)),
    format: (v) => (Number.isNaN(v) ? "too few rooftops" : `${Math.round(v * 100)}% of rooftops`),
  },
];

export function factorsFor(m: Metro): Factor[] {
  return [
    ...HOUSEHOLD_FACTORS,
    ...m.signals.map<Factor>((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      group: "places",
      value: (mm) => mm.near[s.id],
      format: (v) => `${v} within ~450 m`,
    })),
  ];
}

export function factorMap(m: Metro): Map<string, Factor> {
  return new Map(factorsFor(m).map((f) => [f.id, f]));
}
