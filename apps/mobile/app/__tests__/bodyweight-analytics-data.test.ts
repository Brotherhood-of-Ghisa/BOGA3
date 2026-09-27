import { renderHook, waitFor } from '@testing-library/react-native';
import { useExerciseRecords } from '@/src/session-recorder/use-exercise-records';
import { eq } from 'drizzle-orm';
import { exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups, sessionExercises, sessions, gyms, bodyWeightMeasurements } from '@/src/data/schema';
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
  db.insert(exerciseDefinitions).values({ id: 'pull', name: 'Pull-up', bodyweightCoefficient: 1,
    movementStandard: 'Strict pull-up', loadingMethod: 'Belt', loadInputMode: 'total_load' }).run();
  db.insert(muscleGroups).values({ id: 'back', displayName: 'Back', familyName: 'Back' }).run();
  db.insert(exerciseMuscleMappings).values({ id: 'map', exerciseDefinitionId: 'pull', muscleGroupId: 'back', role: 'primary', weight: 1 }).run();
  for (const [id, date, amount] of [['old', '2026-09-19T12:00:00Z', '0'], ['new', '2026-09-20T12:00:00Z', '20']]) {
    const startedAt = new Date(date);
    db.insert(sessions).values({ id, status: 'completed', startedAt, completedAt: new Date(startedAt.getTime() + 3600000) }).run();
    db.insert(bodyWeightMeasurements).values({ id: `${id}-reading`, weightValue: '80', weightKg: 80, weightUnit: 'kg', measuredAt: startedAt }).run();
    db.insert(sessionExercises).values({ id: `${id}-ex`, sessionId: id, exerciseDefinitionId: 'pull', name: 'Pull-up', orderIndex: 0 }).run();
    db.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: `${id}-ex`, orderIndex: 0,
      weightValue: amount, repsValue: '8', weightUnit: 'kg', externalLoadMode: 'added', setType: 'rir_1', performanceStatus: null }).run();
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
  expect(initial.insights.personalRecords[0].loadLabel).toBe('BW + 20.0 kg');
  expect(initial.view.volume).toBe('800');
  expect((await loadExerciseCatalogStats('all', end)).aggregatesById.get('pull')?.totalVolume).toBe(1440);
  const db = mockFixture.database;
  db.insert(bodyWeightMeasurements).values({ id: 'today', weightValue: '100', weightUnit: 'kg', weightKg: 100, measuredAt: end }).run();
  expect((await read()).daily[0].totalVolume).toBe(800);
  db.update(bodyWeightMeasurements).set({ weightKg: 82, weightValue: '82' }).where(eq(bodyWeightMeasurements.id, 'new-reading')).run();
  expect((await read()).daily[0].totalVolume).toBe(816);
  db.update(exerciseDefinitions).set({ bodyweightCoefficient: 0.7 }).where(eq(exerciseDefinitions.id, 'pull')).run();
  const changed = await read();
  expect(changed.daily[0].totalVolume).toBeCloseTo(619.2);
  expect(changed.insights.exerciseVolumeComparisons[0].currentVolume).toBeCloseTo(619.2);
  expect(changed.muscle[0].totalWeight).toBeCloseTo(309.6);
});

it('uses legacy numeric loads as added weight while preserving their lb unit', async () => {
  mockFixture.database.update(exerciseSets).set({ weightUnit: 'lb', externalLoadMode: 'assistance' }).where(eq(exerciseSets.id, 'new-set')).run();
  const value = await read();
  expect(value.history.sessions[0].totalVolume).toBeCloseTo(712.5747792, 8);
  expect(value.blocks.blocks[0].totalVolume).toBeCloseTo(712.5747792, 8);
  expect(value.daily[0].totalVolume).toBeCloseTo(712.5747792, 8);
  expect(value.muscle[0].totalWeight).toBeCloseTo(356.2873896, 8);
  expect(value.insights.personalRecords).toHaveLength(1);
  expect(value.insights.personalRecords[0].estimatedOneRepMax).toBeCloseTo(33.7192915768, 8);
  expect(value.view.cards[0].rows[0].weightReps).toBe('BW + 20.0 lb × 8');
});

it.each(['definition'] as const)('retains counts but withholds placeholder %s load metadata', async entity => {
  const db = mockFixture.database;
  if (entity === 'definition') db.update(exerciseDefinitions).set({ localBodyweightMetadataKnown: false }).run();
  const value = await read();
  expect(value.history.sessions[0]).toMatchObject({ totalVolume: null, workingSetCount: 1 });
  expect(value.blocks.blocks[0].totalVolume).toBeNull();
  expect(value.daily[0]).toMatchObject({ totalVolume: null, workingSetCount: 1 });
  expect(value.muscle[0].totalWeight).toBeNull();
  expect(value.insights.exerciseVolumeComparisons[0]).toMatchObject({ currentVolume: null, state: 'incomplete' });
  expect(value.insights.personalRecords).toEqual([]);
  expect(value.view.volume).toBe('—');
  expect(value.view.volumeNote).toContain('Volume unavailable');
});


it.each([{ weightKg: 900 }, { weightValue: 'NaN' }, { weightUnit: 'stone' }])(
  'withholds a malformed latest reading across every reader without falling back', async badReading => {
  mockFixture.database.update(bodyWeightMeasurements).set(badReading).where(eq(bodyWeightMeasurements.id, 'new-reading')).run();
  const value = await read();
  expect(value.history.sessions[0]).toMatchObject({ totalVolume: null, workingSetCount: 1, loadContext: { bodyWeightKg: null } });
  expect(value.blocks.blocks[0].totalVolume).toBeNull();
  expect(value.daily[0]).toMatchObject({ totalVolume: null, workingSetCount: 1 });
  expect(value.muscle[0].totalWeight).toBeNull();
  expect(value.insights.exerciseVolumeComparisons[0].currentVolume).toBeNull();
  expect(value.insights.muscleVolumeComparisons[0].currentVolume).toBeNull();
  expect(value.insights.personalRecords).toEqual([]);
  expect(value.view.volume).toBe('—');
  expect(value.view.volumeNote).toContain('Volume unavailable');
  expect((await loadExerciseCatalogStats('all', end)).aggregatesById.get('pull')?.totalVolume).toBeNull();
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
    records: { oneRepMax: { bodyWeightKg: 80, effectiveResistanceKg: 80, gymName: 'Home' }, volume: { value: 640 } },
  } }));

  db.update(bodyWeightMeasurements).set({ weightKg: 90, weightValue: '90' }).where(eq(bodyWeightMeasurements.id, 'old-reading')).run();
  hook.rerender({ scope: 'current-gym', revision: 1 });
  await waitFor(() => expect(hook.result.current).toMatchObject({ status: 'ready', summary: {
    records: { oneRepMax: { bodyWeightKg: 90, effectiveResistanceKg: 90, gymName: 'Home' }, volume: { value: 720 } },
  } }));
  expect((await scopedHistory())?.sessions[0].totalVolume).toBe(720);
  expect((await loadExercisePerformanceHistory({ exerciseDefinitionId: 'pull', period: 'all', gymId: 'club' }))?.sessions[0])
    .toMatchObject({ bodyWeightKg: 80, totalVolume: 800 });

  hook.rerender({ scope: 'all', revision: 1 });
  await waitFor(() => expect(hook.result.current).toMatchObject({ status: 'ready', summary: {
    records: { oneRepMax: { bodyWeightKg: 80, effectiveResistanceKg: 100, gymName: 'Club' }, volume: { value: 800 } },
  } }));
  hook.unmount();
});
