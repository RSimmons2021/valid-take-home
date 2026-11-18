import type { Motif } from "../model/campaign";

/**
 * A pin's ad, drawn in code. It tells one small story in four beats:
 *
 *   1. Hook (0–3 s): the service, happening in a neighbourhood like this one: an AI scene
 *      photo of the verified angle, or a hand-drawn illustration for the business, with the
 *      title readable by 0.7 s (the sound-off test).
 *   2. Proof (3–6.4 s): "right here". The real map opens out from the pin: blocks colour in
 *      by fit, a hand-drawn ring circles the reach, arrows point at real places.
 *   3. Benefit (6.4–8.3 s): back to the scene, with what the business does for you.
 *   4. Close (8.3–10 s): who, where, and one action.
 *
 * Every frame is a pure function of (spec, time), so preview, poster and export are the
 * same film, and the same plan always makes the same video. Strokes use seeded randomness,
 * never Math.random. Places come only from verified Overture places.
 */

export const FILM = { width: 720, height: 1280, fps: 30, seconds: 10 } as const;
/** The poster: the hook, title fully in. */
export const POSTER_T = 1.4;

const BEAT = { proof: 3.0, benefit: 6.4, close: 8.3 } as const;

export interface FilmSpec {
  /** the map, already framed: pin at `center`, ring radius `radiusPx` */
  still: CanvasImageSource;
  center: [number, number];
  radiusPx: number;
  /** scored blocks inside the reach, in film pixels, with distance from the centre (0..1) */
  hexes: { pts: [number, number][]; color: string; d: number }[];
  callouts: { name: string; kind: string; x: number; y: number }[];
  /** the AI scene photo for the hook and benefit, or null for the illustration */
  scene: CanvasImageSource | null;
  motif: Motif;
  /** neighbourhood, for the hook's location chip */
  eyebrow: string;
  title: string;
  /** the proof line, e.g. "Walks start at Jefferson Square Park" */
  hook: string;
  /** the benefit line */
  body: string;
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
  muted: "#63666d",
  blue: "#1626ff",
  wash: "rgba(22,38,255,0.10)",
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
    document.fonts.load(`650 64px ${SANS}`),
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
type Pt = [number, number];

/** An ink stroke through points: tapered ends, a little seeded wobble, drawn up to `progress`. */
function ink(c: CanvasRenderingContext2D, pts: Pt[], seed: number, width: number, color: string, progress: number) {
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

const oval = (cx: number, cy: number, rx: number, ry: number, n = 40, turn = 1.06, tilt = 0): Pt[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2 * turn;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
  });
const line = (x0: number, y0: number, x1: number, y1: number, n = 16): Pt[] =>
  Array.from({ length: n + 1 }, (_, k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
const poly = (...pts: Pt[]): Pt[] => pts.slice(1).flatMap((p, k) => line(pts[k][0], pts[k][1], p[0], p[1], 12).slice(k ? 1 : 0));
/** A four-point sparkle. */
const sparkle = (cx: number, cy: number, r: number): Pt[][] => [line(cx, cy - r, cx, cy + r, 10), line(cx - r, cy, cx + r, cy, 10)];

/** A loop drawn by hand around the reach: slightly oval, overshooting its start. */
function ringPoints(cx: number, cy: number, r: number, seed: number): Pt[] {
  const g = rng(seed);
  const tilt = (g() - 0.5) * 0.3;
  const start = -Math.PI / 2 + (g() - 0.5) * 0.6;
  return Array.from({ length: 97 }, (_, k) => {
    const a = start + (k / 96) * Math.PI * 2.12;
    const rr = r * (1.04 + 0.03 * Math.sin(a * 3 + g() * 0.2));
    return [cx + Math.cos(a + tilt) * rr, cy + Math.sin(a) * rr * 0.97] as Pt;
  });
}

/** A gently curved arrow from a label to its place, with a two-stroke head. */
function arrow(c: CanvasRenderingContext2D, from: Pt, to: Pt, seed: number, progress: number) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const mx = (x0 + x1) / 2 + (y1 - y0) * 0.18;
  const my = (y0 + y1) / 2 - (x1 - x0) * 0.18;
  const pts = Array.from({ length: 25 }, (_, k) => {
    const u = k / 24;
    return [(1 - u) ** 2 * x0 + 2 * (1 - u) * u * mx + u * u * x1, (1 - u) ** 2 * y0 + 2 * (1 - u) * u * my + u * u * y1] as Pt;
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

/** The business, drawn by hand: what the ad is about when there's no scene photo. */
function motifStrokes(m: Motif, cx: number, cy: number): Pt[][] {
  switch (m) {
    case "pet":
      return [
        oval(cx, cy + 60, 92, 74),
        oval(cx - 112, cy - 40, 32, 42, 30, 1.06, -0.4),
        oval(cx - 42, cy - 104, 32, 44),
        oval(cx + 42, cy - 104, 32, 44),
        oval(cx + 112, cy - 40, 32, 42, 30, 1.06, 0.4),
      ];
    case "home":
      return [
        poly([cx - 150, cy - 10], [cx, cy - 150], [cx + 150, cy - 10]),
        poly([cx - 115, cy - 30], [cx - 115, cy + 130], [cx + 115, cy + 130], [cx + 115, cy - 30]),
        poly([cx - 30, cy + 130], [cx - 30, cy + 40], [cx + 30, cy + 40], [cx + 30, cy + 130]),
        poly([cx + 70, cy - 95], [cx + 70, cy - 140], [cx + 100, cy - 140], [cx + 100, cy - 70]),
      ];
    case "clean":
      return [
        ...sparkle(cx - 40, cy - 10, 110),
        ...sparkle(cx + 110, cy - 110, 50),
        ...sparkle(cx + 90, cy + 110, 36),
        oval(cx - 130, cy + 110, 26, 26),
        oval(cx + 150, cy + 20, 16, 16),
      ];
    case "fitness":
      return [
        line(cx - 120, cy, cx + 120, cy, 20),
        poly([cx - 150, cy - 70], [cx - 120, cy - 70], [cx - 120, cy + 70], [cx - 150, cy + 70], [cx - 150, cy - 70]),
        poly([cx + 150, cy - 70], [cx + 120, cy - 70], [cx + 120, cy + 70], [cx + 150, cy + 70], [cx + 150, cy - 70]),
        poly([cx - 185, cy - 45], [cx - 150, cy - 45], [cx - 150, cy + 45], [cx - 185, cy + 45], [cx - 185, cy - 45]),
        poly([cx + 185, cy - 45], [cx + 150, cy - 45], [cx + 150, cy + 45], [cx + 185, cy + 45], [cx + 185, cy - 45]),
      ];
    case "learn":
      return [
        poly([cx, cy - 80], [cx - 70, cy - 110], [cx - 170, cy - 95], [cx - 170, cy + 95], [cx - 70, cy + 80], [cx, cy + 110]),
        poly([cx, cy - 80], [cx + 70, cy - 110], [cx + 170, cy - 95], [cx + 170, cy + 95], [cx + 70, cy + 80], [cx, cy + 110]),
        line(cx, cy - 80, cx, cy + 110, 14),
        ...sparkle(cx + 150, cy - 170, 30),
      ];
    default:
      return [
        [...poly([cx, cy + 150], [cx - 95, cy - 10]), ...oval(cx, cy - 60, 108, 108, 50, 0.84).slice(8), ...poly([cx + 95, cy - 10], [cx, cy + 150])],
        oval(cx, cy - 60, 38, 38),
      ];
  }
}

// ── type and layout ──────────────────────────────────────────────────────────
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Lay words into lines no wider than `width`. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, maxLines: number): { word: string; x: number; line: number }[] {
  const space = c.measureText(" ").width;
  const out: { word: string; x: number; line: number }[] = [];
  let x = 0;
  let row = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = c.measureText(word).width;
    if (x > 0 && x + w > width) {
      row++;
      x = 0;
    }
    if (row >= maxLines) break;
    out.push({ word, x, line: row });
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

/** Draw an image to cover the frame, scaled by `zoom` about a focal point (0..1). */
function cover(c: CanvasRenderingContext2D, img: CanvasImageSource, zoom: number, fx = 0.5, fy = 0.5) {
  const { width: W, height: H } = FILM;
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  const s = Math.max(W / iw, H / ih) * zoom;
  const w = iw * s;
  const h = ih * s;
  c.drawImage(img, (W - w) * fx, (H - h) * fy, w, h);
}

/** Where each callout's label goes: down the side nearer its place, one slot per label. */
function labelSlots(callouts: FilmSpec["callouts"], cx: number): { side: -1 | 1; y: number }[] {
  const used = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>;
  const order = callouts.map((p, k) => ({ p, k })).sort((a, b) => a.p.y - b.p.y || a.k - b.k);
  const out: { side: -1 | 1; y: number }[] = [];
  for (const { p, k } of order) {
    let side: -1 | 1 = p.x < cx ? -1 : 1;
    if (used[side] >= 2) side = side === -1 ? 1 : -1;
    out[k] = { side, y: 470 + used[side]++ * 150 };
  }
  return out;
}

/** The scene photo, or the business drawn by hand on paper (`drawIn` 0..1 draws the strokes). */
function drawScene(c: CanvasRenderingContext2D, s: FilmSpec, zoom: number, fx: number, fy: number, drawIn: number) {
  const { width: W, height: H } = FILM;
  if (s.scene) {
    cover(c, s.scene, zoom, fx, fy);
    return;
  }
  c.fillStyle = C.paper;
  c.fillRect(0, 0, W, H);
  c.fillStyle = C.wash;
  c.beginPath();
  c.arc(W / 2, 470, 260 * easeOut(clamp(drawIn * 1.4)), 0, Math.PI * 2);
  c.fill();
  motifStrokes(s.motif, W / 2, 470).forEach((pts, k) => ink(c, pts, s.seed + k * 13, 7, k === 0 ? C.ink : C.blue, at(drawIn, k * 0.12, k * 0.12 + 0.55)));
}

/** A soft dark gradient so white type reads over any photo. */
function shade(c: CanvasRenderingContext2D, from: number, alpha: number) {
  const { width: W, height: H } = FILM;
  const g = c.createLinearGradient(0, from, 0, H);
  g.addColorStop(0, "rgba(5,6,8,0)");
  g.addColorStop(1, `rgba(5,6,8,${alpha})`);
  c.fillStyle = g;
  c.fillRect(0, from, W, H - from);
}

// ── the beats ────────────────────────────────────────────────────────────────
function hook(c: CanvasRenderingContext2D, t: number, s: FilmSpec) {
  const { width: W } = FILM;
  const photo = !!s.scene;
  drawScene(c, s, 1.14 - 0.12 * easeOut(clamp(t / 3.4)), 0.5, 0.45, at(t, 0.05, 1.6));
  if (photo) shade(c, 520, 0.82);
  // where: a small chip, so the first frame already says "this neighbourhood"
  const chip = easeOut(at(t, 0.05, 0.35));
  c.save();
  c.globalAlpha = chip;
  c.font = `500 18px ${MONO}`;
  const label = fit(c, s.eyebrow.toUpperCase(), 520);
  const cw = c.measureText(label).width + 44;
  c.fillStyle = photo ? "rgba(5,6,8,0.55)" : C.card;
  roundRect(c, 40, 56, cw, 44, 22);
  c.fill();
  c.fillStyle = photo ? C.cyan : C.blue;
  c.beginPath();
  c.arc(62, 78, 5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = photo ? "#ffffff" : C.ink;
  c.fillText(label, 76, 84);
  c.restore();
  // the title: big, low, word by word, all in by 0.7 s
  c.save();
  c.font = `680 66px ${SANS}`;
  const words = wrap(c, s.title, W - 100, 3);
  const lines = (words.at(-1)?.line ?? 0) + 1;
  const top = photo ? 1150 - lines * 74 : 860;
  c.fillStyle = photo ? "#ffffff" : C.ink;
  if (photo) {
    c.shadowColor = "rgba(0,0,0,0.35)";
    c.shadowBlur = 18;
  }
  words.forEach((w, k) => {
    const a = easeOut(at(t, 0.15 + k * 0.05, 0.45 + k * 0.05));
    c.globalAlpha = a;
    c.fillText(w.word, 50 + w.x, top + w.line * 74 + 16 * (1 - a));
  });
  c.restore();
}

function proof(c: CanvasRenderingContext2D, t: number, s: FilmSpec) {
  const { width: W, height: H } = FILM;
  const u = t - BEAT.proof; // local time
  const [cx, cy] = s.center;
  // the map opens out from the pin: "right here"
  const open = easeInOut(at(u, 0, 0.55));
  c.save();
  c.beginPath();
  c.arc(cx, cy, open * Math.hypot(W, H), 0, Math.PI * 2);
  c.clip();
  c.fillStyle = C.paper;
  c.fillRect(0, 0, W, H);
  const zoom = 1.08 - 0.08 * easeOut(clamp(u / 3.4));
  c.translate(cx, cy);
  c.scale(zoom, zoom);
  c.translate(-cx, -cy);
  c.drawImage(s.still, 0, 0, W, H);
  for (const h of s.hexes) {
    const a = easeOut(at(u, 0.3 + h.d * 0.6, 0.65 + h.d * 0.6));
    if (a <= 0) continue;
    c.globalAlpha = a;
    c.fillStyle = h.color;
    c.beginPath();
    h.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 1;
  ink(c, ringPoints(cx, cy, s.radiusPx, s.seed), s.seed, 6, C.marker, easeInOut(at(u, 0.55, 1.4)));
  const drop = at(u, 0.4, 0.7);
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
  const slots = labelSlots(s.callouts, cx);
  s.callouts.forEach((p, k) => {
    const start = 1.2 + k * 0.6;
    const pop = at(u, start, start + 0.22);
    if (pop <= 0) return;
    c.fillStyle = C.blue;
    c.strokeStyle = C.card;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(p.x, p.y, 9 * back(pop), 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const { side, y: ly } = slots[k];
    c.font = `600 34px ${HAND}`;
    const name = fit(c, p.name, 250);
    const tw = c.measureText(name).width;
    const lx = side < 0 ? 34 : W - 34 - tw;
    const label = easeOut(at(u, start + 0.25, start + 0.5));
    arrow(c, [side < 0 ? lx + tw + 6 : lx - 6, ly - 8], [p.x - side * 12, p.y], s.seed + k * 31, at(u, start + 0.1, start + 0.5));
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
  // the proof line, on a card at the top
  const card = easeOut(at(u, 0.35, 0.7));
  if (card > 0) {
    c.save();
    c.globalAlpha = card;
    c.font = `620 40px ${SANS}`;
    const words = wrap(c, s.hook, W - 144, 3);
    const lines = (words.at(-1)?.line ?? 0) + 1;
    const y = 56 - 12 * (1 - card);
    c.shadowColor = "rgba(5,6,8,0.18)";
    c.shadowBlur = 30;
    c.shadowOffsetY = 10;
    c.fillStyle = C.card;
    roundRect(c, 40, y, W - 80, 64 + lines * 50, 24);
    c.fill();
    c.shadowColor = "transparent";
    c.fillStyle = C.ink;
    words.forEach((w) => c.fillText(w.word, 72 + w.x, y + 62 + w.line * 50));
    c.restore();
  }
  // Map attribution while the map shows (the basemap carries OpenStreetMap data). Drawn as
  // part of this beat, so the next shot covers it as it fades in.
  c.save();
  c.globalAlpha = open;
  c.font = `500 13px ${MONO}`;
  c.fillStyle = "rgba(5,6,8,0.55)";
  c.fillText("© Overture Maps Foundation · OpenStreetMap contributors", 24, H - 20);
  c.restore();
}

function benefit(c: CanvasRenderingContext2D, t: number, s: FilmSpec) {
  const { width: W } = FILM;
  const u = t - BEAT.benefit;
  const fade = easeOut(at(u, 0, 0.4));
  c.save();
  c.globalAlpha = fade;
  // a different crop of the same scene, so the return reads as a new shot
  drawScene(c, s, 1.32 - 0.08 * clamp(u / 2), 0.35, 0.3, 1);
  if (s.scene) shade(c, 380, 0.88);
  c.restore();
  c.save();
  c.font = `560 44px ${SANS}`;
  const words = wrap(c, s.body, W - 140, 4);
  const lines = (words.at(-1)?.line ?? 0) + 1;
  const top = s.scene ? 1120 - lines * 56 : 880;
  c.fillStyle = s.scene ? "#ffffff" : C.ink;
  words.forEach((w, k) => {
    const a = easeOut(at(u, 0.25 + k * 0.035, 0.6 + k * 0.035));
    c.globalAlpha = a;
    c.fillText(w.word, 60 + w.x, top + w.line * 56 + 12 * (1 - a));
  });
  // a hand-drawn underline under the last line: the one beat of emphasis
  c.globalAlpha = 1;
  const last = words.filter((w) => w.line === lines - 1).at(-1);
  const end = last ? 60 + last.x + c.measureText(last.word).width : 200;
  const y = top + (lines - 1) * 56 + 18;
  ink(c, line(60, y, end, y - 4, 24), s.seed + 99, 5, C.marker, easeInOut(at(u, 0.9, 1.4)));
  c.restore();
}

function close(c: CanvasRenderingContext2D, t: number, s: FilmSpec) {
  const { width: W, height: H } = FILM;
  const u = t - BEAT.close;
  const y = H - (H - 300) * easeOut(at(u, 0, 0.45));
  c.save();
  c.fillStyle = C.ink;
  roundRect(c, 0, y, W, H, 40);
  c.fill();
  c.globalAlpha = easeOut(at(u, 0.25, 0.6));
  c.fillStyle = C.paper;
  c.font = `680 64px ${SANS}`;
  const words = wrap(c, s.business, W - 112, 2);
  words.forEach((w) => c.fillText(w.word, 56 + w.x, y + 150 + w.line * 72));
  const after = y + 150 + ((words.at(-1)?.line ?? 0) + 1) * 72;
  c.font = `400 32px ${SANS}`;
  c.fillStyle = "#b9bbc2";
  c.fillText(fit(c, `Serving ${s.where}`, W - 112), 56, after + 10);
  c.font = `500 22px ${MONO}`;
  c.fillStyle = C.cyan;
  c.fillText(s.stat, 56, after + 60, W - 112);
  const pill = easeOut(at(u, 0.5, 0.85));
  c.globalAlpha = pill;
  c.fillStyle = C.blue;
  c.font = `620 36px ${SANS}`;
  const pw = c.measureText(s.cta).width + 88;
  roundRect(c, 56, after + 120 + 10 * (1 - pill), pw, 84, 42);
  c.fill();
  c.fillStyle = "#ffffff";
  c.fillText(s.cta, 100, after + 175 + 10 * (1 - pill));
  c.restore();
}

// ── the film ─────────────────────────────────────────────────────────────────
export function drawFrame(c: CanvasRenderingContext2D, t: number, s: FilmSpec): void {
  const { width: W, height: H } = FILM;
  const mapOn = t >= BEAT.proof && t < BEAT.benefit + 0.4;
  c.save();
  c.fillStyle = C.paper;
  c.fillRect(0, 0, W, H);
  if (t < BEAT.benefit) hook(c, t, s); // stays underneath while the map opens over it
  if (mapOn) proof(c, t, s);
  if (t >= BEAT.benefit) benefit(c, t, s);
  if (t >= BEAT.close) close(c, t, s);
  c.restore();
}
