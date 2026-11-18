/**
 * Hand-drawn marks as SVG path data: wobbly arrows and scribbled circles.
 *
 * The wobble is seeded, so a mark looks hand-drawn but identical on every render (no
 * jitter when React re-renders, and the tests can assert on it). Each mark is two
 * strokes, like a pen going over a line twice, which is what reads as "drawn by hand".
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/**
 * A curved arrow from `from` to `to`. The shaft bows to one side (`bend`, as a fraction of
 * its length) and wanders slightly; the head is two short strokes. Returns the shaft as two
 * passes plus the head, so each can animate in sequence.
 */
export function arrow(from: Pt, to: Pt, seed: number, bend = 0.22): { shaft: string[]; head: string } {
  const r = rng(seed);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // unit normal: the side the arrow bows towards
  const nx = -dy / len;
  const ny = dx / len;
  const side = r() > 0.5 ? 1 : -1;

  const pass = (wobble: number) => {
    const j = () => (r() - 0.5) * wobble;
    const c1 = { x: from.x + dx * 0.3 + nx * len * bend * side + j(), y: from.y + dy * 0.3 + ny * len * bend * side + j() };
    const c2 = { x: from.x + dx * 0.75 + nx * len * bend * 0.5 * side + j(), y: from.y + dy * 0.75 + ny * len * bend * 0.5 * side + j() };
    return `M${f(from.x + j() / 2)} ${f(from.y + j() / 2)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(to.x)} ${f(to.y)}`;
  };

  // Head follows the shaft's final direction (from the last control point to the tip).
  const c2x = from.x + dx * 0.75 + nx * len * bend * 0.5 * side;
  const c2y = from.y + dy * 0.75 + ny * len * bend * 0.5 * side;
  const ang = Math.atan2(to.y - c2y, to.x - c2x);
  const size = Math.min(16, Math.max(10, len * 0.12));
  const wing = (da: number) => ({
    x: to.x - size * Math.cos(ang + da) + (r() - 0.5) * 2,
    y: to.y - size * Math.sin(ang + da) + (r() - 0.5) * 2,
  });
  const a = wing(0.5);
  const b = wing(-0.5);
  const head = `M${f(a.x)} ${f(a.y)} L${f(to.x)} ${f(to.y)} L${f(b.x)} ${f(b.y)}`;

  return { shaft: [pass(6), pass(10)], head };
}

/**
 * A scribbled loop around a rectangle: an ellipse drawn a little more than once round,
 * with the radius drifting so the start and end don't meet cleanly.
 */
export function scribble(rect: Rect, seed: number, pad = 12): string {
  const r = rng(seed);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // an ellipse that encloses the rect's corners, plus padding
  const rx = (rect.w / 2) * Math.SQRT2 * 0.92 + pad;
  const ry = (rect.h / 2) * Math.SQRT2 * 0.92 + pad;
  const turns = 1.12;
  const steps = 48;
  const start = -Math.PI / 2 - 0.5 + r() * 0.4;
  let drift = 0;
  const pts: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = start + t * turns * 2 * Math.PI;
    drift += (r() - 0.5) * 0.02;
    const grow = 1 + 0.05 * t + drift; // the pen spirals slightly outwards
    pts.push({ x: cx + Math.cos(a) * rx * grow, y: cy + Math.sin(a) * ry * grow });
  }
  return smooth(pts);
}

/** Catmull-Rom through the points, as cubic Béziers. */
export function smooth(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** The point on a rectangle's edge facing `from` (so arrows stop at the target, not inside it). */
export function edgeToward(rect: Rect, from: Pt, gap = 10): Pt {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = rect.w / 2 + gap;
  const hh = rect.h / 2 + gap;
  const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: cx + dx * s, y: cy + dy * s };
}
