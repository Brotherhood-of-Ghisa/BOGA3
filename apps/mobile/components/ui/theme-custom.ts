import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { generateRoles, inkStep, type ThemeMode, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { normaliseHue } from '@/components/ui/theme-hue';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): the user
// picks a hue and a strength for each of the five seeds and for the primary
// text (`ink`, which presets step from the text seed), and the page's
// lightness and depth. Everything else is derived. No readability floor is
// gated here — only the presets are hand-checked.

// A hue (0–359) and a strength (0–100, a share of the part's most chroma).
export type HueStrength = { hue: number; strength: number };
// The page: its L* (0 black – 100 white) and its depth (0–300, a percentage of
// the shipped steps from the page to its cards, lines and empty cells).
export type CustomBackground = HueStrength & { lightness: number; depth: number };

export type CustomColours = {
  background: CustomBackground;
  // Primary text: `ink` alone.
  ink: HueStrength;
  // Secondary text: `inkMuted`, `inkFaint` and `inkGhost`.
  text: HueStrength;
  accent: HueStrength;
  record: HueStrength;
  viz: HueStrength;
};

export type CustomPart = keyof CustomColours;
export const CUSTOM_PARTS: readonly CustomPart[] = ['background', 'ink', 'text', 'accent', 'record', 'viz'];

export const STRENGTH_MAX = 100;
export const LIGHTNESS_MAX = 100;
export const DEPTH_MAX = 300;
export const DEFAULT_DEPTH = 100;

// Each seed's L* and the chroma a strength of 100 gives it. The L* are the
// shipped seeds' (the neutral `inkMuted`, the custom accent's 46, the brass's
// 45, the ramp's strongest step), so a converted preset keeps its look. `ink`'s
// seed only draws its hue ring: primary text is drawn by `customInk`.
const SEED: Record<CustomPart, { lightness: number; chroma: number }> = {
  background: { lightness: 42.4, chroma: 40 },
  ink: { lightness: 42.4, chroma: 40 },
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

// The five theme seeds; `ink` is not one of them (`generateCustomRoles`).
export function customSeeds(colours: CustomColours): ThemeSeeds {
  return {
    background: customSeed('background', colours.background),
    text: customSeed('text', colours.text),
    accent: customSeed('accent', colours.accent),
    record: customSeed('record', colours.record),
    viz: customSeed('viz', colours.viz),
  };
}

// Primary text sits at its ladder's `ink` L* (8 light, 95 dark), where sRGB
// holds little chroma and how much depends on the hue. Its strength is a share
// of the most that hue holds there, so the whole slider changes the colour.
const inkGamut = (mode: ThemeMode, hue: number): number =>
  hexToLch(lchToHex({ lightness: inkStep(mode).lightness, chroma: 150, hue })).chroma;

export function customInk(mode: ThemeMode, { hue, strength }: HueStrength): string {
  return lchToHex({ lightness: inkStep(mode).lightness, chroma: (inkGamut(mode, hue) * strength) / STRENGTH_MAX, hue });
}

// The primary text a text seed draws on a mode's ladder, as a hue and strength.
function inkFromTextSeed(mode: ThemeMode, seed: string): HueStrength {
  const { hue, chroma } = hexToLch(seed);
  const share = (chroma * inkStep(mode).chroma) / inkGamut(mode, hue);
  return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round(share * STRENGTH_MAX)) };
}

// A page at L* 50 or above takes dark text, on the light ladder; below, light
// text on the dark ladder.
export function customMode({ background }: Pick<CustomColours, 'background'>): ThemeMode {
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
  const reference = { ...generateRoles(customSeeds(colours), mode), ink: customInk(mode, colours.ink) };
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
  const pick = (part: CustomPart, seed: string): HueStrength => {
    const { hue, chroma } = hexToLch(seed);
    return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round((chroma / SEED[part].chroma) * STRENGTH_MAX)) };
  };
  const paper = hexToLch(generateRoles(seeds, mode).paper).lightness;
  return {
    background: { ...pick('background', seeds.background), lightness: Math.round(paper), depth: DEFAULT_DEPTH },
    ink: inkFromTextSeed(mode, seeds.text),
    text: pick('text', seeds.text),
    accent: pick('accent', seeds.accent),
    record: pick('record', seeds.record),
    viz: pick('viz', seeds.viz),
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
// A value without `ink` (stored before it was a part) takes the primary text
// its `text` drew, to the nearest whole strength.
export function parseCustomColours(value: unknown): CustomColours | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Record<string, unknown>;
  const read = (part: CustomPart) =>
    part === 'ink' && stored.ink === undefined ? 'missing' : parseHueStrength(stored[part]);
  const parts = Object.fromEntries(CUSTOM_PARTS.map((part) => [part, read(part)]));
  if (Object.values(parts).some((part) => part === null)) return null;
  const { background, text, accent, record, viz } = parts as Record<CustomPart, HueStrength>;
  const { lightness, depth } = stored.background as Record<string, unknown>;
  if (!isInteger(lightness, LIGHTNESS_MAX) || !isInteger(depth, DEPTH_MAX)) return null;
  const mode = customMode({ background: { ...background, lightness, depth } });
  const ink = parts.ink === 'missing' ? inkFromTextSeed(mode, customSeed('text', text)) : (parts.ink as HueStrength);
  return { background: { ...background, lightness, depth }, ink, text, accent, record, viz };
}
