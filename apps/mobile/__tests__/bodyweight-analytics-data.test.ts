import { renderHook, waitFor } from '@testing-library/react-native';
import { useExerciseRecords } from '@/src/session-recorder/use-exercise-records';
import { eq } from 'drizzle-orm';
import { exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups, sessionExercises, sessions, gyms, bodyWeightMeasurements, userSettings } from '@/src/data/schema';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { loadRecentExerciseBlocks } from '@/src/data/exercise-block-history';
import { computeSelectedExerciseDailyEffort } from '@/src/data/exercise-analytics';
import { computeSelectedMuscleDailyEffort } from '@/src/data/stats';
import { loadExerciseCatalogStats } from '@/src/data/exercise-catalog-stats';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { loadCompletedSessionInsights } from '@/src/session-insights/repository';
import { buildSessionViewModel } from '@/src/session-recorder/session-view-model';
import { mapDraftSnapshotToSession } from '@/src/session-recorder/session-model';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(callback, [callback]);
  },
}));

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
const start = new Date('2026-09-20T00:00:00Z');
const end = new Date('2026-09-21T00:00:00Z');
beforeEach(() => {
  mockFixture = createInMemoryDatabase(); const db = mockFixture.database;
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  db.insert(exerciseDefinitions).values({ id: 'pull', name: 'Pull-up', bodyweightContribution: 1,
    loadInputMode: 'total_load' }).run();
  db.insert(muscleGroups).values({ id: 'back', displayName: 'Back', familyName: 'Back' }).run();
  db.insert(exerciseMuscleMappings).values({ id: 'map', exerciseDefinitionId: 'pull', muscleGroupId: 'back', role: 'primary', weight: 1 }).run();
  for (const [id, date, amount] of [['old', '2026-09-19T12:00:00Z', '0'], ['new', '2026-09-20T12:00:00Z', '20']]) {
    const startedAt = new Date(date);
    db.insert(sessions).values({ id, status: 'completed', startedAt, completedAt: new Date(startedAt.getTime() + 3600000) }).run();
    db.insert(bodyWeightMeasurements).values({ id: `${id}-reading`, weightKg: 80, measuredAt: startedAt }).run();
    db.insert(sessionExercises).values({ id: `${id}-ex`, sessionId: id, exerciseDefinitionId: 'pull', name: 'Pull-up', orderIndex: 0 }).run();
    db.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: `${id}-ex`, orderIndex: 0,
      weightValue: amount, repsValue: '8', setType: 'rir_1', performanceStatus: null }).run();
  }
});
afterEach(() => mockFixture.close());

const read = async () => {
  const [history, blocks, daily, muscle, insights, graph] = await Promise.all([
    loadExercisePerformanceHistory({ exerciseDefinitionId: 'pull', period: 'all' }),
    loadRecentExerciseBlocks({ exerciseDefinitionId: 'pull', now: end }),
    computeSelectedExerciseDailyEffort({ exerciseDefinitionId: 'pull', start, end, timeZone: 'UTC' }),
    computeSelectedMuscleDailyEffort({ muscleGroupIds: ['back'], start, end, timeZone: 'UTC' }),
    loadCompletedSessionInsights('new'), loadSessionSnapshotById('new'),
  ]);
  if (!history || !insights || !graph) throw new Error('Expected persisted workout graph');
  return { history, blocks, daily, muscle, insights, view: buildSessionViewModel(mapDraftSnapshotToSession(graph), new Map()) };
};

it('reads the complete saved context across DB adapters and refreshes it after explicit corrections', async () => {
  const initial = await read();
  expect(initial.history.sessions[0].totalVolume).toBe(800);
  expect(initial.blocks.blocks[0].totalVolume).toBe(800);
  expect(initial.daily[0].totalVolume).toBe(800);
  expect(initial.muscle[0].totalWeight).toBe(400);
  expect(initial.insights.exerciseVolumeComparisons[0].currentVolume).toBe(800);
  expect(initial.insights.muscleVolumeComparisons[0].currentVolume).toBe(400);
  expect(initial.view.volume).toBe('800');
  expect((await loadExerciseCatalogStats('all', end)).aggregatesById.get('pull')?.totalVolume).toBe(1440);
  const db = mockFixture.database;
  db.insert(bodyWeightMeasurements).values({ id: 'today', weightKg: 100, measuredAt: end }).run();
  expect((await read()).daily[0].totalVolume).toBe(800);
  db.update(bodyWeightMeasurements).set({ weightKg: 82 }).where(eq(bodyWeightMeasurements.id, 'new-reading')).run();
  expect((await read()).daily[0].totalVolume).toBe(816);
  db.update(exerciseDefinitions).set({ bodyweightContribution: 0.7 }).where(eq(exerciseDefinitions.id, 'pull')).run();
  const changed = await read();
  expect(changed.daily[0].totalVolume).toBeCloseTo(619.2);
  expect(changed.insights.exerciseVolumeComparisons[0].currentVolume).toBeCloseTo(619.2);
  expect(changed.muscle[0].totalWeight).toBeCloseTo(309.6);
});

