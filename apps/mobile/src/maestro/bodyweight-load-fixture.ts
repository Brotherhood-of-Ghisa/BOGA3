import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { correctSessionBodyWeight } from '@/src/data/bodyweight';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';

/** Ambiguous legacy values are deliberate; the UI must review them, never guess. */
export const seedBodyweightLoadFixture = async (now = new Date(), missingBodyWeight = false): Promise<void> => {
  const exerciseId = 'maestro_bw_pull';
  await saveExerciseCatalogExercise({ id: exerciseId, name: 'Bodyweight Pull-Up', loadInputMode: 'total_load',
    loadRules: missingBodyWeight ? { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' }
      : { bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null },
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }] });
  const historical = new Date(now.getTime() - 7 * 86400000);
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bw_history', gymId: null, startedAt: historical,
    exercises: [{ id: 'maestro_bw_history_exercise', exerciseDefinitionId: exerciseId, name: 'Bodyweight Pull-Up',
      sets: [{ id: 'maestro_bw_legacy', weightValue: '80', repsValue: '8', setType: 'rir_1', performanceStatus: null }] }] });
  await correctSessionBodyWeight('maestro_bw_history', { weightValue: '80', weightUnit: 'kg' });
  await completeSessionDraft('maestro_bw_history', { completedAt: new Date(historical.getTime() + 3600000) });
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bw_active', gymId: null, startedAt: now,
    exercises: [{ id: 'maestro_bw_exercise', exerciseDefinitionId: exerciseId, name: 'Bodyweight Pull-Up', sets: [
      { id: 'maestro_bw_new', weightValue: '0', weightUnit: 'kg', externalLoadMode: 'added', repsValue: '8',
        setType: 'rir_1', performanceStatus: 'unperformed', plannedWeightUnit: null, plannedExternalLoadMode: null,
        localBodyweightMetadataKnown: true },
      { id: 'maestro_bw_plan', weightValue: '', repsValue: '', setType: null, performanceStatus: 'planned',
        plannedWeightValue: '100', plannedRepsValue: '8', plannedSetType: 'rir_1',
        plannedWeightUnit: 'kg', plannedExternalLoadMode: null },
    ] }] });
  if (!missingBodyWeight) await correctSessionBodyWeight('maestro_bw_active', { weightValue: '80', weightUnit: 'kg' });
};
