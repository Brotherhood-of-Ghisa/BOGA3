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
  heatmapTodayBg: '#e8f4ff',
  heatmapTodayBorder: '#7bbcf4',
  heatmapTodayMarker: '#2f8ed8',
  heatmapSelectedBorder: '#0f5cc0',
  rowActiveBackground: '#eef5ff',
  rowActiveBorder: '#a9c7f5',
  rowLastAddedBackground: '#f5f9ff',
  rowSwipeDeleteBackground: '#fff0f0',
  rowSwipeSkipBackground: '#eef2f9',
  rowSwipeIcon: '#20324f',
  rowSwipeText: '#20324f',
} as const;

export const uiSpace = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  screen: 20,
} as const;

export const uiRadius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  full: 999,
} as const;

export const uiTypography = {
  size: {
    xs: 11,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 18,
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

export const uiTokens = {
  colors: uiColors,
  space: uiSpace,
  radius: uiRadius,
  typography: uiTypography,
  border: uiBorder,
} as const;

export type UiColorToken = keyof typeof uiColors;
export type UiSpaceToken = keyof typeof uiSpace;
export type UiRadiusToken = keyof typeof uiRadius;
