import { StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

type ExerciseVolumeComparisonProps = {
  comparison: ExerciseVolumeComparison;
  variant?: 'app' | 'share';
  testID?: string;
};

const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  const [integer, decimal] = `${rounded}`.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal ? `${grouped}.${decimal}` : grouped;
};

export const formatExerciseVolume = (value: number): string => `${formatNumber(value)} kg`;

export const formatExerciseSetCounts = (setCount: number, workingSetCount: number): string =>
  `${setCount} ${setCount === 1 ? 'set' : 'sets'} · ${workingSetCount} working`;

export const formatExerciseVolumeComparison = (
  comparison: ExerciseVolumeComparison
): string => {
  if (comparison.medianVolume === null) return 'No comparison history yet';
  const delta = comparison.currentVolume - comparison.medianVolume;
  if (delta === 0) return 'At median';
  if (comparison.medianVolume === 0) {
    return `${delta > 0 ? '+' : '−'}${formatExerciseVolume(Math.abs(delta))} vs median`;
  }

  const percentage = Math.round((Math.abs(delta) / comparison.medianVolume) * 100);
  return `${percentage}% ${delta > 0 ? 'above' : 'below'} median`;
};

const buildAccessibilityLabel = (comparison: ExerciseVolumeComparison): string => {
  const base = `${comparison.exerciseName}, ${formatExerciseSetCounts(
    comparison.setCount,
    comparison.workingSetCount
  )}. Session volume ${formatExerciseVolume(comparison.currentVolume)}.`;
  if (
    comparison.medianVolume === null ||
    comparison.percentile5Volume === null ||
    comparison.percentile95Volume === null
  ) {
    return `${base} No comparison history yet.`;
  }

  return `${base} ${formatExerciseVolumeComparison(comparison)}. Historical median ${formatExerciseVolume(
    comparison.medianVolume
  )}; fifth to ninety-fifth percentile ${formatExerciseVolume(
    comparison.percentile5Volume
  )} to ${formatExerciseVolume(comparison.percentile95Volume)}, from ${comparison.historicalSessionCount} earlier ${
    comparison.historicalSessionCount === 1 ? 'session' : 'sessions'
  }.`;
};

const markerPosition = (comparison: ExerciseVolumeComparison): number => {
  const low = comparison.percentile5Volume;
  const high = comparison.percentile95Volume;
  if (low === null || high === null || low === high) return 0.5;
  return Math.max(0, Math.min(1, (comparison.currentVolume - low) / (high - low)));
};

export function ExerciseVolumeComparisonRow({
  comparison,
  variant = 'app',
  testID,
}: ExerciseVolumeComparisonProps) {
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
    <UiSurface
      accessibilityLabel={buildAccessibilityLabel(comparison)}
      accessible
      style={[styles.surface, variant === 'share' ? styles.shareSurface : null]}
      testID={testID}>
      <View style={styles.headingRow}>
        <UiText numberOfLines={2} style={styles.exerciseName} variant="labelStrong">
          {comparison.exerciseName}
        </UiText>
        <UiText style={styles.setCounts} variant="subtitle">
          {formatExerciseSetCounts(comparison.setCount, comparison.workingSetCount)}
        </UiText>
      </View>
      <View style={styles.valueRow}>
        <UiText style={styles.currentVolume} variant="title">
          {formatExerciseVolume(comparison.currentVolume)}
        </UiText>
        <UiText
          style={comparison.medianVolume === null ? styles.mutedComparison : styles.comparisonText}
          variant="subtitle">
          {formatExerciseVolumeComparison(comparison)}
        </UiText>
      </View>

      {hasDistribution ? (
        <View testID={testID ? `${testID}-distribution` : undefined}>
          <View style={styles.rangeLabels}>
            <UiText style={styles.rangeLabel} variant="bodyMuted">
              P5 {formatNumber(comparison.percentile5Volume as number)}
            </UiText>
            <UiText style={styles.rangeLabel} variant="bodyMuted">
              Median {formatNumber(comparison.medianVolume as number)}
            </UiText>
            <UiText style={styles.rangeLabel} variant="bodyMuted">
              P95 {formatNumber(comparison.percentile95Volume as number)}
            </UiText>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.trackWrap}>
            <View style={styles.track} />
            <View style={[styles.endpoint, styles.leftEndpoint]} />
            <View style={[styles.endpoint, styles.rightEndpoint]} />
            <View style={styles.medianMarker} />
            <View style={[styles.currentMarker, { left: `${position * 100}%` }]} />
          </View>
          <View style={styles.historyRow}>
            <UiText variant="bodyMuted" style={styles.historyText}>
              {`${comparison.historicalSessionCount} prior sessions`}
            </UiText>
            {outsideRange ? (
              <UiText variant="subtitle" style={styles.outsideRangeText}>
                {comparison.currentVolume < (comparison.percentile5Volume as number)
                  ? 'Below P5'
                  : 'Above P95'}
              </UiText>
            ) : null}
          </View>
        </View>
      ) : hasBaseline ? (
        <View style={styles.baselineRow} testID={testID ? `${testID}-baseline` : undefined}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.baselineGlyph}>
            <View style={styles.baselineTrack} />
            <View style={styles.baselineMarker} />
          </View>
          <UiText style={styles.historyText} variant="bodyMuted">
            {`${comparison.state === 'single-baseline' ? '1 prior session' : `${comparison.historicalSessionCount} equal prior sessions`} · baseline ${formatExerciseVolume(
              comparison.medianVolume as number
            )}`}
          </UiText>
        </View>
      ) : (
        <UiText style={styles.historyText} variant="bodyMuted">
          This is the first comparable completed session.
        </UiText>
      )}
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    padding: uiSpace.lg,
    gap: uiSpace.sm,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  shareSurface: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  exerciseName: {
    flexShrink: 1,
  },
  setCounts: {
    fontSize: uiTypography.size.xs,
  },
  valueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  currentVolume: {
    fontSize: uiTypography.size.lg,
  },
  comparisonText: {
    color: uiColors.actionPrimary,
  },
  mutedComparison: {
    color: uiColors.textSecondary,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.xs,
  },
  rangeLabel: {
    fontSize: uiTypography.size.xs,
  },
  trackWrap: {
    height: 20,
    marginHorizontal: uiSpace.xs,
    justifyContent: 'center',
  },
  track: {
    height: 5,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionNeutralSubtleBorder,
  },
  endpoint: {
    position: 'absolute',
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionNeutralSubtleBorder,
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
    width: 2,
    height: 16,
    marginLeft: -1,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.textPrimary,
  },
  currentMarker: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: uiRadius.full,
    borderWidth: 2,
    borderColor: uiColors.surfaceDefault,
    backgroundColor: uiColors.actionPrimary,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  historyText: {
    flexShrink: 1,
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
  },
  outsideRangeText: {
    fontSize: uiTypography.size.xs,
    color: uiColors.actionPrimary,
  },
  baselineRow: {
    gap: uiSpace.xs,
  },
  baselineGlyph: {
    height: 14,
    justifyContent: 'center',
  },
  baselineTrack: {
    height: 3,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionNeutralSubtleBorder,
  },
  baselineMarker: {
    position: 'absolute',
    left: '50%',
    width: 3,
    height: 14,
    marginLeft: -1.5,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.textPrimary,
  },
});
