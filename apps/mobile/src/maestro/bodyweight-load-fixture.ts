import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';

/** One exercise and set: the user supplies the first applicable dated reading. */
export async function seedBodyweightRmVolumeFixture(): Promise<void> {
  setBodyweightCalculationsEnabled(false);
  await saveExerciseCatalogExercise({ id: 'maestro_bw_pull', name: 'Bodyweight Pull-Up', loadInputMode: 'total_load',
    loadRules: { bodyweightCoefficient: 1, movementStandard: null, loadingMethod: null },
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }] });
  // Keep the active review session just ahead of the flow so a reading entered
  // through the body weight log is applicable without a session-local prompt.
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bw_active', gymId: null, startedAt: new Date(Date.now() + 10 * 60_000),
    exercises: [{ id: 'maestro_bw_exercise', exerciseDefinitionId: 'maestro_bw_pull', name: 'Bodyweight Pull-Up',
      sets: [{ id: 'maestro_bw_set', weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added',
        repsValue: '8', setType: 'rir_1', performanceStatus: 'unperformed' }] }] });
}
