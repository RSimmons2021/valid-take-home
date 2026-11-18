/**
 * Plain-data descriptions of the household factors. Signals are described by the data
 * files themselves; these two are computed from addresses, so they're defined here.
 *
 * Shared by the browser (factors.ts) and the AI server (server/), so the model is told
 * exactly the labels and meanings the user sees. Keep this file dependency-free: the
 * server runs it directly with Node's type stripping.
 */
export interface FactorInfo {
  id: string;
  label: string;
  description: string;
}

export const HOUSEHOLD_INFO: FactorInfo[] = [
  {
    id: "homes",
    label: "Homes",
    description: "Addresses in the cell, with apartment units counted separately where the county lists them.",
  },
  {
    id: "single",
    label: "Detached houses",
    description:
      "Share of rooftops with a single address and no units: houses rather than apartment blocks. A proxy for owners, yards and garages.",
  },
];
