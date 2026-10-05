import { hexToLch, lchToHex } from '@/components/ui/lch';
import type { ThemeSeeds } from '@/components/ui/theme';

// A theme from one hue: Settings → Appearance → Custom colour. The user picks a hue;
// lightness and chroma are ours, so the floors the presets are gated on hold
// for every hue by construction rather than being checked after the fact.

// `accent` at the default's L* 46: a `surface` (white) label clears 5.1:1 on
// it at every hue. Chroma 60 is a little under the default's 73 so the
// greens and magentas do not glare; out-of-gamut hues lose chroma.
const ACCENT = { lightness: 46, chroma: 60 };
// The ground and the ramp take the accent's hue at the shipped seeds' L* and
// chroma, so a hue reads as one family, as the presets do.
const GROUND = { lightness: 42.4, chroma: 8 };
const VIZ = { lightness: 58, chroma: 20 };
// `record` stays the shipped brass unless the accent comes within
// `RECORD_GAP` of it; then it steps that far away, on the side away from the
// accent. L* 45 keeps it ≥ 4.5:1 on `paper`, `surface` and `record-wash`.
const RECORD = { lightness: 45, chroma: 47, hue: hexToLch('#8A6516').hue };
const RECORD_GAP = 35;

export function normaliseHue(hue: number): number {
  return ((Math.round(hue) % 360) + 360) % 360;
}

// A plain name for a hue, for VoiceOver and the ring's centre.
export function hueName(hue: number): string {
  const h = normaliseHue(hue);
  const names: [number, string][] = [
    [15, 'Pink'],
    [35, 'Red'],
    [60, 'Orange'],
    [88, 'Amber'],
    [115, 'Olive'],
    [155, 'Green'],
    [215, 'Teal'],
    [285, 'Blue'],
    [310, 'Indigo'],
    [340, 'Purple'],
    [360, 'Pink'],
  ];
  return names.find(([upTo]) => h < upTo)![1];
}

export function seedsFromHue(hue: number): ThemeSeeds {
  const h = normaliseHue(hue);
  return {
    ground: lchToHex({ ...GROUND, hue: h }),
    accent: lchToHex({ ...ACCENT, hue: h }),
    record: lchToHex({ ...RECORD, hue: recordHue(h) }),
    viz: lchToHex({ ...VIZ, hue: h }),
  };
}

function recordHue(accentHue: number): number {
  const brass = RECORD.hue;
  const distance = Math.abs(accentHue - brass);
  if (Math.min(distance, 360 - distance) >= RECORD_GAP) return brass;
  return accentHue <= brass ? accentHue + RECORD_GAP : accentHue - RECORD_GAP;
}

// How a custom hue is stored in place of a preset id: `hue:47`.
const HUE_ID = /^hue:(\d{1,3})$/;

export type HueThemeId = `hue:${number}`;

export function hueThemeId(hue: number): HueThemeId {
  return `hue:${normaliseHue(hue)}`;
}

// The hue a stored id names, or null when it is not a hue id (or out of range).
export function parseHueThemeId(id: string): number | null {
  const match = HUE_ID.exec(id);
  if (!match) return null;
  const hue = Number(match[1]);
  return hue < 360 ? hue : null;
}
