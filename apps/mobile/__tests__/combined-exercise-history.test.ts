/* eslint-disable import/first */
import { createInMemoryDatabase, type InMemoryDatabaseFixture, type InMemoryTestDatabase } from './helpers/in-memory-db';

let mockDatabase: InMemoryTestDatabase;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockDatabase }));

import { computeSelectedExercisesHistoryEffort } from '@/src/data/exercise-analytics';
import { loadCombinedExerciseHistory } from '@/src/data/combined-exercise-history';
import { __resetClockForTests } from '@/src/data/clock';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';

let fixture: InMemoryDatabaseFixture;
const at = (day: number) => new Date(2026, 10, day, 12);
const scope = { exerciseDefinitionIds: ['a', 'b'], start: at(16), end: at(23) };
const period = { kind: 'history' as const, weeks: 4 };

const block = (sessionId: string, id: string, exerciseDefinitionId: string, orderIndex: number,
  weightValue: string, recordingMode: 'reps' | 'hold' = 'reps') => {
  mockDatabase.insert(sessionExercises).values({ id, sessionId, exerciseDefinitionId, orderIndex, name: exerciseDefinitionId }).run();
  mockDatabase.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: id, orderIndex: 0, weightValue,
    repsValue: recordingMode === 'hold' ? '' : '5', recordingMode, durationSec: recordingMode === 'hold' ? 30 : null,
    setType: 'rir_2' }).run();
};

beforeEach(() => {
  __resetClockForTests(); fixture = createInMemoryDatabase(); mockDatabase = fixture.database;
  mockDatabase.insert(exerciseDefinitions).values([
    { id: 'a', name: 'Exercise A' }, { id: 'b', name: 'Exercise B', loadInputMode: 'per_side_load' },
    { id: 'hold', name: 'Hold', recordingMode: 'hold' }, { id: 'empty', name: 'Unused' },
  ]).run();
  mockDatabase.insert(gyms).values({ id: 'home', name: 'Home' }).run();
  mockDatabase.insert(sessions).values([
    { id: 'older', status: 'completed', startedAt: at(17), completedAt: at(17), gymId: 'home' },
    { id: 'newer', status: 'completed', startedAt: at(20), completedAt: at(20), gymId: null },
  ]).run();
  block('older', 'older-a', 'a', 0, '50'); block('older', 'older-b', 'b', 1, '10');
  block('newer', 'newer-b', 'b', 0, '20'); block('newer', 'newer-a', 'a', 1, '100');
  block('newer', 'newer-a-again', 'a', 2, '100');
});
afterEach(() => fixture.close());

it('adds each block once with its own load mode and deduplicates contributing sessions', async () => {
  const read = await computeSelectedExercisesHistoryEffort({ ...scope, exerciseDefinitionIds: ['a', 'b', 'a'] });
  expect(read.daily.map(day => [day.workingSetCount, day.totalVolume, day.sessionIds])).toEqual([
    [2, 350, ['older']], [3, 1200, ['newer']],
  ]);
  expect(read.gyms.map(gym => [gym.gymId, gym.sessionCount])).toEqual([[null, 1], ['home', 1]]);
  for (const day of read.daily) {
    expect(day.estimatedRM1).toBeNull(); expect(day.highestWeight).toBeNull();
    expect(day).not.toHaveProperty('personalRecordCounts');
  }
});

it.each([[undefined, 1550], [null, 1200], ['home', 350]] as const)('shares the three-state gym scope %s', async (gymId, expected) => {
  const read = await computeSelectedExercisesHistoryEffort({ ...scope, gymId });
  expect(read.daily.reduce((sum, day) => sum + (day.totalVolume ?? 0), 0)).toBe(expected);
  const history = await loadCombinedExerciseHistory({ exerciseDefinitionIds: scope.exerciseDefinitionIds, period, now: at(22), gymId });
  expect(history!.sessions.reduce((sum, entry) => sum + (entry.totalVolume ?? 0), 0)).toBe(expected);
});

it('interleaves history by completion and original block order, keeping both exercises’ records', async () => {
  const read = await loadCombinedExerciseHistory({ exerciseDefinitionIds: ['a', 'b'], period, now: at(22) });
  expect(read!.sessions.map(entry => entry.sessionExerciseId)).toEqual(['newer-b', 'newer-a', 'newer-a-again', 'older-a', 'older-b']);
  expect(read!.sessions[0].exerciseName).toBe('Exercise B');
  expect(read!.sessions[1].exerciseName).toBe('Exercise A');
  expect(read!.sessions[0].records?.volumeKg).toBe(200);
  expect(read!.sessions[1].records?.volumeKg).toBe(1000);
  expect(read!.sessions[2].records).toBeNull();
  expect(read).not.toHaveProperty('allTimeBest');
  expect(read).not.toHaveProperty('exerciseDefinitionId');
  const setIds = read!.sessions.flatMap(entry => entry.sets.map(set => set.setId));
  expect(new Set(setIds).size).toBe(5);
});

it('retains hold-only unavailability while repetition Volume survives alongside holds', async () => {
  mockDatabase.insert(sessions).values({ id: 'holds', status: 'completed', startedAt: at(21), completedAt: at(21) }).run();
  block('holds', 'hold-block', 'hold', 0, '0', 'hold');
  const onlyHolds = await computeSelectedExercisesHistoryEffort({ ...scope, exerciseDefinitionIds: ['hold', 'empty'] });
  expect(onlyHolds.daily[0]).toMatchObject({ totalVolume: null, volumeSetCount: 0, workingSetCount: 1 });
  const mixed = await computeSelectedExercisesHistoryEffort({ ...scope, exerciseDefinitionIds: ['a', 'hold'] });
  expect(mixed.weekly[0]).toMatchObject({ totalVolume: 1250, workingSetCount: 4 });
});

it('counts confirmed work in the newest active session without adding it to completed History', async () => {
  mockDatabase.insert(sessions).values({ id: 'active', status: 'active', startedAt: at(21) }).run();
  block('active', 'active-a', 'a', 0, '60');
  const read = await computeSelectedExercisesHistoryEffort({ ...scope, now: at(22) });
  expect(read.daily.reduce((sum, day) => sum + day.workingSetCount, 0)).toBe(6);
  const history = await loadCombinedExerciseHistory({ exerciseDefinitionIds: ['a', 'b'], period, now: at(22) });
  expect(history!.sessions.some(entry => entry.sessionId === 'active')).toBe(false);
});

it('rejects a missing definition without silently shrinking the selection', async () => {
  await expect(loadCombinedExerciseHistory({ exerciseDefinitionIds: ['a', 'missing'], period, now: at(22) })).resolves.toBeNull();
});
