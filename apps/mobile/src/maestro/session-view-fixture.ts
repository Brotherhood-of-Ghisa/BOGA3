import { persistSessionDraftSnapshot } from '@/src/data';

import { EXERCISE_BLOCK_HISTORY_FIXTURE, seedExerciseBlockHistoryFixture } from './exercise-block-history-fixture';

const MINUTE_MS = 60 * 1000;

/**
 * The session view's fixture: the block-history fixture's
 * completed history (Bench best 1RM ≈ 197.9 from 155 × 8), plus one active
 * session at its gym drawn like the accepted `V6-Session` artboard:
 *
 * - Barbell Bench Press: a warm-up, RIR 2 160 × 8 (1RM ≈ 204.3, a new record),
 *   RIR 1 162.5 × 6 — all done — then two planned rows (3/5).
 * - Incline Dumbbell Press: three done sets, no history, so no record (3/3).
 * - Cable Flys: three planned rows (0/3).
 *
 * Written through the session's own repository, so the rows are exactly what
 * the app would have written.
 */
export const SESSION_VIEW_FIXTURE = {
  sessionId: 'maestro_session_view_active',
  gymName: 'Maestro Block History Gym',
  benchExerciseId: 'maestro_session_view_bench',
  inclineExerciseId: 'maestro_session_view_incline',
  flyExerciseId: 'maestro_session_view_fly',
  performedSetCount: 6,
} as const;

const done = (id: string, weightValue: string, repsValue: string, setType: 'warm_up' | 'rir_0' | 'rir_1' | 'rir_2') => ({
  id,
  weightValue,
  repsValue,
  setType,
  performanceStatus: null,
});

const planned = (id: string, plannedWeightValue: string, plannedRepsValue: string, plannedSetType: 'rir_0' | 'rir_1' | 'rir_2') => ({
  id,
  weightValue: '',
  repsValue: '',
  setType: null,
  plannedWeightValue,
  plannedRepsValue,
  plannedSetType,
  performanceStatus: 'planned' as const,
});

export const seedSessionViewFixture = async ({ now = new Date() }: { now?: Date } = {}) => {
  await seedExerciseBlockHistoryFixture({ now });

  await persistSessionDraftSnapshot({
    sessionId: SESSION_VIEW_FIXTURE.sessionId,
    gymId: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId,
    startedAt: new Date(now.getTime() - 47 * MINUTE_MS),
    status: 'active',
    exercises: [
      {
        id: SESSION_VIEW_FIXTURE.benchExerciseId,
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseName,
        sets: [
          done('maestro_session_view_bench_1', '100', '10', 'warm_up'),
          done('maestro_session_view_bench_2', '160', '8', 'rir_2'),
          done('maestro_session_view_bench_3', '162.5', '6', 'rir_1'),
          planned('maestro_session_view_bench_4', '162.5', '6', 'rir_1'),
          planned('maestro_session_view_bench_5', '165', '5', 'rir_0'),
        ],
      },
      {
        id: SESSION_VIEW_FIXTURE.inclineExerciseId,
        exerciseDefinitionId: 'seed_incline_dumbbell_press',
        name: 'Incline Dumbbell Press',
        sets: [
          done('maestro_session_view_incline_1', '30', '12', 'rir_2'),
          done('maestro_session_view_incline_2', '32.5', '10', 'rir_1'),
          done('maestro_session_view_incline_3', '32.5', '8', 'rir_0'),
        ],
      },
      {
        id: SESSION_VIEW_FIXTURE.flyExerciseId,
        exerciseDefinitionId: 'seed_cable_flys',
        name: 'Cable Flys',
        sets: [
          planned('maestro_session_view_fly_1', '22.5', '15', 'rir_2'),
          planned('maestro_session_view_fly_2', '22.5', '12', 'rir_1'),
          planned('maestro_session_view_fly_3', '22.5', '10', 'rir_0'),
        ],
      },
    ],
  });

  return SESSION_VIEW_FIXTURE;
};
