/* eslint-disable import/first */
import { eq } from 'drizzle-orm';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native open only.
  require('./helpers/local-data').localDataBootstrapModule());

import { enterSessionFromExercise } from '@/src/session-entry/exercise-entry';
import * as drafts from '@/src/data/session-drafts';
import { loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import * as blockHistory from '@/src/data/exercise-block-history';
import { loadSuggestedExercisePlan } from '@/src/data/exercise-block-history';
import { deleteExerciseCatalogExercise, saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { exerciseSets, sessions } from '@/src/data/schema';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { closeLocalData, loadMaestroFixture, localDataClient, localDatabase, resetLocalData } from './helpers/local-data';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const activeRows = () => localDatabase().select().from(sessions).all().filter(row => row.status === 'active' && !row.deletedAt);

beforeEach(async () => { resetLocalData(); await loadMaestroFixture('exercise-block-history'); });
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

it('starts a workout with one blank unconfirmed set in one graph save', async () => {
  const before = Date.now();
  const result = await enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, null);
  const snapshot = (await loadSessionSnapshotById(result.sessionId))!;
  expect(result.kind).toBe('started');
  expect(activeRows()).toHaveLength(1);
  expect(snapshot.startedAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(snapshot.gymId).toBeNull();
  expect(snapshot.exercises).toHaveLength(1);
  expect(snapshot.exercises[0]).toMatchObject({ id: result.sessionExerciseId, exerciseDefinitionId: SQUAT,
    sets: [{ id: result.setId, weightValue: '', repsValue: '', performanceStatus: 'unperformed' }] });
});

it('repeats only that exercise with fresh, unconfirmed target rows', async () => {
  const suggestion = (await loadSuggestedExercisePlan({ exerciseDefinitionId: SQUAT }))!;
  const result = await enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'repeat' }, null);
  const snapshot = (await loadSessionSnapshotById(result.sessionId))!;
  const rows = snapshot.exercises[0].sets;
  expect(snapshot.exercises).toHaveLength(1);
  expect(rows).toHaveLength(suggestion.sets.length);
  expect(rows[0]).toMatchObject({ plannedWeightValue: suggestion.sets[0].weightValue,
    plannedRepsValue: suggestion.sets[0].repsValue, performanceStatus: 'planned', repsValue: '', weightValue: '' });
  expect(rows.every(row => !suggestion.sets.some(source => source.setId === row.id))).toBe(true);
  expect(rows.every(row => !row.sourcePlanSetId && !row.sourcePlanUseId)).toBe(true);
});

it('continues the most recent matching card, preserving earlier work, the gym and start time', async () => {
  const startedAt = new Date(2026, 10, 20, 12);
  const created = await persistSessionDraftSnapshot({ gymId: null, startedAt, exercises: [
    { id: 'first-squat', exerciseDefinitionId: SQUAT, name: 'Squat', sets: [{ id: 'first-set', weightValue: '100', repsValue: '5', performanceStatus: null }] },
    { id: 'last-squat', exerciseDefinitionId: SQUAT, name: 'Squat', sets: [{ id: 'last-set', weightValue: '', repsValue: '', performanceStatus: 'unperformed' }] },
    { id: 'other', exerciseDefinitionId: PULLDOWN, name: 'Pulldown', sets: [] },
  ] });
  const result = await enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, created.sessionId);
  const snapshot = (await loadSessionSnapshotById(created.sessionId))!;
  expect(result).toMatchObject({ kind: 'resumed', sessionId: created.sessionId, sessionExerciseId: 'last-squat' });
  expect(activeRows()).toHaveLength(1);
  expect(snapshot.startedAt).toEqual(startedAt);
  expect(snapshot.exercises.map(card => [card.id, card.sets.length])).toEqual([['first-squat', 1], ['last-squat', 2], ['other', 0]]);
  expect(snapshot.exercises[0].sets[0]).toMatchObject({ id: 'first-set', weightValue: '100', repsValue: '5', performanceStatus: null });
});

