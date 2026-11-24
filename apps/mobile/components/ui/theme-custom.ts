import { hexToLch, lchToHex, withAlpha, type Lch } from '@/components/ui/lch';
import {
  darkFillLightness,
  DEFAULT_DIRECTION,
  generateRoles,
  inkStep,
  paperLightness,
  paperStep,
  rampLightness,
  THEME_DIRECTIONS,
  washLightness,
  type ThemeDirection,
  type ThemeMode,
  type RoleOptions,
  type ThemeSeeds,
  type UiRoles,
} from '@/components/ui/theme';
import { normaliseHue } from '@/components/ui/theme-hue';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): the user
// picks a hue and a strength for each of the four colour seeds, for the
// highlight (`accentWash`) and for the three inks (which presets step from the
// text seed); the page's mode, lightness, depth and borders; the inks', the
// accent's, the best ever's and an unmatched highlight's L* (each over the
// whole range, so every sRGB colour is reachable); a matching highlight's
// contrast; the chart ramp's
// ends, or the page's ramp, and solid bars; and the direction. Everything else
// is derived. No readability floor is gated here — only the presets are
// hand-checked.

// A hue (0–359) and a strength (0–100, a share of the most chroma the part's
// L* and hue hold; for a theme saved before `GAMUT_SCALE`, the page's, the
// accent's and the best ever's are shares of a fixed chroma, `SEED`).
export type HueStrength = { hue: number; strength: number };
// The page, the accent and the best ever on the gamut scale (`GAMUT_SCALE`):
// `tint`, when present, is the strength on the fixed-chroma scale (`SEED`)
// the part was saved with before the theme was converted, and the part draws
// from it as it did then, washes, rules, grounds and ramp included, so
// converting repaints nothing. Its strength and lightness are then read from
// what it draws (`gamutPart`). Moving that part's strength or lightness drops
// the tint (`untinted`).
export type Tinted = { tint?: number };
// The page: its mode (the ladder it draws on), its L* (in steps of 0.25), its
// depth (0–300, a percentage of the shipped steps from the page to the other
// grounds — wells, cards, fields on a card — and empty cells) and its borders
// (0–300, the same for the hairlines; absent, the depth).
export type CustomBackground = HueStrength & Tinted & { mode: ThemeMode; lightness: number; depth: number; borders?: number };
// The highlight: `accentWash`, the band behind the row being edited, the
// current set and today's plan. The accent's hue and strength while `match`,
// else its own, a share of the most chroma its ladder's L* holds; `contrast`
// (0–300) is a percentage of its shipped step from the page. A highlight of
// its own may have its own L* (`lightness`, 0–100): its strength is then a
// share of the most chroma there, hue and strength unrounded like an
// `OwnInk`, and `contrast` does not move it. Absent, it draws as before.
export type CustomHighlight = HueStrength & { match: boolean; contrast: number; lightness?: number };
// Primary text: `ink` alone, at its own L*.
export type CustomInk = HueStrength & { lightness: number };
// The text seed, which no page edits any more: its hue and strength, and
// `contrast` (0–150, a percentage of the shipped steps of `inkMuted` and
// `inkFaint` from the page). It draws the secondary and the muted text of a
// theme saved before they were parts, until one of them is moved.
export type CustomText = HueStrength & { contrast: number };
// Secondary (`inkMuted`) or muted text (`inkFaint`: planned, not-yet-done,
// placeholder and disabled values) at its own L*. Hue (0 to under 360),
// strength (a share of the most chroma there) and lightness (0–100) are
// stored unrounded, so storing the inks a theme draws repaints neither
// (`ownInks`).
export type OwnInk = HueStrength & { lightness: number };
// One end of the chart ramp (`viz1` the start, `viz4` the end): a colour at
// its own L*, unrounded like an `OwnInk`, so storing the ends a ramp draws
// repaints neither.
export type ChartEnd = OwnInk;
// The chart: `follow` draws the ramp the page gives; off, `viz1` is the
// start, `viz4` the end and `viz2`/`viz3` sit between them (`chartRamp`).
// `solid` draws every bar mark in `viz4` instead of the ramp's steps
// (`appearanceSolidBars`). The ends are stored with it, followed or not;
// turning `follow` off restarts them at the ends the page's ramp draws.
export type CustomChart = { follow: boolean; solid: boolean; start: ChartEnd; end: ChartEnd };
// The accent or best ever: a hue and strength, and on the gamut scale its own
// L* (absent, the mode's: `fillDefault`).
export type CustomFill = HueStrength & Tinted & { lightness?: number };
// The marker of a theme whose every strength is a share of the most chroma its
// part's L* and hue hold (`GAMUT_SCALE`). Absent (a theme saved before), the
// page's, the accent's and the best ever's strengths are shares of a fixed
// chroma (`SEED`), until one strength or lightness is moved (`onGamutScale`).
export const GAMUT_SCALE = 2;
export type CustomColours = {
  scale?: typeof GAMUT_SCALE;
  background: CustomBackground;
  ink: CustomInk;
  text: CustomText;
  // Absent (a theme saved before they were parts): stepped from the text
  // seed. The editor stores both at once.
  secondary?: OwnInk;
  muted?: OwnInk;
  accent: CustomFill;
  highlight: CustomHighlight;
  record: CustomFill;
  // Absent (a theme saved before it was a part): the page's ramp, steps on
  // the bars.
  chart?: CustomChart;
  direction: ThemeDirection;
};

