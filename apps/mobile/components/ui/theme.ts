import { hexToLch, lchToHex, withAlpha, type Lch } from '@/components/ui/lch';

// The colours a theme is made from (`docs/specs/ui/design-language.md` §2,
// "Derivation"): four seeds and a direction. The palette follows these; danger,
// filter selection, the regimes and the on-colour roles keep fixed colours per
// mode in every theme.
export type ThemeSeeds = {
  // A mid neutral. Its hue and chroma tint the ground family: the four grounds
  // (`well`, `paper`, `surface`, `raised`), the two rules and `viz0`, so the
  // page reads as one warm (or cool) family. The chart ramp takes its hue too.
  background: string;
  // A mid neutral. Its hue and chroma tint the ink family, `ink` to
  // `inkFaint`, and `scrim`. A theme that has not split them gives both
  // families the same neutral.
  text: string;
  // The one primary action, used as given.
  accent: string;
  // An all-time best, used as given. Keep it a different hue from `accent`.
  record: string;
  // How `gain` and `loss` are drawn (`DIRECTION_PAIRS`).
  direction: ThemeDirection;
};

// A change's two directions as a pair of hues, or both in `ink`: the sign is
// always drawn, so `ink` still reads.
export type ThemeDirection = 'green-crimson' | 'blue-orange' | 'ink';
export const THEME_DIRECTIONS: readonly ThemeDirection[] = ['green-crimson', 'blue-orange', 'ink'];
export const DEFAULT_DIRECTION: ThemeDirection = 'green-crimson';

// The shipped theme. `background` and `text` are both `inkMuted`, the mid
// neutral the others were picked around; `accent` and `record` are the roles
// picked on device (2026-09-22), darkened to L* 43 so each clears 4.5:1 on the
// light `paper`.
export const defaultThemeSeeds: ThemeSeeds = {
  background: '#6B6358',
  text: '#6B6358',
  accent: '#B83902',
  record: '#845F0F',
  direction: DEFAULT_DIRECTION,
};

// The two lightness ladders a theme is drawn on. `light` is a dark ink on a
// pale page; `dark` a pale ink on a dark page. The seeds are the same in both:
// a seed sets hue and chroma, the ladder sets lightness.
export type ThemeMode = 'light' | 'dark';

// The colours a step is taken from: the four seeds, and the chart ramp's
// colour, which `background` gives (`rampColour`).
type SeedName = Exclude<keyof ThemeSeeds, 'direction'> | 'ramp';

// A role as a step of a seed: the role's own L*, at the seed's hue, with the
// seed's chroma scaled by `chroma`.
type Step = { seed: SeedName; lightness: number; chroma: number };

const step = (seed: SeedName, lightness: number, chroma: number): Step => ({ seed, lightness, chroma });

// The lightness ladders a theme can be drawn on. `standard` is the light and
// the dark ladder, chosen by mode; `ink-paper` is the Ink + paper preset's own:
// a dark page under light cards, the same in both modes.
export type ThemeLadder = 'standard' | 'ink-paper';

// Text drawn straight on the page, not on a card: a page's title, its section
// headings, a pager's tabs, a header's title and glyphs.
type PageInkRole = 'pageInk' | 'pageInkMuted' | 'pageInkFaint';

// A ladder whose page and cards are one family of lightness: the page inks are
// the inks, and the step below a card, inside it, is the page.
const withPageInks = (ladder: Record<Exclude<SteppedRole, PageInkRole | 'inset'>, Step>): Record<SteppedRole, Step> => ({
  ...ladder,
  pageInk: ladder.ink,
  pageInkMuted: ladder.inkMuted,
  pageInkFaint: ladder.inkFaint,
  inset: ladder.paper,
});

type SteppedRole =
  | PageInkRole
  | 'inset'
  | 'ink'
  | 'inkMuted'
  | 'inkFaint'
  | 'well'
  | 'paper'
  | 'surface'
  | 'raised'
  | 'rule'
  | 'ruleSoft'
  | 'accentWash'
  | 'recordWash'
  | 'recordRule'
  | 'viz0'
  | 'viz1'
  | 'viz2'
  | 'viz3'
  | 'viz4';

