/* eslint-disable import/first */
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));

import { __resetClockForTests } from '@/src/data/clock';
import {
  exerciseDefinitions, exerciseSets, exerciseTagDefinitions, gyms, sessionExercises,
  sessionExerciseTags, sessionPlanExercises, sessionPlans, sessionPlanSets, sessions,
} from '@/src/data/schema';
import {
  ActiveSessionConflictError, SessionUnavailableError, createSessionDraftRepository, reviveSessionRow,
} from '@/src/data/session-drafts';
import { formatElapsed } from '@/src/session-recorder/session-view-model';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

const start = new Date(2026, 10, 4, 19, 50);
const firstEnd = new Date(2026, 10, 4, 20, 3);
const resumedAt = new Date(2026, 10, 4, 20, 10);
const repository = createSessionDraftRepository();
const db = () => mockFixture.database;
const sessionRow = () => db().select().from(sessions).where(eq(sessions.id, 'workout')).get()!;
const children = () => ({
  exercises: db().select().from(sessionExercises).all(),
  sets: db().select().from(exerciseSets).all(),
  tags: db().select().from(sessionExerciseTags).all(),
  blocks: db().select().from(sessionPlanExercises).all(),
});

beforeEach(() => {
  __resetClockForTests();
  mockFixture = createInMemoryDatabase();
  jest.mocked(notifyLocalWrite).mockClear();
});
afterEach(() => mockFixture.close());

const seed = async () => {
  db().insert(gyms).values({ id: 'gym', name: 'Home Sweet Home' }).run();
  db().insert(exerciseDefinitions).values({ id: 'press', name: 'Arnold Presses' }).run();
  db().insert(sessionPlans).values({ id: 'plan', title: 'Upper body' }).run();
  db().insert(sessionPlanExercises).values({
    id: 'block', sessionPlanId: 'plan', exerciseDefinitionId: 'press', name: 'Arnold Presses',
    orderIndex: 0, progressStatus: 'completed', resolvedAt: firstEnd,
  }).run();
  db().insert(sessionPlanSets).values({
    id: 'target', sessionPlanExerciseId: 'block', orderIndex: 0, targetReps: 10, targetWeightValue: '40',
  }).run();
  await repository.persistDraftSnapshot({
    sessionId: 'workout', gymId: 'gym', startedAt: start, sourcePlanId: 'plan',
    exercises: [{ id: 'card', exerciseDefinitionId: 'press', name: 'Arnold Presses', sourcePlanExerciseId: 'block',
      sets: [{ id: 'set', repsValue: '10', weightValue: '40', setType: 'rir_1', sourcePlanSetId: 'target' }],
    }],
  }, { now: start });
  db().insert(exerciseTagDefinitions).values({
    id: 'tag', exerciseDefinitionId: 'press', name: 'Seated', normalizedName: 'seated',
  }).run();
  db().insert(sessionExerciseTags).values({ id: 'assignment', sessionExerciseId: 'card', exerciseTagDefinitionId: 'tag' }).run();
  await repository.completeSession('workout', { now: firstEnd });
  db().update(sessions).set({ localDirty: false }).run();
  jest.mocked(notifyLocalWrite).mockClear();
};

it('reopens only the session header and preserves saved work, tags, gym, Start and resolved plan provenance', async () => {
  await seed();
  const savedChildren = children();
  const before = sessionRow();

  await repository.reopenCompletedSession('workout', { now: resumedAt });

  expect(sessionRow()).toEqual({ ...before, status: 'active', completedAt: null, durationSec: null,
    localDirty: true, localUpdatedAtMs: expect.any(Number), updatedAt: resumedAt });
  expect(sessionRow().localUpdatedAtMs).toBeGreaterThan(before.localUpdatedAtMs);
  expect(children()).toEqual(savedChildren);
  expect(await repository.loadLatestDraftSnapshot()).toMatchObject({ sessionId: 'workout', sourcePlanId: 'plan' });
  expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
  expect(formatElapsed(start, resumedAt)).toBe('20:00');

  const finalEnd = new Date(2026, 10, 4, 20, 20);
  await repository.completeSession('workout', { now: finalEnd });
  expect(sessionRow()).toMatchObject({ id: 'workout', status: 'completed', startedAt: start,
    completedAt: finalEnd, durationSec: 30 * 60 });
  expect(children()).toEqual(savedChildren);
  expect(db().select().from(sessions).all()).toHaveLength(1);
});