// What the editor offers, one page each: the colour parts (one hue and
// strength each), the chart, then the direction.
export type CustomPart = Exclude<keyof CustomColours, 'text' | 'scale'>;
export type CustomColourPart = Exclude<CustomPart, 'chart' | 'direction'>;
export const CUSTOM_COLOUR_PARTS: readonly CustomColourPart[] = ['background', 'ink', 'secondary', 'muted', 'accent', 'highlight', 'record'];
export const CUSTOM_PARTS: readonly CustomPart[] = [...CUSTOM_COLOUR_PARTS, 'chart', 'direction'];
export const isColourPart = (part: CustomPart): part is CustomColourPart => part !== 'chart' && part !== 'direction';
// The secondary and the muted text: stored together, at their own L*.
export type OwnInkPart = 'secondary' | 'muted';
export const isOwnInkPart = (part: CustomPart): part is OwnInkPart => part === 'secondary' || part === 'muted';

export const STRENGTH_MAX = 100;
export const LIGHTNESS_MAX = 100;
// The page's and the primary text's L* move in quarter steps: a dark page
// lives in the first few L*.
export const LIGHTNESS_STEP = 0.25;
export const DEPTH_MAX = 300;
export const BORDERS_MAX = 300;
export const DEFAULT_DEPTH = 100;
export const TEXT_CONTRAST_MAX = 150;
export const HIGHLIGHT_CONTRAST_MAX = 300;
export const DEFAULT_CONTRAST = 100;

// Where a page lands when its mode is switched, or a preset is first made
// custom: the ladder's `paper`.
export const PAGE_DEFAULT: Record<ThemeMode, number> = { dark: paperLightness('dark'), light: paperLightness('light') };
// The primary text's L* by default: the ladder's `ink` (8 light, 95 dark).
export const inkDefault = (mode: ThemeMode): number => inkStep(mode).lightness;

// Each seed's L* and, on the fixed-chroma scale (a theme saved before
// `GAMUT_SCALE`, and a tint), the chroma a strength of 100 gives it. The L*
// are the shipped seeds' (the neutral `inkMuted`, the accent's and the
// brass's 43, which clear 4.5:1 on the light `paper`), so a converted preset
// keeps its look. The other parts are drawn by `gamutColour`.
type SeedPart = Exclude<keyof ThemeSeeds, 'direction'>;
const SEED: Record<SeedPart, { lightness: number; chroma: number }> = {
  background: { lightness: 42.4, chroma: 40 },
  text: { lightness: 42.4, chroma: 40 },
  accent: { lightness: 43, chroma: 100 },
  record: { lightness: 43, chroma: 100 },
};

// The seed a part's hue and strength make. Out-of-gamut chroma is reduced.
export function customSeed(part: SeedPart, { hue, strength }: HueStrength): string {
  const { lightness, chroma } = SEED[part];
  return lchToHex({ lightness, chroma: (chroma * strength) / STRENGTH_MAX, hue });
}

// The theme seeds; `ink` and the highlight are not among them
// (`generateCustomRoles`).
export function customSeeds(colours: CustomColours): ThemeSeeds {
  return {
    background: partSeed(colours, 'background'),
    text: customSeed('text', colours.text),
    accent: partSeed(colours, 'accent'),
    record: partSeed(colours, 'record'),
    direction: colours.direction,
  };
}

// The most chroma sRGB holds at an L* and hue.
const gamut = (lightness: number, hue: number): number => hexToLch(lchToHex({ lightness, chroma: 150, hue })).chroma;

// A hue at its most vivid: the most chroma sRGB holds at that hue, at the L*
// that holds it (whole L*s). What a hue picker paints, whatever the part's L*.
const vivid = new Map<number, string>();
export function vividColour(hue: number): string {
  const known = vivid.get(hue);
  if (known !== undefined) return known;
  let best = { lightness: 50, chroma: 0 };
  for (let lightness = 1; lightness < LIGHTNESS_MAX; lightness += 1) {
    const chroma = gamut(lightness, hue);
    if (chroma > best.chroma) best = { lightness, chroma };
  }
  const colour = lchToHex({ ...best, hue });
  vivid.set(hue, colour);
  return colour;
}

// Whether every strength is a share of the most chroma its part's L* holds.
export const isGamutScaled = ({ scale }: Pick<CustomColours, 'scale'>): boolean => scale === GAMUT_SCALE;

