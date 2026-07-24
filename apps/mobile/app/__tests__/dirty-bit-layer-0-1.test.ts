/**
 * Write-path dirty-bit contract for the Layer 0 / Layer 1 repos — the
 * counterpart to the Layer 2 / 3 coverage in `dirty-bit-layer-2-3.test.ts`.
 * Every repo create / update / softDelete / cascade path that writes a
 * Layer 0/1 entity must, inside the SAME transaction as the row write, set
 * `local_dirty = 1` and `local_updated_at_ms = nowMonotonic(tx)`.
 *
 * Entities covered (one create + update + softDelete assertion group each,
 * plus a cascade assertion where applicable):
 *   - gyms                       (Layer 0) — local-gyms.ts
 *   - exercise_definitions       (Layer 0) — exercise-catalog.ts
 *   - exercise_muscle_mappings   (Layer 1) — exercise-catalog.ts (cascade leg)
 *   - sessions                   (Layer 1) — session-list.ts (soft-delete/restore)
 *   - exercise_tag_definitions   (Layer 1) — exercise-tags.ts (tag-def paths)
 *
 * The seeder dirty-stamp rule (exercise-catalog-seeds.ts) is asserted in
 * the final describe block: seed rows — muscle_groups, exercise_definitions,
 * and exercise_muscle_mappings — land DIRTY (local_dirty = 1) so a fresh
 * account's starter catalog pushes to the server on the next cycle, and the
 * monotonic counter advances so a later user edit out-stamps the seed.
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema applied, built via the shared `helpers/in-memory-db` fixture (see
 * that file for why we drive the schema from the generated migration bundle).
 * `@/src/data/bootstrap` is mocked so the repos' `bootstrapLocalDataLayer()`
 * resolves to this in-memory database.
 */

import { eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests } from '@/src/data/clock';
import {
  createDrizzleExerciseCatalogStore,
  createExerciseCatalogRepository,
} from '@/src/data/exercise-catalog';
import {
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { upsertLocalGym } from '@/src/data/local-gyms';
import * as schema from '@/src/data/schema';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessions,
} from '@/src/data/schema';
import { createDrizzleSessionListStore } from '@/src/data/session-list';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

type TestDatabase = InMemoryTestDatabase;

// The repos under test call `bootstrapLocalDataLayer()` to acquire the
// drizzle handle. The mock factory may only reference variables whose names
// start with `mock`, so the live handle lives on a mock-prefixed holder.
// `jest.mock` is hoisted above the imports by babel-jest, so the repo
// modules above bind to this mock when they first resolve `bootstrap`.
const mockBootstrapState: { database: TestDatabase | null } = { database: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

// `seedSystemExerciseCatalog` is typed against the production
// `ExpoSQLiteDatabase` handle. The better-sqlite3 handle is structurally
// identical at the query-builder level (only the driver `RunResult` generic
// differs), so a single bridging cast keeps the seeder call sites honest
// without leaking `any` into the assertions.
const seedInto = (database: TestDatabase, now: Date): void => {
  seedSystemExerciseCatalog(database as unknown as LocalDatabase, now);
};

let fixture: InMemoryDatabaseFixture;

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockBootstrapState.database = fixture.database;
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

const requireDatabase = (): TestDatabase => {
  if (!mockBootstrapState.database) {
    throw new Error('Test database not initialised');
  }
  return mockBootstrapState.database;
};

describe('gyms write paths flip the dirty bit', () => {
  it('marks the row dirty with a positive timestamp on create', async () => {
    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });

    const row = requireDatabase().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('advances the timestamp and keeps the row dirty on update', async () => {
    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });
    const created = requireDatabase().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();

    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple Annex' });
    const updated = requireDatabase().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();

    expect(updated?.localDirty).toBe(true);
    expect(updated?.localUpdatedAtMs ?? 0).toBeGreaterThan(created?.localUpdatedAtMs ?? 0);
  });
});

