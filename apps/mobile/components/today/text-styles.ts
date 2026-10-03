import { StyleSheet } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui/tokens';

// Type roles shared by Today's cards (`design-language.md` §3): micro-labels
// Archivo 700 at `xxs`, headline figures Plex Mono 700, quiet figures Plex
// Mono 500. A PR figure is `record`.
export const todayText = StyleSheet.create({
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // A block's own label (`This week`, `October so far`, `Latest session`).
  microLabelStrong: {
    color: uiRoles.ink,
  },
  microLabelFaint: {
    color: uiRoles.inkFaint,
  },
  headlineFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  // The month's difference, beside its headline.
  differenceFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  detailFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  inlineFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    color: uiRoles.ink,
  },
  record: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    color: uiRoles.record,
  },
  mutedLine: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
});