export type FillPart = 'accent' | 'record';
// The parts a conversion tints.
export type TintedPart = 'background' | FillPart;
export const isTintedPart = (part: CustomPart): part is TintedPart => part === 'background' || part === 'accent' || part === 'record';

// Whether a page, accent or best ever draws on the gamut scale: the theme is
// on it and the part has no tint.
const drawsOnGamut = (colours: CustomColours, part: TintedPart): boolean => isGamutScaled(colours) && colours[part].tint === undefined;

// A part with its tint dropped: it draws on the gamut scale from now on.
export function untinted<T extends Tinted>(colour: T): T {
  if (colour.tint === undefined) return colour;
  const { tint: _tint, ...rest } = colour;
  return rest as T;
}

// The accent's or best ever's L* when none is stored: the seed's in light
// mode (43), the dark ladder's in dark (72, 66).
export const fillDefault = (mode: ThemeMode, part: FillPart): number => (mode === 'light' ? SEED[part].lightness : darkFillLightness(part));

// What a page, accent or best ever is drawn from.
type SeedColours = Pick<CustomColours, 'scale' | 'background'> & Partial<Pick<CustomColours, FillPart>>;
type FillColours<P extends FillPart> = SeedColours & Pick<CustomColours, P>;

export const fillLightness = <P extends FillPart>(colours: FillColours<P>, part: P): number =>
  colours[part].lightness ?? fillDefault(customMode(colours), part);

// On the gamut scale, the accent or best ever at its own L*.
const gamutFill = <P extends FillPart>(colours: FillColours<P>, part: P): string => gamutColour(fillLightness(colours, part), colours[part]);

// On the gamut scale, the chroma the page asks of the background seed: the
// page's own (a share of what its L* holds) over the share `paper` takes.
const pageSeedChroma = (background: CustomBackground): number =>
  (gamut(background.lightness, background.hue) * background.strength) / STRENGTH_MAX / paperStep(background.mode).chroma;

// The seed a page, accent or best ever gives the ladder: on the fixed-chroma
// scale (a theme saved before, or a tinted part, from its tint); else the
// fill as drawn, or the page's seed at the chroma its `paper` asks (passed
// apart, `ladderOptions`: a hex at the seed's L* may hold less).
function partSeed<P extends TintedPart>(colours: SeedColours & Pick<CustomColours, P>, part: P): string {
  const colour: HueStrength & Tinted = colours[part];
  if (!isGamutScaled(colours)) return customSeed(part, colour);
  if (colour.tint !== undefined) return customSeed(part, { hue: colour.hue, strength: colour.tint });
  if (part === 'background') return lchToHex({ lightness: SEED.background.lightness, chroma: pageSeedChroma(colours.background), hue: colour.hue });
  return gamutFill(colours as FillColours<FillPart>, part as FillPart);
}

// The options a custom theme's ladder is generated with: the page's hue for
// the ramp, and the seed chroma a page on the gamut scale asks.
function ladderOptions(colours: CustomColours): RoleOptions {
  const { background } = colours;
  return { rampHue: background.hue, ...(drawsOnGamut(colours, 'background') ? { backgroundChroma: pageSeedChroma(background) } : {}) };
}

// The page and the fills on the gamut scale, each drawn at its own L*.
function gamutRoles(colours: CustomColours): Partial<UiRoles> {
  const { background } = colours;
  return {
    ...(drawsOnGamut(colours, 'background') ? { paper: gamutColour(background.lightness, background) } : {}),
    ...(drawsOnGamut(colours, 'accent') ? { accent: gamutFill(colours, 'accent') } : {}),
    ...(drawsOnGamut(colours, 'record') ? { record: gamutFill(colours, 'record') } : {}),
  };
}

// The seed the accent gives: the highlight that matches it is a wash of it.
export const accentSeed = (colours: FillColours<'accent'>): string => partSeed(colours, 'accent');

// A drawn colour as a share of the most chroma its L* holds at a hue.
function shareAt(lightness: number, hue: number, chroma: number): number {
  const most = gamut(lightness, hue);
  return most > 0 ? Math.min(STRENGTH_MAX, (chroma / most) * STRENGTH_MAX) : 0;
}

// The accent or best ever as drawn, on the gamut scale at its drawn L*: its
// hue kept, its strength unrounded.
function fillOf({ hue }: HueStrength, drawn: string): CustomFill {
  const { lightness, chroma } = hexToLch(drawn);
  const at = clamp(lightness);
  return { hue, strength: shareAt(at, hue, chroma), lightness: at };
}