it('keeps a hold unperformed and uses its hold effort default', async () => {
  const hold = await saveExerciseCatalogExercise({ name: 'Quick hold', recordingMode: 'hold', mappings: [{ muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' }] });
  const result = await enterSessionFromExercise({ exerciseDefinitionId: hold.id, mode: 'empty' }, null);
  const snapshot = (await loadSessionSnapshotById(result.sessionId))!;
  expect(snapshot.exercises[0].sets[0]).toMatchObject({ recordingMode: 'hold', durationSec: null, performanceStatus: 'unperformed', setType: 'rir_0' });
});

it('refuses missing/deleted exercises, missing history and stale workouts without starting a session', async () => {
  await expect(enterSessionFromExercise({ exerciseDefinitionId: 'missing', mode: 'empty' }, null)).rejects.toThrow('no longer available');
  await expect(enterSessionFromExercise({ exerciseDefinitionId: PULLDOWN, mode: 'repeat' }, null)).rejects.toThrow('No earlier workout');
  await deleteExerciseCatalogExercise(SQUAT);
  await expect(enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, null)).rejects.toThrow('no longer available');
  await expect(enterSessionFromExercise({ exerciseDefinitionId: PULLDOWN, mode: 'empty' }, 'missing')).rejects.toThrow('workout changed');
  expect(activeRows()).toHaveLength(0);
});

it('rolls back the complete first graph when a set write fails', async () => {
  // A real SQLite failure inside the graph transaction, after its session row.
  localDataClient().exec(`CREATE TRIGGER fail_quick_set BEFORE INSERT ON exercise_sets BEGIN SELECT RAISE(ABORT, 'disk failure'); END;`);
  await expect(enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, null)).rejects.toMatchObject({ message: 'disk failure' });
  expect(activeRows()).toHaveLength(0);
});

it('preserves AI logging control and leaves its workout untouched', async () => {
  const created = await persistSessionDraftSnapshot({ startedAt: new Date(), gymId: null, exercises: [] });
  localDatabase().update(sessions).set({ loggingClientId: 'coach' }).where(eq(sessions.id, created.sessionId)).run();
  await expect(enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, created.sessionId)).rejects.toThrow('Take over logging');
  expect((await loadSessionSnapshotById(created.sessionId))!.exercises).toHaveLength(0);
  expect(localDatabase().select().from(exerciseSets).all().filter(row => row.id.startsWith('set-'))).toHaveLength(0);
});


it('keeps ordinary concurrent work written while repeat history is loading', async () => {
  const created = await persistSessionDraftSnapshot({ startedAt: new Date(), gymId: null,
    exercises: [{ id: 'squat-card', exerciseDefinitionId: SQUAT, name: 'Squat', sets: [] }] });
  const load = blockHistory.loadSuggestedExercisePlan;
  jest.spyOn(blockHistory, 'loadSuggestedExercisePlan').mockImplementationOnce(async options => {
    const snapshot = (await loadSessionSnapshotById(created.sessionId))!;
    await persistSessionDraftSnapshot({ ...snapshot, status: 'active', exercises: [{ ...snapshot.exercises[0], sets: [
      { id: 'concurrent-set', weightValue: '123', repsValue: '4', performanceStatus: null },
    ] }] });
    return load(options);
  });
  await enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'repeat' }, created.sessionId);
  const snapshot = (await loadSessionSnapshotById(created.sessionId))!;
  expect(snapshot.exercises[0].sets[0]).toMatchObject({ id: 'concurrent-set', weightValue: '123', repsValue: '4' });
  expect(snapshot.exercises[0].sets.length).toBeGreaterThan(1);
});


it('preserves a same-revision synced row arriving after the final read and before persistence', async () => {
  const created = await persistSessionDraftSnapshot({ startedAt: new Date(), gymId: null,
    exercises: [{ id: 'squat-card', exerciseDefinitionId: SQUAT, name: 'Squat', sets: [] }] });
  const load = drafts.loadSessionSnapshotById;
  let reads = 0;
  jest.spyOn(drafts, 'loadSessionSnapshotById').mockImplementation(async id => {
    const snapshot = await load(id);
    if (++reads === 2) {
      localDatabase().insert(exerciseSets).values({ id: 'late-synced-set', sessionExerciseId: 'squat-card',
        orderIndex: 0, weightValue: '140', repsValue: '3', performanceStatus: null }).run();
    }
    return snapshot;
  });
  await enterSessionFromExercise({ exerciseDefinitionId: SQUAT, mode: 'empty' }, created.sessionId);
  const snapshot = (await load(created.sessionId))!;
  expect(snapshot.exercises[0].sets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'late-synced-set', weightValue: '140', repsValue: '3' }),
  ]));
  expect(snapshot.exercises[0].sets).toHaveLength(2);
});
