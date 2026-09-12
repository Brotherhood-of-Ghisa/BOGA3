import { ScrollView, StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import type { CurrentSessionMuscleSummary, ExercisePersonalRecord } from '@/src/session-insights';

import { ExercisePersonalRecordCelebration } from './exercise-personal-record-celebration';
import {
  SessionMuscleLoad,
  type SessionMuscleLoadCatalogState,
} from './session-muscle-load';

type SessionCompletionPresentationProps = {
  durationDisplay: string;
  exerciseCount: number;
  gymName: string | null;
  performedSetCount: number;
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  selectedPersonalRecordIndex: number;
  personalRecordShareError: string | null;
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: SessionMuscleLoadCatalogState;
  onPreviousPersonalRecord: () => void;
  onNextPersonalRecord: () => void;
  onSharePersonalRecord: (personalRecord: ExercisePersonalRecord) => void;
  onRetryMuscleCatalog: () => void;
  onViewMuscleLoad: () => void;
  onDone: () => void;
};

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

export function SessionCompletionPresentation({
  durationDisplay,
  exerciseCount,
  gymName,
  performedSetCount,
  workingSetCount,
  personalRecords,
  selectedPersonalRecordIndex,
  personalRecordShareError,
  muscleSummary,
  muscleCatalogState,
  onPreviousPersonalRecord,
  onNextPersonalRecord,
  onSharePersonalRecord,
  onRetryMuscleCatalog,
  onViewMuscleLoad,
  onDone,
}: SessionCompletionPresentationProps) {
  const selectedPersonalRecord = personalRecords[selectedPersonalRecordIndex] ?? null;
  const hasMultiplePersonalRecords = personalRecords.length > 1;
  const positionLabel = `${selectedPersonalRecordIndex + 1} of ${personalRecords.length}`;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="session-completion-presentation">
      <UiSurface style={styles.completeSurface} testID="session-completion-context">
        <UiText style={styles.completeEyebrow} variant="labelStrong">
          Session complete
        </UiText>
        <UiText variant="title">
          {`${durationDisplay} · ${formatCount(exerciseCount, 'exercise')} · ${formatCount(
            performedSetCount,
            'set'
          )}`}
        </UiText>
        {gymName?.trim() ? <UiText variant="bodyMuted">{gymName}</UiText> : null}
      </UiSurface>

      {selectedPersonalRecord ? (
        <View style={styles.section} testID="session-completion-personal-records">
          <View style={styles.sectionHeadingRow}>
            <UiText variant="title">Personal records</UiText>
            {hasMultiplePersonalRecords ? (
              <UiText
                accessibilityLabel={`Personal record ${positionLabel}`}
                testID="session-completion-pr-position"
                variant="label">
                {positionLabel}
              </UiText>
            ) : null}
          </View>
          <ExercisePersonalRecordCelebration
            key={selectedPersonalRecord.setId}
            onShare={() => onSharePersonalRecord(selectedPersonalRecord)}
            personalRecord={selectedPersonalRecord}
            shareError={personalRecordShareError}
            testID={`session-completion-pr-${selectedPersonalRecord.exerciseDefinitionId}`}
            variant="expanded"
          />
          {hasMultiplePersonalRecords ? (
            <View style={styles.pager} testID="session-completion-pr-pager">
              <UiButton
                accessibilityLabel="Previous personal record"
                disabled={selectedPersonalRecordIndex === 0}
                label="Previous"
                style={styles.pagerButton}
                variant="secondary"
                onPress={onPreviousPersonalRecord}
              />
              <UiButton
                accessibilityLabel="Next personal record"
                disabled={selectedPersonalRecordIndex === personalRecords.length - 1}
                label="Next"
                style={styles.pagerButton}
                variant="secondary"
                onPress={onNextPersonalRecord}
              />
            </View>
          ) : null}
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
          accessibilityHint="Opens Stats with the last seven days shown by muscle."
          accessibilityLabel="View 7-day muscle load"
          label="View 7-day muscle load"
          testID="session-completion-view-muscle-load"
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
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  completeEyebrow: {
    color: uiColors.textSuccess,
  },
  section: {
    gap: uiSpace.md,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  pager: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  pagerButton: {
    flex: 1,
  },
  actions: {
    gap: uiSpace.sm,
  },
});
