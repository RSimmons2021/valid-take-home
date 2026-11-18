/**
 * A pin's video, drawn in code: the real map of the pin, its blocks coloured by fit, a
 * hand-drawn ring around the reach, arrows to real places, and the business's close.
 *
 * Every frame is a pure function of (spec, time), so the preview, the poster and the
 * exported file are the same film, and the same plan always makes the same video. Strokes
 * use seeded randomness, never Math.random. Nothing here can invent a place: callouts come
 * from Overture places the script already verified.
 *
 * Timing follows the sound-off test: the title is readable before 1 s, the situation (this
 * neighbourhood, on a map) is the first frame, and every beat holds long enough to read.
 */

export const FILM = { width: 720, height: 1280, fps: 30, seconds: 8 } as const;
export const POSTER_T = 4.4;

export interface FilmSpec {
  /** the map, already framed: pin centred, ring radius `radiusPx` */
  still: CanvasImageSource;
  center: [number, number];
  radiusPx: number;
  /** scored blocks inside the reach, in film pixels, with distance from the centre (0..1) */
  hexes: { pts: [number, number][]; color: string; d: number }[];
  callouts: { name: string; kind: string; x: number; y: number }[];
  eyebrow: string;
  title: string;
  hook: string;
  business: string;
  where: string;
  stat: string;
  cta: string;
  seed: number;
}

const C = {
  paper: "#e7e4dc",
  card: "#fbfbf9",
  ink: "#050608",
  ink2: "#3d4048",
  muted: "#63666d",
  blue: "#1626ff",
  cyan: "#00e1f0",
  marker: "#ff6a13",
};
const SANS = '"Geist Variable", system-ui, sans-serif';
const MONO = '"Geist Mono Variable", ui-monospace, monospace';
const HAND = '"Caveat", "Bradley Hand", cursive';

/** Fonts the film draws with; wait for them before rendering a frame you keep. */
export async function filmFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`650 54px ${SANS}`),
    document.fonts.load(`500 18px ${MONO}`),
    document.fonts.load(`600 34px ${HAND}`),
  ]).catch(() => undefined);
}

// ── timing ───────────────────────────────────────────────────────────────────
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const at = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const back = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

/** Seeded randomness: the same seed draws the same wobble every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// ── hand-drawn marks ─────────────────────────────────────────────────────────
/** An ink stroke through points: tapered ends, a little seeded wobble, drawn up to `progress`. */
function ink(c: CanvasRenderingContext2D, pts: [number, number][], seed: number, width: number, color: string, progress: number) {
  if (progress <= 0 || pts.length < 2) return;
  const r = rng(seed);
  const j = pts.map(() => [(r() - 0.5) * 2.2, (r() - 0.5) * 2.2]);
  const upto = Math.max(1, Math.floor((pts.length - 1) * clamp(progress)));
  c.strokeStyle = color;
  c.lineCap = "round";
  for (let k = 0; k < upto; k++) {
    const u = k / (pts.length - 1);
    c.lineWidth = Math.max(0.8, width * (0.4 + 0.6 * Math.sin(Math.PI * clamp(u * 0.92 + 0.04))));
    c.beginPath();
    c.moveTo(pts[k][0] + j[k][0], pts[k][1] + j[k][1]);
    c.lineTo(pts[k + 1][0] + j[k + 1][0], pts[k + 1][1] + j[k + 1][1]);
    c.stroke();
  }
}

/** A loop drawn by hand around the reach: slightly oval, overshooting its start. */
function ringPoints(cx: number, cy: number, r: number, seed: number): [number, number][] {
  const g = rng(seed);
  const tilt = (g() - 0.5) * 0.3;
  const start = -Math.PI / 2 + (g() - 0.5) * 0.6;
  return Array.from({ length: 97 }, (_, k) => {
    const a = start + (k / 96) * Math.PI * 2.12;
    const rr = r * (1.04 + 0.03 * Math.sin(a * 3 + g() * 0.2));
    return [cx + Math.cos(a + tilt) * rr, cy + Math.sin(a) * rr * 0.97] as [number, number];
  });
}

