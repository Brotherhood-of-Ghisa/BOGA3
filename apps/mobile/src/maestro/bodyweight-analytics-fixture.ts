import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { correctSessionBodyWeight, saveBodyWeightReading } from '@/src/data/bodyweight';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';

/** Frozen sources, a different current reading and an incomplete mixed workout. */
export async function seedBodyweightAnalyticsFixture(now = new Date()): Promise<void> {
  await saveExerciseCatalogExercise({ id: 'maestro_bwa_pull', name: 'Analytics Pull-Up', loadInputMode: 'total_load',
    loadRules: { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' },
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }] });
  await saveExerciseCatalogExercise({ id: 'maestro_bwa_press', name: 'Analytics Press', loadInputMode: 'total_load',
    loadRules: { bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null },
    mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }] });
  const set = (id: string, amount: string, mode: 'added' | 'assistance' | 'unquantified_assistance' = 'added') => ({
    id, weightValue: amount, repsValue: '8', setType: 'rir_1' as const, performanceStatus: null,
    weightUnit: 'kg', externalLoadMode: mode, plannedWeightUnit: null, plannedExternalLoadMode: null,
    localBodyweightMetadataKnown: true,
  });
  for (const row of [
    { id: 'unweighted', days: 5, amount: '0', mode: 'added' as const, B: 80 },
    { id: 'assisted', days: 4, amount: '20', mode: 'assistance' as const, B: 80 },
    { id: 'weighted', days: 3, amount: '20', mode: 'added' as const, B: 80 },
    { id: 'incomplete', days: 2, amount: '0', mode: 'added' as const, B: null },
  ]) {
    const id = `maestro_bwa_${row.id}`;
    const startedAt = new Date(now.getTime() - row.days * 86400000);
    await persistSessionDraftSnapshot({ sessionId: id, gymId: null, startedAt, exercises: [
      { id: `${id}_pull`, exerciseDefinitionId: 'maestro_bwa_pull', name: 'Analytics Pull-Up',
        sets: [set(`${id}_set`, row.amount, row.mode)] },
      ...(row.id === 'incomplete' ? [{ id: `${id}_press`, exerciseDefinitionId: 'maestro_bwa_press', name: 'Analytics Press',
        sets: [{ ...set(`${id}_press_set`, '50'), repsValue: '10' }] }] : []),
    ] });
    if (row.B !== null) await correctSessionBodyWeight(id, { weightValue: String(row.B), weightUnit: 'kg' });
    await completeSessionDraft(id, { completedAt: new Date(startedAt.getTime() + 3600000) });
  }
  await saveBodyWeightReading({ weightValue: '90', weightUnit: 'kg', measuredAt: new Date(now.getTime() - 3600000) });
  await persistSessionDraftSnapshot({ sessionId: 'maestro_bwa_active', gymId: null, startedAt: now, exercises: [
    { id: 'maestro_bwa_active_pull', exerciseDefinitionId: 'maestro_bwa_pull', name: 'Analytics Pull-Up',
      sets: [{ ...set('maestro_bwa_active_set', '0'), performanceStatus: 'unperformed' }] },
  ] });
  await correctSessionBodyWeight('maestro_bwa_active', { weightValue: '82', weightUnit: 'kg' });
}
