import { hexToLch, lchToHex, withAlpha, type Lch } from '@/components/ui/lch';

// The colours a theme is made from (`docs/specs/ui/design-language.md` §2,
// "Derivation"). The palette follows these seeds; danger, the two change
// directions, filter selection, the regimes and the on-colour roles keep fixed
// colours per mode in every theme, and light mode's cards stay white.
export type ThemeSeeds = {
  // A mid neutral. Its hue and chroma tint the ground family: `paper`, the two
  // rules and `viz0`, so the page reads as one warm (or cool) family.
  background: string;
  // A mid neutral. Its hue and chroma tint the ink family, `ink` to
  // `inkGhost`, and `scrim`. A theme that has not split them gives both
  // families the same neutral.
  text: string;
  // The one primary action, used as given.
  accent: string;
  // An all-time best, used as given. Keep it a different hue from `accent`.
  record: string;
  // The strongest data-visualisation step. The ramp takes its hue and chroma
  // and lightens in fixed steps toward `viz1`.
  viz: string;
};

// The shipped theme. `background` and `text` are both `inkMuted`, the mid
// neutral the others were picked around; `accent`, `record` and `viz` are those
// roles as picked on device (2026-09-22 and 2026-09-25).
export const defaultThemeSeeds: ThemeSeeds = {
  background: '#6B6358',
  text: '#6B6358',
  accent: '#C2410C',
  record: '#8A6516',
  viz: '#A4866B',
};

// The two lightness ladders a theme is drawn on. `light` is a dark ink on a
// pale page; `dark` a pale ink on a dark page. The seeds are the same in both:
// a seed sets hue and chroma, the ladder sets lightness.
export type ThemeMode = 'light' | 'dark';

type SeedName = keyof ThemeSeeds;

// A role as a step of a seed: the role's own L*, at the seed's hue, with the
// seed's chroma scaled by `chroma`.
type Step = { seed: SeedName; lightness: number; chroma: number };

const step = (seed: SeedName, lightness: number, chroma: number): Step => ({ seed, lightness, chroma });

type SteppedRole =
  | 'ink'
  | 'inkMuted'
  | 'inkFaint'
  | 'inkGhost'
  | 'paper'
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

// The light ladder and chroma factors are the values the shipped roles were
// picked at (calibrated 2026-10-01), so the default seeds reproduce the
// shipped palette within ΔE*ab 3.
const LIGHT_STEPS: Record<SteppedRole, Step> = {
  ink: step('text', 8, 0.53),
  inkMuted: step('text', 42.4, 1),
  inkFaint: step('text', 61.6, 0.83),
  inkGhost: step('text', 72.9, 0.89),
  paper: step('background', 96.2, 0.35),
  // Hairlines sit on `paper` and `surface`, so they belong to the ground they
  // divide, not to the text drawn on it.
  rule: step('background', 87.9, 0.88),
  ruleSoft: step('background', 92.8, 0.72),
  accentWash: step('accent', 96.9, 0.064),
  recordWash: step('record', 96, 0.19),
  recordRule: step('record', 89, 0.38),
  // Empty / rest is a neutral, not a step of the ramp's hue.
  viz0: step('background', 93.6, 0.39),
  // Even L* steps, so each bucket reads as "more" without relying on hue.
  viz1: step('viz', 87, 0.44),
  viz2: step('viz', 78, 0.64),
  viz3: step('viz', 68, 0.83),
  viz4: step('viz', 58, 1),
};

// The dark ladder mirrors the light one about the page: the inks lighten, the
// grounds darken, and a card is lifted off the page by a lighter ground,
// never a shadow — so `surface` (L* 15) sits above `paper` (L* 10). `ink-muted`
// at L* 65 clears 4.5:1 on `surface`.
const DARK_STEPS: Record<SteppedRole, Step> = {
  ink: step('text', 95, 0.3),
  inkMuted: step('text', 65, 0.8),
  inkFaint: step('text', 49, 0.75),
  inkGhost: step('text', 37, 0.7),
  paper: step('background', 10, 0.35),
  rule: step('background', 30, 0.5),
  ruleSoft: step('background', 24, 0.45),
  // Washes are a dark band of their role: `record` still clears 4.5:1 on its own.
  accentWash: step('accent', 19, 0.18),
  recordWash: step('record', 20, 0.3),
  recordRule: step('record', 34, 0.5),
  viz0: step('background', 19.5, 0.4),
  // "More" is still stronger: the ramp lightens away from the dark ground in
  // even steps of 6.5 L* (sRGB rounding costs up to 0.35), from 11 above
  // `surface` to L* 45.5, which keeps `ink` above 4.5:1 on `viz4`.
  viz1: step('viz', 26, 0.44),
  viz2: step('viz', 32.5, 0.64),
  viz3: step('viz', 39, 0.83),
  viz4: step('viz', 45.5, 1),
};