/** A gently curved arrow from a label to its place, with a two-stroke head. */
function arrow(c: CanvasRenderingContext2D, from: [number, number], to: [number, number], seed: number, progress: number) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const mx = (x0 + x1) / 2 + (y1 - y0) * 0.18;
  const my = (y0 + y1) / 2 - (x1 - x0) * 0.18;
  const pts = Array.from({ length: 25 }, (_, k) => {
    const u = k / 24;
    return [(1 - u) ** 2 * x0 + 2 * (1 - u) * u * mx + u * u * x1, (1 - u) ** 2 * y0 + 2 * (1 - u) * u * my + u * u * y1] as [number, number];
  });
  ink(c, pts, seed, 4, C.marker, at(progress, 0, 0.8));
  const head = at(progress, 0.8, 1);
  if (head > 0) {
    const a = Math.atan2(y1 - pts[22][1], x1 - pts[22][0]);
    for (const s of [-1, 1]) {
      const b = a + Math.PI + s * 0.5;
      ink(c, [[x1, y1], [x1 + Math.cos(b) * 16 * head, y1 + Math.sin(b) * 16 * head]], seed + s * 7, 4, C.marker, 1);
    }
  }
}

// ── type ─────────────────────────────────────────────────────────────────────
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Lay words into lines no wider than `width`. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, maxLines: number): { word: string; x: number; line: number }[] {
  const space = c.measureText(" ").width;
  const out: { word: string; x: number; line: number }[] = [];
  let x = 0;
  let line = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = c.measureText(word).width;
    if (x > 0 && x + w > width) {
      line++;
      x = 0;
    }
    if (line >= maxLines) break;
    out.push({ word, x, line });
    x += w + space;
  }
  return out;
}

/** Shorten text to fit a width with an ellipsis, rather than squashing the letters. */
function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * Where each callout's label goes: down the side of the frame nearer its place, one slot
 * per label so they never overlap however close the places are. Deterministic, like the rest.
 */
function labelSlots(callouts: FilmSpec["callouts"], cx: number): { side: -1 | 1; y: number }[] {
  const used = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>;
  const order = callouts.map((p, k) => ({ p, k })).sort((a, b) => a.p.y - b.p.y || a.k - b.k);
  const out: { side: -1 | 1; y: number }[] = [];
  for (const { p, k } of order) {
    let side: -1 | 1 = p.x < cx ? -1 : 1;
    if (used[side] >= 2) side = side === -1 ? 1 : -1; // balance a crowded side
    out[k] = { side, y: 470 + used[side]++ * 150 };
  }
  return out;
}

