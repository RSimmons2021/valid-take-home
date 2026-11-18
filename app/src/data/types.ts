/** The file the pipeline writes (pipeline/catchment/aggregate.py). Columnar: arrays align by cell. */
export interface MetroFile {
  metro: MetroInfo;
  release: string;
  schema: string;
  h3_res: number;
  built_at: string;
  signals: SignalDef[];
  ledger: Ledger;
  names: string[];
  zips: { code: string; homes: number }[];
  hexes: {
    id: string[];
    homes: number[];
    rooftops: number[];
    single: number[];
    buildings: number[];
    height: (number | null)[];
    footprint: number[];
    zip: number[];
    hood: number[];
    city: number[];
    signals: Record<string, number[]>;
  };
  /** places that changed since the previous Overture release, matched by GERS id (null if not built) */
  changes?: {
    since: string;
    added: ChangedPlaces;
    closed: ChangedPlaces;
    totals: { new_ids: number; newly_closed: number };
  } | null;
  places: {
    id: string[];
    name: string[];
    brand: (string | null)[];
    signal: number[];
    confidence: number[];
    lon: number[];
    lat: number[];
  };
}

export interface ChangedPlaces {
  id: string[];
  name: string[];
  signal: number[];
  lon: number[];
  lat: number[];
}

export interface MetroInfo {
  id: string;
  name: string;
  region: string;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
}

export interface SignalDef {
  id: string;
  label: string;
  description: string;
}

export interface Ledger {
  places: {
    raw: number;
    kept: number;
    dropped: Record<"closed" | "low_confidence" | "uncategorized" | "duplicate", number>;
    min_confidence: number;
    dedupe_meters: number;
  };
  addresses: { in_metro: number; rooftops: number; with_postcode: number; units_per_rooftop: number };
  buildings: { in_metro: number; with_height: number };
  cells: number;
  signal_places: Record<string, number>;
}

export interface IndexFile {
  release: string;
  schema: string;
  metros: MetroSummary[];
}

export interface MetroSummary {
  id: string;
  name: string;
  region: string;
  center: [number, number];
  zoom: number;
  cells: number;
  homes: number;
  places_kept: number;
  units_per_rooftop: number;
  bytes: number;
}
