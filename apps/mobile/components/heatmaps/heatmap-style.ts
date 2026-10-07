// heatmap-style.ts — the look shared by the Daily and Weekly heatmaps, in the
// design language: the `viz` ramp and its marks, and the type of the
// title, legends and axes.

import { StyleSheet } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

// Weekly marks on a `viz` row are `ink` (`design-language.md` §2): the current
// week is a 1px ring, the selected row a 2px border. Daily tiles are read-only.
export const HEAT_MARK = {
  color: uiRoles.ink,
  todayWidth: 1,
  selectedWidth: 2,
} as const;

const microLabel = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700',
  fontSize: uiTypography.size.xxs,
  lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  textTransform: 'uppercase',
} as const;

export const heatmapStyles = StyleSheet.create({
  wrap: { paddingTop: uiSpace.xs, paddingBottom: uiSpace.sm },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: uiSpace.lg,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  caption: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  // Weekday gutter, month axis and legend: legends, so `ink-faint`
  // (`design-language.md` §2, G11).
  legendText: { ...microLabel, color: uiRoles.inkFaint },
  // An empty (`viz0`) cell needs a hairline to read against `surface`.
  restCell: { borderColor: uiRoles.rule },
});
