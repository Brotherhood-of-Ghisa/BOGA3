import { StyleSheet, View } from 'react-native';

import { Icon, UiSurface, UiText, uiColors, uiSpace, uiTypography } from '@/components/ui';
import type { ExercisePersonalRecord } from '@/src/session-insights';

type ExercisePersonalRecordCelebrationProps = {
  personalRecord: ExercisePersonalRecord;
  testID: string;
};

const formatLoad = (value: number): string =>
  Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;

/** One exercise's new PR on the completion screen: the exercise and its set. */
export function ExercisePersonalRecordCelebration({
  personalRecord,
  testID,
}: ExercisePersonalRecordCelebrationProps) {
  const fact = `${formatLoad(personalRecord.weight)} kg × ${personalRecord.reps} reps · est. 1RM ${Math.round(
    personalRecord.estimatedOneRepMax
  )} kg`;

  return (
    <UiSurface
      accessibilityLabel={`New PR for ${personalRecord.exerciseName}. ${fact}`}
      accessible
      style={styles.surface}
      testID={testID}>
      <View style={styles.headingRow}>
        <UiText style={styles.celebrationTitle} variant="labelStrong">
          New PR
        </UiText>
        <Icon color={uiColors.actionSuccess} name="star" size="sm" />
      </View>
      <UiText numberOfLines={2} style={styles.exerciseName} variant="labelStrong">
        {personalRecord.exerciseName}
      </UiText>
      <UiText numberOfLines={2} style={styles.fact} variant="label">
        {fact}
      </UiText>
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  celebrationTitle: {
    color: uiColors.textSuccess,
  },
  fact: {
    color: uiColors.textAccentStrong,
  },
  exerciseName: {
    fontSize: uiTypography.size.base,
  },
});