// A theme on the gamut scale: as it is, or one saved before converted to the
// nearest values — the page, the accent and the best ever each tinted by its
// old strength, at the strength (unrounded) and, for the two fills, the L*
// they draw. The other parts were already on it, so it draws the same roles.
// The editor stores this on the first move of any strength or lightness.
export function onGamutScale(colours: CustomColours): CustomColours {
  if (isGamutScaled(colours)) return colours;
  const tinted: CustomColours = {
    ...colours,
    scale: GAMUT_SCALE,
    background: { ...colours.background, tint: colours.background.strength },
    accent: { ...colours.accent, tint: colours.accent.strength },
    record: { ...colours.record, tint: colours.record.strength },
  };
  const roles = generateCustomRoles(colours);
  return { ...tinted, background: drawnPart(tinted, 'background', roles), accent: drawnPart(tinted, 'accent', roles), record: drawnPart(tinted, 'record', roles) };
}

// A part of a theme on the gamut scale as it is: one not tinted as stored;
// a tinted one at the strength and L* (the page's own) it draws now, tint
// kept, so moving its strength or lightness starts where it is.
export function gamutPart<P extends TintedPart>(colours: CustomColours, part: P): CustomColours[P] {
  return colours[part].tint === undefined ? colours[part] : drawnPart(colours, part, generateCustomRoles(colours));
}

// A tinted part at the strength and L* the roles it draws give it.
function drawnPart<P extends TintedPart>(colours: CustomColours, part: P, roles: UiRoles): CustomColours[P] {
  if (part === 'background') {
    const { background } = colours;
    return { ...background, strength: shareAt(background.lightness, background.hue, hexToLch(roles.paper).chroma) } as CustomColours[P];
  }
  const colour = colours[part];
  return { ...fillOf(colour, roles[part as FillPart]), tint: colour.tint } as CustomColours[P];
}

// A colour at an L* whose strength is a share of the most that hue holds
// there, so the whole slider changes the colour: every part on the gamut
// scale, the inks and the highlight on either.
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

// A drawn colour as an ink at its own L*, unrounded: `gamutColour` draws the
// same hex again. An L* that holds no chroma (black, white) has strength 0.
function ownInkOf(colour: string): OwnInk {
  const { lightness, chroma, hue } = hexToLch(colour);
  const at = clamp(lightness);
  const most = gamut(at, hue);
  return { hue, strength: most > 0 ? Math.min(STRENGTH_MAX, (chroma / most) * STRENGTH_MAX) : 0, lightness: at };
}

// The secondary and the muted text, each at its own L*: as stored, else as
// the theme draws them now. The editor stores both on the first move of
// either, so neither jumps.
export function ownInks(colours: CustomColours): Record<OwnInkPart, OwnInk> {
  const { secondary, muted } = colours;
  let roles: UiRoles | undefined;
  const drawn = (): UiRoles => (roles ??= generateCustomRoles(colours));
  return { secondary: secondary ?? ownInkOf(drawn().inkMuted), muted: muted ?? ownInkOf(drawn().inkFaint) };
}

// The secondary and the muted text on a newly chosen mode: those stored go to
// that ladder's L* (as primary text goes to its `ink`); those not yet stored
// stay absent, stepped from the new page.
export function inksInMode({ secondary, muted }: CustomColours, mode: ThemeMode): Partial<Record<OwnInkPart, OwnInk>> {
  return {
    ...(secondary === undefined ? {} : { secondary: { ...secondary, lightness: inkStep(mode, 'inkMuted').lightness } }),
    ...(muted === undefined ? {} : { muted: { ...muted, lightness: inkStep(mode, 'inkFaint').lightness } }),
  };
}

// The accent and the best ever on a newly chosen mode: on the gamut scale,
// those not tinted go to that ladder's L* (as the inks go to theirs); a
// tinted one draws as before, from its tint.
export function fillsInMode(colours: CustomColours, mode: ThemeMode): Partial<Pick<CustomColours, FillPart>> {
  if (!isGamutScaled(colours)) return {};
  const fills: Partial<Pick<CustomColours, FillPart>> = {};
  for (const part of ['accent', 'record'] as const) {
    if (colours[part].tint === undefined) fills[part] = { ...colours[part], lightness: fillDefault(mode, part) };
  }
  return fills;
}

// The chart as stored, else the page's ramp with steps on the bars, its ends
// as the theme draws them now: switching the ramp from the page starts there,
// so neither end moves (the steps between become the LCh thirds).
export function chartOf(colours: CustomColours): CustomChart {
  return colours.chart ?? { follow: true, solid: false, ...drawnEnds(colours) };
}

// The ramp's ends as a theme draws them now, each at its own L*.
export function drawnEnds(colours: CustomColours): Pick<CustomChart, 'start' | 'end'> {
  const { viz1, viz4 } = generateCustomRoles(colours);
  return { start: ownInkOf(viz1), end: ownInkOf(viz4) };
}

