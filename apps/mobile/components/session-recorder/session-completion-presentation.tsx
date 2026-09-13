import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiSpace, uiTypography } from '@/components/ui';
import type {
  CurrentSessionMuscleSummary,
  ExercisePersonalRecord,
  ExerciseVolumeComparison,
} from '@/src/session-insights';

import { ExercisePersonalRecordCelebration } from './exercise-personal-record-celebration';
import { ExerciseVolumeComparisonRow } from './exercise-volume-comparison';
import {
  SessionMuscleLoad,
  type SessionMuscleLoadCatalogState,
} from './session-muscle-load';
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
  onRetryMuscleCatalog: () => void;
  onViewMuscleLoad: () => void;
  onDone: () => void;
};

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

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
  onRetryMuscleCatalog,
  onViewMuscleLoad,
  onDone,
}: SessionCompletionPresentationProps) {
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="session-completion-presentation">
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

        <View style={styles.section}>
          <UiText variant="title">Session summary</UiText>
          <UiSurface style={styles.completeSurface} testID="session-completion-context">
            <UiText variant="labelStrong">
              {`${durationDisplay} · ${formatCount(exerciseCount, 'exercise')} · ${formatCount(
                performedSetCount,
                'set'
              )}`}
            </UiText>
            <UiText
              style={styles.summarySecondary}
              testID="session-completion-working-sets"
              variant="bodyMuted">
              {`${formatCount(workingSetCount, 'working set')}${
                gymName?.trim() ? ` · ${gymName}` : ''
              }`}
            </UiText>
          </UiSurface>
        </View>

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

        {performedSetCount > 0 ? (
          <View style={styles.section}>
            <SessionMuscleLoad
              catalogState={muscleCatalogState}
              onRetry={onRetryMuscleCatalog}
              performedSetCount={performedSetCount}
              summary={muscleSummary}
              visible
              workingSetCount={workingSetCount}
            />
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
          <UiButton
            accessibilityHint="Opens Stats with the last seven days shown by muscle."
            accessibilityLabel="View 7-day muscle load"
            label="View 7-day muscle load"
            testID="session-completion-view-muscle-load"
            variant="secondary"
            onPress={onViewMuscleLoad}
          />
          <UiButton
            accessibilityHint="Returns to Stats and History."
            accessibilityLabel="Done with session completion"
            label="Done"
            testID="session-completion-done"
            variant="secondary"
            onPress={onDone}
          />
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
    gap: uiSpace.xs,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  summarySecondary: {
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
