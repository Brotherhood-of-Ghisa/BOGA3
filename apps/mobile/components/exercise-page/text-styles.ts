import { StyleSheet } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui/tokens';

// Type roles shared by the exercise page's parts (`design-language.md` §3, with
// the weights decided on device in step 3: running figures Plex Mono 500,
// headline figures 700, micro-labels Archivo 700 at `xxs`).
export const pageText = StyleSheet.create({
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  // A control's label in caps: the selector, `Add set`, `Complete exercise`.
  controlLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    letterSpacing: uiTypography.size.xs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
  // The weight × reps of a set row.
  runningFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  // A quiet line of figures: dates, a record's set, a preview.
  detailFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  headlineFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
