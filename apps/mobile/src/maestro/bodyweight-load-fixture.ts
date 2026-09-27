import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';

/** One exercise and set: the user supplies the first applicable dated reading. */
export async function seedBodyweightRmVolumeFixture(): Promise<void> {
  await saveExerciseCatalogExercise({ id: 'maestro_bw_pull', name: 'Bodyweight Pull-Up', loadInputMode: 'total_load',
    loadRules: { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' },
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }] });
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bw_active', gymId: null, startedAt: new Date(),
    exercises: [{ id: 'maestro_bw_exercise', exerciseDefinitionId: 'maestro_bw_pull', name: 'Bodyweight Pull-Up',
      sets: [{ id: 'maestro_bw_set', weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added',
        repsValue: '8', setType: 'rir_1', performanceStatus: 'unperformed' }] }] });
}
