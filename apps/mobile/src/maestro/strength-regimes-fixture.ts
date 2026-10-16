import { upsertLocalGym } from '@/src/data/local-gyms';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { EXERCISE_PAGE_FIXTURE, seedExercisePageFixture } from './exercise-page-fixture';

/** Synthetic layout/interaction history, not empirical evidence or a calibration context. */
export async function seedStrengthRegimesFixture(now = new Date()) {
  await seedExercisePageFixture(now);
  for (const id of ['a', 'b']) await upsertLocalGym({ id: `maestro_regime_gym_${id}`, name: `Gym ${id.toUpperCase()}`, now });
  for (let i = 0; i < 32; i++) {
    const id = `maestro_regime_${i}`, completedAt = new Date(now.getTime() - (65 - 2 * i) * 86_400_000);
    const reps = [2, 4, 6][i % 3], rir = i % 5;
    const observedLoad = (i < 16 ? 100 : 112) / estimateOneRepMax(1, reps + rir)! + (i % 2 ? 2 : -2);
    const weightValue = String(Math.round(observedLoad / 2.5) * 2.5);
    await persistSessionDraftSnapshot({ sessionId: id, gymId: `maestro_regime_gym_${i % 2 ? 'b' : 'a'}`,
      startedAt: new Date(completedAt.getTime() - 3_600_000),
      exercises: [{ id: `${id}_block`, exerciseDefinitionId: EXERCISE_PAGE_FIXTURE.benchExerciseId,
        name: EXERCISE_PAGE_FIXTURE.benchExerciseName,
        sets: [0, 1, 2].map(index => ({ id: `${id}_set_${index}`, repsValue: String(reps), weightValue,
          setType: `rir_${rir}` as 'rir_0' | 'rir_1' | 'rir_2' | 'rir_3' | 'rir_4', performanceStatus: null })) }],
    }, { now: completedAt });
    await completeSessionDraft(id, { completedAt, now: completedAt });
  }
}
