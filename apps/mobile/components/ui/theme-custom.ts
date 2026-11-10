import { hexToLch, lchToHex, withAlpha, type Lch } from '@/components/ui/lch';
import { generateRoles, inkStep, rampLightness, type ThemeMode, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { normaliseHue } from '@/components/ui/theme-hue';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): the user
// picks a hue and a strength for each of the five seeds, for the borders and
// for the primary text (`ink`, which presets step from the text seed); the
// page's mode, lightness and depth; and the borders' and texts' contrast.
// Everything else is derived. No readability floor is gated here — only the
// presets are hand-checked.

// A hue (0–359) and a strength (0–100, a share of the part's most chroma).
export type HueStrength = { hue: number; strength: number };
// The page: its mode (the ladder it draws on), its L* (in steps of 0.25) and
// its depth (0–300, a percentage of the shipped steps from the page to its
// cards and empty cells).
export type CustomBackground = HueStrength & { mode: ThemeMode; lightness: number; depth: number };
// `rule` and `ruleSoft`: the background's hue and strength while `match`, else
// their own; `contrast` (0–300) is a percentage of their shipped steps from
// the page.
export type CustomBorders = HueStrength & { match: boolean; contrast: number };
// Primary text: `ink` alone, at its own L*.
export type CustomInk = HueStrength & { lightness: number };
// Secondary text: `inkMuted`, `inkFaint` and `inkGhost`; `contrast` (0–150) is
// a percentage of their shipped steps from the page.
export type CustomText = HueStrength & { contrast: number };
// The chart ramp. With `gamut`, a strength is a share of the most chroma each
// step's L* holds; without it, of the shipped seed's (themes saved before).
export type CustomViz = HueStrength & { gamut: boolean };

export type CustomColours = {
  background: CustomBackground;
  borders: CustomBorders;
  ink: CustomInk;
  text: CustomText;
  accent: HueStrength;
  record: HueStrength;
  viz: CustomViz;
};

export type CustomPart = keyof CustomColours;
export const CUSTOM_PARTS: readonly CustomPart[] = ['background', 'borders', 'ink', 'text', 'accent', 'record', 'viz'];

export const STRENGTH_MAX = 100;
export const LIGHTNESS_MAX = 100;
// The page's and the primary text's L* move in quarter steps: a dark page
// lives in the first few L*.
export const LIGHTNESS_STEP = 0.25;
export const DEPTH_MAX = 300;
export const DEFAULT_DEPTH = 100;
export const BORDER_CONTRAST_MAX = 300;
export const TEXT_CONTRAST_MAX = 150;
export const DEFAULT_CONTRAST = 100;

export type LightnessRange = { min: number; max: number };
// The useful L* of each mode's page and primary text: a dark page and pale
// text, or a pale page and dark text. A theme saved outside its range keeps
// its value until it is moved.
export const PAGE_RANGE: Record<ThemeMode, LightnessRange> = { dark: { min: 0, max: 35 }, light: { min: 65, max: 100 } };
export const INK_RANGE: Record<ThemeMode, LightnessRange> = { dark: { min: 60, max: 100 }, light: { min: 0, max: 40 } };
// Where a page lands when its mode is switched: near the ladder's `paper`.
export const PAGE_DEFAULT: Record<ThemeMode, number> = { dark: 10, light: 96.25 };
// The primary text's L* by default: the ladder's `ink` (8 light, 95 dark).
export const inkDefault = (mode: ThemeMode): number => inkStep(mode).lightness;