// The chart on a newly chosen mode: its ends at that ladder's `viz1` and
// `viz4` L* (as the inks go to theirs); none stored, none.
export function chartInMode({ chart }: CustomColours, mode: ThemeMode): Pick<CustomColours, 'chart'> {
  if (chart === undefined) return {};
  const { start, end } = chart;
  return { chart: { ...chart, start: { ...start, lightness: rampLightness(mode, 'viz1') }, end: { ...end, lightness: rampLightness(mode, 'viz4') } } };
}

// A chart end in LCh: its strength a share of the most chroma its L* and hue
// hold, as `gamutColour` draws it.
const endLch = ({ lightness, hue, strength }: ChartEnd): Lch => ({ lightness, chroma: (gamut(lightness, hue) * strength) / STRENGTH_MAX, hue });

// The turn from one hue to another the short way round, in degrees: −180 to
// 180, and +180 (rising hue) when they are opposite.
export function hueTurn(from: number, to: number): number {
  const turn = ((((to - from) % 360) + 540) % 360) - 180;
  return turn === -180 ? 180 : turn;
}

// Below this chroma an end is a grey: its hue is not seen, so the steps
// between take the other end's.
const GREY_CHROMA = 0.5;

// The ramp between a chosen start (`viz1`) and end (`viz4`): `viz2` and `viz3`
// a third and two thirds of the way in L*, C* and hue, the hue the short way
// round (a grey end takes the other's hue). The ends are drawn exactly; a step
// out of gamut loses chroma.
export function chartRamp({ start, end }: Pick<CustomChart, 'start' | 'end'>): Pick<UiRoles, 'viz1' | 'viz2' | 'viz3' | 'viz4'> {
  const [from, to] = [endLch(start), endLch(end)];
  const fromHue = from.chroma < GREY_CHROMA ? to.hue : from.hue;
  const turn = hueTurn(fromHue, to.chroma < GREY_CHROMA ? fromHue : to.hue);
  const at = (share: number): string =>
    lchToHex({
      lightness: from.lightness + share * (to.lightness - from.lightness),
      chroma: from.chroma + share * (to.chroma - from.chroma),
      hue: (((fromHue + share * turn) % 360) + 360) % 360,
    });
  return { viz1: gamutColour(start.lightness, start), viz2: at(1 / 3), viz3: at(2 / 3), viz4: gamutColour(end.lightness, end) };
}

// Whether a custom theme draws every bar mark in its ramp's end.
export const solidBars = ({ chart }: Pick<CustomColours, 'chart'>): boolean => chart?.solid === true;

// The ladder a custom theme draws on: its page's chosen mode.
export function customMode({ background }: Pick<CustomColours, 'background'>): ThemeMode {
  return background.mode;
}

// Seeds read only for the accent's wash: the others are not looked at.
const accentOnlySeeds = (accent: string): ThemeSeeds => ({ background: accent, text: accent, accent, record: accent, direction: DEFAULT_DIRECTION });

// The highlight as a hue and a strength (a share of the most chroma the
// ladder's wash L* holds): the one an accent seed draws, so unmatching it
// changes nothing.
export function highlightFromAccent(accentSeed: string, mode: ThemeMode): HueStrength {
  const { hue, chroma } = hexToLch(generateRoles(accentOnlySeeds(accentSeed), mode).accentWash);
  const share = chroma / gamut(washLightness(mode), hue);
  return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round(share * STRENGTH_MAX)) };
}

// A highlight of its own hue and strength, at the ladder's wash L*.
function ownHighlight({ highlight }: CustomColours, mode: ThemeMode): Partial<UiRoles> {
  return highlight.match ? {} : { accentWash: gamutColour(washLightness(mode), highlight) };
}

// The other grounds and empty cells: depth spreads or flattens them.
const GROUND_ROLES = new Set<keyof UiRoles>(['well', 'surface', 'raised', 'viz0']);
// The hairlines: borders spread or flatten them.
const RULE_ROLES = new Set<keyof UiRoles>(['rule', 'ruleSoft']);
// Grounds that take the page's hue and chroma, so a tinted page has tinted
// cards and fields (the light ladder's `raised` is white, with no hue of its own).
const PAGE_TINTED_ROLES = new Set<keyof UiRoles>(['surface', 'raised']);
const SECONDARY_ROLES = new Set<keyof UiRoles>(['inkMuted', 'inkFaint']);
const HIGHLIGHT_ROLES = new Set<keyof UiRoles>(['accentWash']);
// Roles that are the ladder's ends whatever the page: black or white.
const KEPT_ROLES = new Set<keyof UiRoles>(['selection', 'onAccent', 'onSelection', 'onDanger', 'onInk', 'scrim']);

// How far a role's step from the page is scaled: by depth, borders, the
// secondary text's contrast, the highlight's contrast, or not at all.
function roleScale(role: keyof UiRoles, colours: CustomColours): number {
  if (GROUND_ROLES.has(role)) return colours.background.depth / DEFAULT_DEPTH;
  if (RULE_ROLES.has(role)) return bordersOf(colours.background) / DEFAULT_DEPTH;
  if (SECONDARY_ROLES.has(role)) return colours.text.contrast / DEFAULT_CONTRAST;
  if (HIGHLIGHT_ROLES.has(role)) return colours.highlight.contrast / DEFAULT_CONTRAST;
  return 1;
}