// ── the film ─────────────────────────────────────────────────────────────────
export function drawFrame(c: CanvasRenderingContext2D, t: number, s: FilmSpec): void {
  const { width: W, height: H } = FILM;
  c.save();
  c.fillStyle = C.paper;
  c.fillRect(0, 0, W, H);

  // The map: fades up and settles from a slow push-in, so the first frame already says "this neighbourhood".
  const zoom = 1.09 - 0.09 * easeOut(clamp(t / FILM.seconds));
  const [cx, cy] = s.center;
  c.save();
  c.translate(cx, cy);
  c.scale(zoom, zoom);
  c.translate(-cx, -cy);
  c.globalAlpha = easeOut(at(t, 0, 0.5));
  c.drawImage(s.still, 0, 0, W, H);

  // Blocks colour in from the centre outwards: darker blue is a better fit, as in the app.
  for (const h of s.hexes) {
    const a = easeOut(at(t, 0.35 + h.d * 0.8, 0.75 + h.d * 0.8));
    if (a <= 0) continue;
    c.globalAlpha = a;
    c.fillStyle = h.color;
    c.beginPath();
    h.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 1;

  // The reach, circled by hand, and the pin landing in the middle.
  ink(c, ringPoints(cx, cy, s.radiusPx, s.seed), s.seed, 6, C.marker, easeInOut(at(t, 1.0, 2.1)));
  const drop = at(t, 0.8, 1.15);
  if (drop > 0) {
    c.globalAlpha = drop;
    c.fillStyle = C.ink;
    c.beginPath();
    c.arc(cx, cy - 10 * (1 - easeOut(drop)), 13 * back(drop), 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = C.card;
    c.lineWidth = 4;
    c.stroke();
    c.globalAlpha = 1;
  }

  // Real places, one after another: a dot, a hand-drawn arrow, a handwritten label.
  const slots = labelSlots(s.callouts, cx);
  s.callouts.forEach((p, k) => {
    const start = 2.3 + k * 0.75;
    const pop = at(t, start, start + 0.25);
    if (pop <= 0) return;
    c.fillStyle = C.blue;
    c.strokeStyle = C.card;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(p.x, p.y, 9 * back(pop), 0, Math.PI * 2);
    c.fill();
    c.stroke();
    // label in its own slot at the side, on a paper chip so it reads over the map
    const { side, y: ly } = slots[k];
    c.font = `600 34px ${HAND}`;
    const name = fit(c, p.name, 250);
    const tw = c.measureText(name).width;
    const lx = side < 0 ? 34 : W - 34 - tw;
    const label = easeOut(at(t, start + 0.3, start + 0.6));
    const ax = side < 0 ? lx + tw + 6 : lx - 6;
    arrow(c, [ax, ly - 8], [p.x - side * 12, p.y], s.seed + k * 31, at(t, start + 0.1, start + 0.55));
    c.globalAlpha = label * 0.9;
    c.fillStyle = C.card;
    roundRect(c, lx - 12, ly - 36, tw + 24, 66, 12);
    c.fill();
    c.globalAlpha = label;
    c.fillStyle = C.ink;
    c.fillText(name, lx, ly - 4 * (1 - label));
    c.font = `500 14px ${MONO}`;
    c.fillStyle = C.muted;
    c.fillText(fit(c, p.kind.toUpperCase(), tw), lx, ly + 20);
    c.globalAlpha = 1;
  });
  c.restore();

  // Title card: in by 0.6 s, so a silent scroller gets it at once.
  const card = easeOut(at(t, 0.1, 0.5));
  c.save();
  c.globalAlpha = card;
  c.translate(0, -16 * (1 - card));
  c.font = `650 54px ${SANS}`;
  const words = wrap(c, s.title, 600, 3);
  const lines = (words.at(-1)?.line ?? 0) + 1;
  c.font = `400 26px ${SANS}`;
  const hookWords = wrap(c, s.hook, 600, 2);
  const hookLines = s.hook ? (hookWords.at(-1)?.line ?? 0) + 1 : 0;
  const cardH = 92 + lines * 62 + (hookLines ? 18 + hookLines * 34 : 0);
  c.shadowColor = "rgba(5,6,8,0.18)";
  c.shadowBlur = 30;
  c.shadowOffsetY = 10;
  c.fillStyle = C.card;
  roundRect(c, 40, 64, W - 80, cardH, 26);
  c.fill();
  c.shadowColor = "transparent";
  c.font = `500 17px ${MONO}`;
  c.fillStyle = C.blue;
  c.fillText(s.eyebrow.toUpperCase(), 72, 112, W - 144);
  c.font = `650 54px ${SANS}`;
  c.fillStyle = C.ink;
  words.forEach((w, k) => {
    const a = easeOut(at(t, 0.15 + k * 0.06, 0.45 + k * 0.06));
    c.globalAlpha = card * a;
    c.fillText(w.word, 72 + w.x, 172 + w.line * 62 + 14 * (1 - a));
  });
  c.font = `400 26px ${SANS}`;
  c.fillStyle = C.ink2;
  const hook = easeOut(at(t, 1.4, 1.8));
  c.globalAlpha = card * hook;
  hookWords.forEach((w) => c.fillText(w.word, 72 + w.x, 172 + lines * 62 + 10 + w.line * 34));
  c.restore();

  // The close: who, where, and one action. Slides up over the bottom of the map.
  const close = easeOut(at(t, 5.6, 6.1));
  if (close > 0) {
    const ph = 420;
    const y = H - ph * close;
    c.save();
    c.fillStyle = C.ink;
    roundRect(c, 0, y, W, ph + 40, 34);
    c.fill();
    const a = easeOut(at(t, 5.9, 6.3));
    c.globalAlpha = a;
    c.fillStyle = C.paper;
    c.font = `650 56px ${SANS}`;
    c.fillText(s.business, 56, y + 104, W - 112);
    c.font = `400 28px ${SANS}`;
    c.fillStyle = "#b9bbc2";
    c.fillText(`Serving ${s.where}`, 56, y + 150, W - 112);
    c.font = `500 20px ${MONO}`;
    c.fillStyle = C.cyan;
    c.fillText(s.stat, 56, y + 196, W - 112);
    const pill = easeOut(at(t, 6.2, 6.6));
    c.globalAlpha = pill;
    c.fillStyle = C.blue;
    c.font = `600 32px ${SANS}`;
    const pw = c.measureText(s.cta).width + 72;
    roundRect(c, 56, y + 236 + 10 * (1 - pill), pw, 74, 37);
    c.fill();
    c.fillStyle = "#ffffff";
    c.fillText(s.cta, 92, y + 284 + 10 * (1 - pill));
    c.restore();
  }

  // Map attribution, on every frame (the basemap carries OpenStreetMap data).
  c.font = `500 13px ${MONO}`;
  c.fillStyle = close > 0.5 ? "rgba(236,235,230,0.55)" : "rgba(5,6,8,0.55)";
  c.fillText("© Overture Maps Foundation · OpenStreetMap contributors", 24, H - 20);
  c.restore();
}
