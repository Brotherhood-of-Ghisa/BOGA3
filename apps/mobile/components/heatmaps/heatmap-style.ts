// heatmap-style.ts — the look shared by the Daily and Weekly heatmaps, in the
// design language: legends, axes and Week-column spacing. Neither view draws a
// title: the history page's selectors name what is shown.

import { StyleSheet } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

const microLabel = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700',
  fontSize: uiTypography.size.xxs,
  lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  textTransform: 'uppercase',
} as const;

export const heatmapStyles = StyleSheet.create({
  // Weekday gutter, month axis and legend: legends, so `ink-faint`
  // (`design-language.md` §2, G11).
  legendText: { ...microLabel, color: uiRoles.inkFaint },
  weekColumn: { marginLeft: uiSpace.sm },
  // An empty (`viz0`) cell needs a hairline to read against `surface`.
  restCell: { borderColor: uiRoles.rule },
  // A tile or row that opens its sessions, while held (as ActionButton's press).
  pressed: { opacity: 0.7 },
});
