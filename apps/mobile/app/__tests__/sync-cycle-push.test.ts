/**
 * Push-leg coverage for the sync cycle: the batch selector walks entity tables
 * in topological order (parents before children), respects the batch cap,
 * breaks out of the walk once the cap is hit, and orders rows oldest-dirty
 * first within a table.
 *
 * Driver: a real in-memory better-sqlite3 database with the full migrated
 * schema applied, via the shared helpers/in-memory-db fixture.
 */

import { eq } from 'drizzle-orm';

import { BATCH_CAP, selectPushBatch } from '@/src/sync/cycle';
import type { Transaction } from '@/src/data/clock';
import { exerciseDefinitions, gyms, sessions } from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  fixture = createInMemoryDatabase();
  database = fixture.database;
});

afterEach(() => {
  fixture.close();
});

const insertGym = (id: string, ms: number, dirty = true): void => {
  database
    .insert(gyms)
    .values({ id, name: `Gym ${id}`, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const insertExerciseDefinition = (id: string, ms: number, dirty = true): void => {
  database
    .insert(exerciseDefinitions)
    .values({ id, name: `Def ${id}`, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const insertSession = (id: string, ms: number, dirty = true): void => {
  database
    .insert(sessions)
    .values({
      id,
      startedAt: new Date('2026-05-29T08:00:00.000Z'),
      localDirty: dirty,
      localUpdatedAtMs: ms,
    })
    .run();
};

describe('selectPushBatch ordering and batching', () => {
  it('walks entity tables in topological order (parents before children)', () => {
    // A Layer 1 session and a Layer 0 gym, both dirty. The Layer 0 gym must
    // come first regardless of insert or timestamp order.
    insertSession('sess-1', 5);
    insertGym('gym-1', 100);

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    expect(batch.map((entity) => entity.type)).toEqual(['gyms', 'sessions']);
    expect(batch[0].id).toBe('gym-1');
    expect(batch[1].id).toBe('sess-1');
  });

  it('orders rows within a table oldest-dirty first', () => {
    insertGym('gym-late', 300);
    insertGym('gym-early', 100);
    insertGym('gym-mid', 200);

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    expect(batch.map((entity) => entity.id)).toEqual(['gym-early', 'gym-mid', 'gym-late']);
  });

  it('skips clean rows', () => {
    insertGym('gym-dirty', 100, true);
    insertGym('gym-clean', 200, false);

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    expect(batch.map((entity) => entity.id)).toEqual(['gym-dirty']);
  });

  it('respects the batch cap and breaks out of the topological walk', () => {
    // Three dirty gyms (Layer 0) and one dirty exercise definition (also
    // Layer 0). With a cap of 2 the walk stops inside the first table that
    // overflows the cap and never reaches the later rows.
    insertGym('gym-1', 100);
    insertGym('gym-2', 200);
    insertGym('gym-3', 300);
    insertExerciseDefinition('def-1', 50);

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, 2));

    expect(batch).toHaveLength(2);
    expect(batch.every((entity) => entity.type === 'gyms')).toBe(true);
  });

  it('returns an empty batch when nothing is dirty', () => {
    insertGym('gym-clean', 100, false);

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    expect(batch).toEqual([]);
  });
});

describe('selectPushBatch wire shape', () => {
  it('serialises the row into the wire envelope with the monotonic LWW key', () => {
    insertGym('gym-1', 4242);

    const [entity] = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    expect(entity.type).toBe('gyms');
    expect(entity.id).toBe('gym-1');
    expect(entity.client_updated_at_ms).toBe(4242);
    // Local-only bookkeeping columns must never appear in the wire payload.
    expect(entity.fields).not.toHaveProperty('local_dirty');
    expect(entity.fields).not.toHaveProperty('local_updated_at_ms');
    expect(entity.fields).toHaveProperty('name', 'Gym gym-1');
    expect(entity.fields).toHaveProperty('deleted_at', null);
  });

  it('keeps the post-cap rows dirty in the database (no mutation on select)', () => {
    insertGym('gym-1', 100);

    database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.localDirty).toBe(true);
  });
});
