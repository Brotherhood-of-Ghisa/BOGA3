import { StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiSpace, uiTypography } from '@/components/ui';
import type { ExercisePersonalRecord } from '@/src/session-insights';

type ExercisePersonalRecordCelebrationProps = {
  personalRecord: ExercisePersonalRecord;
  variant: 'expanded' | 'collapsed' | 'compact';
  testID: string;
};

const formatLoad = (value: number): string =>
  Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;

export function ExercisePersonalRecordCelebration({
  personalRecord,
  variant,
  testID,
}: ExercisePersonalRecordCelebrationProps) {
  const fact = `${formatLoad(personalRecord.weight)} kg × ${personalRecord.reps} reps · est. 1RM ${Math.round(
    personalRecord.estimatedOneRepMax
  )} kg`;

  return (
    <UiSurface
      accessibilityLabel={
        variant === 'collapsed' || variant === 'compact'
          ? `New PR for ${personalRecord.exerciseName}. ${fact}`
          : undefined
      }
      accessible={variant === 'collapsed' || variant === 'compact'}
      style={[
        styles.surface,
        variant === 'collapsed' ? styles.collapsedSurface : null,
        variant === 'compact' ? styles.compactSurface : null,
      ]}
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
      {variant === 'compact' ? (
        <UiText numberOfLines={2} style={styles.compactExerciseName} variant="labelStrong">
          {personalRecord.exerciseName}
        </UiText>
      ) : null}
      <UiText numberOfLines={2} style={styles.fact} variant="label">
        {fact}
      </UiText>
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  collapsedSurface: {
    marginTop: uiSpace.xs,
    padding: uiSpace.sm,
  },
  compactSurface: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
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
  compactExerciseName: {
    fontSize: uiTypography.size.base,
  },
});
