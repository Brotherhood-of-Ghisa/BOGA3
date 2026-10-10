import { ScrollView, StyleSheet, View } from 'react-native';

import { SessionFactsCard } from '@/components/session-detail';
import { SessionTopBar } from '@/components/session-view';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  personalRecordCount,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionBreakdownExerciseRow,
  type SessionBreakdownMuscleRow,
} from '@/src/session-insights';

import { SessionBreakdownPager } from './session-breakdown-pager';
import { SessionSummaryContent, type MuscleCatalogState } from './session-summary-content';
export type { MuscleCatalogState } from './session-summary-content';

type SessionCompletionScreenProps = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  gymName: string | null;
  workingSetCount: number;
  // The session's `Volume`, pre-formatted (`sessionVolumeFigure`).
  volume: string;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
  muscleVolumeComparisons?: ExerciseVolumeComparison[];
  // The card's two breakdown pages (`session-breakdown.ts`).
  breakdownMuscleRows: SessionBreakdownMuscleRow[];
  breakdownExerciseRows: SessionBreakdownExerciseRow[];
  muscleCatalogState: MuscleCatalogState;
  // The insights read: pending and failed states say so rather than reading as
  // a session with no history ([[session.volume-comparison]]).
  historyState?: 'loading' | 'ready' | 'error';
  shouldFailNextShare?: boolean;
  onDone: () => void;
};

/**
 * The completion screen after Finish, in the design language: `Session
 * summary` · Done (where Finish sat), the summary card, every record set (1RM,
 * else Weight), each exercise's volume against its history, and `Share
 * session`. Stored context carries the screen; the comparisons wait on the
 * history read and say when it is pending or failed.
 *
 * The summary card leads with the session's results — `Records`, `Ex`, `Sets`,
 * `Volume` — and drops `Gym` and `Duration` to a context row beneath them, so
 * the gym no longer takes a row of its own. `Records` is the session's record
 * count across every exercise; a session without one reads `0`, a valid zero
 * (`design-language.md` §6), not a dash. Beneath them the card's breakdown is
 * a two-page pager, by muscle then by exercise, in place of the `Sets by
 * muscle` table. Everything below the card is unchanged.
 */
export function SessionCompletionScreen({
  completedAt,
  durationDisplay,
  exerciseCount,
  gymName,
  workingSetCount,
  volume,
  personalRecords,
  exerciseVolumeComparisons,
  muscleVolumeComparisons = [],
  breakdownMuscleRows,
  breakdownExerciseRows,
  muscleCatalogState,
  historyState = 'ready',
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
              {
                label: 'Records',
                value: String(personalRecords.reduce((total, record) => total + personalRecordCount(record), 0)),
                testID: 'session-completion-records',
              },
              { label: 'Ex', spokenLabel: 'Exercises', value: String(exerciseCount), testID: 'session-completion-exercises' },
              { label: 'Sets', value: String(workingSetCount), testID: 'session-completion-sets' },
              { label: 'Volume', value: volume, align: 'end', testID: 'session-completion-volume' },
            ],
            [
              {
                label: 'Gym',
                value: gymName?.trim() || 'No gym',
                kind: 'text',
                testID: 'session-completion-gym',
              },
              { label: 'Duration', value: durationDisplay, align: 'end', testID: 'session-completion-duration' },
            ],
          ]}
          testID="session-completion-context">
          {workingSetCount > 0 ? (
            <SessionBreakdownPager
              catalogState={muscleCatalogState}
              exerciseRows={breakdownExerciseRows}
              muscleRows={breakdownMuscleRows}
            />
          ) : null}
        </SessionFactsCard>

        <SessionSummaryContent
          completedAt={completedAt}
          durationDisplay={durationDisplay}
          exerciseCount={exerciseCount}
          workingSetCount={workingSetCount}
          personalRecords={personalRecords}
          exerciseVolumeComparisons={exerciseVolumeComparisons}
          muscleVolumeComparisons={muscleVolumeComparisons}
          historyState={historyState}
          muscleCatalogState={muscleCatalogState}
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
