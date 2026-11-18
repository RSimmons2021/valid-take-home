import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef } from "react";
import { type Metro, cellLabel, placesNear } from "../data/metro";
import { MILE } from "../model/plan";
import type { ScoreResult } from "../model/score";
import { verdict } from "../model/score";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import { applyBasemapTheme, basemapStyle } from "./basemap";
import { PALETTES, scoreColor } from "./colors";
import { registerMap } from "./snapshot";

let protocolAdded = false;

/**
 * Interleaved deck layers accept `beforeId` at runtime (cells render beneath the 3D
 * buildings), but the layer prop types don't declare it. Spread an untyped object.
 */
const UNDER_BUILDINGS = { beforeId: "buildings" } as object;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Metres of extrusion per home in 3D. A 400-home block stands ~1 km tall at metro zoom. */
const METRES_PER_HOME = 2.6;
const PITCH_3D = 52;
/** Zoom at which a cell's evidence links (~450 m) are legible. */
const EVIDENCE_ZOOM = 12.8;
const BEARING_3D = -18;

interface Evidence {
  from: [number, number];
  to: [number, number];
  prefer: boolean;
}

/**
 * The places behind a cell's score: every place within one ring that belongs to a
 * signal the user weighted, linked back to the cell. This is Radar's "what the data
 * sees" moment, answering the question the score raises: why here?
 */
function evidenceFor(metro: Metro, result: ScoreResult, cell: number): Evidence[] {
  const weights = new Map(result.active.map((a) => [a.factor.id, a.weight]));
  const from: [number, number] = [metro.lon[cell], metro.lat[cell]];
  const out: Evidence[] = [];
  for (const [s, list] of placesNear(metro, cell)) {
    const w = weights.get(metro.signals[s].id);
    if (!w) continue;
    for (const k of list.slice(0, 12)) {
      out.push({ from, to: [metro.places.lon[k], metro.places.lat[k]], prefer: w > 0 });
    }
  }
  return out;
}

