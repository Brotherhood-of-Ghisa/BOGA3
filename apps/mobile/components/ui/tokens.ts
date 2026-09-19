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

// Seven sizes, down from the fourteen that used to ship. `base` stays at 14:
// density in the recorder was chosen over gym-floor legibility.
export const uiTypography = {
  size: {
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
  space: uiSpace,
  radius: uiRadius,
  typography: uiTypography,
  border: uiBorder,
  elevation: uiElevation,
} as const;

export type UiColorToken = keyof typeof uiColors;
export type UiSpaceToken = keyof typeof uiSpace;
export type UiRadiusToken = keyof typeof uiRadius;
export type UiElevationToken = keyof typeof uiElevation;