describe('exercise_definitions write paths flip the dirty bit', () => {
  const store = createDrizzleExerciseCatalogStore();

  const seedMuscleGroup = () => {
    requireDatabase()
      .insert(muscleGroups)
      .values({ id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 })
      .run();
  };

  it('marks the definition dirty with a positive timestamp on create', async () => {
    seedMuscleGroup();
    const now = new Date('2026-05-29T10:00:00.000Z');

    const saved = await store.saveExercise({
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now,
    });

    const row = requireDatabase()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, saved.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('advances the timestamp and keeps the definition dirty on update', async () => {
    seedMuscleGroup();
    const saved = await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });
    const created = requireDatabase()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, saved.id))
      .get();

    await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press v2',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T11:00:00.000Z'),
    });
    const updated = requireDatabase()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, 'def-1'))
      .get();

    expect(updated?.localDirty).toBe(true);
    expect(updated?.localUpdatedAtMs ?? 0).toBeGreaterThan(created?.localUpdatedAtMs ?? 0);
  });

  it('persists and returns per-side load mode through repository create and edit', async () => {
    seedMuscleGroup();
    const repository = createExerciseCatalogRepository(store);

    const created = await repository.saveExercise({
      id: 'def-per-side',
      name: 'Single-Arm Press',
      loadInputMode: 'per_side_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1 }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    expect(created.loadInputMode).toBe('per_side_load');
    expect(
      requireDatabase()
        .select({ loadInputMode: exerciseDefinitions.loadInputMode })
        .from(exerciseDefinitions)
        .where(eq(exerciseDefinitions.id, created.id))
        .get()?.loadInputMode
    ).toBe('per_side_load');

    const edited = await repository.saveExercise({
      id: created.id,
      name: 'Single-Arm Press (Edited)',
      loadInputMode: 'per_side_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1 }],
      now: new Date('2026-05-29T11:00:00.000Z'),
    });

    expect(edited).toMatchObject({
      id: created.id,
      name: 'Single-Arm Press (Edited)',
      loadInputMode: 'per_side_load',
    });
    expect(
      requireDatabase()
        .select({ loadInputMode: exerciseDefinitions.loadInputMode })
        .from(exerciseDefinitions)
        .where(eq(exerciseDefinitions.id, created.id))
        .get()?.loadInputMode
    ).toBe('per_side_load');
  });

  it('marks the definition dirty and sets deletedAt on soft delete', async () => {
    seedMuscleGroup();
    await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const deletedAt = new Date('2026-05-29T12:00:00.000Z');
    await store.setExerciseDeletedState({ id: 'def-1', deletedAt, now: deletedAt });

    const row = requireDatabase()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, 'def-1'))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
  });
});

describe('exercise_muscle_mappings write paths flip the dirty bit', () => {
  const store = createDrizzleExerciseCatalogStore();

  const seedMuscleGroups = () => {
    requireDatabase()
      .insert(muscleGroups)
      .values([
        { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
        { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
      ])
      .run();
  };

  it('marks re-inserted mapping rows dirty with a positive timestamp', async () => {
    seedMuscleGroups();
    await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const rows = requireDatabase()
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.exerciseDefinitionId, 'def-1'))
      .all();

    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
  });

  it('re-stamps mappings dirty when the exercise is re-saved (cascade leg)', async () => {
    seedMuscleGroups();
    await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });
    const firstRow = requireDatabase()
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.exerciseDefinitionId, 'def-1'))
      .get();

    await store.saveExercise({
      id: 'def-1',
      name: 'Custom Press',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
      now: new Date('2026-05-29T11:00:00.000Z'),
    });

    const rows = requireDatabase()
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.exerciseDefinitionId, 'def-1'))
      .all();

    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(firstRow?.localUpdatedAtMs ?? 0);
    }
  });
});

describe('sessions write paths flip the dirty bit', () => {
  const store = createDrizzleSessionListStore();

  const insertSession = (id: string) => {
    requireDatabase()
      .insert(sessions)
      .values({ id, startedAt: new Date('2026-05-29T08:00:00.000Z') })
      .run();
  };

  it('marks the session dirty and sets deletedAt on soft delete', async () => {
    insertSession('session-1');
    const deletedAt = new Date('2026-05-29T09:00:00.000Z');

    await store.setSessionDeletedState({
      sessionId: 'session-1',
      deletedAt,
      updatedAt: deletedAt,
    });

    const row = requireDatabase().select().from(sessions).where(eq(sessions.id, 'session-1')).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
  });

  it('advances the timestamp and keeps the session dirty on restore (update)', async () => {
    insertSession('session-1');
    await store.setSessionDeletedState({
      sessionId: 'session-1',
      deletedAt: new Date('2026-05-29T09:00:00.000Z'),
      updatedAt: new Date('2026-05-29T09:00:00.000Z'),
    });
    const deleted = requireDatabase()
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'session-1'))
      .get();

    await store.setSessionDeletedState({
      sessionId: 'session-1',
      deletedAt: null,
      updatedAt: new Date('2026-05-29T10:00:00.000Z'),
    });
    const restored = requireDatabase()
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'session-1'))
      .get();

    expect(restored?.deletedAt).toBeNull();
    expect(restored?.localDirty).toBe(true);
    expect(restored?.localUpdatedAtMs ?? 0).toBeGreaterThan(deleted?.localUpdatedAtMs ?? 0);
  });
});