// Each seed's L* and the chroma a strength of 100 gives it. The L* are the
// shipped seeds' (the neutral `inkMuted`, the custom accent's 46, the brass's
// 45, the ramp's strongest step), so a converted preset keeps its look. `ink`'s
// seed only paints its hue bar: primary text is drawn by `gamutColour`. The
// borders' is the background's, so matching it changes nothing.
const SEED: Record<CustomPart, { lightness: number; chroma: number }> = {
  background: { lightness: 42.4, chroma: 40 },
  borders: { lightness: 42.4, chroma: 40 },
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

// The five theme seeds; `ink` and the borders are not among them
// (`generateCustomRoles`).
export function customSeeds(colours: CustomColours): ThemeSeeds {
  return {
    background: customSeed('background', colours.background),
    text: customSeed('text', colours.text),
    accent: customSeed('accent', colours.accent),
    record: customSeed('record', colours.record),
    viz: customSeed('viz', colours.viz),
  };
}

// The most chroma sRGB holds at an L* and hue.
const gamut = (lightness: number, hue: number): number => hexToLch(lchToHex({ lightness, chroma: 150, hue })).chroma;

// A colour at an L* whose strength is a share of the most that hue holds
// there, so the whole slider changes the colour: primary text (where sRGB
// holds little chroma) and the chart ramp's steps.
export function gamutColour(lightness: number, { hue, strength }: HueStrength): string {
  return lchToHex({ lightness, chroma: (gamut(lightness, hue) * strength) / STRENGTH_MAX, hue });
}

// Primary text at its ladder's `ink` L* (8 light, 95 dark).
export function customInk(mode: ThemeMode, colour: HueStrength): string {
  return gamutColour(inkDefault(mode), colour);
}

// The primary text a text seed draws on a mode's ladder, as a hue and strength.
function inkFromTextSeed(mode: ThemeMode, seed: string): HueStrength {
  const { hue, chroma } = hexToLch(seed);
  const share = (chroma * inkStep(mode).chroma) / gamut(inkDefault(mode), hue);
  return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round(share * STRENGTH_MAX)) };
}

// The ladder a custom theme draws on: its page's chosen mode.
export function customMode({ background }: Pick<CustomColours, 'background'>): ThemeMode {
  return background.mode;
}

// The ramp's L* when its strength is the gamut's, weakest first: the light
// ladder's, and in dark even steps from the ladder's `viz1` (26) to the light
// ramp's strongest (58) — past where `ink` holds 4.5:1, for the chroma.
const DARK_GAMUT_RAMP = [26, 26 + 32 / 3, 26 + 64 / 3, 58];
// The strongest step's L* in both modes: where a chart hue bar is painted.
export const rampStrongest = 58;
const RAMP_ROLES = ['viz1', 'viz2', 'viz3', 'viz4'] as const;

function gamutRamp({ gamut: own, ...colour }: CustomViz, mode: ThemeMode): Partial<UiRoles> {
  if (!own) return {};
  const steps = mode === 'light' ? rampLightness('light') : DARK_GAMUT_RAMP;
  return Object.fromEntries(RAMP_ROLES.map((role, index) => [role, gamutColour(steps[index], colour)]));
}

// Borders of their own hue and strength, on the ladder's `rule` steps.
function ownBorders(colours: CustomColours, mode: ThemeMode): Partial<UiRoles> {
  if (colours.borders.match) return {};
  const { rule, ruleSoft } = generateRoles({ ...customSeeds(colours), background: customSeed('borders', colours.borders) }, mode);
  return { rule, ruleSoft };
}

// Cards and empty cells: depth spreads or flattens them.
const GROUND_ROLES = new Set<keyof UiRoles>(['surface', 'viz0']);
const BORDER_ROLES = new Set<keyof UiRoles>(['rule', 'ruleSoft']);
const SECONDARY_ROLES = new Set<keyof UiRoles>(['inkMuted', 'inkFaint', 'inkGhost']);
// Roles that are the ladder's ends whatever the page: black or white.
const KEPT_ROLES = new Set<keyof UiRoles>(['selection', 'onAccent', 'onSelection', 'onDanger', 'onInk', 'scrim']);

// How far a role's step from the page is scaled: by depth, the borders'
// contrast, the secondary text's contrast, or not at all.
function roleScale(role: keyof UiRoles, colours: CustomColours): number {
  if (GROUND_ROLES.has(role)) return colours.background.depth / DEFAULT_DEPTH;
  if (BORDER_ROLES.has(role)) return colours.borders.contrast / DEFAULT_CONTRAST;
  if (SECONDARY_ROLES.has(role)) return colours.text.contrast / DEFAULT_CONTRAST;
  return 1;
}

// The reference ladder's `paper` and `ink` L*, and the chosen page.
type Frame = { paper: Lch; end: number; page: number };

