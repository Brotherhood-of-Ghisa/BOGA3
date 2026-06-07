/* eslint-disable import/first */

/**
 * Outcome: signing out (or switching to a different account on the same device)
 * clears the previous account's local data so it can neither leak into nor
 * suppress the bootstrap of the next account — and it does so LOCALLY, never
 * issuing a server delete, so the server's copy survives for a later sign-in to
 * restore.
 *
 * The wipe must, on the singleton runtime-state row:
 *   - clear all rows from the nine syncable entity tables (muscle_groups
 *     included — it is now a synced entity, recovered for the next account via
 *     the generic first-sign-in pull);
 *   - reset bootstrap_completed_at → null;
 *   - reset pull_cursor → {};
 *   - reset applied_seed_migration_app_version → 0;
 *   - PRESERVE last_emitted_ms (the monotonic clock is device-global).
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle via
 * the shared fixture, with `bootstrapLocalDataLayer` mocked to return it so the
 * wipe runs end to end against a real schema. Foreign keys are left OFF so the
 * fixture can seed one minimal row per table independently of FK parentage —
 * the wipe's job is to clear rows, not to honour referential structure.
 *
 * A second mock confirms the wipe never resolves the Supabase client, which is
 * the structural guarantee that no network call (and therefore no server
 * delete) can be issued from this path.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import {
  createBootstrapMockState,
  createClientMockState,
} from './helpers/sync-cycle-mocks';

type TestDatabase = InMemoryTestDatabase;

// Repos / the wipe resolve their DB handle through `bootstrapLocalDataLayer`;
// point it at the per-test in-memory database. The mock factory may only close
// over `mock`-prefixed names (babel-jest hoists it above the imports below).
const mockBootstrapState = createBootstrapMockState<TestDatabase>();
const mockClientState = createClientMockState();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Guard rail: if the wipe ever reached for the Supabase client, this factory
// would record the call (and the test asserts it never happens). The wipe is
// local only.
jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

// Imported AFTER the mocks so the module under test binds to them.
import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExerciseTags,
  sessionExercises,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { wipeLocalForAccountSwitch } from '@/src/sync/account-wipe';

// The nine syncable, per-user entity tables the wipe must clear, paired with a
// label for readable assertions.
const ENTITY_TABLES = [
  ['muscle_groups', muscleGroups],
  ['gyms', gyms],
  ['exercise_definitions', exerciseDefinitions],
  ['exercise_muscle_mappings', exerciseMuscleMappings],
  ['exercise_tag_definitions', exerciseTagDefinitions],
  ['sessions', sessions],
  ['session_exercises', sessionExercises],
  ['exercise_sets', exerciseSets],
  ['session_exercise_tags', sessionExerciseTags],
] as const;

let fixture: InMemoryDatabaseFixture;

const db = (): TestDatabase => fixture.database;

const PRESERVED_LAST_EMITTED_MS = 1_700_000_555_000;

/** Inserts one minimal row into each of the nine syncable entity tables. */
const seedEveryEntityTable = (): void => {
  db()
    .insert(muscleGroups)
    .values({ id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 })
    .run();
  db().insert(gyms).values({ id: 'gym-1', name: 'Iron Temple' }).run();
  db().insert(exerciseDefinitions).values({ id: 'def-1', name: 'Bench Press' }).run();
  db()
    .insert(exerciseMuscleMappings)
    .values({ id: 'map-1', exerciseDefinitionId: 'def-1', muscleGroupId: 'chest', weight: 1 })
    .run();
  db()
    .insert(exerciseTagDefinitions)
    .values({
      id: 'tag-1',
      exerciseDefinitionId: 'def-1',
      name: 'Warmup',
      normalizedName: 'warmup',
    })
    .run();
  db()
    .insert(sessions)
    .values({ id: 'session-1', status: 'active', startedAt: new Date('2026-05-30T10:00:00.000Z') })
    .run();
  db()
    .insert(sessionExercises)
    .values({ id: 'sx-1', sessionId: 'session-1', orderIndex: 0, name: 'Bench Press' })
    .run();
  db()
    .insert(exerciseSets)
    .values({ id: 'set-1', sessionExerciseId: 'sx-1', orderIndex: 0 })
    .run();
  db()
    .insert(sessionExerciseTags)
    .values({ id: 'sxt-1', sessionExerciseId: 'sx-1', exerciseTagDefinitionId: 'tag-1' })
    .run();
};