// The borders a page draws: its own, else its depth (how a theme saved before
// borders existed drew its hairlines).
export const bordersOf = ({ borders, depth }: Pick<CustomBackground, 'borders' | 'depth'>): number => borders ?? depth;

// The reference ladder's `paper` and `ink` L*, and the chosen page.
type Frame = { paper: Lch; end: number; page: number };

// A role moved onto the chosen page: it keeps its hue, its chroma and its
// share of the way from `paper` to `ink`, scaled. `limit`, when given, is an
// L* it does not pass (the drawn `ink`, for the secondary text).
function moveRole(role: keyof UiRoles, value: string, frame: Frame, scale: number, limit: number | null): string {
  const { paper, end, page } = frame;
  const lch = PAGE_TINTED_ROLES.has(role) ? { ...hexToLch(value), chroma: paper.chroma, hue: paper.hue } : hexToLch(value);
  const share = ((lch.lightness - paper.lightness) / (end - paper.lightness)) * scale;
  const lightness = clamp(page + share * (end - page));
  return lchToHex({ ...lch, lightness: limit === null ? lightness : short(lightness, page, limit) });
}

// The ladder's `paper`, whose hue and chroma `surface` and `raised` take: on
// the gamut scale, a page not tinted gives its own as drawn (at the ladder's
// L* the chroma its L* holds may not fit).
function framePaper(colours: CustomColours, paper: string): Lch {
  const ladder = hexToLch(paper);
  if (!drawsOnGamut(colours, 'background')) return ladder;
  const { background } = colours;
  return { ...ladder, chroma: hexToLch(gamutColour(background.lightness, background)).chroma, hue: background.hue };
}

// An L* on the page's side of `limit`.
const short = (lightness: number, page: number, limit: number): number =>
  page <= limit ? Math.min(lightness, limit) : Math.max(lightness, limit);

// Every role for a custom theme. The ladder of its mode is generated from the
// seeds, then moved onto the chosen page (`moveRole`): depth scales the
// grounds and empty cells, borders the hairlines, the text seed's contrast
// the secondary and muted text until they are stored, the highlight's its
// band. `surface` and `raised` take the page's hue and chroma. Primary text
// sits at its own L*, and so do the secondary and the muted text once they
// have one (`ownInkRoles`), and on the gamut scale the page and the fills not
// tinted (`gamutRoles`); every other role keeps its place measured from the
// ladder's `ink`. A chart that does not follow the
// page draws its own ramp (`chartRamp`). The `ink` direction draws both
// changes in the drawn `ink`.
export function generateCustomRoles(colours: CustomColours): UiRoles {
  const mode = customMode(colours);
  const reference: UiRoles = {
    ...generateRoles(customSeeds(colours), mode, ladderOptions(colours)),
    ink: customInk(mode, colours.ink),
    ...ownHighlight(colours, mode),
  };
  const frame: Frame = { paper: framePaper(colours, reference.paper), end: hexToLch(reference.ink).lightness, page: colours.background.lightness };
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
  const inked = {
    ...moved,
    ...(atLadder ? {} : { ink: gamutColour(colours.ink.lightness, colours.ink) }),
    ...ownInkRoles(colours),
    ...ownHighlightRole(colours),
    ...gamutRoles(colours),
    ...(colours.chart === undefined || colours.chart.follow ? {} : chartRamp(colours.chart)),
  };
  // A custom page and its cards are one family of lightness: text on the page
  // is drawn in the inks, and the step below a card is the page.
  const paged = { ...inked, pageInk: inked.ink, pageInkMuted: inked.inkMuted, pageInkFaint: inked.inkFaint, inset: inked.paper };
  const drawn = colours.direction === 'ink' ? { ...paged, gain: paged.ink, loss: paged.ink } : paged;
  // The backdrop behind a sheet: the drawn `ink` at 42% on a light page, as
  // the light ladder draws it; the dark ladder's black otherwise.
  return mode === 'light' ? { ...drawn, scrim: withAlpha(drawn.ink, 0.42) } : drawn;
}

const clamp = (lightness: number): number => Math.min(LIGHTNESS_MAX, Math.max(0, lightness));

// The secondary and the muted text drawn at their own L*, with no limit
// against `ink` or each other.
function ownInkRoles({ secondary, muted }: CustomColours): Partial<UiRoles> {
  return {
    ...(secondary === undefined ? {} : { inkMuted: gamutColour(secondary.lightness, secondary) }),
    ...(muted === undefined ? {} : { inkFaint: gamutColour(muted.lightness, muted) }),
  };
}