// A role moved onto the chosen page: it keeps its hue, its chroma and its
// share of the way from `paper` to `ink`, scaled. `limit`, when given, is an
// L* it does not pass (the drawn `ink`, for the secondary text).
function moveRole(role: keyof UiRoles, value: string, frame: Frame, scale: number, limit: number | null): string {
  const { paper, end, page } = frame;
  const lch = role === 'surface' ? { ...hexToLch(value), chroma: paper.chroma, hue: paper.hue } : hexToLch(value);
  const share = ((lch.lightness - paper.lightness) / (end - paper.lightness)) * scale;
  const lightness = clamp(page + share * (end - page));
  return lchToHex({ ...lch, lightness: limit === null ? lightness : short(lightness, page, limit) });
}

// An L* on the page's side of `limit`.
const short = (lightness: number, page: number, limit: number): number =>
  page <= limit ? Math.min(lightness, limit) : Math.max(lightness, limit);

// Every role for a custom theme. The ladder of its mode is generated from the
// seeds, then moved onto the chosen page (`moveRole`): depth scales the cards
// and empty cells, the borders' contrast the hairlines and the secondary
// text's contrast its inks. `surface` takes the page's hue and chroma, so a
// tinted page has tinted cards. Primary text sits at its own L*; every other
// role keeps its place measured from the ladder's `ink`.
export function generateCustomRoles(colours: CustomColours): UiRoles {
  const mode = customMode(colours);
  const reference: UiRoles = {
    ...generateRoles(customSeeds(colours), mode),
    ink: customInk(mode, colours.ink),
    ...ownBorders(colours, mode),
    ...gamutRamp(colours.viz, mode),
  };
  const frame: Frame = { paper: hexToLch(reference.paper), end: hexToLch(reference.ink).lightness, page: colours.background.lightness };
  // At its ladder's L*, `ink` is moved like every role (onto the ladder's
  // end); elsewhere it is drawn at the chosen L*. The two paths differ only
  // by rounding, but the first keeps a theme saved before the lightness
  // existed byte-identical (`ui-theme-custom.test.ts`): do not merge them.
  const atLadder = colours.ink.lightness === inkDefault(mode);
  const inkLightness = atLadder ? frame.end : colours.ink.lightness;

  const moved = Object.fromEntries(
    Object.entries(reference).map(([name, value]) => {
      const role = name as keyof UiRoles;
      if (KEPT_ROLES.has(role)) return [role, value];
      return [role, moveRole(role, value, frame, roleScale(role, colours), SECONDARY_ROLES.has(role) ? inkLightness : null)];
    }),
  ) as UiRoles;
  const drawn = atLadder ? moved : { ...moved, ink: gamutColour(colours.ink.lightness, colours.ink) };
  // The backdrop behind a sheet: the drawn `ink` at 42% on a light page, as
  // the light ladder draws it; the dark ladder's black otherwise.
  return mode === 'light' ? { ...drawn, scrim: withAlpha(drawn.ink, 0.42) } : drawn;
}

const clamp = (lightness: number): number => Math.min(LIGHTNESS_MAX, Math.max(0, lightness));

// Borders that match their page: its hue and strength, stepped as far as its
// depth (how one depth drew both before borders were a part).
export const matchingBorders = ({ hue, strength, depth }: CustomBackground): CustomBorders => ({
  hue,
  strength,
  match: true,
  contrast: depth,
});

// The custom colours nearest a theme's seeds, drawn on a mode: each seed's hue
// and strength, the page at that ladder's `paper`, the shipped depth and
// contrasts and the shipped chart chroma. Used when the user first picks
// Custom, starting from the theme they were on.
export function customFromSeeds(seeds: ThemeSeeds, mode: ThemeMode): CustomColours {
  const pick = (part: CustomPart, seed: string): HueStrength => {
    const { hue, chroma } = hexToLch(seed);
    return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round((chroma / SEED[part].chroma) * STRENGTH_MAX)) };
  };
  const paper = hexToLch(generateRoles(seeds, mode).paper).lightness;
  const background: CustomBackground = { ...pick('background', seeds.background), mode, lightness: Math.round(paper), depth: DEFAULT_DEPTH };
  return {
    background,
    borders: matchingBorders(background),
    ink: { ...inkFromTextSeed(mode, seeds.text), lightness: inkDefault(mode) },
    text: { ...pick('text', seeds.text), contrast: DEFAULT_CONTRAST },
    accent: pick('accent', seeds.accent),
    record: pick('record', seeds.record),
    viz: { ...pick('viz', seeds.viz), gamut: false },
  };
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isInteger =
  (max: number) =>
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const isLightness = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value / LIGHTNESS_STEP) && value >= 0 && value <= LIGHTNESS_MAX;
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isMode = (value: unknown): value is ThemeMode => value === 'light' || value === 'dark';

