import { generateRoles } from '@/components/ui/theme';
import { launchTheme } from '@/components/ui/theme-launch';

// The colour roles (`docs/specs/ui/design-language.md` §2). A screen names the
// role, never the hex. They are generated from four seed colours
// (`components/ui/theme.ts`, §2 "Derivation") — the seeds of the preset chosen
// on this device as of launch (§2 "Presets"); what each role is for is on
// `UiRoles`.
export const uiRoles = generateRoles(launchTheme.preset.seeds);

// The geometry (`docs/specs/ui/design-language.md` §4): the radii, fixed
// widths and label tracking the accepted target is drawn with. Decided
// 2026-09-22.
export const uiGeometry = {
  radius: {
    // Cards: `surface` on `paper`, 1px `rule`.
    card: 6,
    // A sheet's two top corners.
    sheet: 16,
    // Controls inside a screen: input fields, a segmented selector, an outline
    // button. The target drew 4 and 5, a difference with no name, so one value.
    // Added 2026-09-23 (exercise page).
    control: 4,
    // Fully rounded ends: pills, tags and handles.
    pill: 999,
  },
  // The minimum tap target, and the width of the set row's type and control
  // columns — every control in a list sits on this one vertical axis.
  tapTarget: 44,
  // A metric's fixed-width value column (`1RM` / `VOL`), so figures align down
  // a list.
  metricValueWidth: 38,
  sheetHandle: { width: 38, height: 4 },
  // A labelled input field (micro-label above a large figure): the exercise
  // page's logger, whose Weight / Reps / Effort fields share this height. Added
  // 2026-09-23.
  fieldHeight: 50,
  // Micro-label letter-spacing as a fraction of the font size (em); React
  // Native takes points, so apply it as `size * microLabelTracking`.
  microLabelTracking: 0.1,
} as const;

// Six steps. The previous scale interleaved 2/10/14/20 with the 4/8/12/16
// rhythm, which made every value on-scale and the scale non-constraining.
export const uiSpace = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Eight sizes, down from the fourteen that used to ship. `base` stays at 14:
// density while logging was chosen over gym-floor legibility. `xxs` (10) was
// added 2026-09-22 for micro-labels — legends, units, tertiary labels — which
// the accepted design target drew at 8/9px; both lift to 10 rather than earning
// rungs of their own, since 8px body-adjacent text was poor for accessibility.
// No other rung moved.
export const uiTypography = {
  size: {
    xxs: 10,
    xs: 11,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 18,
    xxl: 24,
  },
  // One line-height per size, so vertical rhythm stops depending on whatever
  // leading the platform font happens to supply. Keyed to `size`.
  lineHeight: {
    xxs: 14,
    xs: 15,
    sm: 16,
    md: 18,
    base: 20,
    lg: 22,
    xl: 24,
    xxl: 30,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

// The three typefaces of `docs/specs/ui/design-language.md` §3, and the only
// weights of each that ship. They are embedded in the binary by the expo-font
// config plugin (`app.config.ts`), so they are available before JS runs and
// need no loading step.
//
// Name a face as `{ fontFamily: uiFonts.x.family, fontWeight: <one of its
// weights> }` — the same pair on iOS and Android. `family` is the files'
// typographic family name, not a PostScript name: iOS picks the face from the
// family by weight, Android from the XML font family the plugin registers under
// this string. A weight outside `weights` is not embedded and silently lands on
// the nearest one that is. On web these fall back to system fonts.
export const uiFonts = {
  // Headings, control labels, buttons, micro-labels.
  display: { family: 'Archivo', weights: ['600', '700', '800'] },
  // Body and prose.
  body: { family: 'Source Sans 3', weights: ['400', '600'] },
  // Every number — monospaced so digits align down a column.
  figure: { family: 'IBM Plex Mono', weights: ['500', '600', '700'] },
} as const;

// Icon edge lengths, in points (`components/ui/icon.tsx`). Glyphs are drawn on
// a 24 grid with a 2-unit stroke, so a smaller size also thins the stroke.
// `xs` marks a point inside a chart, `sm` sits inline with body text, `md` is
// the glyph of a control or row indicator, `lg` a destination badge.
export const uiIconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export const uiBorder = {
  width: 1,
} as const;

export type UiRoleToken = keyof typeof uiRoles;
export type UiFontToken = keyof typeof uiFonts;
export type UiSpaceToken = keyof typeof uiSpace;
export type UiIconSizeToken = keyof typeof uiIconSize;
