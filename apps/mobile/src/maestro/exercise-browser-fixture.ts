import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { seedSessionViewFixture } from './session-view-fixture';

/** Browser-only history: old uses still count and repeated blocks count once. */
export const seedExerciseBrowserFixture = async (now = new Date()): Promise<void> => {
  await seedSessionViewFixture({ now });
  const histories = [
    { id: 'old-incline', exerciseDefinitionId: 'seed_incline_dumbbell_press', name: 'Incline Dumbbell Press', completedAt: new Date(now.getTime() - 240 * 86_400_000) },
    { id: 'prior-year', exerciseDefinitionId: 'seed_cable_bench_presses', name: 'Cable Bench Press', completedAt: new Date(now.getFullYear() - 1, 0, 15, 12) },
  ];
  for (const history of histories) {
    const sessionId = `maestro_browser_${history.id}`;
    await persistSessionDraftSnapshot({
      sessionId, gymId: null, startedAt: new Date(history.completedAt.getTime() - 3_600_000),
      exercises: [0, 1].map((i) => ({
        id: `${sessionId}_block_${i}`, exerciseDefinitionId: history.exerciseDefinitionId, name: history.name,
        sets: [{ id: `${sessionId}_set_${i}`, weightValue: '30', repsValue: '8', setType: 'warm_up', performanceStatus: null }],
      })),
    }, { now: history.completedAt });
    await completeSessionDraft(sessionId, { completedAt: history.completedAt, now: history.completedAt });
  }
};
