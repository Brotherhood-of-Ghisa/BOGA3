// heatmap-style.ts — the look shared by the Daily and Weekly heatmaps, in the
// design language: the title, legends, axes and Week-column spacing.

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
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  // Weekday gutter, month axis and legend: legends, so `ink-faint`
  // (`design-language.md` §2, G11).
  legendText: { ...microLabel, color: uiRoles.inkFaint },
  weekColumn: { marginLeft: uiSpace.sm },
  // An empty (`viz0`) cell needs a hairline to read against `surface`.
  restCell: { borderColor: uiRoles.rule },
});