// A field added after custom themes were first saved: its default when
// absent, null when present but invalid.
function optional<T>(value: unknown, valid: (value: unknown) => value is T, fallback: T): T | null {
  if (value === undefined) return fallback;
  return valid(value) ? value : null;
}

function parseHueStrength(value: unknown): HueStrength | null {
  if (!isFields(value)) return null;
  const { hue, strength } = value;
  return isInteger(359)(hue) && isInteger(STRENGTH_MAX)(strength) ? { hue, strength } : null;
}

// A page saved without a mode (before it was chosen) takes the one its
// lightness gave: light at 50 and above.
function parseBackground(value: unknown): CustomBackground | null {
  const colour = parseHueStrength(value);
  if (colour === null || !isFields(value)) return null;
  const { lightness, depth } = value;
  if (!isLightness(lightness) || !isInteger(DEPTH_MAX)(depth)) return null;
  const mode = optional(value.mode, isMode, lightness >= 50 ? 'light' : 'dark');
  return mode === null ? null : { ...colour, mode, lightness, depth };
}

function parseBorders(value: unknown): CustomBorders | null {
  const colour = parseHueStrength(value);
  if (colour === null || !isFields(value)) return null;
  const { match, contrast } = value;
  return isBoolean(match) && isInteger(BORDER_CONTRAST_MAX)(contrast) ? { ...colour, match, contrast } : null;
}

// Primary text saved without `ink` (before it was a part) takes the one its
// `text` drew, to the nearest whole strength; without a lightness, the
// ladder's.
function parseInk(stored: Fields, mode: ThemeMode, text: HueStrength): CustomInk | null {
  const colour = stored.ink === undefined ? inkFromTextSeed(mode, customSeed('text', text)) : parseHueStrength(stored.ink);
  if (colour === null) return null;
  const lightness = optional((stored.ink as Fields | undefined)?.lightness, isLightness, inkDefault(mode));
  return lightness === null ? null : { ...colour, lightness };
}

// A part with one field added since it was first saved: the field's default
// when absent.
function withField<T, K extends string, V>(colour: T | null, value: unknown, key: K, valid: (value: unknown) => value is V, fallback: V) {
  if (colour === null || !isFields(value)) return null;
  const field = optional(value[key], valid, fallback);
  return field === null ? null : ({ ...colour, [key]: field } as T & Record<K, V>);
}

// Custom colours as stored, or null when any part is missing or out of range.
// Fields added since the first custom themes are optional, and each default
// draws what the theme drew before the field existed: the mode from the
// lightness, borders that match the page at its depth, the primary text from
// the secondary at its ladder's L*, the shipped text contrast and chart chroma.
export function parseCustomColours(value: unknown): CustomColours | null {
  if (!isFields(value)) return null;
  const background = parseBackground(value.background);
  const [text, accent, record] = (['text', 'accent', 'record'] as const).map((part) => parseHueStrength(value[part]));
  if (background === null || text === null || accent === null || record === null) return null;
  const borders = value.borders === undefined ? matchingBorders(background) : parseBorders(value.borders);
  const ink = parseInk(value, background.mode, text);
  const textColour = withField(text, value.text, 'contrast', isInteger(TEXT_CONTRAST_MAX), DEFAULT_CONTRAST);
  const viz = withField(parseHueStrength(value.viz), value.viz, 'gamut', isBoolean, false);
  if (borders === null || ink === null || textColour === null || viz === null) return null;
  return { background, borders, ink, text: textColour, accent, record, viz };
}