it('keeps the raw Weight presentation while the contribution changes only derived math', async () => {
  const value = await read();
  expect(value.history.sessions[0].totalVolume).toBe(800);
  expect(value.blocks.blocks[0].totalVolume).toBe(800);
  expect(value.daily[0].totalVolume).toBe(800);
  expect(value.muscle[0].totalWeight).toBe(400);
  expect(value.insights.personalRecords).toHaveLength(1);
  expect(value.insights.personalRecords[0].estimatedOneRepMax).toBeCloseTo(47.671419, 6);
  expect(value.view.cards[0].rows[0].weightReps).toBe('20.0 × 8');
  expect(value.view.cards[0].rows[0]).not.toHaveProperty('bodyweight');
});

it.each([{ weightKg: 0 }, { weightKg: -10 }])(
  'skips a malformed latest reading and uses the previous valid reading across every reader', async badReading => {
  mockFixture.database.update(bodyWeightMeasurements).set(badReading).where(eq(bodyWeightMeasurements.id, 'new-reading')).run();
  const value = await read();
  expect(value.history.sessions[0]).toMatchObject({ totalVolume: 800, workingSetCount: 1, loadContext: { bodyWeightKg: 80 } });
  expect(value.blocks.blocks[0].totalVolume).toBe(800);
  expect(value.daily[0]).toMatchObject({ totalVolume: 800, workingSetCount: 1 });
  expect(value.muscle[0].totalWeight).toBe(400);
  expect(value.insights.exerciseVolumeComparisons[0].currentVolume).toBe(800);
  expect(value.insights.muscleVolumeComparisons[0].currentVolume).toBe(400);
  expect(value.view.volume).toBe('800');
  expect((await loadExerciseCatalogStats('all', end)).aggregatesById.get('pull')?.totalVolume).toBe(1440);
});


it('keeps gym-scoped history and records on the same dated bodyweight context after corrections', async () => {
  const db = mockFixture.database;
  db.insert(gyms).values([{ id: 'home', name: 'Home' }, { id: 'club', name: 'Club' }]).run();
  db.update(sessions).set({ gymId: 'home' }).where(eq(sessions.id, 'old')).run();
  db.update(sessions).set({ gymId: 'club' }).where(eq(sessions.id, 'new')).run();
  const scopedHistory = () => loadExercisePerformanceHistory({ exerciseDefinitionId: 'pull', period: 'all', gymId: 'home' });
  const initial = await scopedHistory();
  expect(initial?.sessions).toHaveLength(1);
  expect(initial?.sessions[0]).toMatchObject({ sessionId: 'old', gymName: 'Home', bodyWeightKg: 80, totalVolume: 640 });
  expect(initial?.allTimeBest.estimatedOneRepMax?.sessionId).toBe('old');

  const hook = renderHook(({ scope, revision }: { scope: 'all' | 'current-gym'; revision: number }) =>
    useExerciseRecords('pull', loadExercisePerformanceHistory, null, { scope, currentGymId: 'home' }, revision),
  { initialProps: { scope: 'current-gym', revision: 0 } });
  await waitFor(() => expect(hook.result.current).toMatchObject({ status: 'ready', summary: {
    records: { oneRepMax: { gymName: 'Home' }, volume: { value: 640 } },
  } }));

  db.update(bodyWeightMeasurements).set({ weightKg: 90 }).where(eq(bodyWeightMeasurements.id, 'old-reading')).run();
  hook.rerender({ scope: 'current-gym', revision: 1 });
  await waitFor(() => expect(hook.result.current).toMatchObject({ status: 'ready', summary: {
    records: { oneRepMax: { gymName: 'Home' }, volume: { value: 720 } },
  } }));
  expect((await scopedHistory())?.sessions[0].totalVolume).toBe(720);
  expect((await loadExercisePerformanceHistory({ exerciseDefinitionId: 'pull', period: 'all', gymId: 'club' }))?.sessions[0])
    .toMatchObject({ bodyWeightKg: 80, totalVolume: 800 });

  hook.rerender({ scope: 'all', revision: 1 });
  await waitFor(() => expect(hook.result.current).toMatchObject({ status: 'ready', summary: {
    records: { oneRepMax: { gymName: 'Club' }, volume: { value: 800 } },
  } }));
  hook.unmount();
});
