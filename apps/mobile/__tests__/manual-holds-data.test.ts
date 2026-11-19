import { eq } from 'drizzle-orm';

import { loadExerciseSessionFacts } from '@/src/data/exercise-session-facts';
import { completeSessionDraft, loadSessionSnapshotById, persistCompletedSessionSnapshot, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { deriveLastSession } from '@/src/session-recorder/exercise-records';
import { loadCompletedSessionInsights } from '@/src/session-insights';
import { loadTodayProgress } from '@/src/progress-summary';
import { exerciseDefinitions } from '@/src/data/schema';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

jest.mock('@/src/data/bootstrap', () => require('./helpers/local-data').localDataBootstrapModule());

beforeEach(resetLocalData);
afterEach(closeLocalData);

it('preserves seconds, load and explicit effort through draft, finish, metadata changes and history correction', async () => {
  const db = localDatabase();
  db.insert(exerciseDefinitions).values({ id: 'plank', name: 'Plank', recordingMode: 'hold' }).run();
  const startedAt = new Date(1000);
  const exercises = [{ id: 'card', exerciseDefinitionId: 'plank', name: 'Plank', sets: [
    { id: 'set', recordingMode: 'hold' as const, durationSec: 45, repsValue: '', weightValue: '', performanceStatus: 'unperformed' as const },
    { id: 'explicit', recordingMode: 'hold' as const, durationSec: 30, repsValue: '', weightValue: '5', setType: null, performanceStatus: 'unperformed' as const },
  ] }];
  await persistSessionDraftSnapshot({ sessionId: 'session', gymId: null, startedAt, exercises });
  expect((await loadSessionSnapshotById('session'))?.exercises[0].sets).toMatchObject([
    { durationSec: 45, repsValue: '', weightValue: '', setType: 'rir_0', performanceStatus: 'unperformed' },
    { durationSec: 30, repsValue: '', weightValue: '5', setType: null, performanceStatus: 'unperformed' },
  ]);
  const confirmed = exercises.map(block => ({ ...block, sets: block.sets.map(set => ({
    ...set, setType: set.id === 'set' ? 'rir_0' as const : null, performanceStatus: null,
  })) }));
  await persistSessionDraftSnapshot({ sessionId: 'session', gymId: null, startedAt, exercises: confirmed });
  await completeSessionDraft('session', { completedAt: new Date(61000) });
  expect(await loadExerciseSessionFacts('plank')).toMatchObject([
    { workingSets: 2, volumeSets: 0, volumeKg: null, bestE1rmKg: null, topWeightKg: null },
  ]);
  db.update(exerciseDefinitions).set({ recordingMode: 'reps' }).where(eq(exerciseDefinitions.id, 'plank')).run();
  const restored = await loadSessionSnapshotById('session');
  expect(restored?.exercises[0].sets[0]).toMatchObject({ recordingMode: 'hold', durationSec: 45, repsValue: '', performanceStatus: null });
  confirmed[0].sets[0].durationSec = 38;
  await persistCompletedSessionSnapshot({ sessionId: 'session', gymId: null, startedAt, completedAt: new Date(61000), exercises: confirmed });
  expect((await loadSessionSnapshotById('session'))?.exercises[0].sets[0].durationSec).toBe(38);
  expect((await loadExerciseSessionFacts('plank'))[0].workingSets).toBe(2);
  const insights = await loadCompletedSessionInsights('session', 52);
  expect(insights).toMatchObject({ personalRecords: [], exerciseVolumeComparisons: [{ workingSetCount: 2, currentVolume: null, state: 'unavailable' }] });
  const progress = await loadTodayProgress(new Date(120000), 4);
  expect(progress).toMatchObject({ status: 'ready', week: { current: { sessions: 1, workingSets: 2, volumeKgReps: null } } });
  const history = await loadExercisePerformanceHistory({ exerciseDefinitionId: 'plank', period: { kind: 'all' } });
  expect(deriveLastSession(history!.sessions)).toMatchObject({ maxWeight: null, volume: null, oneRepMax: null,
    sets: [{ recordingMode: 'hold', durationSec: 38, reps: null }, { recordingMode: 'hold', durationSec: 30, reps: null }] });
});
