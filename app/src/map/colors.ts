/**
 * Score → colour. Below the on-target line cells are a faint warm wash (present, not
 * worth buying); above it they ramp from pale to Radar blue. The ramp is perceptually
 * even-ish because it interpolates in OKLab, not RGB.
 */
type RGBA = [number, number, number, number];

const LOW: RGBA = [138, 128, 112, 26];
const PALE: [number, number, number] = [205, 210, 255];
const DEEP: [number, number, number] = [22, 38, 255];

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}
function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
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
function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const A = toOklab(PALE);
const B = toOklab(DEEP);
const RAMP: RGBA[] = Array.from({ length: 51 }, (_, k) => {
  const t = k / 50;
  const [r, g, b] = fromOklab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  return [r, g, b, Math.round(120 + 105 * t)];
});

const NONE: RGBA = [0, 0, 0, 0];

export function scoreColor(score: number): RGBA {
  if (Number.isNaN(score)) return NONE;
  if (score < 50) return LOW;
  return RAMP[Math.min(50, Math.max(0, Math.round(score - 50)))];
}

export function rampCss(): string {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b, a] = RAMP[Math.round(t * 50)];
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${t * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
