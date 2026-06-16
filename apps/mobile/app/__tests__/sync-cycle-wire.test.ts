/**
 * Wire-serialisation round-trip coverage: for every one of the nine entity
 * types, a representative row serialised to the wire envelope and back through
 * the database round-trips its typed columns intact. Confirms the local-only
 * bookkeeping columns never reach the wire, and that timestamp columns
 * round-trip as epoch-ms integers on the wire and Date values in SQLite.
 *
 * Driver: a real in-memory better-sqlite3 database (FK constraints on) so the
 * full parent chain must exist for each child entity.
 */

import { eq } from 'drizzle-orm';

import { entityToWire, wireToEntity, type WireEntity } from '@/src/sync/cycle';
import type { EntityTableName } from '@/src/sync/topo-order';
import * as schema from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  fixture = createInMemoryDatabase({ foreignKeys: true });
  database = fixture.database;
});

afterEach(() => {
  fixture.close();
});

const TABLES: Record<EntityTableName, (typeof schema)[keyof typeof schema]> = {
  gyms: schema.gyms,
  exercise_definitions: schema.exerciseDefinitions,
  muscle_groups: schema.muscleGroups,
  exercise_tag_definitions: schema.exerciseTagDefinitions,
  sessions: schema.sessions,
  exercise_muscle_mappings: schema.exerciseMuscleMappings,
  session_exercises: schema.sessionExercises,
  exercise_sets: schema.exerciseSets,
  session_exercise_tags: schema.sessionExerciseTags,
};

/** Seeds the FK parent chain that each entity type needs to insert cleanly. */
const seedParents = (): void => {
  database.insert(schema.muscleGroups).values({ id: 'mg-1', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 }).run();
  database.insert(schema.gyms).values({ id: 'gym-1', name: 'Gym' }).run();
  database.insert(schema.exerciseDefinitions).values({ id: 'def-1', name: 'Bench' }).run();
  database.insert(schema.exerciseTagDefinitions).values({ id: 'tag-1', exerciseDefinitionId: 'def-1', name: 'Heavy', normalizedName: 'heavy' }).run();
  database.insert(schema.sessions).values({ id: 'sess-1', startedAt: new Date('2026-05-29T08:00:00.000Z') }).run();
  database.insert(schema.sessionExercises).values({ id: 'sx-1', sessionId: 'sess-1', orderIndex: 0, name: 'Bench' }).run();
};

/** A representative row literal per entity type, including null and value cases. */
const SAMPLE_ROWS: Record<EntityTableName, Record<string, unknown>> = {
  gyms: {
    id: 'gym-wire',
    name: 'Iron Temple',
    latitude: 51.5,
    longitude: -0.12,
    coordinateAccuracyM: 5,
    coordinatesUpdatedAt: new Date('2026-05-29T09:00:00.000Z'),
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: null,
  },
  exercise_definitions: {
    id: 'def-wire',
    name: 'Squat',
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: new Date('2026-05-29T10:00:00.000Z'),
  },
  muscle_groups: {
    id: 'mg-wire',
    displayName: 'Quadriceps',
    familyName: 'Legs',
    sortOrder: 3,
    isEditable: 1,
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: new Date('2026-05-29T10:00:00.000Z'),
  },
  exercise_tag_definitions: {
    id: 'tag-wire',
    exerciseDefinitionId: 'def-1',
    name: 'Light',
    normalizedName: 'light',
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: null,
  },
  sessions: {
    id: 'sess-wire',
    gymId: 'gym-1',
    status: 'completed',
    startedAt: new Date('2026-05-29T08:00:00.000Z'),
    completedAt: new Date('2026-05-29T09:00:00.000Z'),
    durationSec: 3600,
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T09:00:00.000Z'),
    deletedAt: null,
  },
  exercise_muscle_mappings: {
    id: 'emm-wire',
    exerciseDefinitionId: 'def-1',
    muscleGroupId: 'mg-1',
    weight: 1,
    role: 'primary',
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: null,
  },
  session_exercises: {
    id: 'sx-wire',
    sessionId: 'sess-1',
    exerciseDefinitionId: 'def-1',
    orderIndex: 1,
    name: 'Bench',
    machineName: null,
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: null,
  },
  exercise_sets: {
    id: 'set-wire',
    sessionExerciseId: 'sx-1',
    orderIndex: 0,
    weightValue: '100',
    repsValue: '8',
    setType: 'rir_2',
    plannedWeightValue: '100',
    plannedRepsValue: '10',
    plannedSetType: 'rir_1',
    performanceStatus: 'planned',
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:30:00.000Z'),
    deletedAt: null,
  },
  session_exercise_tags: {
    id: 'set-tag-wire',
    sessionExerciseId: 'sx-1',
    exerciseTagDefinitionId: 'tag-1',
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    deletedAt: null,
  },
};