// The light ladder. The washes and ramp are the values the shipped roles were
// picked at. The grounds are a ladder, `well` 90 < `paper` 92 < `surface` 97 <
// `raised` 100: a card stands off the page by 5 L*, and every preset's `accent`,
// used as given, clears 4.5:1 on that page. `inkFaint` clears 3:1 on `paper` and
// `surface`. The hairlines are about 8% ink over a card.
const LIGHT_STEPS = withPageInks({
  ink: step('text', 8, 0.53),
  inkMuted: step('text', 42.4, 1),
  inkFaint: step('text', 55, 0.83),
  // Sunken: the track of a segmented control, a slider or a bar.
  well: step('background', 90, 0.4),
  paper: step('background', 92, 0.35),
  surface: step('background', 97, 0.2),
  // An input or field on a card: white.
  raised: step('background', 100, 0),
  // Hairlines sit on the grounds, so they belong to the ground they divide,
  // not to the text drawn on it.
  rule: step('background', 87, 0.7),
  ruleSoft: step('background', 89.3, 0.6),
  // Washes are a tinted band, ΔE*ab 2.5 off both the page and a card.
  accentWash: step('accent', 94.8, 0.15),
  recordWash: step('record', 94.8, 0.3),
  recordRule: step('record', 89, 0.38),
  // Empty / rest is a neutral, not a step of the ramp's hue.
  viz0: step('background', 93.6, 0.39),
  // Even L* steps, so each bucket reads as "more" without relying on hue.
  viz1: step('ramp', 87, 0.44),
  viz2: step('ramp', 78, 0.64),
  viz3: step('ramp', 68, 0.83),
  viz4: step('ramp', 58, 1),
});

// The dark ladder mirrors the light one about the page: the inks lighten and
// the grounds darken, each ground a step lighter than the one below it —
// `well` (L* 7) under `paper` (10), `surface` (15) over it and `raised` (21.5)
// over a card. `ink-muted` at L* 65 clears 4.5:1 on `raised`.
const DARK_STEPS = withPageInks({
  ink: step('text', 95, 0.3),
  inkMuted: step('text', 65, 0.8),
  inkFaint: step('text', 49, 0.75),
  well: step('background', 7, 0.35),
  paper: step('background', 10, 0.35),
  surface: step('background', 15, 0.35),
  raised: step('background', 21.5, 0.35),
  rule: step('background', 27, 0.5),
  ruleSoft: step('background', 23.5, 0.45),
  // Washes are a dark band of their role: `record` still clears 4.5:1 on its own.
  accentWash: step('accent', 19, 0.18),
  recordWash: step('record', 20, 0.3),
  recordRule: step('record', 34, 0.5),
  viz0: step('background', 19.5, 0.4),
  // "More" is still stronger: the ramp lightens away from the dark ground in
  // even steps of 6.5 L* (sRGB rounding costs up to 0.35), from 11 above
  // `surface` to L* 45.5, which keeps `ink` above 4.5:1 on `viz4`.
  viz1: step('ramp', 26, 0.44),
  viz2: step('ramp', 32.5, 0.64),
  viz3: step('ramp', 39, 0.83),
  viz4: step('ramp', 45.5, 1),
});

// Ink + paper's ladder, in both modes: the page is the ink family gone dark
// (`text` at L* 13) and the cards are paper (`background` at L* 95). Every
// well and field sits on a card, so here alone the well is lighter than the
// page: `paper` 13 < `well` 89.5 < `surface` 95 < `raised` 100, with the
// in-card `inset` at 92, where the light ladder's page sits. What a card holds
// is drawn as on the light ladder; text on the page takes the page inks, the
// paper's own colour and two steps of the ink family, each clearing its floor
// on the dark page.
const INK_PAPER_STEPS: Record<SteppedRole, Step> = {
  ...LIGHT_STEPS,
  ink: step('text', 10, 0.9),
  inkMuted: step('text', 37, 1),
  inkFaint: step('text', 51, 0.85),
  paper: step('text', 13, 1.1),
  well: step('background', 89.5, 0.8),
  inset: step('background', 92, 0.7),
  surface: step('background', 95, 0.57),
  raised: step('background', 100, 0),
  rule: step('background', 85, 0.9),
  ruleSoft: step('background', 87.5, 0.75),
  pageInk: step('background', 96.5, 0.45),
  pageInkMuted: step('text', 67, 0.9),
  pageInkFaint: step('text', 52, 1),
};

