import { ScrollView, StyleSheet, View } from 'react-native';

import { SessionFactsCard } from '@/components/session-detail';
import { SessionTopBar } from '@/components/session-view';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import type {
  CurrentSessionMuscleSummary,
  ExercisePersonalRecord,
  ExerciseVolumeComparison,
} from '@/src/session-insights';

import { SessionMuscleBreakdown, SessionSummaryContent, type MuscleCatalogState } from './session-summary-content';
export type { MuscleCatalogState } from './session-summary-content';

type SessionCompletionScreenProps = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  gymName: string | null;
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
  muscleVolumeComparisons?: ExerciseVolumeComparison[];
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: MuscleCatalogState;
  shouldFailNextShare?: boolean;
  onDone: () => void;
};

/**
 * The completion screen after Finish, in the design language: `Session
 * complete` · Done (where Finish sat), the summary card with sets by muscle, every record set (1RM, else Weight), each exercise's volume against its history,
 * and `Share session`. Stored context only; history is optional enrichment.
 */
export function SessionCompletionScreen({
  completedAt,
  durationDisplay,
  exerciseCount,
  gymName,
  workingSetCount,
  personalRecords,
  exerciseVolumeComparisons,
  muscleVolumeComparisons = [],
  muscleSummary,
  muscleCatalogState,
  shouldFailNextShare = false,
  onDone,
}: SessionCompletionScreenProps) {
  return (
    <View style={styles.screen}>
      <SessionTopBar mode="complete" onDone={onDone} />
      <ScrollView contentContainerStyle={styles.content} testID="session-completion-presentation">
        <SessionFactsCard
          facts={[
            [
              { label: 'Duration', value: durationDisplay, testID: 'session-completion-duration' },
              { label: 'Exercises', value: String(exerciseCount), testID: 'session-completion-exercises' },
              { label: 'Sets', value: String(workingSetCount), align: 'end', testID: 'session-completion-sets' },
            ],
            [
              {
                label: 'Gym',
                value: gymName?.trim() || 'No gym',
                kind: 'text',
                testID: 'session-completion-gym',
              },
            ],
          ]}
          testID="session-completion-context">
          <SessionMuscleBreakdown
            workingSetCount={workingSetCount}
            muscleSummary={muscleSummary}
            muscleCatalogState={muscleCatalogState}
          />
        </SessionFactsCard>

        <SessionSummaryContent
          completedAt={completedAt}
          durationDisplay={durationDisplay}
          exerciseCount={exerciseCount}
          workingSetCount={workingSetCount}
          personalRecords={personalRecords}
          exerciseVolumeComparisons={exerciseVolumeComparisons}
          muscleVolumeComparisons={muscleVolumeComparisons}
          shouldFailNextShare={shouldFailNextShare}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
});