it.each(['missing', 'deleted'] as const)('cannot resume a %s session or revive its work', async (kind) => {
  await seed();
  if (kind === 'deleted') db().update(sessions).set({ deletedAt: firstEnd }).run();
  const before = sessionRow();
  const savedChildren = children();

  await expect(repository.reopenCompletedSession(kind === 'missing' ? 'absent' : 'workout'))
    .rejects.toBeInstanceOf(SessionUnavailableError);

  expect(sessionRow()).toEqual(before);
  expect(children()).toEqual(savedChildren);
  expect(notifyLocalWrite).not.toHaveBeenCalled();
});

it('rejects another active workout transactionally and identifies it without changing either session', async () => {
  await seed();
  const before = sessionRow();
  await repository.persistDraftSnapshot({ sessionId: 'current', gymId: null, startedAt: resumedAt, exercises: [] });
  await expect(repository.reopenCompletedSession('workout')).rejects.toMatchObject({
    name: 'ActiveSessionConflictError', activeSessionId: 'current',
  });
  expect(sessionRow()).toEqual(before);
});

it('offers the same current workout as Train when sync has left more than one active row', async () => {
  await seed();
  db().insert(sessions).values([
    { id: 'older-active', status: 'active', startedAt: start, updatedAt: firstEnd },
    { id: 'current-active', status: 'active', startedAt: start, updatedAt: resumedAt },
  ]).run();
  await expect(repository.reopenCompletedSession('workout')).rejects.toMatchObject({ activeSessionId: 'current-active' });
  expect(await repository.loadLatestDraftSnapshot()).toMatchObject({ sessionId: 'current-active' });
});

it('opening an already resumed workout is idempotent and does not dirty or announce it again', async () => {
  await seed();
  await repository.reopenCompletedSession('workout', { now: resumedAt });
  const before = sessionRow();
  jest.mocked(notifyLocalWrite).mockClear();
  await expect(repository.reopenCompletedSession('workout')).resolves.toEqual({ sessionId: 'workout' });
  expect(sessionRow()).toEqual(before);
  expect(notifyLocalWrite).not.toHaveBeenCalled();
});

it('logs additional work on the resumed workout and completes it under the same identity', async () => {
  await seed();
  await repository.reopenCompletedSession('workout', { now: resumedAt });
  const draft = (await repository.loadLatestDraftSnapshot())!;
  await repository.persistDraftSnapshot({
    sessionId: draft.sessionId, gymId: draft.gymId, startedAt: draft.startedAt,
    exercises: draft.exercises.map((exercise) => ({ ...exercise,
      sets: [...exercise.sets, { id: 'added-set', weightValue: '45', repsValue: '10', setType: 'rir_0' }],
    })),
  });
  await repository.completeSession('workout', { now: new Date(2026, 10, 4, 20, 20) });
  const finished = (await repository.loadSessionSnapshotById('workout'))!;
  expect(finished).toMatchObject({ sessionId: 'workout', status: 'completed', durationSec: 1800, sourcePlanId: 'plan' });
  expect(finished.exercises[0].sets.map((set) => set.id)).toEqual(['set', 'added-set']);
  expect(finished.exercises[0].sets[0].sourcePlanSetId).toBe('target');
  expect(db().select().from(sessionExerciseTags).all()).toHaveLength(1);
});

it.each(['start-first', 'resume-first'] as const)('permits only one active workout when Start and Resume race (%s)', async (order) => {
  await seed();
  const create = () => repository.persistDraftSnapshot({ sessionId: 'new', gymId: null, startedAt: resumedAt, exercises: [] }, { requireNoActiveSession: true });
  const resume = () => repository.reopenCompletedSession('workout');
  const operations = order === 'start-first' ? [create, resume] : [resume, create];
  const outcomes = await Promise.allSettled(operations.map((operation) => operation()));
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: expect.any(ActiveSessionConflictError) });
  const active = db().select().from(sessions).all().filter((row) => row.status === 'active' && row.deletedAt === null);
  expect(active).toHaveLength(1);
  expect(active[0].id).toBe(order === 'start-first' ? 'new' : 'workout');
});

it('cannot resurrect a discarded planned start over a resumed workout', async () => {
  await seed();
  db().insert(sessions).values({ id: 'discarded-plan-start', status: 'active', startedAt: start, deletedAt: firstEnd }).run();
  await repository.reopenCompletedSession('workout');
  await expect(reviveSessionRow('discarded-plan-start')).rejects.toMatchObject({ activeSessionId: 'workout' });
  expect(db().select().from(sessions).where(eq(sessions.id, 'discarded-plan-start')).get()?.deletedAt).toEqual(firstEnd);
});
