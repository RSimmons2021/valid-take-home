import type { Map as MlMap } from "maplibre-gl";

/**
 * Map snapshots for the printed one-pager and link previews. The map keeps its drawing
 * buffer (preserveDrawingBuffer) so its canvas, with the deck.gl layers drawn into it
 * (interleaved), can be read back at any time.
 */
let current: MlMap | null = null;

export function registerMap(map: MlMap | null): void {
  current = map;
}

/** Wait until the map has finished drawing (tiles loaded, camera still), with a timeout. */
export function mapIdle(timeoutMs = 2500): Promise<void> {
  const map = current;
  if (!map) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, timeoutMs);
    if (map.loaded() && !map.isMoving()) {
      map.once("render", done);
      map.triggerRepaint();
    } else map.once("idle", done);
  });
}

/**
 * The map as an image, centre-cropped to the requested aspect and scaled to `width`.
 * Returns null if there's no map (or the canvas is tainted, which Overture's CORS-open
 * tiles shouldn't cause).
 */
export function snapshotMap(width: number, height: number, type: "image/png" | "image/jpeg" = "image/jpeg", quality = 0.82): string | null {
  const src = current?.getCanvas();
  if (!src || !src.width || !src.height) return null;
  const want = width / height;
  const have = src.width / src.height;
  const sw = have > want ? src.height * want : src.width;
  const sh = have > want ? src.height : src.width / want;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
  try {
    return out.toDataURL(type, quality);
  } catch {
    return null;
  }
}
