import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { generateRoles, type ThemeMode, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { normaliseHue } from '@/components/ui/theme-hue';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): the user
// picks a hue and a strength for each of the five seeds, and the page's
// lightness and depth. Everything else is derived. No readability floor is
// gated here — only the presets are hand-checked.

// A hue (0–359) and a strength (0–100, a share of the part's most chroma).
export type HueStrength = { hue: number; strength: number };
// The page: its L* (0 black – 100 white) and its depth (0–300, a percentage of
// the shipped steps from the page to its cards, lines and empty cells).
export type CustomBackground = HueStrength & { lightness: number; depth: number };

export type CustomColours = {
  background: CustomBackground;
  text: HueStrength;
  accent: HueStrength;
  record: HueStrength;
  viz: HueStrength;
};

export type CustomPart = keyof CustomColours;
export const CUSTOM_PARTS: readonly CustomPart[] = ['background', 'text', 'accent', 'record', 'viz'];

export const STRENGTH_MAX = 100;
export const LIGHTNESS_MAX = 100;
export const DEPTH_MAX = 300;
export const DEFAULT_DEPTH = 100;

// Each seed's L* and the chroma a strength of 100 gives it. The L* are the
// shipped seeds' (the neutral `inkMuted`, the custom accent's 46, the brass's
// 45, the ramp's strongest step), so a converted preset keeps its look.
const SEED: Record<CustomPart, { lightness: number; chroma: number }> = {
  background: { lightness: 42.4, chroma: 40 },
  text: { lightness: 42.4, chroma: 40 },
  accent: { lightness: 46, chroma: 100 },
  record: { lightness: 45, chroma: 100 },
  viz: { lightness: 58, chroma: 60 },
};

// The seed a part's hue and strength make. Out-of-gamut chroma is reduced.
export function customSeed(part: CustomPart, { hue, strength }: HueStrength): string {
  const { lightness, chroma } = SEED[part];
  return lchToHex({ lightness, chroma: (chroma * strength) / STRENGTH_MAX, hue });
}

export function customSeeds(colours: CustomColours): ThemeSeeds {
  return {
    background: customSeed('background', colours.background),
    text: customSeed('text', colours.text),
    accent: customSeed('accent', colours.accent),
    record: customSeed('record', colours.record),
    viz: customSeed('viz', colours.viz),
  };
}

// A page at L* 50 or above takes dark text, on the light ladder; below, light
// text on the dark ladder.
export function customMode({ background }: CustomColours): ThemeMode {
  return background.lightness >= 50 ? 'light' : 'dark';
}

// The page's own steps, which depth spreads or flattens.
const GROUND_ROLES = new Set<keyof UiRoles>(['surface', 'rule', 'ruleSoft', 'viz0']);
// Roles that are the ladder's ends whatever the page: black or white.
const KEPT_ROLES = new Set<keyof UiRoles>(['selection', 'onAccent', 'onSelection', 'onDanger', 'onInk']);

// Every role for a custom theme. The ladder of its mode is generated from the
// seeds, then moved onto the chosen page: each role keeps its hue, its chroma
// and its place on the way from `paper` to `ink` (a share of that distance),
// and depth scales that share for the ground roles. `surface` takes the page's
// hue and chroma, so a tinted page has tinted cards.
export function generateCustomRoles(colours: CustomColours): UiRoles {
  const mode = customMode(colours);
  const reference = generateRoles(customSeeds(colours), mode);
  const paperRef = hexToLch(reference.paper).lightness;
  const end = hexToLch(reference.ink).lightness;
  const { lightness: page, depth } = colours.background;
  const paper = hexToLch(reference.paper);

  const moved = Object.fromEntries(
    Object.entries(reference).map(([name, value]) => {
      const role = name as keyof UiRoles;
      if (KEPT_ROLES.has(role) || role === 'scrim') return [role, value];
      const lch = role === 'surface' ? { ...hexToLch(value), chroma: paper.chroma, hue: paper.hue } : hexToLch(value);
      const share = ((lch.lightness - paperRef) / (end - paperRef)) * (GROUND_ROLES.has(role) ? depth / DEFAULT_DEPTH : 1);
      return [role, lchToHex({ ...lch, lightness: clamp(page + share * (end - page)) })];
    }),
  ) as UiRoles;
  // The backdrop behind a sheet: the moved `ink` at 42% on a light page, as
  // the light ladder draws it; the dark ladder's black otherwise.
  return mode === 'light' ? { ...moved, scrim: withAlpha(moved.ink, 0.42) } : moved;
}

const clamp = (lightness: number): number => Math.min(LIGHTNESS_MAX, Math.max(0, lightness));

// The custom colours nearest a theme's seeds, drawn on a mode: each seed's hue
// and strength, the page at that ladder's `paper` and the shipped depth. Used
// when the user first picks Custom, starting from the theme they were on.
export function customFromSeeds(seeds: ThemeSeeds, mode: ThemeMode): CustomColours {
  const pick = (part: CustomPart): HueStrength => {
    const { hue, chroma } = hexToLch(seeds[part]);
    return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round((chroma / SEED[part].chroma) * STRENGTH_MAX)) };
  };
  const paper = hexToLch(generateRoles(seeds, mode).paper).lightness;
  return {
    background: { ...pick('background'), lightness: Math.round(paper), depth: DEFAULT_DEPTH },
    text: pick('text'),
    accent: pick('accent'),
    record: pick('record'),
    viz: pick('viz'),
  };
}

const isInteger = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function parseHueStrength(value: unknown): HueStrength | null {
  if (typeof value !== 'object' || value === null) return null;
  const { hue, strength } = value as Record<string, unknown>;
  return isInteger(hue, 359) && isInteger(strength, STRENGTH_MAX) ? { hue, strength } : null;
}

// Custom colours as stored, or null when any part is missing or out of range.
export function parseCustomColours(value: unknown): CustomColours | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Record<string, unknown>;
  const parts = CUSTOM_PARTS.map((part) => parseHueStrength(stored[part]));
  if (parts.some((part) => part === null)) return null;
  const { lightness, depth } = stored.background as Record<string, unknown>;
  if (!isInteger(lightness, LIGHTNESS_MAX) || !isInteger(depth, DEPTH_MAX)) return null;
  const [background, text, accent, record, viz] = parts as HueStrength[];
  return { background: { ...background, lightness, depth }, text, accent, record, viz };
}