// A highlight of its own at its own L*, which its contrast does not move.
function ownHighlightRole({ highlight }: CustomColours): Partial<UiRoles> {
  return highlight.match || highlight.lightness === undefined ? {} : { accentWash: gamutColour(highlight.lightness, highlight) };
}

// The highlight as the editor shows it: matching the accent, or at its own
// L*, as stored; else at the L* and strength (unrounded, its hue kept) it
// draws now, so storing that repaints nothing.
export function highlightOf(colours: CustomColours): CustomHighlight {
  const { highlight } = colours;
  if (highlight.match || highlight.lightness !== undefined) return highlight;
  const { lightness, chroma } = hexToLch(generateCustomRoles(colours).accentWash);
  const at = clamp(lightness);
  return { ...highlight, strength: shareAt(at, highlight.hue, chroma), lightness: at };
}

// A highlight without its own L*: drawn at the ladder's wash, moved by its
// contrast, its hue and strength whole as such a highlight is stored (one at
// its own L* holds them unrounded).
export function washHighlight(highlight: CustomHighlight): CustomHighlight {
  if (highlight.lightness === undefined) return highlight;
  const { lightness: _lightness, hue, strength, ...rest } = highlight;
  return { ...rest, hue: Math.round(hue) % 360, strength: Math.round(strength) };
}

