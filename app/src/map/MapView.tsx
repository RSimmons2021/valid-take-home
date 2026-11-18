import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef } from "react";
import { cellLabel } from "../data/metro";
import { MILE } from "../model/plan";
import { verdict } from "../model/score";
import { useStore } from "../state/store";
import { basemapStyle } from "./basemap";
import { scoreColor } from "./colors";

let protocolAdded = false;

/**
 * Interleaved deck layers accept `beforeId` at runtime (cells render beneath the 3D
 * buildings), but the layer prop types don't declare it. Spread an untyped object.
 */
const UNDER_BUILDINGS = { beforeId: "buildings" } as object;

/** The map: Overture basemap, scored H3 cells beneath the buildings, plan pins on top. */
export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markers = useRef<Marker[]>([]);
  const tooltip = useRef<HTMLDivElement>(null);

  const metro = useStore((s) => s.metro);
  const result = useStore((s) => s.result);
  const plan = useStore((s) => s.plan);
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const focusedPin = useStore((s) => s.focusedPin);
  const frameRequest = useStore((s) => s.frameRequest);

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
      style: basemapStyle(release),
      center: m?.info.center ?? [-122.33, 37.79],
      zoom: m?.info.zoom ?? 11,
      pitch: 0,
      maxPitch: 60,
      attributionControl: { compact: true },
      dragRotate: true,
      hash: false,
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const ids = metro?.ids;
  const data = useMemo(() => (metro ? Array.from({ length: metro.n }, (_, i) => i) : []), [metro]);

  // Layers.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !metro || !result || !ids) return;
    const covered = new Uint8Array(metro.n);
    for (const p of plan?.pins ?? []) for (const i of p.covered) covered[i] = p.rank;
    const focus = focusedPin;

    overlay.setProps({
      layers: [
        new H3HexagonLayer<number>({
          id: "cells",
          data,
          getHexagon: (i) => ids[i],
          getFillColor: (i) => {
            const c = scoreColor(result.score[i]);
            if (focus != null && covered[i] !== focus) return [c[0], c[1], c[2], Math.round(c[3] * 0.35)];
            return c;
          },
          extruded: false,
          stroked: false,
          highPrecision: false,
          pickable: true,
          autoHighlight: true,
          highlightColor: [5, 6, 8, 40],
          updateTriggers: { getFillColor: [result, focus, plan] },
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
          getFillColor: (p) => (focus === p.rank ? [0, 225, 240, 34] : [0, 225, 240, 14]),
          getLineColor: (p) => (focus == null || focus === p.rank ? [5, 6, 8, 210] : [5, 6, 8, 70]),
          getLineWidth: (p) => (focus === p.rank ? 2.5 : 1.25),
          lineWidthUnits: "pixels",
          updateTriggers: { getFillColor: [focus], getLineColor: [focus], getLineWidth: [focus] },
          ...UNDER_BUILDINGS,
        }),
        new H3HexagonLayer<number>({
          id: "selected",
          data: selected == null ? [] : [selected],
          getHexagon: (i) => ids[i],
          filled: false,
          stroked: true,
          extruded: false,
          getLineColor: [5, 6, 8, 255],
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
        }),
      ],
    });
  }, [metro, result, plan, selected, focusedPin, data, ids]);

  // Pin markers (HTML, so the numbers use the interface type).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markers.current) m.remove();
    markers.current = (plan?.pins ?? []).map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pin${focusedPin === p.rank ? " pin--focus" : ""}`;
      el.textContent = String(p.rank);
      el.setAttribute("aria-label", `Pin ${p.rank}`);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = useStore.getState();
        s.focusPin(s.focusedPin === p.rank ? null : p.rank);
      });
      return new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    });
  }, [plan, focusedPin]);

  // Camera: frame the plan (or the metro) on request.
  useEffect(() => {
    const map = mapRef.current;
    const s = useStore.getState();
    if (!map || !s.metro) return;
    const pins = s.plan?.pins ?? [];
    const pad = framePadding();
    if (pins.length) {
      const b = new LngLatBounds();
      for (const p of pins) {
        const dLat = (p.radiusMi * MILE) / 111_320;
        const dLon = dLat / Math.cos((p.lat * Math.PI) / 180);
        b.extend([p.lon - dLon, p.lat - dLat]).extend([p.lon + dLon, p.lat + dLat]);
      }
      map.fitBounds(b, { padding: pad, duration: 900, maxZoom: 13.5 });
    } else {
      const [xmin, ymin, xmax, ymax] = s.metro.info.bbox;
      map.fitBounds([xmin, ymin, xmax, ymax], { padding: pad, duration: 900 });
    }
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
      { padding: framePadding(), duration: 700 },
    );
  }, [focusedPin, plan]);

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

function framePadding() {
  const wide = window.innerWidth > 980;
  return wide ? { top: 80, bottom: 60, left: 380, right: 400 } : { top: 60, bottom: 60, left: 30, right: 30 };
}
