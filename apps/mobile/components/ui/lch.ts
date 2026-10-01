// CIE LCh (D65) ⇄ sRGB, the space the colour roles are specified and gated in
// (`docs/specs/ui/design-language.md` §2): L* is perceptual lightness 0–100,
// C* chroma (colourfulness), h the hue angle in degrees.

export type Lch = { lightness: number; chroma: number; hue: number };

const WHITE = { x: 0.95047, y: 1, z: 1.08883 };
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export function hexToLch(hex: string): Lch {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`hexToLch: expected #RRGGBB, got "${hex}"`);
  }
  const [r, g, b] = [1, 3, 5].map((offset) => toLinear(parseInt(hex.slice(offset, offset + 2), 16) / 255));
  const f = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE.x);
  const fy = f((0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE.y);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE.z);
  const a = 500 * (fx - fy);
  const bStar = 200 * (fy - fz);
  const hue = (Math.atan2(bStar, a) * 180) / Math.PI;
  return { lightness: 116 * fy - 16, chroma: Math.hypot(a, bStar), hue: hue < 0 ? hue + 360 : hue };
}

// The nearest sRGB colour at this lightness and hue: when the requested chroma
// lies outside the sRGB gamut it is reduced until the colour fits, so lightness
// and hue — what the roles are stepped in — are kept.
export function lchToHex({ lightness, chroma, hue }: Lch): string {
  let rgb = lchToLinearRgb(lightness, chroma, hue);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = chroma;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (inGamut(lchToLinearRgb(lightness, mid, hue))) low = mid;
      else high = mid;
    }
    rgb = lchToLinearRgb(lightness, low, hue);
  }
  return `#${rgb.map((channel) => toHexByte(fromLinear(channel))).join('')}`.toUpperCase();
}

// `#RRGGBB` at an opacity, as React Native's `rgba()` string.
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lchToLinearRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const fy = (lightness + 16) / 116;
  const fx = fy + (chroma * Math.cos(radians)) / 500;
  const fz = fy - (chroma * Math.sin(radians)) / 200;
  const inverse = (t: number) => (t ** 3 > EPSILON ? t ** 3 : (116 * t - 16) / KAPPA);
  const x = inverse(fx) * WHITE.x;
  const y = lightness > KAPPA * EPSILON ? fy ** 3 : lightness / KAPPA;
  const z = inverse(fz) * WHITE.z;
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

// A hair of tolerance so white (L* 100, C* 0) and the gamut edge round-trip.
function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function toHexByte(value: number): string {
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, '0');
}
