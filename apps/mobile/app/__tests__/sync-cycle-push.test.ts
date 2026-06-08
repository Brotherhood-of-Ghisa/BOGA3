/**
 * Push-leg coverage for the sync cycle: the batch selector walks entity tables
 * in topological order (parents before children), respects the batch cap,
 * breaks out of the walk once the cap is hit, and orders rows oldest-dirty
 * first within a table; and the FK-closure preflight flags an orphan dirty
 * child LOCALLY before any batch leaves for the server.
 *
 * Driver: a real in-memory better-sqlite3 database with the full migrated
 * schema applied, via the shared helpers/in-memory-db fixture.
 */

import { eq } from 'drizzle-orm';

import { BATCH_CAP, selectPushBatch, type WireEntity } from '@/src/sync/cycle';
import { findPushBatchFkViolations } from '@/src/sync/fk-graph';
import type { Transaction } from '@/src/data/clock';
import { exerciseDefinitions, gyms, muscleGroups, sessions } from '@/src/data/schema';

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

// A dirty exercise-muscle mapping carries two required parents: its exercise
// definition and its muscle group. Both are syncable entities, so a mapping
// whose muscle group is missing locally (and not in the same batch) is an orphan
// the server's FK check would reject wholesale — the preflight must catch it
// before the push.
const mappingEnvelope = (
  id: string,
  exerciseDefinitionId: string,
  muscleGroupId: string,
): WireEntity => ({
  type: 'exercise_muscle_mappings',
  id,
  client_updated_at_ms: 1000,
  fields: {
    exercise_definition_id: exerciseDefinitionId,
    muscle_group_id: muscleGroupId,
    weight: 1,
    role: 'primary',
    deleted_at: null,
  },
});

const muscleGroupEnvelope = (id: string): WireEntity => ({
  type: 'muscle_groups',
  id,
  client_updated_at_ms: 900,
  fields: {
    display_name: 'Chest',
    family_name: 'Chest',
    sort_order: 0,
    is_editable: 0,
    deleted_at: null,
  },
});

describe('findPushBatchFkViolations: muscle_groups parent edge', () => {
  const insertExerciseDefinitionParent = (id: string): void => {
    database.insert(exerciseDefinitions).values({ id, name: `Def ${id}` }).run();
  };
  const insertMuscleGroupParent = (id: string): void => {
    database
      .insert(muscleGroups)
      .values({ id, displayName: 'Chest', familyName: 'Chest', sortOrder: 0 })
      .run();
  };

  it('flags a dirty mapping whose muscle_group parent is absent locally', () => {
    // The exercise-definition parent is present and clean; only the muscle group
    // is missing. The mapping must still be flagged, on the muscle_group_id edge.
    insertExerciseDefinitionParent('def-1');

    const batch = [mappingEnvelope('emm-orphan', 'def-1', 'mg-missing')];
    const violations = database.transaction((tx) =>
      findPushBatchFkViolations(tx as Transaction, batch),
    );

    expect(violations).toEqual([
      {
        childType: 'exercise_muscle_mappings',
        childId: 'emm-orphan',
        parentType: 'muscle_groups',
        parentIdField: 'muscle_group_id',
        parentId: 'mg-missing',
      },
    ]);
  });

  it('flags the mapping when its muscle_group parent is quarantined, not on the server', () => {
    // The muscle group exists locally but is itself quarantined, so it will not
    // be pushed this cycle. The server has never seen it, so a child relying on
    // it would be rejected — the preflight treats a quarantined parent as absent.
    insertExerciseDefinitionParent('def-1');
    insertMuscleGroupParent('mg-1');

    const batch = [mappingEnvelope('emm-1', 'def-1', 'mg-1')];
    const quarantined = new Set(['muscle_groups mg-1']);
    const violations = database.transaction((tx) =>
      findPushBatchFkViolations(tx as Transaction, batch, quarantined),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      childId: 'emm-1',
      parentType: 'muscle_groups',
      parentIdField: 'muscle_group_id',
    });
  });

  it('passes a valid batch whose muscle_group parent is present and clean locally', () => {
    // Both parents present and clean (so, given the topological selector, already
    // on the server). The mapping is FK-safe to push.
    insertExerciseDefinitionParent('def-1');
    insertMuscleGroupParent('mg-1');

    const batch = [mappingEnvelope('emm-1', 'def-1', 'mg-1')];
    const violations = database.transaction((tx) =>
      findPushBatchFkViolations(tx as Transaction, batch),
    );

    expect(violations).toEqual([]);
  });

  it('passes when the muscle_group parent rides in the same batch (deferred FK)', () => {
    // The muscle group is new (not yet on the server) but ships in the same
    // batch ahead of the mapping; deferred server FKs resolve it inside one
    // transaction, so the preflight must not flag the child.
    insertExerciseDefinitionParent('def-1');

    const batch = [muscleGroupEnvelope('mg-1'), mappingEnvelope('emm-1', 'def-1', 'mg-1')];
    const violations = database.transaction((tx) =>
      findPushBatchFkViolations(tx as Transaction, batch),
    );

    expect(violations).toEqual([]);
  });
});
