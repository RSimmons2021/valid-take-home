import type { Map as MlMap, StyleSpecification } from "maplibre-gl";
import type { Theme } from "../state/theme";

/**
 * The basemap is Overture too: base, transportation, buildings and divisions PMTiles,
 * read straight from Overture's public bucket with HTTP range requests (CORS is open).
 * Pinned to the same release as the data so the map and the numbers always agree.
 *
 * Light is an architect's model (paper land, white streets, clay buildings); dark is
 * Radar's machine view (ink land, graphite streets, buildings as dim glass).
 */
interface Palette {
  background: string;
  landCover: string;
  green: string;
  water: string;
  roadMinor: string;
  roadMajor: string;
  motorway: string;
  building: string;
  buildingOpacity: number;
  roadLabel: string;
  placeLabel: string;
  halo: string;
}

const PALETTES: Record<Theme, Palette> = {
  light: {
    background: "#e7e4dc",
    landCover: "#dcdccc",
    green: "#d6d9c4",
    water: "#c9d0d1",
    roadMinor: "#f7f5f0",
    roadMajor: "#fbfaf6",
    motorway: "#ffffff",
    building: "#ddd6c8",
    buildingOpacity: 0.85,
    roadLabel: "#6e7178",
    placeLabel: "#3c3f45",
    halo: "rgba(231,228,220,0.9)",
  },
  dark: {
    background: "#131418",
    landCover: "#16191a",
    green: "#151a17",
    water: "#07080b",
    roadMinor: "#1f2127",
    roadMajor: "#2a2d35",
    motorway: "#363a44",
    building: "#262a33",
    buildingOpacity: 0.9,
    roadLabel: "#7d818b",
    placeLabel: "#b7b8be",
    halo: "rgba(10,11,13,0.9)",
  },
};

/** Which paint property of which layer reads which palette entry. One table drives both build and theme switch. */
const PAINT: [layer: string, property: string, key: keyof Palette][] = [
  ["background", "background-color", "background"],
  ["land-cover", "fill-color", "landCover"],
  ["land-use-green", "fill-color", "green"],
  ["water", "fill-color", "water"],
  ["roads-minor", "line-color", "roadMinor"],
  ["roads-major", "line-color", "roadMajor"],
  ["roads-motorway", "line-color", "motorway"],
  ["buildings", "fill-extrusion-color", "building"],
  ["road-labels", "text-color", "roadLabel"],
  ["road-labels", "text-halo-color", "halo"],
  ["place-labels", "text-color", "placeLabel"],
  ["place-labels", "text-halo-color", "halo"],
];

/** Recolour a live map in place: no style reload, so tiles and deck layers stay put. */
export function applyBasemapTheme(map: MlMap, theme: Theme): void {
  const p = PALETTES[theme];
  for (const [layer, prop, key] of PAINT) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, p[key]);
  }
  if (map.getLayer("buildings")) map.setPaintProperty("buildings", "fill-extrusion-opacity", buildingOpacity(p));
}

function buildingOpacity(p: Palette) {
  return ["interpolate", ["linear"], ["zoom"], 13, 0, 14, p.buildingOpacity];
}

export function basemapStyle(release: string, theme: Theme): StyleSpecification {
  const p = PALETTES[theme];
  const tiles = (t: string) => `pmtiles://https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${release}/${t}.pmtiles`;
  const attribution =
    '<a href="https://overturemaps.org" target="_blank" rel="noreferrer">© Overture Maps Foundation</a> · <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">sources</a>';

  const road = (classes: string[]) => ["all", ["==", ["get", "subtype"], "road"], ["in", ["get", "class"], ["literal", classes]]];

  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      base: { type: "vector", url: tiles("base"), attribution },
      transportation: { type: "vector", url: tiles("transportation") },
      buildings: { type: "vector", url: tiles("buildings") },
      divisions: { type: "vector", url: tiles("divisions") },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      {
        id: "land-cover",
        type: "fill",
        source: "base",
        "source-layer": "land_cover",
        filter: ["in", ["get", "subtype"], ["literal", ["forest", "shrub", "grass", "wetland"]]],
        paint: { "fill-color": p.landCover, "fill-opacity": 0.55 },
      },
      {
        id: "land-use-green",
        type: "fill",
        source: "base",
        "source-layer": "land_use",
        filter: ["in", ["get", "subtype"], ["literal", ["park", "recreation", "golf", "cemetery", "protected"]]],
        paint: { "fill-color": p.green, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "base",
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": p.water },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        minzoom: 12,
        filter: road(["residential", "service", "unclassified", "living_street"]) as never,
        paint: {
          "line-color": p.roadMinor,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.4, 16, 5],
        },
      },
      {
        id: "roads-major",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        minzoom: 8,
        filter: road(["primary", "secondary", "tertiary", "trunk"]) as never,
        paint: {
          "line-color": p.roadMajor,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 9, 0.6, 16, 9],
        },
      },
      {
        id: "roads-motorway",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        minzoom: 6,
        filter: road(["motorway"]) as never,
        paint: {
          "line-color": p.motorway,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.8, 16, 12],
        },
      },
      {
        // Hex cells are inserted beneath this layer, so buildings stand on the score.
        id: "buildings",
        type: "fill-extrusion",
        source: "buildings",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": p.building,
          "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
          "fill-extrusion-opacity": buildingOpacity(p) as never,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "transportation",
        "source-layer": "segment",
        minzoom: 14,
        filter: road(["primary", "secondary", "tertiary", "residential"]) as never,
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "@name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10.5,
          "text-letter-spacing": 0.02,
        },
        paint: { "text-color": p.roadLabel, "text-halo-color": p.halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "divisions",
        "source-layer": "division",
        filter: [
          "all",
          ["in", ["get", "subtype"], ["literal", ["locality", "neighborhood", "macrohood"]]],
          // Chicago police beats are tagged as neighbourhoods in Overture; nobody lives in "Beat 2511".
          ["!=", ["slice", ["coalesce", ["get", "@name"], ""], 0, 5], "Beat "],
        ],
        layout: {
          "text-field": ["get", "@name"],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["match", ["get", "subtype"], "locality", 13, 11],
          "text-transform": ["match", ["get", "subtype"], "locality", "none", "uppercase"],
          "text-letter-spacing": ["match", ["get", "subtype"], "locality", 0.01, 0.08],
          "text-max-width": 8,
          "text-padding": 6,
        },
        paint: { "text-color": p.placeLabel, "text-halo-color": p.halo, "text-halo-width": 1.6 },
      },
    ],
  };
}
