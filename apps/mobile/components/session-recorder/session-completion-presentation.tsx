import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  UiButton,
  UiSurface,
  UiText,
  uiBorder,
  uiColors,
  uiRadius,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import type {
  CurrentSessionMuscleSummary,
  ExercisePersonalRecord,
  ExerciseVolumeComparison,
} from '@/src/session-insights';

import { ExercisePersonalRecordCelebration } from './exercise-personal-record-celebration';
import { ExerciseVolumeComparisonRow } from './exercise-volume-comparison';
import type { SessionMuscleLoadCatalogState } from './session-muscle-load';
import { SessionSharePreview } from './session-share-preview';

type SessionCompletionPresentationProps = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  gymName: string | null;
  performedSetCount: number;
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: SessionMuscleLoadCatalogState;
  shouldFailNextShare?: boolean;
  onDone?: () => void;
};

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

const formatExplicitDuration = (durationDisplay: string): string =>
  durationDisplay
    .replace(/(\d+)h/g, '$1 hr')
    .replace(/(\d+)m/g, '$1 min');

type SummaryMetricProps = {
  label: string;
  value: string;
  testID: string;
};

function SummaryMetric({ label, value, testID }: SummaryMetricProps) {
  return (
    <View style={styles.summaryMetric}>
      <UiText style={styles.summaryMetricLabel} variant="subtitle">
        {label}
      </UiText>
      <UiText style={styles.summaryMetricValue} testID={testID} variant="title">
        {value}
      </UiText>
    </View>
  );
}

export function SessionCompletionPresentation({
  completedAt,
  durationDisplay,
  exerciseCount,
  gymName,
  performedSetCount,
  workingSetCount,
  personalRecords,
  exerciseVolumeComparisons,
  muscleSummary,
  muscleCatalogState,
  shouldFailNextShare = false,
  onDone,
}: SessionCompletionPresentationProps) {
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  const hasPerformedSets = performedSetCount > 0;
  const workingSetsByMuscle = muscleSummary?.workingSetsByMuscle ?? [];

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="session-completion-presentation">
        <View style={styles.section}>
          <UiText variant="title">Session Summary</UiText>
          <UiSurface style={styles.completeSurface} testID="session-completion-context">
            <View style={styles.summaryGrid}>
              <SummaryMetric
                label="DURATION"
                testID="session-completion-duration"
                value={formatExplicitDuration(durationDisplay)}
              />
              <SummaryMetric
                label="EXERCISES"
                testID="session-completion-exercises"
                value={`${exerciseCount}`}
              />
              <SummaryMetric
                label="SETS"
                testID="session-completion-sets"
                value={`${performedSetCount} (${workingSetCount} working)`}
              />
              <SummaryMetric
                label="GYM"
                testID="session-completion-gym"
                value={gymName?.trim() || 'No gym'}
              />
            </View>

            {hasPerformedSets ? (
              <View style={styles.muscleBreakdown} testID="session-completion-muscle-breakdown">
                <UiText variant="labelStrong">Working sets by muscle</UiText>
                {workingSetsByMuscle.length > 0 ? (
                  <View style={styles.muscleChipWrap}>
                    {workingSetsByMuscle.map((muscle) => (
                      <View
                        accessibilityLabel={`${muscle.displayName}, ${formatCount(
                          muscle.workingSetCount,
                          'working set'
                        )}`}
                        key={muscle.id}
                        style={styles.muscleChip}
                        testID={`session-completion-muscle-${muscle.id}`}>
                        <UiText style={styles.muscleChipText} variant="labelStrong">
                          {`${muscle.displayName} (${muscle.workingSetCount})`}
                        </UiText>
                      </View>
                    ))}
                  </View>
                ) : (
                  <UiText variant="bodyMuted" testID="session-completion-muscle-empty-state">
                    {muscleCatalogState === 'loading'
                      ? 'Loading muscle breakdown…'
                      : muscleCatalogState === 'error'
                        ? 'Muscle breakdown unavailable.'
                        : 'No mapped working sets for this session.'}
                  </UiText>
                )}
                <UiText style={styles.muscleHint} variant="bodyMuted">
                  Numbers in brackets are working sets.
                </UiText>
              </View>
            ) : null}
          </UiSurface>
        </View>

        {personalRecords.length > 0 ? (
          <View style={styles.section} testID="session-completion-personal-records">
            <UiText variant="title">Personal records</UiText>
            <View style={styles.personalRecordStack}>
              {personalRecords.map((personalRecord) => (
                <ExercisePersonalRecordCelebration
                  key={personalRecord.setId}
                  personalRecord={personalRecord}
                  testID={`session-completion-pr-${personalRecord.exerciseDefinitionId}`}
                  variant="compact"
                />
              ))}
            </View>
          </View>
        ) : null}

        {exerciseVolumeComparisons.length > 0 ? (
          <View style={styles.section} testID="session-completion-exercise-volume">
            <View style={styles.sectionHeadingRow}>
              <UiText variant="title">Exercise volume</UiText>
              <UiText style={styles.sectionHint} variant="bodyMuted">
                Session vs history
              </UiText>
            </View>
            <View style={styles.exerciseStack}>
              {exerciseVolumeComparisons.map((comparison) => (
                <ExerciseVolumeComparisonRow
                  key={`${comparison.exerciseDefinitionId ?? 'legacy'}-${comparison.sessionExerciseIds.join('-')}`}
                  comparison={comparison}
                  testID={`session-completion-exercise-${comparison.sessionExerciseIds[0]}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <UiButton
            accessibilityHint="Opens a preview of the complete session image."
            accessibilityLabel="Share session"
            label="Share session"
            testID="session-completion-share-session"
            onPress={() => setIsSharePreviewOpen(true)}
          />
          {onDone ? (
            <UiButton
              accessibilityHint="Returns to Stats and History."
              accessibilityLabel="Done with session completion"
              label="Done"
              testID="session-completion-done"
              variant="secondary"
              onPress={onDone}
            />
          ) : null}
        </View>
      </ScrollView>

      <SessionSharePreview
        onClose={() => setIsSharePreviewOpen(false)}
        shouldFailNextShare={shouldFailNextShare}
        snapshot={{
          completedAt,
          durationDisplay,
          exerciseCount,
          performedSetCount,
          workingSetCount,
          personalRecords,
          exerciseVolumeComparisons,
        }}
        visible={isSharePreviewOpen}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: uiSpace.screen,
    paddingBottom: uiSpace.xxl,
    gap: uiSpace.xl,
    backgroundColor: uiColors.surfacePage,
  },
  completeSurface: {
    padding: uiSpace.xl,
    gap: uiSpace.xl,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: uiSpace.xxl,
    rowGap: uiSpace.xl,
  },
  summaryMetric: {
    width: '45%',
    minWidth: 120,
    gap: uiSpace.xs,
  },
  summaryMetricLabel: {
    letterSpacing: 0.3,
    color: uiColors.textSecondary,
  },
  summaryMetricValue: {
    fontSize: uiTypography.size.base,
  },
  muscleBreakdown: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiColors.borderMuted,
    paddingTop: uiSpace.xl,
    gap: uiSpace.sm,
  },
  muscleChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  muscleChip: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  muscleChipText: {
    color: uiColors.actionNeutralSubtleText,
  },
  muscleHint: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textSecondary,
  },
  section: {
    gap: uiSpace.md,
  },
  personalRecordStack: {
    gap: uiSpace.sm,
  },
  exerciseStack: {
    gap: uiSpace.sm,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  sectionHint: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
  },
  actions: {
    gap: uiSpace.sm,
  },
});
