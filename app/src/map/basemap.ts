import type { StyleSpecification } from "maplibre-gl";

/**
 * The basemap is Overture too: base, transportation, buildings and divisions PMTiles,
 * read straight from Overture's public bucket with HTTP range requests (CORS is open).
 * Pinned to the same release as the data so the map and the numbers always agree.
 *
 * Styled as an architect's model: paper land, quiet water, white streets, clay buildings.
 */
export function basemapStyle(release: string): StyleSpecification {
  const tiles = (theme: string) =>
    `pmtiles://https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${release}/${theme}.pmtiles`;
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
      { id: "background", type: "background", paint: { "background-color": "#e7e4dc" } },
      {
        id: "land-cover",
        type: "fill",
        source: "base",
        "source-layer": "land_cover",
        filter: ["in", ["get", "subtype"], ["literal", ["forest", "shrub", "grass", "wetland"]]],
        paint: { "fill-color": "#dcdccc", "fill-opacity": 0.55 },
      },
      {
        id: "land-use-green",
        type: "fill",
        source: "base",
        "source-layer": "land_use",
        filter: ["in", ["get", "subtype"], ["literal", ["park", "recreation", "golf", "cemetery", "protected"]]],
        paint: { "fill-color": "#d6d9c4", "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "base",
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#c9d0d1" },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        minzoom: 12,
        filter: road(["residential", "service", "unclassified", "living_street"]) as never,
        paint: {
          "line-color": "#f7f5f0",
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
          "line-color": "#fbfaf6",
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
          "line-color": "#ffffff",
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
          "fill-extrusion-color": "#ddd6c8",
          "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.85],
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
        paint: { "text-color": "#6e7178", "text-halo-color": "#f7f5f0", "text-halo-width": 1.4 },
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
        paint: { "text-color": "#3c3f45", "text-halo-color": "rgba(231,228,220,0.9)", "text-halo-width": 1.6 },
      },
    ],
  };
}