// The custom colours nearest a theme's seeds, drawn on a mode: each seed's hue
// and strength, the page at that ladder's `paper`, the shipped depth and
// contrasts, and the seeds' direction, on the fixed-chroma scale (the
// editor converts it on the first strength or lightness move). Used when the
// user first picks Custom, starting from the theme they were on.
export function customFromSeeds(seeds: ThemeSeeds, mode: ThemeMode): CustomColours {
  const pick = (part: SeedPart, seed: string): HueStrength => {
    const { hue, chroma } = hexToLch(seed);
    return { hue: normaliseHue(hue), strength: Math.min(STRENGTH_MAX, Math.round((chroma / SEED[part].chroma) * STRENGTH_MAX)) };
  };
  const background: CustomBackground = { ...pick('background', seeds.background), mode, lightness: PAGE_DEFAULT[mode], depth: DEFAULT_DEPTH };
  return {
    background,
    ink: { ...inkFromTextSeed(mode, seeds.text), lightness: inkDefault(mode) },
    text: { ...pick('text', seeds.text), contrast: DEFAULT_CONTRAST },
    accent: pick('accent', seeds.accent),
    highlight: { ...highlightFromAccent(seeds.accent, mode), match: true, contrast: DEFAULT_CONTRAST },
    record: pick('record', seeds.record),
    direction: seeds.direction,
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
const isWithin =
  (max: number, below = false) =>
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && (below ? value < max : value <= max);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isMode = (value: unknown): value is ThemeMode => value === 'light' || value === 'dark';
const isDirection = (value: unknown): value is ThemeDirection => THEME_DIRECTIONS.includes(value as ThemeDirection);

// A field added after custom themes were first saved: its default when
// absent, null when present but invalid.
function optional<T>(value: unknown, valid: (value: unknown) => value is T, fallback: T): T | null {
  if (value === undefined) return fallback;
  return valid(value) ? value : null;
}

// A hue and a strength, whole; on the gamut scale the page's, the accent's
// and the best ever's strength may be unrounded (a conversion stores what
// each draws).
function parseHueStrength(value: unknown, unrounded = false): HueStrength | null {
  if (!isFields(value)) return null;
  const { hue, strength } = value;
  const validStrength = unrounded ? isWithin(STRENGTH_MAX) : isInteger(STRENGTH_MAX);
  return isInteger(359)(hue) && validStrength(strength) ? { hue, strength } : null;
}

// On the gamut scale, a part's tint (`Tinted`): absent, or a whole strength.
// A theme saved before has none: an unknown field.
function withTint<T extends HueStrength>(colour: T | null, value: unknown, scaled: boolean): (T & Tinted) | null {
  if (colour === null || !scaled || !isFields(value) || value.tint === undefined) return colour;
  return isInteger(STRENGTH_MAX)(value.tint) ? { ...colour, tint: value.tint } : null;
}

// The accent or best ever; on the gamut scale with its tint and L*, each
// optional.
function parseFill(value: unknown, scaled: boolean): CustomFill | null {
  const colour = withTint(parseHueStrength(value, scaled), value, scaled);
  if (colour === null || !scaled || !isFields(value) || value.lightness === undefined) return colour;
  return isWithin(LIGHTNESS_MAX)(value.lightness) ? { ...colour, lightness: value.lightness } : null;
}

// The scale marker: absent (a theme saved before it), or `GAMUT_SCALE`.
function parseScale(value: unknown): { scale?: typeof GAMUT_SCALE } | null {
  if (value === undefined) return {};
  return value === GAMUT_SCALE ? { scale: GAMUT_SCALE } : null;
}

// A page saved without a mode (before it was chosen) takes the one its
// lightness gave: light at 50 and above.
function parseBackground(value: unknown, scaled: boolean): CustomBackground | null {
  const colour = withTint(parseHueStrength(value, scaled), value, scaled);
  if (colour === null || !isFields(value)) return null;
  const { lightness, depth } = value;
  if (!isLightness(lightness) || !isInteger(DEPTH_MAX)(depth)) return null;
  const mode = optional(value.mode, isMode, lightness >= 50 ? 'light' : 'dark');
  if (mode === null) return null;
  if (value.borders === undefined) return { ...colour, mode, lightness, depth };
  return isInteger(BORDERS_MAX)(value.borders) ? { ...colour, mode, lightness, depth, borders: value.borders } : null;
}

// An ink at its own L*, its values unrounded (`OwnInk`).
function parseOwnInk(value: unknown): OwnInk | null {
  if (!isFields(value)) return null;
  const { hue, strength, lightness } = value;
  return isWithin(360, true)(hue) && isWithin(STRENGTH_MAX)(strength) && isWithin(LIGHTNESS_MAX)(lightness) ? { hue, strength, lightness } : null;
}

// The secondary and the muted text, each absent or at its own L*.
function parseOwnInks(stored: Fields): Partial<Record<OwnInkPart, OwnInk>> | null {
  const inks: Partial<Record<OwnInkPart, OwnInk>> = {};
  for (const part of ['secondary', 'muted'] as const) {
    if (stored[part] === undefined) continue;
    const ink = parseOwnInk(stored[part]);
    if (ink === null) return null;
    inks[part] = ink;
  }
  return inks;
}

// A chart: both switches and both ends. Absent is `undefined`, invalid null.
function parseChart(value: unknown): CustomChart | null | undefined {
  if (value === undefined) return undefined;
  if (!isFields(value)) return null;
  const { follow, solid } = value;
  const [start, end] = [parseOwnInk(value.start), parseOwnInk(value.end)];
  return isBoolean(follow) && isBoolean(solid) && start !== null && end !== null ? { follow, solid, start, end } : null;
}

// A highlight; with its own L*, its hue and strength unrounded (`OwnInk`).
function parseHighlight(value: unknown): CustomHighlight | null {
  if (!isFields(value)) return null;
  const own = value.lightness === undefined ? null : parseOwnInk(value);
  const colour = value.lightness === undefined ? parseHueStrength(value) : own;
  if (colour === null) return null;
  const { match, contrast } = value;
  return isBoolean(match) && isInteger(HIGHLIGHT_CONTRAST_MAX)(contrast) ? { ...colour, match, contrast } : null;
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

// A highlight that matches the accent: its hue and strength as the wash of
// its seed draws them, at the shipped contrast (how a theme drew it before it
// was a part).
const matchingHighlight = (seed: string, mode: ThemeMode): CustomHighlight => ({
  ...highlightFromAccent(seed, mode),
  match: true,
  contrast: DEFAULT_CONTRAST,
});

// Custom colours as stored, or null when any part is missing or out of range.
// Fields added since the first custom themes are optional, and each default
// draws what the theme drew before the field existed: the mode from the
// lightness, a highlight that matches the accent, the primary text from the
// secondary at its ladder's L*, the shipped text contrast, the secondary and
// muted text stepped from the page by it (absent `secondary`, `muted`), the
// page's ramp with steps on the bars (absent `chart`), green and crimson,
// and the fixed-chroma strengths (absent `scale`; on it, a tint and a fill's
// L* are optional too). The top-level parts since removed — `borders` (it is `background.borders`
// now, absent following the depth) and `viz` (the ramp is `chart` now) — are
// ignored like any unknown field.
export function parseCustomColours(value: unknown): CustomColours | null {
  if (!isFields(value)) return null;
  const scale = parseScale(value.scale);
  if (scale === null) return null;
  const scaled = isGamutScaled(scale);
  const background = parseBackground(value.background, scaled);
  const text = parseHueStrength(value.text);
  const [accent, record] = [parseFill(value.accent, scaled), parseFill(value.record, scaled)];
  if (background === null || text === null || accent === null || record === null) return null;
  const ink = parseInk(value, background.mode, text);
  const textColour = withField(text, value.text, 'contrast', isInteger(TEXT_CONTRAST_MAX), DEFAULT_CONTRAST);
  const inks = parseOwnInks(value);
  const highlight =
    value.highlight === undefined ? matchingHighlight(accentSeed({ ...scale, background, accent }), background.mode) : parseHighlight(value.highlight);
  const chart = parseChart(value.chart);
  const direction = optional(value.direction, isDirection, DEFAULT_DIRECTION);
  if (ink === null || textColour === null || inks === null || highlight === null || chart === null || direction === null) return null;
  return { ...scale, background, ink, text: textColour, ...inks, accent, highlight, record, ...(chart === undefined ? {} : { chart }), direction };
}
