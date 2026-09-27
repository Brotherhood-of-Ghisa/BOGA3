import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { correctSessionBodyWeight, saveBodyWeightReading } from '@/src/data/bodyweight';

/** Dates are relative to the run, so this flow never depends on today's calendar. */
export async function seedBodyweightBackfillFixture(now = new Date(), withoutReadings = false): Promise<void> {
  const day = (offset: number) => new Date(now.getTime() + (offset - 21) * 86400000);
  for (const [id, offset] of [['before', 0], ['between', 10], ['after', 16], ['filled', 0]] as const) {
    const sessionId = `maestro_bwf_${id}`;
    await persistSessionDraftSnapshot({ sessionId, gymId: null, startedAt: day(offset), exercises: [{
      id: `${sessionId}_exercise`, exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press',
      sets: [{ id: `${sessionId}_set`, weightValue: '60', repsValue: '8', setType: 'rir_1',
        weightUnit: 'kg', externalLoadMode: 'added', plannedWeightUnit: null, plannedExternalLoadMode: null,
        localBodyweightMetadataKnown: true, performanceStatus: null }],
    }] });
    await completeSessionDraft(sessionId, { completedAt: new Date(day(offset).getTime() + 3600000) });
  }
  await correctSessionBodyWeight('maestro_bwf_filled', { weightValue: '77', weightUnit: 'kg' });
  if (!withoutReadings) {
    await saveBodyWeightReading({ weightValue: '80', weightUnit: 'kg', measuredAt: day(5), now });
    await saveBodyWeightReading({ weightValue: '82', weightUnit: 'kg', measuredAt: day(15), now });
  }
}
