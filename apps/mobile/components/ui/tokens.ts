export const uiColors = {
  actionPrimary: '#0f5cc0',
  actionPrimaryDisabled: '#96afcf',
  actionPrimarySubtleBg: '#eaf2ff',
  actionPrimarySubtleBorder: '#cfe1ff',
  actionDanger: '#b3261e',
  actionDangerText: '#8a2323',
  actionDangerSubtleBg: '#fff0f0',
  actionDangerSubtleBorder: '#f3c5c5',
  actionNeutralSubtleBg: '#eef2f9',
  actionNeutralSubtleBorder: '#c7d3e8',
  actionNeutralSubtleText: '#20324f',
  borderDefault: '#d0d0d0',
  borderStrong: '#6f6f6f',
  borderInputStrong: '#b7c6dd',
  borderSuccess: '#b9dfc3',
  borderWarning: '#f0c9a5',
  borderMuted: '#dbe3ef',
  overlayScrim: 'rgba(0, 0, 0, 0.35)',
  overlayScrimSoft: 'rgba(0, 0, 0, 0.28)',
  surfaceDisabled: '#f4f6fa',
  surfaceDefault: '#ffffff',
  surfaceInfo: '#f5f9ff',
  surfaceMuted: '#fafafa',
  surfacePage: '#f4f7fb',
  surfaceReadOnly: '#f4f4f4',
  surfaceSuccess: '#effcf3',
  surfaceWarning: '#fff7ee',
  textPrimary: '#122033',
  textSuccess: '#125d2f',
  textSecondary: '#56667f',
  textDisabled: '#8190a8',
  textMuted: '#555555',
  textWarning: '#7f4214',
  textAccentStrong: '#0f2a46',
  textAccentMuted: '#37516f',
  actionSuccess: '#1f8740',
  heatmapNeutralBg: '#edf2f6',
  heatmapNeutralBorder: '#cfdae5',
  heatmapBucket1: '#dff4e5',
  heatmapBucket2: '#aee4bd',
  heatmapBucket3: '#68c57f',
  heatmapBucket4: '#218f46',
  failureBackgroundFamily1: '#f1faf3',
  failureBackgroundFamily2: '#e2f5e7',
  failureBackgroundFamily3: '#ccebd5',
  failureBackgroundFamily4: '#b5e1c1',
  failureBackgroundMuscle1: '#fffaf0',
  failureBackgroundMuscle2: '#fff3d6',
  failureBackgroundMuscle3: '#ffe7ad',
  failureBackgroundMuscle4: '#ffd784',
  heatmapTodayBg: '#e8f4ff',
  heatmapTodayBorder: '#7bbcf4',
  heatmapTodayMarker: '#2f8ed8',
  heatmapSelectedBorder: '#0f5cc0',
  rowActiveBackground: '#eef5ff',
  rowActiveBorder: '#a9c7f5',
  rowPlannedBackground: '#e8eef7',
  rowPlannedBorder: '#b8c7da',
  rowSwipeDeleteBackground: '#fff0f0',
  rowSwipeIcon: '#20324f',
  rowSwipeText: '#20324f',
} as const;

// The design-language colour roles (`docs/specs/ui/design-language.md` §2).
// Added alongside `uiColors`, not into it: the two vocabularies are meant to
// stay visibly separate so the switch-over step can delete the legacy palette
// wholesale instead of untangling one object. Nothing adopts these yet.
//
// A screen names the role, never the hex.
export const uiRoles = {
  // Text and realised values.
  ink: '#15181D',
  inkMuted: '#6B6358',
  // Mini legends, tertiary labels, and not-yet-realised values.
  inkFaint: '#9B948A',
  // The legends of not-yet-realised values; the values themselves use
  // `inkFaint` (`design-language.md` §6).
  planned: '#B3ABA0',
  // Absent values and the faintest labels.
  disabled: '#C4BDB0',
  // Grounds.
  paper: '#F6F4EF',
  surface: '#FFFFFF',
  surfaceSubtle: '#FBF9F5',
  // Hairlines. Depth is a rule plus a ground change — never a shadow.
  rule: '#E2DCD0',
  ruleSoft: '#EFEAE0',
  ruleFaint: '#F3EFE6',
  ruleStrong: '#DDD6C8',
  // The one primary action on a screen, and the row or field being edited.
  accent: '#C2410C',
  accentWash: '#FDF6EE',
  // An all-time best, and the band that announces one. Brass, deliberately a
  // different hue from `accent` (41° vs 17°) so "your best ever" and "the
  // button that commits" do not read as the same mark. Decided 2026-09-22.
  record: '#8A6516',
  recordWash: '#FBF3E2',
  recordRule: '#EEDFBE',
  // Destructive actions only.
  danger: '#A4262C',
  // The dimmed backdrop behind a sheet: `ink` at 42%, so the page behind reads
  // as the same warm ground gone dark rather than as a neutral grey.
  scrim: 'rgba(21, 24, 29, 0.42)',
} as const;

// The design-language geometry (`docs/specs/ui/design-language.md` §4): the
// radii, fixed widths and label tracking the accepted target is drawn with
// that the legacy scales do not carry. Kept apart from `uiRadius` / `uiSpace`
// for the same reason `uiRoles` is kept apart from `uiColors` — the switch-over
// step can then retire the legacy scales wholesale. Decided 2026-09-22.
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

// Three values, each with a job. If two radii sit side by side and the
// difference cannot be named, there is only one radius.
export const uiRadius = {
  sm: 8,
  md: 12,
  full: 999,
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
// need no loading step. Nothing adopts these yet.
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

// The layering vocabulary the app had none of: every surface — page card,
// modal, sheet, action menu, tab tray — was a 1px border on white, which is
// why they all read as one flat layer. Opt-in via `UiSurface`'s `elevation`
// prop; `flat` is the default and matches previous rendering exactly.
export const uiElevation = {
  // Deliberately empty: `flat` must add no style keys at all, so the default
  // render tree is byte-identical to before elevation existed.
  flat: {},
  raised: {
    shadowColor: '#122033',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  overlay: {
    shadowColor: '#122033',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;

export const uiTokens = {
  colors: uiColors,
  roles: uiRoles,
  fonts: uiFonts,
  geometry: uiGeometry,
  space: uiSpace,
  radius: uiRadius,
  typography: uiTypography,
  border: uiBorder,
  elevation: uiElevation,
  iconSize: uiIconSize,
} as const;

export type UiColorToken = keyof typeof uiColors;
export type UiRoleToken = keyof typeof uiRoles;
export type UiFontToken = keyof typeof uiFonts;
export type UiSpaceToken = keyof typeof uiSpace;
export type UiIconSizeToken = keyof typeof uiIconSize;
export type UiRadiusToken = keyof typeof uiRadius;
export type UiElevationToken = keyof typeof uiElevation;