// Roles the dark ladder steps that light mode takes elsewhere: light cards are
// white, and light `accent` and `record` are the seeds as given. In dark each
// clears 4.5:1 as text on `paper` and `surface`. `accent` sits at L* 72, apart
// from the fixed roles' L* 64, so a red or teal accent never reads as `danger`
// or a regime; it carries a black label.
const DARK_SURFACE = step('background', 15, 0.35);
const DARK_ACCENT = step('accent', 72, 1);
const DARK_RECORD = step('record', 66, 1);

type FixedRole =
  | 'selection'
  | 'danger'
  | 'gain'
  | 'loss'
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
    // A change's direction (`design-language.md` §6): an improvement and a
    // decrease. Fixed in every theme, like `danger`, so "better" and "worse"
    // never follow the picked accent's hue. One L* (≈41), two hues: the pair
    // reads as equals that differ only in direction, and `loss` is a crimson
    // rather than `danger`'s brick, so a decrease does not read as a delete.
    gain: '#15703F',
    loss: '#C01048',
    regimeOlder: '#006C70',
    regimeNewer: '#7A286B',
    ...onFill('#FFFFFF'),
  },
  // The light values' hues at L* 64, so each clears 4.5:1 as text on the dark
  // `paper` and `surface`; `gain` and `loss` keep one L*. `selection` inverts
  // to white.
  dark: {
    selection: '#FFFFFF',
    danger: '#F7716B',
    gain: '#58AC76',
    loss: '#FF6881',
    regimeOlder: '#54A8AC',
    regimeNewer: '#D57DC1',
    ...onFill('#000000'),
  },
};

// The dark backdrop behind a sheet. Light mode dims with `ink`; dark mode's
// `ink` is pale, so it dims with black.
const DARK_SCRIM = 'rgba(0, 0, 0, 0.6)';

// What each role is for (`docs/specs/ui/design-language.md` §2). One value per
// role: two roles that cannot be told apart are one role.
export type UiRoles = {
  // Text and realised values.
  ink: string;
  // Secondary text.
  inkMuted: string;
  // Mini legends, tertiary labels, and not-yet-realised values.
  inkFaint: string;
  // The faintest ink: legends of not-yet-realised values (the values
  // themselves use `inkFaint`, §6), absent values, placeholders and disabled
  // controls.
  inkGhost: string;
  // The page; also a pressed control and an action strip inside a card.
  paper: string;
  // Cards, sheets and inputs.
  surface: string;
  // Active Progress/history filters: fixed in every theme, black in light
  // mode and white in dark.
  selection: string;
  // Hairlines. Depth is a rule plus a ground change — never a shadow. `rule`
  // borders cards and controls and draws the sheet handle; `ruleSoft` divides
  // rows inside a card or panel.
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
  // decrease (`changeToneColour` in `change-tone.ts` is the only caller). The
  // sign is always drawn too — colour is never the only channel.
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

// Every colour role from the seeds, on the light or the dark ladder. Pure and
// synchronous: `tokens.ts` calls it once at module load. Throws on a seed that
// is not `#RRGGBB`.
export function generateRoles(seeds: ThemeSeeds, mode: ThemeMode = 'light'): UiRoles {
  const seedLch: Record<SeedName, Lch> = {
    background: hexToLch(seeds.background),
    text: hexToLch(seeds.text),
    accent: hexToLch(seeds.accent),
    record: hexToLch(seeds.record),
    viz: hexToLch(seeds.viz),
  };
  const at = ({ seed, lightness, chroma }: Step) =>
    lchToHex({ lightness, chroma: seedLch[seed].chroma * chroma, hue: seedLch[seed].hue });

  const ladder = mode === 'light' ? LIGHT_STEPS : DARK_STEPS;
  const stepped = Object.fromEntries(
    Object.entries(ladder).map(([role, roleStep]) => [role, at(roleStep)]),
  ) as Record<SteppedRole, string>;
  const own =
    mode === 'light'
      ? {
          // Cards stay white in light mode; the background's tint is carried by `paper`.
          surface: '#FFFFFF',
          accent: seeds.accent.toUpperCase(),
          record: seeds.record.toUpperCase(),
          // `ink` at 42%, so the page behind reads as the same ground gone dark
          // rather than as a neutral grey.
          scrim: withAlpha(stepped.ink, 0.42),
        }
      : { surface: at(DARK_SURFACE), accent: at(DARK_ACCENT), record: at(DARK_RECORD), scrim: DARK_SCRIM };
  return { ...stepped, ...own, ...FIXED[mode] };
}
