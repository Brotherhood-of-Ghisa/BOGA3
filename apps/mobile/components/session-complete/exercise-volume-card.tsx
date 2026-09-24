import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

type ExerciseVolumeCardProps = {
  comparison: ExerciseVolumeComparison;
  // `share`: the card inside the captured share image.
  variant?: 'app' | 'share';
  testID?: string;
};

// No thousands separators and no unit on a figure (`design-language.md` §6).
export const formatVolumeFigure = (value: number): string => String(Math.round(value * 10) / 10);

// The spoken form keeps the unit: a screen reader has no legend to lean on.
const formatSpokenVolume = (value: number): string => `${formatVolumeFigure(value)} kg`;

export const formatExerciseSetCounts = (setCount: number, workingSetCount: number): string =>
  `${setCount} ${setCount === 1 ? 'set' : 'sets'} · ${workingSetCount} working`;

export const formatExerciseVolumeComparison = (comparison: ExerciseVolumeComparison): string => {
  if (comparison.medianVolume === null) return 'No comparison history yet';
  const delta = comparison.currentVolume - comparison.medianVolume;
  if (delta === 0) return 'At median';
  if (comparison.medianVolume === 0) {
    return `${delta > 0 ? '+' : '−'}${formatVolumeFigure(Math.abs(delta))} vs median`;
  }

  const percentage = Math.round((Math.abs(delta) / comparison.medianVolume) * 100);
  return `${percentage}% ${delta > 0 ? 'above' : 'below'} median`;
};

const buildAccessibilityLabel = (comparison: ExerciseVolumeComparison): string => {
  const base = `${comparison.exerciseName}, ${formatExerciseSetCounts(
    comparison.setCount,
    comparison.workingSetCount
  )}. Session volume ${formatSpokenVolume(comparison.currentVolume)}.`;
  if (
    comparison.medianVolume === null ||
    comparison.percentile5Volume === null ||
    comparison.percentile95Volume === null
  ) {
    return `${base} No comparison history yet.`;
  }

  return `${base} ${formatExerciseVolumeComparison(comparison)}. Historical median ${formatSpokenVolume(
    comparison.medianVolume
  )}; fifth to ninety-fifth percentile ${formatSpokenVolume(
    comparison.percentile5Volume
  )} to ${formatSpokenVolume(comparison.percentile95Volume)}, from ${comparison.historicalSessionCount} earlier ${
    comparison.historicalSessionCount === 1 ? 'session' : 'sessions'
  }.`;
};

const markerPosition = (comparison: ExerciseVolumeComparison): number => {
  const low = comparison.percentile5Volume;
  const high = comparison.percentile95Volume;
  if (low === null || high === null || low === high) return 0.5;
  return Math.max(0, Math.min(1, (comparison.currentVolume - low) / (high - low)));
};

function Legend({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.legend}>
      <Text style={styles.microLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

/**
 * One exercise's volume this session against its history: the figure, the
 * delta from the median, and the P5–P95 range with median and current markers
 * (or the single/equal-baseline and no-history states). Descriptive context,
 * never a target — so no `accent`, which marks the screen's one action.
 */
export function ExerciseVolumeCard({ comparison, variant = 'app', testID }: ExerciseVolumeCardProps) {
  const hasDistribution =
    comparison.state === 'distribution' &&
    comparison.medianVolume !== null &&
    comparison.percentile5Volume !== null &&
    comparison.percentile95Volume !== null;
  const hasBaseline =
    comparison.medianVolume !== null &&
    (comparison.state === 'single-baseline' || comparison.state === 'constant-baseline');
  const position = markerPosition(comparison);
  const outsideRange =
    hasDistribution &&
    (comparison.currentVolume < (comparison.percentile5Volume as number) ||
      comparison.currentVolume > (comparison.percentile95Volume as number));

  return (
    <Card style={variant === 'share' ? styles.shareCard : null} testID={testID}>
      <View accessibilityLabel={buildAccessibilityLabel(comparison)} accessible style={styles.body}>
        <View style={styles.headingRow}>
          <Text numberOfLines={2} style={styles.name}>
            {comparison.exerciseName}
          </Text>
          <Text style={styles.counts}>{formatExerciseSetCounts(comparison.setCount, comparison.workingSetCount)}</Text>
        </View>
        <View style={styles.valueRow}>
          <View style={styles.legend}>
            <Text style={styles.microLabel}>Vol</Text>
            <Text style={styles.volume}>{formatVolumeFigure(comparison.currentVolume)}</Text>
          </View>
          <Text style={comparison.medianVolume === null ? styles.deltaMuted : styles.delta}>
            {formatExerciseVolumeComparison(comparison)}
          </Text>
        </View>

        {hasDistribution ? (
          <View testID={testID ? `${testID}-distribution` : undefined}>
            <View style={styles.rangeLabels}>
              <Legend label="P5" value={formatVolumeFigure(comparison.percentile5Volume as number)} />
              <Legend label="Median" value={formatVolumeFigure(comparison.medianVolume as number)} />
              <Legend label="P95" value={formatVolumeFigure(comparison.percentile95Volume as number)} />
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.trackWrap}>
              <View style={styles.track} />
              <View style={[styles.endpoint, styles.leftEndpoint]} />
              <View style={[styles.endpoint, styles.rightEndpoint]} />
              <View style={styles.medianMarker} />
              <View style={[styles.currentMarker, { left: `${position * 100}%` }]} />
            </View>
            <View style={styles.historyRow}>
              <Text style={styles.history}>{`${comparison.historicalSessionCount} prior sessions`}</Text>
              {outsideRange ? (
                <Text style={styles.microLabel}>
                  {comparison.currentVolume < (comparison.percentile5Volume as number) ? 'Below P5' : 'Above P95'}
                </Text>
              ) : null}
            </View>
          </View>
        ) : hasBaseline ? (
          <View style={styles.baseline} testID={testID ? `${testID}-baseline` : undefined}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.baselineGlyph}>
              <View style={styles.baselineTrack} />
              <View style={styles.medianMarker} />
            </View>
            <Text style={styles.history}>
              {`${
                comparison.state === 'single-baseline'
                  ? '1 prior session'
                  : `${comparison.historicalSessionCount} equal prior sessions`
              } · baseline ${formatVolumeFigure(comparison.medianVolume as number)}`}
            </Text>
          </View>
        ) : (
          <Text style={styles.history}>This is the first comparable completed session.</Text>
        )}
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
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  deltaMuted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.xs,
  },
  trackWrap: {
    height: uiSpace.lg,
    marginHorizontal: uiSpace.xs,
    justifyContent: 'center',
  },
  track: {
    height: uiSpace.xs,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleStrong,
  },
  endpoint: {
    position: 'absolute',
    width: uiSpace.sm,
    height: uiSpace.sm,
    marginLeft: -uiSpace.xs,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleStrong,
  },
  leftEndpoint: {
    left: 0,
  },
  rightEndpoint: {
    left: '100%',
  },
  medianMarker: {
    position: 'absolute',
    left: '50%',
    width: uiBorder.width * 2,
    height: uiSpace.md,
    marginLeft: -uiBorder.width,
    borderRadius: uiGeometry.radius.pill,
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
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  history: {
    flexShrink: 1,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  baseline: {
    gap: uiSpace.xs,
  },
  baselineGlyph: {
    height: uiSpace.md,
    justifyContent: 'center',
  },
  baselineTrack: {
    height: uiBorder.width * 2,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleStrong,
  },
});
