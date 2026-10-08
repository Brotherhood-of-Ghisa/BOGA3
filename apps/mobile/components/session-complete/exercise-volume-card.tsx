import { formatVolume } from '@/src/exercise-calculations/format';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExerciseVolumeComparison } from '@/src/session-insights';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

type ExerciseVolumeCardProps = {
  comparison: ExerciseVolumeComparison;
  // `share`: the card inside the captured share image.
  variant?: 'app' | 'share';
  testID?: string;
};

// The spoken form keeps the unit: a screen reader has no legend to lean on.
const formatSpokenVolume = (value: number | null): string => value === null ? 'unavailable' : `${formatVolume(value)} kg reps`;

export const formatExerciseSetCount = (workingSetCount: number): string =>
  `${workingSetCount} ${workingSetCount === 1 ? 'set' : 'sets'}`;

export const formatExerciseVolumeComparison = (comparison: ExerciseVolumeComparison): string => {
  if (comparison.currentVolume === null) return '—';
  if (comparison.medianVolume === null) return 'No comparison history yet';
  const delta = comparison.currentVolume - comparison.medianVolume;
  if (delta === 0) return 'At median';
  if (comparison.medianVolume === 0) {
    return `${delta > 0 ? '+' : '−'}${formatVolume(Math.abs(delta))} vs median`;
  }

  const percentage = Math.round((Math.abs(delta) / comparison.medianVolume) * 100);
  if (!Number.isFinite(percentage)) return delta > 0 ? 'Above median' : 'Below median';
  return `${percentage}% ${delta > 0 ? 'above' : 'below'} median`;
};

const hasVolumeReference = (comparison: ExerciseVolumeComparison): boolean =>
  comparison.currentVolume !== null &&
  comparison.historicalSessionCount >= MIN_HISTORY_OBSERVATIONS &&
  comparison.medianVolume !== null && comparison.percentile25Volume !== null && comparison.percentile75Volume !== null;

const buildAccessibilityLabel = (comparison: ExerciseVolumeComparison): string => {
  const base = `${comparison.exerciseName}, ${formatExerciseSetCount(comparison.workingSetCount)}. Session volume ${formatSpokenVolume(comparison.currentVolume)}.`;
  if (!hasVolumeReference(comparison)) {
    return comparison.currentVolume === null ? base : `${base} Building history.`;
  }

  return `${base} ${formatExerciseVolumeComparison(comparison)}. Historical median ${formatSpokenVolume(
    comparison.medianVolume
  )}; twenty-fifth to seventy-fifth percentile ${formatSpokenVolume(
    comparison.percentile25Volume
  )} to ${formatSpokenVolume(comparison.percentile75Volume)}.`;
};

const markerPosition = (value: number, comparison: ExerciseVolumeComparison): number => {
  const median = comparison.medianVolume as number;
  // Symmetric, linear extent around the median; include the current value so
  // outliers keep their actual position instead of being pinned to a quartile.
  // Dividing before multiplying avoids overflowing for very large volumes.
  const radius = Math.max(
    median - (comparison.percentile25Volume as number),
    (comparison.percentile75Volume as number) - median,
    Math.abs((comparison.currentVolume as number) - median),
  );
  return radius === 0 ? 50 : 50 + ((value - median) / radius) * 40;
};

/**
 * Exercise or muscle volume: current value and sets, then P25/median/P75 and
 * delta after six known prior observations. The linear scale centers the
 * median, vertical rules mark the references, and a black dot marks current.
 * Equal quartiles collapse to a rule; low history shows "Building history".
 * Reference labels sit above the bar, values below; sets sit beside the name.
 * Shared by the session summary, live comparison and captured share image.
 */
