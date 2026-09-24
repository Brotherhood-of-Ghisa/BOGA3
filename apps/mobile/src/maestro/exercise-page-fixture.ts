import {
  completeSessionDraft,
  persistSessionDraftSnapshot,
  type SessionDraftExerciseInput,
} from '@/src/data/session-drafts';
import type { SessionSetTypeValue } from '@/src/data/set-types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * The exercise page lane's data (`.maestro/flows/exercise-page.yaml`): two
 * completed Bench Press sessions for the records panel, and an active session
 * whose Bench Press has two performed sets and three planned ones — the states
 * of the accepted target (`V5-Quiet`). Seeded through the session's own
 * repository, so the rows are exactly what the app writes.
 */
export const EXERCISE_PAGE_FIXTURE = {
  activeSessionId: 'maestro_exercise_page_session',
  benchSessionExerciseId: 'maestro_exercise_page_bench',
  squatSessionExerciseId: 'maestro_exercise_page_squat',
  benchExerciseId: 'seed_barbell_bench_press',
  benchExerciseName: 'Barbell Bench Press',
  squatExerciseId: 'seed_barbell_back_squat',
  squatExerciseName: 'Barbell Back Squat',
} as const;

type FixtureSet = [weight: string, reps: string, setType: SessionSetTypeValue];

const performed = (prefix: string, sets: FixtureSet[]) =>
  sets.map(([weightValue, repsValue, setType], index) => ({
    id: `${prefix}_set_${index + 1}`,
    weightValue,
    repsValue,
    setType,
    performanceStatus: null,
  }));

const planned = (prefix: string, start: number, sets: FixtureSet[]) =>
  sets.map(([weightValue, repsValue, setType], index) => ({
    id: `${prefix}_set_${start + index}`,
    weightValue: '',
    repsValue: '',
    setType: null,
    plannedWeightValue: weightValue,
    plannedRepsValue: repsValue,
    plannedSetType: setType,
    performanceStatus: 'planned' as const,
  }));

const bench = (id: string, sets: SessionDraftExerciseInput['sets']): SessionDraftExerciseInput => ({
  id,
  exerciseDefinitionId: EXERCISE_PAGE_FIXTURE.benchExerciseId,
  name: EXERCISE_PAGE_FIXTURE.benchExerciseName,
  sets,
});

// Oldest first. The older session holds the volume record (2560, 5 sets); the
// newer one the 1RM (80 × 8 → 102.1) and heaviest weight (82.5 × 6), and is
// "Last" (VOL 2375).
const HISTORY: { id: string; daysAgo: number; sets: FixtureSet[] }[] = [
  {
    id: 'maestro_exercise_page_history_1',
    daysAgo: 42,
    sets: [
      ['60', '8', 'warm_up'],
      ['80', '6', 'rir_2'],
      ['80', '6', 'rir_2'],
      ['80', '7', 'rir_1'],
      ['80', '7', 'rir_1'],
    ],
  },
  {
    id: 'maestro_exercise_page_history_2',
    daysAgo: 12,
    sets: [
      ['60', '10', 'warm_up'],
      ['80', '8', 'rir_2'],
      ['80', '8', 'rir_1'],
      ['82.5', '6', 'rir_0'],
    ],
  },
];

export const seedExercisePageFixture = async (now: Date = new Date()): Promise<void> => {
  for (const session of HISTORY) {
    const completedAt = new Date(now.getTime() - session.daysAgo * DAY_MS);
    await persistSessionDraftSnapshot(
      {
        sessionId: session.id,
        gymId: null,
        startedAt: new Date(completedAt.getTime() - 60 * MINUTE_MS),
        exercises: [bench(`${session.id}_bench`, performed(`${session.id}_bench`, session.sets))],
      },
      { now: completedAt }
    );
    await completeSessionDraft(session.id, { completedAt, now: completedAt });
  }

  const benchId = EXERCISE_PAGE_FIXTURE.benchSessionExerciseId;
  await persistSessionDraftSnapshot(
    {
      sessionId: EXERCISE_PAGE_FIXTURE.activeSessionId,
      gymId: null,
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS),
      exercises: [
        bench(benchId, [
          ...performed(benchId, [
            ['60', '10', 'warm_up'],
            ['80', '8', 'rir_2'],
          ]),
          ...planned(benchId, 3, [
            ['82.5', '6', 'rir_1'],
            ['82.5', '6', 'rir_1'],
            ['85', '5', 'rir_0'],
          ]),
        ]),
        {
          id: EXERCISE_PAGE_FIXTURE.squatSessionExerciseId,
          exerciseDefinitionId: EXERCISE_PAGE_FIXTURE.squatExerciseId,
          name: EXERCISE_PAGE_FIXTURE.squatExerciseName,
          sets: performed(EXERCISE_PAGE_FIXTURE.squatSessionExerciseId, [['100', '5', 'rir_2']]),
        },
      ],
    },
    { now }
  );
};