// Roles the dark ladder steps that light mode takes as given: light `accent`
// and `record` are the seeds. In dark each clears 4.5:1 as text on `paper` and
// `surface`. `accent` sits at L* 72, apart from the fixed roles' L* 64, so a
// red or teal accent never reads as `danger` or a regime; it carries a black
// label.
const DARK_ACCENT = step('accent', 72, 1);
const DARK_RECORD = step('record', 66, 1);

type FixedRole =
  | 'selection'
  | 'danger'
  | 'regimeOlder'
  | 'regimeNewer'
  | 'onAccent'
  | 'onSelection'
  | 'onDanger'
  | 'onInk';

// What a label, glyph, ring or stroke drawn on a filled role is drawn in. Each
// mode fills `accent`, `selection`, `danger` and `ink` at one end of the
// ladder — dark enough to carry white in light mode, light enough to carry
// black in dark mode — so the four share a value per mode; they are separate
// roles so a fill can be given its own.
const onFill = (colour: string): Pick<UiRoles, 'onAccent' | 'onSelection' | 'onDanger' | 'onInk'> => ({
  onAccent: colour,
  onSelection: colour,
  onDanger: colour,
  onInk: colour,
});

// The roles no seed moves, per mode.
const FIXED: Record<ThemeMode, Pick<UiRoles, FixedRole>> = {
  light: {
    selection: '#000000',
    // Destructive actions only — red means "this deletes" in every theme.
    danger: '#A4262C',
    regimeOlder: '#006C70',
    regimeNewer: '#7A286B',
    ...onFill('#FFFFFF'),
  },
  // The light values' hues at L* 64, so each clears 4.5:1 as text on the dark
  // `paper` and `surface`. `selection` inverts to white.
  dark: {
    selection: '#FFFFFF',
    danger: '#F7716B',
    regimeOlder: '#54A8AC',
    regimeNewer: '#D57DC1',
    ...onFill('#000000'),
  },
};

type ChangePair = Pick<UiRoles, 'gain' | 'loss'>;

// A change's direction (`design-language.md` §6): an improvement and a
// decrease, as the theme's `direction` draws them. Never seeded from the
// accent, so "better" and "worse" do not follow the picked hue. Each pair is
// one L*, two hues: the pair reads as equals that differ only in direction,
// and each clears 4.5:1 as text on `paper` and `surface`. Light mode's L* is
// the pair's own; dark mode's is 64, as the fixed roles'. `ink` draws both in
// `ink` (`generateRoles`).
export const DIRECTION_PAIRS: Record<Exclude<ThemeDirection, 'ink'>, Record<ThemeMode, ChangePair>> = {
  // L* ≈41. `loss` is a crimson rather than `danger`'s brick, so a decrease
  // does not read as a delete.
  'green-crimson': {
    light: { gain: '#15703F', loss: '#C01048' },
    dark: { gain: '#58AC76', loss: '#FF6881' },
  },
  // L* 44 and 64: a blue and an orange, for a reader who tells red from green
  // poorly. The blue leans to 255° and the orange sits at 55°, so neither
  // reads as a preset's accent (Slate's blue, Warm's orange) or the brass.
  'blue-orange': {
    light: { gain: '#006F9E', loss: '#AB4C0C' },
    dark: { gain: '#07A5E8', loss: '#E87F40' },
  },
};