export function ExerciseVolumeCard({ comparison, variant = 'app', testID }: ExerciseVolumeCardProps) {
  const hasDistribution = hasVolumeReference(comparison);
  const low = hasDistribution ? markerPosition(comparison.percentile25Volume as number, comparison) : 50;
  const high = hasDistribution ? markerPosition(comparison.percentile75Volume as number, comparison) : 50;

  return (
    <Card style={variant === 'share' ? styles.shareCard : null} testID={testID}>
      <View accessibilityLabel={buildAccessibilityLabel(comparison)} accessible style={styles.body}>
        <View style={styles.headingRow}>
          <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
            {comparison.exerciseName}
          </Text>
          <Text allowFontScaling={false} style={styles.counts}>{formatExerciseSetCount(comparison.workingSetCount)}</Text>
        </View>
        <View style={styles.valueRow}>
          <View style={styles.legend}>
            <Text allowFontScaling={false} style={styles.microLabel}>Vol</Text>
            <Text allowFontScaling={false} style={styles.volume}>{comparison.currentVolume === null ? '—' : formatVolume(comparison.currentVolume)}</Text>
          </View>
          {hasDistribution ? <Text allowFontScaling={false} style={styles.delta}>
            {formatExerciseVolumeComparison(comparison)}
          </Text> : comparison.currentVolume !== null ? <Text allowFontScaling={false} style={styles.historyStatus}>
            Building history
          </Text> : null}
        </View>

        {hasDistribution ? (
          <View style={styles.distribution} testID={testID ? `${testID}-distribution` : undefined}>
            <View style={styles.rangeLabels}>
              <Text allowFontScaling={false} style={[styles.microLabel, styles.rangeCell]}>P25</Text>
              <Text allowFontScaling={false} style={[styles.microLabel, styles.rangeCell, styles.centerCell]}>Median</Text>
              <Text allowFontScaling={false} style={[styles.microLabel, styles.rangeCell, styles.endCell]}>P75</Text>
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.trackWrap}>
              <View style={styles.track} />
              <View style={[styles.interval, { left: `${low}%`, width: `${high - low}%` }]} />
              <View style={[styles.referenceMarker, { left: `${low}%` }]} testID={testID ? `${testID}-p25` : undefined} />
              <View style={[styles.referenceMarker, { left: '50%' }]} testID={testID ? `${testID}-median` : undefined} />
              <View style={[styles.referenceMarker, { left: `${high}%` }]} testID={testID ? `${testID}-p75` : undefined} />
              <View style={[styles.currentMarker, { left: `${markerPosition(comparison.currentVolume as number, comparison)}%` }]} testID={testID ? `${testID}-current` : undefined} />
            </View>
            <View style={styles.rangeLabels}>
              <Text allowFontScaling={false} style={[styles.legendValue, styles.rangeCell]}>{formatVolume(comparison.percentile25Volume as number)}</Text>
              <Text allowFontScaling={false} style={[styles.legendValue, styles.rangeCell, styles.centerCell]}>{formatVolume(comparison.medianVolume as number)}</Text>
              <Text allowFontScaling={false} style={[styles.legendValue, styles.rangeCell, styles.endCell]}>{formatVolume(comparison.percentile75Volume as number)}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

// The current-session marker: an `ink` dot ringed in `surface` so it reads
// over the track and the median tick.
const MARKER = uiSpace.md;

const styles = StyleSheet.create({
  shareCard: {
    borderColor: uiRoles.ruleSoft,
  },
  body: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  name: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  counts: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  valueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.xs,
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  volume: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  legendValue: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  delta: {
    flexShrink: 1, textAlign: 'right',
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  historyStatus: {
    flexShrink: 1, textAlign: 'right',
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  distribution: {
    gap: uiSpace.xs,
  },
  rangeLabels: {
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  rangeCell: { flex: 1 },
  centerCell: { textAlign: 'center' },
  endCell: { textAlign: 'right' },
  trackWrap: {
    height: uiSpace.lg,
    marginHorizontal: uiSpace.xs,
    justifyContent: 'center',
  },
  track: {
    height: uiSpace.xs,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleSoft,
  },
  interval: {
    position: 'absolute',
    height: uiSpace.xs,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.rule,
  },
  referenceMarker: {
    position: 'absolute',
    width: uiBorder.width * 2,
    height: uiSpace.lg,
    marginLeft: -uiBorder.width,
    backgroundColor: uiRoles.inkMuted,
  },
  currentMarker: {
    position: 'absolute',
    width: MARKER,
    height: MARKER,
    marginLeft: -MARKER / 2,
    borderRadius: uiGeometry.radius.pill,
    borderWidth: uiBorder.width * 2,
    borderColor: uiRoles.surface,
    backgroundColor: uiRoles.ink,
  },
});
