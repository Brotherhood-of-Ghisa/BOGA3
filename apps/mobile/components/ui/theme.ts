import { hexToLch, lchToHex, withAlpha, type Lch } from '@/components/ui/lch';

// The colours a theme is made from (`docs/specs/ui/design-language.md` §2,
// "Derivation"). The palette follows these seeds; danger, the two change
// directions, surface, filter selection and the on-colour roles retain fixed
// colours in every theme.
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

// Destructive actions only — red means "this deletes" in every theme.
const DANGER = '#A4262C';

// A change's direction (`design-language.md` §6): an improvement and a
// decrease. Fixed in every theme, like `danger`, so "better" and "worse" never
// follow the picked accent's hue. One L* (≈41), two hues: the pair reads as
// equals that differ only in direction, and `loss` is a crimson rather than
// `danger`'s brick, so a decreasing figure does not read as a delete.
const GAIN = '#15703F';
const LOSS = '#C01048';

// What a label, glyph, ring or stroke drawn on a filled role is drawn in. Light
// mode fills `accent`, `selection`, `danger` and `ink` dark enough to carry
// white at every seed, so all four are white; they are separate roles so a
// ground that is not dark can give each its own.
const ON_FILL = '#FFFFFF';

type SeedName = keyof ThemeSeeds;

// A role as a step of a seed: the role's own L*, at the seed's hue, with the
// seed's chroma scaled by `chroma`. The L* ladder and chroma factors are the
// values the shipped roles were picked at (calibrated 2026-10-01), so the
// default seeds reproduce the shipped palette within ΔE*ab 3.
type Step = { seed: SeedName; lightness: number; chroma: number };

const step = (seed: SeedName, lightness: number, chroma: number): Step => ({ seed, lightness, chroma });

const STEPS = {
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
} as const satisfies Record<string, Step>;

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
  // Active Progress/history filters: fixed black in every theme.
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

// Every colour role from the seeds. Pure and synchronous: `tokens.ts` calls it
// once at module load. Throws on a seed that is not `#RRGGBB`.
export function generateRoles(seeds: ThemeSeeds): UiRoles {
  const seedLch: Record<SeedName, Lch> = {
    background: hexToLch(seeds.background),
    text: hexToLch(seeds.text),
    accent: hexToLch(seeds.accent),
    record: hexToLch(seeds.record),
    viz: hexToLch(seeds.viz),
  };
  const at = ({ seed, lightness, chroma }: Step) =>
    lchToHex({ lightness, chroma: seedLch[seed].chroma * chroma, hue: seedLch[seed].hue });

  const ink = at(STEPS.ink);
  return {
    ink,
    inkMuted: at(STEPS.inkMuted),
    inkFaint: at(STEPS.inkFaint),
    inkGhost: at(STEPS.inkGhost),
    paper: at(STEPS.paper),
    // Cards stay white in every theme; the background's tint is carried by `paper`.
    surface: '#FFFFFF',
    selection: '#000000',
    rule: at(STEPS.rule),
    ruleSoft: at(STEPS.ruleSoft),
    accent: seeds.accent.toUpperCase(),
    accentWash: at(STEPS.accentWash),
    record: seeds.record.toUpperCase(),
    recordWash: at(STEPS.recordWash),
    recordRule: at(STEPS.recordRule),
    danger: DANGER,
    gain: GAIN,
    loss: LOSS,
    viz0: at(STEPS.viz0),
    viz1: at(STEPS.viz1),
    viz2: at(STEPS.viz2),
    viz3: at(STEPS.viz3),
    viz4: at(STEPS.viz4),
    regimeOlder: '#006C70',
    regimeNewer: '#7A286B',
    // The dimmed backdrop behind a sheet: `ink` at 42%, so the page behind
    // reads as the same ground gone dark rather than as a neutral grey.
    scrim: withAlpha(ink, 0.42),
    onAccent: ON_FILL,
    onSelection: ON_FILL,
    onDanger: ON_FILL,
    onInk: ON_FILL,
  };
}