// The pair a direction draws, given the theme's `ink`.
function changePair(direction: ThemeDirection, mode: ThemeMode, ink: string): ChangePair {
  return direction === 'ink' ? { gain: ink, loss: ink } : DIRECTION_PAIRS[direction][mode];
}

// The chart ramp's colour: `background`'s hue, at a chroma that scales with
// the background's (the shipped presets' ramps sat about 2.7 times their
// neutral's) but never under a floor, so a near-grey theme still draws a
// tinted ramp rather than one more grey. A grey's hue is about 297°, a cool
// blue-grey.
const RAMP_CHROMA_GAIN = 2.7;
const RAMP_CHROMA_FLOOR = 12;

function rampColour(background: Lch, hue: number): Lch {
  return { ...background, hue, chroma: Math.max(background.chroma * RAMP_CHROMA_GAIN, RAMP_CHROMA_FLOOR) };
}

// The dark backdrop behind a sheet. Light mode dims with `ink`; dark mode's
// `ink` is pale, so it dims with black.
const DARK_SCRIM = 'rgba(0, 0, 0, 0.6)';

// The shadows the edge draws (`edge.ts`), per mode: `lift` under a card or a
// control, a 1pt drop barely darker than the page; `well` the inner shade at
// the top of a sunken track. Light mode shades with `ink`, so the shadow is
// the page's own dark; dark mode's `ink` is pale, so it shades with black,
// stronger, since a shadow reads less on a dark ground.
export type EdgeShades = { lift: string; well: string };

const DARK_SHADES: EdgeShades = { lift: 'rgba(0, 0, 0, 0.45)', well: 'rgba(0, 0, 0, 0.6)' };

export function edgeShades(ink: string, mode: ThemeMode): EdgeShades {
  return mode === 'light' ? { lift: withAlpha(ink, 0.05), well: withAlpha(ink, 0.09) } : DARK_SHADES;
}

// What each role is for (`docs/specs/ui/design-language.md` §2). One value per
// role: two roles that cannot be told apart are one role.
export type UiRoles = {
  // Text and realised values.
  ink: string;
  // Secondary text.
  inkMuted: string;
  // The faintest ink: mini legends, tertiary labels, not-yet-realised values
  // and their legends, absent values, placeholders and disabled controls.
  inkFaint: string;
  // The three inks for text drawn straight on the page rather than on a card:
  // a page's title and section headings, a pager's tabs, a header's title and
  // glyphs. They are the inks in every theme but Ink + paper, whose page is
  // dark under light cards.
  pageInk: string;
  pageInkMuted: string;
  pageInkFaint: string;
  // The four grounds, lightest last in light mode and in dark (Ink + paper
  // alone lays its dark `paper` lowest): `well` is sunken (the track of a
  // segmented control, a slider or a bar); `paper` the page; `surface` cards,
  // sheets and controls; `raised` an input or field drawn on a card.
  well: string;
  paper: string;
  surface: string;
  raised: string;
  // A step below a card, inside it: a pressed row or control, the row that is
  // mine, an action strip or a quieter panel. The page's `paper` in every
  // theme but Ink + paper, whose page is dark under its cards.
  inset: string;
  // Active Progress/history filters: fixed in every theme, black in light
  // mode and white in dark.
  selection: string;
  // Hairlines. Depth is a ground change plus the edge (`edge.ts`): `rule` is
  // the hairline round cards and controls and draws the sheet handle;
  // `ruleSoft` divides rows inside a card or panel.
  rule: string;
  ruleSoft: string;
  // The one primary action on a screen, and the row or field being edited.
  accent: string;
  accentWash: string;
  // An all-time best, and the band that announces one — a different hue from
  // `accent`, so "your best ever" and "the button that commits" do not read
  // as the same mark.
  record: string;
  recordWash: string;
  recordRule: string;
  // Destructive actions only.
  danger: string;
  // A change against an earlier period: `gain` an improvement, `loss` a
  // decrease (`changeToneColourIn` in `change-tone.ts`; Today's met weekly
  // target also takes `gain`), as the theme's `direction` draws them. The sign is always drawn too — colour
  // is never the only channel, and under `ink` it is the only one.
  gain: string;
  loss: string;
  // Data visualisation: one sequential ramp, one meaning ("more"). `viz0` is
  // empty / rest. Text on a `viz` ground is `ink`.
  viz0: string;
  viz1: string;
  viz2: string;
  viz3: string;
  viz4: string;
  // Categorical temporal regimes, never direction or recency magnitude.
  regimeOlder: string;
  regimeNewer: string;
  // The dimmed backdrop behind a sheet.
  scrim: string;
  // A label, glyph, ring or stroke drawn on a filled role: on `accent` (the
  // filled primary, the start disc, the log tick), on `selection` (a selected
  // history filter), on `danger` (a delete swipe) and on `ink` used as a fill
  // (a selected chip or segment, a checked box). `surface` is a ground, never a
  // foreground; `ui-on-colour-guard.test.ts` keeps it so.
  onAccent: string;
  onSelection: string;
  onDanger: string;
  onInk: string;
};

