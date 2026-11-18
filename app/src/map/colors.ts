import type { Theme } from "../state/theme";

/**
 * Score → colour, with one rule in both themes: darker and more saturated means a better
 * fit. Below the on-target line cells are a faint wash (present, not worth buying); above
 * it they ramp from pale to deep blue. Ramps interpolate in OKLab so equal score steps look
 * like equal colour steps.
 *
 * On the dark basemap "pale" is also translucent, so weak cells recede into the ground
 * instead of glowing; strong cells are opaque, saturated blue.
 */
export type RGBA = [number, number, number, number];
type RGB = [number, number, number];

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}
function toOklab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function ramp(from: RGB, to: RGB, alpha: [number, number]): RGBA[] {
  const A = toOklab(from);
  const B = toOklab(to);
  return Array.from({ length: 51 }, (_, k) => {
    const t = k / 50;
    const [r, g, b] = fromOklab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
    return [r, g, b, Math.round(alpha[0] + (alpha[1] - alpha[0]) * t)];
  });
}

export interface ScorePalette {
  low: RGBA;
  /** below average *because* of a signal the user avoids: a warm wash, never darker than fit */
  held: RGBA;
  ramp: RGBA[];
  /** evidence links: a preferred signal, an avoided one */
  prefer: RGBA;
  avoid: RGBA;
  /** pin radius outline */
  ring: RGBA;
  ringFill: RGBA;
  /** a pin's reach when it's focused, hovered or spotlit from the legend */
  ringFillHot: RGBA;
  /** 3D: side walls are darker than tops */
  selected: RGBA;
}

export const PALETTES: Record<Theme, ScorePalette> = {
  light: {
    low: [138, 128, 112, 26],
    held: [240, 96, 72, 62],
    ramp: ramp([205, 210, 255], [22, 38, 255], [120, 225]),
    prefer: [22, 38, 255, 230],
    avoid: [255, 59, 47, 230],
    ring: [5, 6, 8, 210],
    ringFill: [0, 225, 240, 14],
    ringFillHot: [0, 225, 240, 44],
    selected: [5, 6, 8, 255],
  },
  dark: {
    low: [236, 235, 230, 14],
    held: [255, 122, 102, 80],
    ramp: ramp([196, 204, 255], [38, 56, 255], [55, 240]),
    prefer: [0, 225, 240, 235],
    avoid: [255, 95, 80, 235],
    ring: [236, 235, 230, 190],
    ringFill: [0, 225, 240, 18],
    ringFillHot: [0, 225, 240, 40],
    selected: [255, 255, 255, 255],
  },
};

const NONE: RGBA = [0, 0, 0, 0];

/** Map classes a reader can pick out at a glance, and that the legend can spotlight. */
export type CellClass = "fit" | "low" | "held" | "reach";

export function scoreColor(score: number, palette: ScorePalette, held = false): RGBA {
  if (Number.isNaN(score)) return NONE;
  if (score < 50) return held ? palette.held : palette.low;
  return palette.ramp[Math.min(50, Math.max(0, Math.round(score - 50)))];
}

export const css = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;

export function rampCss(palette: ScorePalette): string {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b, a] = palette.ramp[Math.round(t * 50)];
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${t * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