/**
 * Writes the singleton runtime-state row with every field populated to a value
 * the wipe is expected to either reset or preserve, so each assertion proves an
 * actual change rather than a coincidental default.
 */
const seedRuntimeStateRow = (): void => {
  db()
    .insert(syncRuntimeState)
    .values({
      id: PRIMARY_RUNTIME_STATE_ID,
      pullCursor: { '0': { server_received_at: 's', owner_user_id: 'u', type: 'gyms', id: 'g' } } as never,
      lastEmittedMs: PRESERVED_LAST_EMITTED_MS,
      bootstrapCompletedAt: new Date('2026-05-31T12:00:00.000Z'),
      appliedSeedMigrationAppVersion: 7,
    })
    .run();
};

const readRuntimeStateRow = () =>
  db().select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get();

const countRows = (table: (typeof ENTITY_TABLES)[number][1]): number =>
  db().select().from(table).all().length;

describe('sign-out / account-switch local wipe', () => {
  beforeEach(() => {
    // FK enforcement OFF: the fixture seeds one independent row per table; the
    // wipe clears rows, it does not depend on referential structure.
    fixture = createInMemoryDatabase();
    mockBootstrapState.database = fixture.database;
    mockClientState.client = { rpc: jest.fn() };
    (getRequiredSupabaseMobileClient as jest.Mock).mockClear();
    seedEveryEntityTable();
    seedRuntimeStateRow();
  });

  afterEach(() => {
    fixture.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('clears every one of the nine syncable entity tables', async () => {
    for (const [label, table] of ENTITY_TABLES) {
      expect([label, countRows(table)]).toEqual([label, 1]);
    }

    await wipeLocalForAccountSwitch();

    for (const [label, table] of ENTITY_TABLES) {
      expect([label, countRows(table)]).toEqual([label, 0]);
    }
  });

  it('resets the four runtime-state fields per the wipe checklist', async () => {
    await wipeLocalForAccountSwitch();

    const row = readRuntimeStateRow();
    expect(row?.bootstrapCompletedAt).toBeNull();
    expect(row?.pullCursor).toEqual({});
    expect(row?.appliedSeedMigrationAppVersion).toBe(0);
  });

  it('preserves last_emitted_ms (the device-global monotonic counter)', async () => {
    await wipeLocalForAccountSwitch();

    expect(readRuntimeStateRow()?.lastEmittedMs).toBe(PRESERVED_LAST_EMITTED_MS);
  });

  it('clears the muscle_groups taxonomy (a synced entity, recovered via the next sign-in pull)', async () => {
    expect(db().select().from(muscleGroups).all()).toHaveLength(1);

    await wipeLocalForAccountSwitch();

    expect(db().select().from(muscleGroups).all()).toHaveLength(0);
  });

  it('issues no server call (and therefore no server delete)', async () => {
    await wipeLocalForAccountSwitch();

    // The wipe never resolves the authenticated Supabase client, so no RPC —
    // including the dev-only server wipe — can be dispatched from this path.
    expect(getRequiredSupabaseMobileClient as jest.Mock).not.toHaveBeenCalled();
    expect((mockClientState.client as { rpc: jest.Mock } | null)?.rpc).not.toHaveBeenCalled();
  });

  it('leaves the singleton runtime-state row in place rather than deleting it', async () => {
    await wipeLocalForAccountSwitch();

    expect(db().select().from(syncRuntimeState).all()).toHaveLength(1);
  });
});