// The `ink` step of a mode's ladder: its L* and the share of the text seed's
// chroma it takes. A custom theme draws its primary text there.
export function inkStep(mode: ThemeMode): { lightness: number; chroma: number } {
  const { lightness, chroma } = (mode === 'light' ? LIGHT_STEPS : DARK_STEPS).ink;
  return { lightness, chroma };
}

// The L* of a mode's `paper`: where a custom page starts.
export function paperLightness(mode: ThemeMode): number {
  return (mode === 'light' ? LIGHT_STEPS : DARK_STEPS).paper.lightness;
}

// The L* of a mode's `accentWash`: where a custom highlight of its own is
// drawn.
export function washLightness(mode: ThemeMode): number {
  return (mode === 'light' ? LIGHT_STEPS : DARK_STEPS).accentWash.lightness;
}

// Every colour role from the seeds, on the light or the dark ladder, or on
// Ink + paper's (`ladder`), which is the same in both modes and holds light
// cards, so what they carry is drawn as in light mode. Pure and synchronous:
// `tokens.ts` calls it once at module load. Throws on a seed that is not
// `#RRGGBB`. `rampHue` replaces the hue the ramp reads back from `background`:
// a custom theme passes the hue the user picked, which a near-grey seed's hex
// no longer holds.
export type RoleOptions = { rampHue?: number; ladder?: ThemeLadder };

export function generateRoles(seeds: ThemeSeeds, mode: ThemeMode = 'light', { rampHue, ladder = 'standard' }: RoleOptions = {}): UiRoles {
  const background = hexToLch(seeds.background);
  const seedLch: Record<SeedName, Lch> = {
    background,
    text: hexToLch(seeds.text),
    accent: hexToLch(seeds.accent),
    record: hexToLch(seeds.record),
    ramp: rampColour(background, rampHue ?? background.hue),
  };
  const at = ({ seed, lightness, chroma }: Step) =>
    lchToHex({ lightness, chroma: seedLch[seed].chroma * chroma, hue: seedLch[seed].hue });

  const drawn: ThemeMode = ladder === 'ink-paper' ? 'light' : mode;
  const steps = ladder === 'ink-paper' ? INK_PAPER_STEPS : drawn === 'light' ? LIGHT_STEPS : DARK_STEPS;
  const stepped = Object.fromEntries(
    Object.entries(steps).map(([role, roleStep]) => [role, at(roleStep)]),
  ) as Record<SteppedRole, string>;
  const own =
    drawn === 'light'
      ? {
          accent: seeds.accent.toUpperCase(),
          record: seeds.record.toUpperCase(),
          // `ink` at 42%, so the page behind reads as the same ground gone dark
          // rather than as a neutral grey.
          scrim: withAlpha(stepped.ink, 0.42),
        }
      : { accent: at(DARK_ACCENT), record: at(DARK_RECORD), scrim: DARK_SCRIM };
  return { ...stepped, ...own, ...FIXED[drawn], ...changePair(seeds.direction, drawn, stepped.ink) };
}