/** The map: Overture basemap, scored H3 cells beneath the buildings, plan pins on top. */
export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markers = useRef<Marker[]>([]);
  const lastPinCells = useRef<Set<number>>(new Set());
  const introPlayed = useRef(false);
  const tooltip = useRef<HTMLDivElement>(null);

  const metro = useStore((s) => s.metro);
  const result = useStore((s) => s.result);
  const plan = useStore((s) => s.plan);
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const focusedPin = useStore((s) => s.focusedPin);
  const frameRequest = useStore((s) => s.frameRequest);
  const view3d = useStore((s) => s.view3d);
  const liftOverlay = useStore((s) => s.liftOverlay);
  const theme = useTheme((s) => s.theme);
  const palette = PALETTES[theme];

  // Map + overlay, once.
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    if (!protocolAdded) {
      addProtocol("pmtiles", new Protocol().tile);
      protocolAdded = true;
    }
    const release = useStore.getState().index?.release ?? "2026-10-21.0";
    const m = useStore.getState().metro;
    const map = new MlMap({
      container: container.current,
      style: basemapStyle(release, useTheme.getState().theme),
      center: m?.info.center ?? [-122.33, 37.79],
      zoom: m?.info.zoom ?? 11,
      pitch: 0,
      maxPitch: 70,
      attributionControl: { compact: true },
      dragRotate: true,
      hash: false,
      // Keep the frame readable after drawing, for the printed one-pager and link previews.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    map.on("click", (e: { point: { x: number; y: number } }) => {
      // deck handles cell clicks; a click that hits no cell clears the selection
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 0 });
      if (!picked) useStore.getState().select(null);
    });
    mapRef.current = map;
    overlayRef.current = overlay;
    registerMap(map);
    return () => {
      registerMap(null);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Theme: recolour the basemap in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyBasemapTheme(map, theme);
    else map.once("load", () => applyBasemapTheme(map, theme));
  }, [theme]);

  const ids = metro?.ids;
  const data = useMemo(() => (metro ? Array.from({ length: metro.n }, (_, i) => i) : []), [metro]);
  const focusCell = selected ?? hovered;
  // Cells of the lift test's ZIPs, tagged 1 = test, 2 = control.
  const liftCells = useMemo(() => {
    if (!metro || !liftOverlay) return [];
    const role = new Map<string, number>([...liftOverlay.test.map((z) => [z, 1] as const), ...liftOverlay.control.map((z) => [z, 2] as const)]);
    const out: { i: number; role: number }[] = [];
    for (let i = 0; i < metro.n; i++) {
      const z = metro.zip[i];
      const r = z >= 0 ? role.get(metro.zips[z].code) : undefined;
      if (r) out.push({ i, role: r });
    }
    return out;
  }, [metro, liftOverlay]);
  const evidence = useMemo(
    () => (metro && result && focusCell != null ? evidenceFor(metro, result, focusCell) : []),
    [metro, result, focusCell],
  );

  // Layers.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !metro || !result || !ids) return;
    const covered = new Uint8Array(metro.n);
    for (const p of plan?.pins ?? []) for (const i of p.covered) covered[i] = p.rank;
    const focus = focusedPin;
    const motion = reducedMotion() ? 0 : 1;

    overlay.setProps({
      layers: [
        new H3HexagonLayer<number>({
          id: "cells",
          data,
          getHexagon: (i) => ids[i],
          getFillColor: (i) => {
            const c = scoreColor(result.score[i], palette);
            if (focus != null && covered[i] !== focus) return [c[0], c[1], c[2], Math.round(c[3] * 0.3)];
            return c;
          },
          extruded: view3d,
          getElevation: (i) => (Number.isNaN(result.score[i]) ? 0 : metro.homes[i] * METRES_PER_HOME),
          material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [60, 64, 80] },
          stroked: false,
          highPrecision: false,
          pickable: true,
          autoHighlight: true,
          highlightColor: theme === "dark" ? [255, 255, 255, 50] : [5, 6, 8, 40],
          // Colours morph when a weight changes instead of snapping: the map "thinks".
          transitions: { getFillColor: 450 * motion, getElevation: 700 * motion },
          updateTriggers: { getFillColor: [result, focus, plan, theme], getElevation: [result] },
          ...UNDER_BUILDINGS,
          onHover: (info) => {
            useStore.getState().hover(info.object ?? null);
            const el = tooltip.current;
            if (!el) return;
            if (info.object == null) {
              el.hidden = true;
              return;
            }
            el.hidden = false;
            el.style.transform = `translate(${info.x + 14}px, ${info.y + 14}px)`;
          },
          onClick: (info) => {
            if (info.object != null) useStore.getState().select(info.object);
          },
        }),
        new ScatterplotLayer({
          id: "pin-radius",
          data: plan?.pins ?? [],
          getPosition: (p) => [p.lon, p.lat],
          getRadius: (p) => p.radiusMi * MILE,
          radiusUnits: "meters",
          stroked: true,
          filled: true,
          getFillColor: (p) => (focus === p.rank ? [0, 225, 240, 40] : palette.ringFill),
          getLineColor: (p) =>
            focus == null || focus === p.rank ? palette.ring : [palette.ring[0], palette.ring[1], palette.ring[2], 60],
          getLineWidth: (p) => (focus === p.rank ? 2.5 : 1.25),
          lineWidthUnits: "pixels",
          transitions: { getRadius: 500 * motion },
          updateTriggers: { getFillColor: [focus, theme], getLineColor: [focus, theme], getLineWidth: [focus] },
          ...UNDER_BUILDINGS,
        }),
        new H3HexagonLayer<{ i: number; role: number }>({
          id: "lift-overlay",
          data: liftCells,
          getHexagon: (d) => ids[d.i],
          extruded: false,
          stroked: true,
          filled: true,
          getFillColor: (d) => (d.role === 1 ? [22, 38, 255, 0] : [255, 184, 31, theme === "dark" ? 70 : 90]),
          getLineColor: (d) => (d.role === 1 ? palette.prefer : [255, 160, 0, 230]),
          getLineWidth: 1.2,
          lineWidthUnits: "pixels",
          updateTriggers: { getFillColor: [theme], getLineColor: [theme] },
        }),
        new LineLayer<Evidence>({
          id: "evidence-links",
          data: evidence,
          getSourcePosition: (d) => d.from,
          getTargetPosition: (d) => d.to,
          getColor: (d) => {
            const c = d.prefer ? palette.prefer : palette.avoid;
            return [c[0], c[1], c[2], 150];
          },
          getWidth: 1.2,
          widthUnits: "pixels",
          updateTriggers: { getColor: [theme] },
        }),
        new ScatterplotLayer<Evidence>({
          id: "evidence-places",
          data: evidence,
          getPosition: (d) => d.to,
          getRadius: 3.5,
          radiusUnits: "pixels",
          stroked: true,
          getFillColor: (d) => (d.prefer ? palette.prefer : palette.avoid),
          getLineColor: theme === "dark" ? [10, 11, 13, 255] : [251, 251, 249, 255],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          updateTriggers: { getFillColor: [theme], getLineColor: [theme] },
        }),
        new H3HexagonLayer<number>({
          id: "selected",
          data: selected == null ? [] : [selected],
          getHexagon: (i) => ids[i],
          filled: false,
          stroked: true,
          extruded: false,
          getLineColor: palette.selected,
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
          updateTriggers: { getLineColor: [theme] },
        }),
      ],
    });
  }, [metro, result, plan, selected, focusedPin, data, ids, evidence, view3d, theme, palette, liftCells]);

  // Pin markers (HTML, so the numbers use the interface type). Only pins that are new to
  // the plan drop in, so tuning a weight doesn't replay the animation on every pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markers.current) m.remove();
    const before = lastPinCells.current;
    let stagger = 0;
    markers.current = (plan?.pins ?? []).map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      const isNew = !before.has(p.cell);
      el.className = `pin${focusedPin === p.rank ? " pin--focus" : ""}${isNew ? " pin--new" : ""}`;
      if (isNew) el.style.setProperty("--delay", `${stagger++ * 70}ms`);
      el.textContent = String(p.rank);
      el.setAttribute("aria-label", `Pin ${p.rank}: ${p.label.hood ?? p.label.city ?? "unnamed area"}`);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = useStore.getState();
        s.focusPin(s.focusedPin === p.rank ? null : p.rank);
      });
      return new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    });
    lastPinCells.current = new Set((plan?.pins ?? []).map((p) => p.cell));
  }, [plan, focusedPin]);

  // Camera: frame the plan (or the metro) on request. The first time, open with
  // Radar's establishing shot: pitched low over the clay city, swinging round and
  // settling into the plan.
  useEffect(() => {
    const map = mapRef.current;
    const s = useStore.getState();
    if (!map || !s.metro) return;
    const target = planBounds(s.metro, s.plan?.pins ?? []);
    const cam = map.cameraForBounds(target, { padding: framePadding(), maxZoom: 13.5 });
    if (!cam) return;
    const settle = { ...cam, pitch: s.view3d ? PITCH_3D : 0, bearing: s.view3d ? BEARING_3D : 0 };
    if (!introPlayed.current && !reducedMotion()) {
      introPlayed.current = true;
      const zoom = (cam.zoom ?? s.metro.info.zoom) + 1.1;
      map.jumpTo({ center: cam.center, zoom, pitch: 64, bearing: -42 });
      map.easeTo({ ...settle, duration: 3400, easing: easeInOutCubic });
      return;
    }
    introPlayed.current = true;
    map.easeTo({ ...settle, duration: reducedMotion() ? 0 : 900 });
  }, [frameRequest]);

  // Camera: fly to a focused pin.
  useEffect(() => {
    const map = mapRef.current;
    const pin = plan?.pins.find((p) => p.rank === focusedPin);
    if (!map || !pin) return;
    const dLat = (pin.radiusMi * MILE * 1.25) / 111_320;
    const dLon = dLat / Math.cos((pin.lat * Math.PI) / 180);
    map.fitBounds(
      [
        [pin.lon - dLon, pin.lat - dLat],
        [pin.lon + dLon, pin.lat + dLat],
      ],
      // the pin card opens beside the left panel; keep the circle clear of both
      { padding: framePadding(true), duration: reducedMotion() ? 0 : 700, pitch: map.getPitch(), bearing: map.getBearing() },
    );
  }, [focusedPin, plan]);

  // Selecting a cell opens a card over the map. Keep the cell (and its evidence links)
  // in the clear space between the card and the plan panel instead of under the card.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selected == null || !metro) return;
    const canvas = map.getContainer().getBoundingClientRect();
    const card = document.querySelector(".card")?.getBoundingClientRect();
    const right = document.querySelector(".panel--right")?.getBoundingClientRect();
    if (!card || window.innerWidth <= 900) return;
    const left = card.right - canvas.left;
    const rightEdge = (right ? right.left : canvas.right) - canvas.left;
    const lngLat: [number, number] = [metro.lon[selected], metro.lat[selected]];
    const pt = map.project(lngLat);
    const margin = 60;
    // Evidence links span ~450 m: below neighbourhood zoom they collapse into a dot.
    const zoom = Math.max(map.getZoom(), EVIDENCE_ZOOM);
    const visible = pt.x > left + margin && pt.x < rightEdge - margin;
    if (visible && zoom === map.getZoom()) return;
    const targetX = visible ? pt.x : (left + rightEdge) / 2;
    map.easeTo({
      center: lngLat,
      zoom,
      offset: [targetX - canvas.width / 2, pt.y - canvas.height / 2],
      duration: reducedMotion() ? 0 : 700,
    });
  }, [selected, metro]);

  // 3D: tilt the camera and hide the buildings (the cells are the buildings now).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const go = () => {
      if (map.getLayer("buildings")) map.setLayoutProperty("buildings", "visibility", view3d ? "none" : "visible");
      if (!introPlayed.current) return;
      map.easeTo({
        pitch: view3d ? PITCH_3D : 0,
        bearing: view3d ? BEARING_3D : 0,
        duration: reducedMotion() ? 0 : 1100,
        easing: easeInOutCubic,
      });
    };
    if (map.isStyleLoaded()) go();
    else map.once("load", go);
  }, [view3d]);

  const hoverInfo = metro && result && hovered != null ? { label: cellLabel(metro, hovered), score: result.score[hovered] } : null;

  return (
    <div className="map">
      <div ref={container} className="map__canvas" />
      <div ref={tooltip} className="map__tooltip" hidden>
        {hoverInfo && (
          <>
            <b>{hoverInfo.label.hood ?? hoverInfo.label.city ?? "Unnamed area"}</b>
            <span>
              {Number.isNaN(hoverInfo.score) ? "Too few homes to score" : `${Math.round(hoverInfo.score)} · ${verdict(hoverInfo.score)}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function planBounds(metro: Metro, pins: { lat: number; lon: number; radiusMi: number }[]): LngLatBounds {
  if (!pins.length) {
    const [xmin, ymin, xmax, ymax] = metro.info.bbox;
    return new LngLatBounds([xmin, ymin], [xmax, ymax]);
  }
  const b = new LngLatBounds();
  for (const p of pins) {
    const dLat = (p.radiusMi * MILE) / 111_320;
    const dLon = dLat / Math.cos((p.lat * Math.PI) / 180);
    b.extend([p.lon - dLon, p.lat - dLat]).extend([p.lon + dLon, p.lat + dLat]);
  }
  return b;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function framePadding(withCard = false) {
  const wide = window.innerWidth > 900;
  if (!wide) return { top: 60, bottom: 60, left: 30, right: 30 };
  return { top: 80, bottom: 70, left: withCard ? 740 : 380, right: 400 };
}
