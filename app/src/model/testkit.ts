import { gridDisk, latLngToCell } from "h3-js";
import { buildMetro } from "../data/metro";
import type { MetroFile } from "../data/types";

/** Test-only helpers: small synthetic metros built from real H3 cells. */

/** A synthetic metro: a disk of cells around a centre, with per-cell overrides. */
export function fakeMetro(opts: {
  k?: number;
  homes?: (i: number, id: string) => number;
  vets?: (i: number) => number;
  zip?: (i: number) => number;
  /** number of ZIP codes (94100, 94101, …); default 2 */
  zipCount?: number;
}): ReturnType<typeof buildMetro> {
  const centre: [number, number] = [-122.42, 37.77];
  const ids = gridDisk(latLngToCell(centre[1], centre[0], 9), opts.k ?? 6).sort();
  const homes = ids.map((id, i) => opts.homes?.(i, id) ?? 100);
  const file: MetroFile = {
    metro: { id: "t", name: "Test", region: "CA", bbox: [-123, 37, -122, 38], center: centre, zoom: 12 },
    release: "test",
    schema: "2.0.0",
    h3_res: 9,
    built_at: "",
    signals: [{ id: "pet_life", label: "Pet owners", description: "" }],
    ledger: {} as MetroFile["ledger"],
    names: ["Hood"],
    zips: opts.zipCount
      ? Array.from({ length: opts.zipCount }, (_, k) => ({ code: String(94100 + k), homes: 0 }))
      : [
          { code: "94110", homes: 0 },
          { code: "94114", homes: 0 },
        ],
    hexes: {
      id: ids,
      homes,
      rooftops: homes.map((h) => h / 2),
      single: ids.map(() => 50),
      buildings: ids.map(() => 10),
      height: ids.map(() => 8),
      footprint: ids.map(() => 1000),
      zip: ids.map((_, i) => opts.zip?.(i) ?? 0),
      hood: ids.map(() => 0),
      city: ids.map(() => -1),
      signals: { pet_life: ids.map((_, i) => opts.vets?.(i) ?? 0) },
    },
    places: { id: [], name: [], brand: [], signal: [], confidence: [], lon: [], lat: [] },
  };
  for (const z of file.zips) z.homes = 0;
  ids.forEach((_, i) => {
    file.zips[file.hexes.zip[i]].homes += homes[i];
  });
  return buildMetro(file);
}

