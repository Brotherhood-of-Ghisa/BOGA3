/* eslint-disable import/first */

/**
 * Outcome: a member's exercise → group-exercise links are local synced rows
 * with a deterministic id, so "one group exercise per personal exercise per
 * group" holds without a server constraint and relinking reuses the same id —
 * the Sync v2 undelete path (contract §A.1.1.3).
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle (FK
 * enforcement on, like the production handle), with `bootstrapLocalDataLayer`
 * pointed at it so the real repository runs end to end.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Imported AFTER the bootstrap mock so the repository binds to it.
import { __resetClockForTests } from '@/src/data/clock';
import {
  exerciseGroupLinkId,
  linkExercise,
  listLinks,
  unlinkExercise,
} from '@/src/data/exercise-group-links';
import { exerciseDefinitions, exerciseGroupLinks } from '@/src/data/schema';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-09-13T10:00:00.000Z');
const T1 = new Date('2026-09-13T11:00:00.000Z');
const T2 = new Date('2026-09-13T12:00:00.000Z');

const readLink = (id: string) =>
  db().select().from(exerciseGroupLinks).where(eq(exerciseGroupLinks.id, id)).get();

const allLinkRows = () => db().select().from(exerciseGroupLinks).all();

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db().insert(exerciseDefinitions).values({ id: 'def-bench', name: 'Bench Press' }).run();
  db().insert(exerciseDefinitions).values({ id: 'def-squat', name: 'Squat' }).run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('exercise group links repository', () => {
  it('derives the deterministic id <group_id>:<exercise_definition_id>', () => {
    expect(exerciseGroupLinkId('grp-1', 'def-bench')).toBe('grp-1:def-bench');
    expect(exerciseGroupLinkId('grp-1', 'seed:bench-press')).toBe('grp-1:seed:bench-press');
  });

  it('linking creates one dirty row under the deterministic id', async () => {
    const link = await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);

    expect(link).toEqual({
      id: 'grp-1:def-bench',
      exerciseDefinitionId: 'def-bench',
      groupId: 'grp-1',
      groupExerciseId: 'gx-bench',
      createdAt: T0,
      updatedAt: T0,
    });
    const row = readLink('grp-1:def-bench');
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    expect(row?.deletedAt).toBeNull();
  });

  it('relinking the same exercise into the same group reuses the id and retargets the row', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    const first = readLink('grp-1:def-bench');

    const relinked = await linkExercise('def-bench', 'grp-1', 'gx-bench-paused', T1);

    expect(relinked.id).toBe('grp-1:def-bench');
    expect(allLinkRows()).toHaveLength(1);
    const row = readLink('grp-1:def-bench');
    expect(row?.groupExerciseId).toBe('gx-bench-paused');
    expect(row?.createdAt).toEqual(T0);
    expect(row?.updatedAt).toEqual(T1);
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(first?.localUpdatedAtMs ?? 0);
  });

  it('relinking to the current live target is a no-op that leaves a clean row clean', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    db().update(exerciseGroupLinks).set({ localDirty: false }).run();
    const before = readLink('grp-1:def-bench');

    await linkExercise('def-bench', 'grp-1', 'gx-bench', T1);

    const after = readLink('grp-1:def-bench');
    expect(after?.localDirty).toBe(false);
    expect(after?.localUpdatedAtMs).toBe(before?.localUpdatedAtMs);
    expect(after?.updatedAt).toEqual(T0);
  });

  it('unlink tombstones the row (kept for sync) and hides it from listLinks', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    db().update(exerciseGroupLinks).set({ localDirty: false }).run();

    await unlinkExercise('def-bench', 'grp-1', T1);

    const row = readLink('grp-1:def-bench');
    expect(row?.deletedAt).toEqual(T1);
    expect(row?.groupExerciseId).toBe('gx-bench');
    expect(row?.localDirty).toBe(true);
    expect(await listLinks()).toEqual([]);
  });

  it('guards the confirmed target atomically and leaves a moved link clean', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    await linkExercise('def-bench', 'grp-1', 'gx-other', T1);
    db().update(exerciseGroupLinks).set({ localDirty: false }).run();
    const before = readLink('grp-1:def-bench');

    expect(await unlinkExercise('def-bench', 'grp-1', T2, 'gx-bench')).toBe(false);
    expect(readLink('grp-1:def-bench')).toEqual(before);
    expect(await unlinkExercise('def-bench', 'grp-1', T2, 'gx-other')).toBe(true);
    expect(readLink('grp-1:def-bench')?.deletedAt).toEqual(T2);
    expect(await unlinkExercise('def-bench', 'grp-1', T2, 'gx-other')).toBe(false);
    expect(await unlinkExercise('def-squat', 'grp-1', T2, 'gx-other')).toBe(false);
  });

  it('unlinking one mapping preserves another personal link and the same exercise in another group', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    await linkExercise('def-squat', 'grp-1', 'gx-bench', T0);
    await linkExercise('def-bench', 'grp-2', 'gx-bench', T0);
    db().update(exerciseDefinitions).set({ deletedAt: T1 }).where(eq(exerciseDefinitions.id, 'def-bench')).run();
    expect(await unlinkExercise('def-bench', 'grp-1', T2, 'gx-bench')).toBe(true);
    expect((await listLinks()).map((link) => link.id)).toEqual(['grp-1:def-squat', 'grp-2:def-bench']);
  });

  it('relinking after unlink undeletes the same id rather than creating a new row', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    await unlinkExercise('def-bench', 'grp-1', T1);
    const tombstone = readLink('grp-1:def-bench');

    const relinked = await linkExercise('def-bench', 'grp-1', 'gx-bench-2', T2);

    expect(relinked.id).toBe('grp-1:def-bench');
    expect(allLinkRows()).toHaveLength(1);
    const row = readLink('grp-1:def-bench');
    expect(row?.deletedAt).toBeNull();
    expect(row?.groupExerciseId).toBe('gx-bench-2');
    expect(row?.createdAt).toEqual(T0);
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(tombstone?.localUpdatedAtMs ?? 0);
  });

  it('unlinking a missing or already-unlinked link is a no-op', async () => {
    await unlinkExercise('def-bench', 'grp-1', T0);
    expect(allLinkRows()).toHaveLength(0);

    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);
    await unlinkExercise('def-bench', 'grp-1', T1);
    db().update(exerciseGroupLinks).set({ localDirty: false }).run();

    await unlinkExercise('def-bench', 'grp-1', T2);

    const row = readLink('grp-1:def-bench');
    expect(row?.deletedAt).toEqual(T1);
    expect(row?.localDirty).toBe(false);
  });

  it('keeps one row per group: the same exercise links independently into two groups', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-1', T0);
    await linkExercise('def-bench', 'grp-2', 'gx-2', T0);
    await linkExercise('def-squat', 'grp-1', 'gx-3', T0);

    expect((await listLinks()).map((link) => link.id)).toEqual([
      'grp-1:def-bench',
      'grp-1:def-squat',
      'grp-2:def-bench',
    ]);
  });

  it('rejects a link to an exercise that does not exist locally (FK into exercise_definitions)', async () => {
    // better-sqlite3's SqliteError is created outside jest's realm, so
    // `.rejects.toThrow` does not recognise it as an Error; match the message.
    await expect(linkExercise('def-missing', 'grp-1', 'gx-1', T0)).rejects.toMatchObject({
      message: expect.stringMatching(/foreign key/i),
    });
    expect(allLinkRows()).toHaveLength(0);
  });

  it('blocks hard-deleting a linked exercise (on delete no action, like session_exercises)', async () => {
    await linkExercise('def-bench', 'grp-1', 'gx-bench', T0);

    expect(() =>
      db().delete(exerciseDefinitions).where(eq(exerciseDefinitions.id, 'def-bench')).run(),
    ).toThrow(/foreign key/i);
    expect(readLink('grp-1:def-bench')).toBeDefined();
  });

  it('rejects a row whose id is not the deterministic <group_id>:<exercise_definition_id>', () => {
    expect(() =>
      db()
        .insert(exerciseGroupLinks)
        .values({
          id: 'random-id',
          exerciseDefinitionId: 'def-bench',
          groupId: 'grp-1',
          groupExerciseId: 'gx-bench',
        })
        .run(),
    ).toThrow(/exercise_group_links_id_deterministic/);
  });
});
