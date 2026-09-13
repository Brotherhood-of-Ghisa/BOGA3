import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import type { ExercisePersonalRecord } from '@/src/session-insights';

type ExercisePersonalRecordCelebrationProps = {
  personalRecord: ExercisePersonalRecord;
  variant: 'expanded' | 'collapsed';
  testID: string;
  shareError?: string | null;
  onShare?: () => void;
};

const formatLoad = (value: number): string =>
  Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;

export function ExercisePersonalRecordCelebration({
  personalRecord,
  variant,
  testID,
  shareError,
  onShare,
}: ExercisePersonalRecordCelebrationProps) {
  const fact = `${formatLoad(personalRecord.weight)} kg × ${personalRecord.reps} reps · est. 1RM ${Math.round(
    personalRecord.estimatedOneRepMax
  )} kg`;

  return (
    <UiSurface
      accessibilityLabel={
        variant === 'collapsed' ? `New PR for ${personalRecord.exerciseName}. ${fact}` : undefined
      }
      accessible={variant === 'collapsed'}
      style={[styles.surface, variant === 'collapsed' ? styles.collapsedSurface : null]}
      testID={testID}>
      <View style={styles.headingRow}>
        <UiText style={styles.celebrationTitle} variant="labelStrong">
          New PR
        </UiText>
        <UiText accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.spark}>
          ★
        </UiText>
      </View>
      {variant === 'expanded' ? (
        <UiText numberOfLines={2} variant="subtitle">
          {personalRecord.exerciseName}
        </UiText>
      ) : null}
      <UiText numberOfLines={2} style={styles.fact} variant="label">
        {fact}
      </UiText>
      {variant === 'expanded' && onShare ? (
        <UiButton
          accessibilityHint="Opens the platform share sheet with this personal record as text."
          accessibilityLabel={`Share PR for ${personalRecord.exerciseName}`}
          label="Share PR"
          style={styles.shareButton}
          variant="secondary"
          onPress={onShare}
        />
      ) : null}
      {variant === 'expanded' && shareError ? (
        <UiText accessibilityLiveRegion="polite" style={styles.shareError} testID={`${testID}-share-error`}>
          {shareError}
        </UiText>
      ) : null}
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    padding: uiSpace.lg,
    gap: uiSpace.xs,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  collapsedSurface: {
    marginTop: uiSpace.xs,
    padding: uiSpace.sm,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  celebrationTitle: {
    color: uiColors.textSuccess,
  },
  spark: {
    color: uiColors.actionSuccess,
  },
  fact: {
    color: uiColors.textAccentStrong,
  },
  shareButton: {
    alignSelf: 'flex-start',
    marginTop: uiSpace.xs,
    minWidth: 110,
  },
  shareError: {
    color: uiColors.actionDangerText,
  },
});