describe('exercise_tag_definitions write paths flip the dirty bit', () => {
  const store = createDrizzleExerciseTagStore();

  const insertExerciseDefinition = (id: string) => {
    requireDatabase()
      .insert(exerciseDefinitions)
      .values({ id, name: 'Bench Press' })
      .run();
  };

  it('marks the tag definition dirty with a positive timestamp on create', async () => {
    insertExerciseDefinition('def-1');

    const created = await store.createTagDefinition({
      exerciseDefinitionId: 'def-1',
      name: 'Heavy',
      normalizedName: 'heavy',
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const row = requireDatabase()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('advances the timestamp and keeps the tag definition dirty on rename (update)', async () => {
    insertExerciseDefinition('def-1');
    const created = await store.createTagDefinition({
      exerciseDefinitionId: 'def-1',
      name: 'Heavy',
      normalizedName: 'heavy',
      now: new Date('2026-05-29T10:00:00.000Z'),
    });
    const createdRow = requireDatabase()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();

    await store.renameTagDefinition({
      id: created.id,
      name: 'Very Heavy',
      normalizedName: 'very heavy',
      now: new Date('2026-05-29T11:00:00.000Z'),
    });
    const renamedRow = requireDatabase()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();

    expect(renamedRow?.localDirty).toBe(true);
    expect(renamedRow?.localUpdatedAtMs ?? 0).toBeGreaterThan(createdRow?.localUpdatedAtMs ?? 0);
  });

  it('marks the tag definition dirty and sets deletedAt on soft delete', async () => {
    insertExerciseDefinition('def-1');
    const created = await store.createTagDefinition({
      exerciseDefinitionId: 'def-1',
      name: 'Heavy',
      normalizedName: 'heavy',
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const deletedAt = new Date('2026-05-29T12:00:00.000Z');
    await store.setTagDefinitionDeletedState({ id: created.id, deletedAt, now: deletedAt });

    const row = requireDatabase()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
  });
});

describe('seeder stamps catalog rows dirty while advancing the clock', () => {
  it('lands muscle_groups, exercise_definitions and exercise_muscle_mappings rows with local_dirty = 1 so a fresh account pushes', () => {
    const database = requireDatabase();
    seedInto(database, new Date('2026-05-29T10:00:00.000Z'));

    const muscleGroupRows = database.select().from(muscleGroups).all();
    const definitionRows = database.select().from(exerciseDefinitions).all();
    const mappingRows = database.select().from(exerciseMuscleMappings).all();

    expect(muscleGroupRows.length).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(muscleGroupRows.length).toBeGreaterThan(0);
    expect(definitionRows.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(definitionRows.length).toBeGreaterThan(0);
    expect(mappingRows.length).toBeGreaterThan(0);

    // muscle_groups is a Layer 0 synced entity seeded through the same generic
    // starter-catalog path as exercise_definitions, so its rows must land dirty
    // too — otherwise the taxonomy never reaches the server for a fresh account.
    for (const row of muscleGroupRows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
    for (const row of definitionRows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
    for (const row of mappingRows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
  });

  it('advances the monotonic clock so a later user edit out-stamps the seed and pushes', async () => {
    const database = requireDatabase();
    seedInto(database, new Date('2026-05-29T10:00:00.000Z'));

    const seededId = SYSTEM_EXERCISE_DEFINITION_SEEDS[0].id;
    const seededRow = database
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, seededId))
      .get();

    // The seed row is already dirty; a later user edit through the real repo
    // store must keep it dirty AND stamp a strictly-higher monotonic timestamp.
    const store = createDrizzleExerciseCatalogStore();
    await store.setExerciseDeletedState({
      id: seededId,
      deletedAt: new Date('2026-05-29T11:00:00.000Z'),
      now: new Date('2026-05-29T11:00:00.000Z'),
    });

    const editedRow = database
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, seededId))
      .get();

    expect(editedRow?.localDirty).toBe(true);
    expect(editedRow?.localUpdatedAtMs ?? 0).toBeGreaterThan(seededRow?.localUpdatedAtMs ?? 0);
  });

  it('stamps the applied-seed marker so re-launches short-circuit', () => {
    const database = requireDatabase();
    seedInto(database, new Date('2026-05-29T10:00:00.000Z'));

    const runtimeRow = database.select().from(schema.syncRuntimeState).all()[0];
    expect(runtimeRow?.appliedSeedMigrationAppVersion).toBe(SEED_CATALOG_BUNDLE_VERSION);
  });
});
