import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';

/** One exercise and set: the user supplies the first applicable dated reading. */
export async function seedBodyweightRmVolumeFixture(): Promise<void> {
  await setBodyweightCalculationsEnabled(false);
  await saveExerciseCatalogExercise({ id: 'maestro_bw_pull', name: 'Bodyweight Pull-Up', loadInputMode: 'total_load',
    bodyweightContribution: 1,
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }] });
  // Start the active session just ahead of now so a reading saved now through
  // the body weight log applies to it without a session-local prompt.
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bw_active', gymId: null, startedAt: new Date(Date.now() + 10 * 60_000),
    exercises: [{ id: 'maestro_bw_exercise', exerciseDefinitionId: 'maestro_bw_pull', name: 'Bodyweight Pull-Up',
      sets: [{ id: 'maestro_bw_set', weightValue: '0', repsValue: '10',
        setType: 'rir_1', performanceStatus: null }] }] });
}
