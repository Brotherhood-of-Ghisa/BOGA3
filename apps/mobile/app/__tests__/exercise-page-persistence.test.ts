/**
 * The exercise page's persistence against the real repository and a real
 * migrated in-memory SQLite: the lane fixture seeds through the recorder's own
 * write path, a save replaces only the page's exercise, a removal leaves the
 * others, and the records panel reads what History reads.
 */
/* eslint-disable import/first */

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let mockActiveDatabase: InMemoryTestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) throw new Error('test database not initialised');
    return mockActiveDatabase;
  }),
}));

import { __resetClockForTests } from '@/src/data/clock';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { exerciseDefinitions } from '@/src/data/schema';
import { completeSessionDraft, loadSessionSnapshotById } from '@/src/data/session-drafts';
import { EXERCISE_PAGE_FIXTURE, seedExercisePageFixture } from '@/src/maestro/exercise-page-fixture';
import { commitSet, planCompleteExercise } from '@/src/session-recorder/exercise-page-model';
import { deriveExerciseRecords } from '@/src/session-recorder/exercise-records';
import {
  loadSessionExerciseDraft,
  saveSessionExerciseDraft,
  SessionExerciseDraftError,
} from '@/src/session-recorder/session-exercise-draft';

const NOW = new Date('2026-09-23T10:00:00Z');
const { activeSessionId, benchSessionExerciseId, squatSessionExerciseId } = EXERCISE_PAGE_FIXTURE;

describe('exercise page persistence', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(async () => {
    __resetClockForTests();
    fixture = createInMemoryDatabase();
    mockActiveDatabase = fixture.database;
    fixture.database
      .insert(exerciseDefinitions)
      .values([
        {
          id: EXERCISE_PAGE_FIXTURE.benchExerciseId,
          name: EXERCISE_PAGE_FIXTURE.benchExerciseName,
        },
        {
          id: EXERCISE_PAGE_FIXTURE.squatExerciseId,
          name: EXERCISE_PAGE_FIXTURE.squatExerciseName,
        },
      ])
      .run();
    await seedExercisePageFixture(NOW);
  });

  afterEach(() => {
    fixture.close();
    mockActiveDatabase = null;
  });

  it('loads one exercise of the active session, and refuses what is not there', async () => {
    const loaded = await loadSessionExerciseDraft(activeSessionId, benchSessionExerciseId);
    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') return;
    expect(loaded.exercise.sets.map((set) => set.performanceStatus ?? null)).toEqual([
      null,
      null,
      'planned',
      'planned',
      'planned',
    ]);

    expect(await loadSessionExerciseDraft(activeSessionId, 'nope')).toEqual({
      status: 'missing-exercise',
    });
    expect(await loadSessionExerciseDraft('nope', benchSessionExerciseId)).toEqual({
      status: 'missing-session',
    });
    expect(await loadSessionExerciseDraft('maestro_exercise_page_history_2', 'x')).toEqual({
      status: 'not-active',
    });
  });

  it('saves only its own exercise and keeps the rest of the session as persisted', async () => {
    const loaded = await loadSessionExerciseDraft(activeSessionId, benchSessionExerciseId);
    if (loaded.status !== 'ready') throw new Error('not loaded');
    const [, , third] = loaded.exercise.sets;
    const sets = commitSet(loaded.exercise.sets, third!.id, {
      weightValue: '82.5',
      repsValue: '5',
      setType: 'rir_3',
    });

    await saveSessionExerciseDraft(activeSessionId, {
      sessionExerciseId: benchSessionExerciseId,
      exercise: { ...loaded.exercise, sets },
    });

    const session = await loadSessionSnapshotById(activeSessionId);
    expect(session?.status).toBe('active');
    expect(session?.exercises.map((exercise) => exercise.id)).toEqual([
      benchSessionExerciseId,
      squatSessionExerciseId,
    ]);
    expect(session?.exercises[0]?.sets[2]).toMatchObject({
      weightValue: '82.5',
      repsValue: '5',
      setType: 'rir_3',
      performanceStatus: null,
      plannedRepsValue: '6',
    });
    expect(session?.exercises[1]?.sets).toHaveLength(1);
  });

  it('persists Complete as unperformed planned rows, never deleting them', async () => {
    const loaded = await loadSessionExerciseDraft(activeSessionId, benchSessionExerciseId);
    if (loaded.status !== 'ready') throw new Error('not loaded');
    const plan = planCompleteExercise(loaded.exercise.sets);

    await saveSessionExerciseDraft(activeSessionId, {
      sessionExerciseId: benchSessionExerciseId,
      exercise: { ...loaded.exercise, sets: plan.nextSets },
    });

    const reloaded = await loadSessionExerciseDraft(activeSessionId, benchSessionExerciseId);
    if (reloaded.status !== 'ready') throw new Error('not reloaded');
    expect(
      reloaded.exercise.sets.map((set) => [set.performanceStatus ?? null, set.plannedRepsValue ?? null])
    ).toEqual([
      [null, null],
      [null, null],
      ['unperformed', '6'],
      ['unperformed', '6'],
      ['unperformed', '5'],
    ]);
  });

  it('removes the exercise and leaves the others', async () => {
    await saveSessionExerciseDraft(activeSessionId, {
      sessionExerciseId: benchSessionExerciseId,
      exercise: null,
    });
    const session = await loadSessionSnapshotById(activeSessionId);
    expect(session?.exercises.map((exercise) => exercise.id)).toEqual([squatSessionExerciseId]);
  });

  it('will not recreate an exercise or a session that is gone', async () => {
    await saveSessionExerciseDraft(activeSessionId, {
      sessionExerciseId: benchSessionExerciseId,
      exercise: null,
    });
    await expect(
      saveSessionExerciseDraft(activeSessionId, {
        sessionExerciseId: benchSessionExerciseId,
        exercise: null,
      })
    ).rejects.toEqual(new SessionExerciseDraftError('missing-exercise'));

    await completeSessionDraft(activeSessionId, { now: NOW });
    await expect(
      saveSessionExerciseDraft(activeSessionId, {
        sessionExerciseId: squatSessionExerciseId,
        exercise: null,
      })
    ).rejects.toEqual(new SessionExerciseDraftError('not-active'));
  });

  it('derives the records panel from completed history, the active session excluded', async () => {
    const history = await loadExercisePerformanceHistory({
      exerciseDefinitionId: EXERCISE_PAGE_FIXTURE.benchExerciseId,
      period: 'all',
      now: NOW,
    });
    const { records, last } = deriveExerciseRecords(history?.sessions ?? []);

    expect(records.oneRepMax?.value).toBeCloseTo(102.14, 2);
    expect(records.oneRepMax).toMatchObject({ weight: 80, reps: 8 });
    expect(records.maxWeight).toMatchObject({ weight: 82.5, reps: 6 });
    expect(records.volume).toMatchObject({ value: 2560, setCount: 5 });
    expect(last?.volume).toBe(2375);
    expect(last?.sets.map((set) => [set.setType, set.weight, set.reps])).toEqual([
      ['warm_up', 60, 10],
      ['rir_2', 80, 8],
      ['rir_1', 80, 8],
      ['rir_0', 82.5, 6],
    ]);
  });
});