const LOCAL_UPDATED_AT = 1733000000123;

describe('entityToWire / wireToEntity round-trip', () => {
  const types = Object.keys(SAMPLE_ROWS) as EntityTableName[];

  it.each(types)('round-trips %s through the wire envelope', (type) => {
    seedParents();
    const table = TABLES[type] as typeof schema.gyms;
    const sample: Record<string, unknown> = {
      ...SAMPLE_ROWS[type],
      localDirty: true,
      localUpdatedAtMs: LOCAL_UPDATED_AT,
    };

    database.insert(table).values(sample as never).run();
    const original = database.select().from(table).where(eq(table.id, sample.id as string)).get() as Record<string, unknown>;

    // Serialise to the wire and confirm the local-only columns are absent and
    // the LWW key is the monotonic timestamp.
    const wire: WireEntity = entityToWire(original, type);
    expect(wire.type).toBe(type);
    expect(wire.id).toBe(sample.id);
    expect(wire.client_updated_at_ms).toBe(LOCAL_UPDATED_AT);
    expect(wire.fields).not.toHaveProperty('local_dirty');
    expect(wire.fields).not.toHaveProperty('local_updated_at_ms');

    // Re-materialise the row from the wire envelope: drop the original and
    // re-insert under the same id so composite-unique indexes don't collide.
    // The reconstructed row lands clean (not dirty).
    database.delete(table).where(eq(table.id, sample.id as string)).run();
    const reconstructed = wireToEntity(wire, type);
    database.insert(table).values(reconstructed as never).run();
    const landed = database.select().from(table).where(eq(table.id, wire.id)).get() as Record<string, unknown>;

    expect(landed.localDirty).toBe(false);
    expect(landed.localUpdatedAtMs).toBe(LOCAL_UPDATED_AT);

    // Every wire field should match the originally-stored value byte for byte
    // after the round-trip (timestamps compared as epoch ms).
    const roundTripWire = entityToWire(landed, type);
    expect(roundTripWire.fields).toEqual(wire.fields);
  });

  it('emits the four gym coordinate columns on the wire', () => {
    seedParents();
    const wire = entityToWire(SAMPLE_ROWS.gyms, 'gyms');
    expect(wire.fields).toMatchObject({
      latitude: 51.5,
      longitude: -0.12,
      coordinate_accuracy_m: 5,
      coordinates_updated_at: SAMPLE_ROWS.gyms.coordinatesUpdatedAt instanceof Date
        ? (SAMPLE_ROWS.gyms.coordinatesUpdatedAt as Date).getTime()
        : null,
    });
  });

  it('serialises a soft-deleted row with a non-null deleted_at', () => {
    const wire = entityToWire(SAMPLE_ROWS.exercise_definitions, 'exercise_definitions');
    expect(typeof wire.fields.deleted_at).toBe('number');
  });

  it('emits the taxonomy columns and a soft-deleted deleted_at for muscle_groups', () => {
    const wire = entityToWire(SAMPLE_ROWS.muscle_groups, 'muscle_groups');
    // The four taxonomy scalars cross the wire; the local-only bookkeeping
    // columns do not. A tombstoned group serialises its deleted_at as epoch ms.
    expect(wire.fields).toMatchObject({
      display_name: 'Quadriceps',
      family_name: 'Legs',
      sort_order: 3,
      is_editable: 1,
    });
    expect(typeof wire.fields.deleted_at).toBe('number');
    expect(wire.fields).not.toHaveProperty('local_dirty');
    expect(wire.fields).not.toHaveProperty('local_updated_at_ms');
  });

  it('reconstructs timestamp columns as Date values and scalars verbatim', () => {
    const wire = entityToWire(SAMPLE_ROWS.sessions, 'sessions');
    const values = wireToEntity({ ...wire, id: 'sess-tx' }, 'sessions');
    expect(values.createdAt).toBeInstanceOf(Date);
    expect(values.deletedAt).toBeNull();
    expect(values.durationSec).toBe(3600);
  });
});
