import { Map as MlMap } from "maplibre-gl";
import { type Metro, cellPolygon } from "../data/metro";
import { basemapStyle } from "../map/basemap";
import { PALETTES, scoreColor } from "../map/colors";
import type { Callout } from "../model/campaign";
import { MILE, type Pin } from "../model/plan";
import { FILM, type FilmSpec } from "./film";

/** The ring sits at this radius in the film, centred a little below the title card. */
const RING_PX = 250;
const CENTER: [number, number] = [FILM.width / 2, 700];

export type FilmFrame = Pick<FilmSpec, "still" | "center" | "radiusPx" | "hexes" | "callouts">;

/**
 * Photograph each pin's neighbourhood for its film. A hidden map of its own does the work
 * (fixed 720×1280, pixel ratio 1, light palette), so making videos never moves the map the
 * person is looking at, and a film looks the same whatever theme they use. Blocks and
 * places are projected while that map is framed on the pin, so they line up exactly.
 */
export async function captureFrames(
  metro: Metro,
  score: Float64Array,
  release: string,
  shots: { pin: Pin; callouts: Callout[] }[],
  onEach?: (done: number) => void,
): Promise<Map<number, FilmFrame>> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${FILM.width}px`,
    height: `${FILM.height}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(host);
  const map = new MlMap({
    container: host,
    style: basemapStyle(release, "light"),
    center: [shots[0]?.pin.lon ?? metro.info.center[0], shots[0]?.pin.lat ?? metro.info.center[1]],
    zoom: 13,
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  const out = new Map<number, FilmFrame>();
  try {
    await settle(map, "load", 10_000);
    const palette = PALETTES.light;
    for (const [n, { pin, callouts }] of shots.entries()) {
      const radiusM = pin.radiusMi * MILE;
      // metres per pixel at this latitude for 512-px tiles: choose the zoom that puts the ring at RING_PX
      const mpp = radiusM / RING_PX;
      const zoom = Math.log2((40_075_016.686 * Math.cos((pin.lat * Math.PI) / 180)) / (512 * mpp));
      // top padding moves the visual centre down to CENTER, clear of the title card
      map.jumpTo({ center: [pin.lon, pin.lat], zoom, padding: { top: 2 * (CENTER[1] - FILM.height / 2), bottom: 0, left: 0, right: 0 } });
      await settle(map, "idle", 6_000);

      const still = document.createElement("canvas");
      still.width = FILM.width;
      still.height = FILM.height;
      still.getContext("2d")!.drawImage(map.getCanvas(), 0, 0, FILM.width, FILM.height);

      const px = (lon: number, lat: number): [number, number] => {
        const p = map.project([lon, lat]);
        return [p.x, p.y];
      };
      const [cx, cy] = px(pin.lon, pin.lat);
      // a point on the ring, due east, gives the ring's radius in film pixels
      const edge = px(pin.lon + radiusM / (111_320 * Math.cos((pin.lat * Math.PI) / 180)), pin.lat);
      const hexes: FilmFrame["hexes"] = [];
      for (let i = 0; i < metro.n; i++) {
        if (Number.isNaN(score[i])) continue;
        const d = Math.hypot(metro.x[i] - metro.x[pin.cell], metro.y[i] - metro.y[pin.cell]);
        if (d > radiusM) continue;
        const [r, g, b, a] = scoreColor(score[i], palette);
        hexes.push({ pts: cellPolygon(metro.ids[i]).map(([lon, lat]) => px(lon, lat)), color: `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`, d: d / radiusM });
      }
      out.set(pin.rank, {
        still,
        center: [cx, cy],
        radiusPx: Math.hypot(edge[0] - cx, edge[1] - cy),
        hexes,
        callouts: callouts.map((c) => {
          const [x, y] = px(c.lon, c.lat);
          return { name: c.name, kind: c.kind, x, y };
        }),
      });
      onEach?.(n + 1);
    }
  } finally {
    map.remove();
    host.remove();
  }
  return out;
}

/** Wait for a map event, but never forever: a slow tile shouldn't stall the whole run. */
function settle(map: MlMap, event: "load" | "idle", timeoutMs: number): Promise<void> {
  if (event === "load" && map.loaded()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    map.once(event, () => {
      clearTimeout(t);
      resolve();
    });
  });
}
