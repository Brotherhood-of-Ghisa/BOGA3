/* eslint-disable import/first */

/**
 * Outcome: an UPDATE to an already-synced row, and a SOFT-DELETE, both
 * round-trip through real server-side last-write-wins and are reflected on a
 * fresh boot (a wiped client that re-pulls).
 *
 * The existing live-endpoint round-trip (`cycle-round-trip.test.ts`) only covers
 * CREATE → push → reinstall re-pull. It never edits a row that is already on the
 * server, nor deletes one. Those are distinct server paths: an UPDATE exercises
 * the LWW UPSERT's `excluded.client_updated_at_ms > stored` overwrite branch on
 * an existing row, and a soft-delete writes `deleted_at` through that same branch
 * so the tombstone (not a hard delete) is what re-pulls. This suite runs the REAL
 * cycle against a REAL Postgres + PostgREST + RLS endpoint, authenticated as the
 * local `user_a` fixture.
 *
 * Like `cycle-round-trip`, it does NOT wipe the fixture user's server rows
 * between cases; isolation comes from a unique row id per `it`, so repeated runs
 * never collide. Each fixture DB is stood up fully migrated with the
 * `muscle_groups` taxonomy seeded, so any accumulated `exercise_muscle_mappings`
 * row a pull hands back never violates its FK into `muscle_groups`.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedTestClient,
  readSyncTestEndpoint,
  type AuthedTestClient,
} from './helpers/sync-test-endpoint';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () => ({
  ...(jest.requireActual('@/src/data/bootstrap') as typeof import('@/src/data/bootstrap')),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  ...(require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
}));

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { exerciseDefinitions, gyms, muscleGroups } from '@/src/data/schema';
import { runSyncCycle } from '@/src/sync/cycle';
import { listExerciseCatalogExercises } from '@/src/data/exercise-catalog';

const config = readSyncTestEndpoint();

let seq = 0;
const uniqueId = (prefix: string): string => {
  seq += 1;
  return `usd-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${seq}-${prefix}`;
};

describe('update + soft-delete round-trip against a live endpoint', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let authed: AuthedTestClient;

  const seedFixtureDatabase = (): void => {
    const now = new Date();
    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      database
        .insert(muscleGroups)
        .values({ ...muscleGroup, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: muscleGroups.id })
        .run();
    }
  };

  // Wipe local state to model a fresh boot / reinstall: a new empty store that
  // must re-pull everything from the server.
  const wipeLocalStore = (): void => {
    fixture.close();
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedFixtureDatabase();
  };

  beforeAll(async () => {
    authed = await createAuthedTestClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedFixtureDatabase();
    mockClientState.client = authed.client;
  });

  afterEach(() => {
    fixture?.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('updates an already-synced row and a fresh boot re-pulls the new value', async () => {
    const gymId = uniqueId('gym');
    const ms = Date.now();

    // Create + push the row, then confirm it is on the server (clean locally).
    database
      .insert(gyms)
      .values({ id: gymId, name: 'Original Name', localDirty: true, localUpdatedAtMs: ms })
      .run();
    await runSyncCycle();
    expect(database.select().from(gyms).where(eq(gyms.id, gymId)).get()?.localDirty).toBe(false);

    // Edit the already-synced row (strictly newer) and push the update.
    database
      .update(gyms)
      .set({ name: 'Renamed', localDirty: true, localUpdatedAtMs: ms + 1000 })
      .where(eq(gyms.id, gymId))
      .run();
    await runSyncCycle();
    expect(database.select().from(gyms).where(eq(gyms.id, gymId)).get()?.localDirty).toBe(false);

    // Fresh boot: a wiped client re-pulls, and must see the UPDATED value —
    // proving the server-side LWW overwrote the existing row, not just inserted.
    wipeLocalStore();
    await runSyncCycle();
    const repulled = database.select().from(gyms).where(eq(gyms.id, gymId)).get();
    expect(repulled?.name).toBe('Renamed');
    expect(repulled?.localDirty).toBe(false);
  }, 60_000);

  it('soft-deletes a synced row; a fresh boot re-pulls the tombstone, hidden from reads', async () => {
    const defId = uniqueId('def');
    const ms = Date.now();

    // Create + push a live exercise definition.
    database
      .insert(exerciseDefinitions)
      .values({ id: defId, name: 'Roundtrip Squat', localDirty: true, localUpdatedAtMs: ms })
      .run();
    await runSyncCycle();
    expect(
      database.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, defId)).get()
        ?.localDirty,
    ).toBe(false);

    // Soft-delete it (strictly newer) and push the tombstone.
    database
      .update(exerciseDefinitions)
      .set({ deletedAt: new Date(ms + 1000), localDirty: true, localUpdatedAtMs: ms + 1000 })
      .where(eq(exerciseDefinitions.id, defId))
      .run();
    await runSyncCycle();

    // Fresh boot: re-pull. The row comes back as a tombstone (deleted_at set),
    // not a hard delete, and the catalog read filters it out — while
    // includeDeleted still surfaces it.
    wipeLocalStore();
    await runSyncCycle();

    const repulled = database
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, defId))
      .get();
    expect(repulled).toBeDefined();
    expect(repulled?.deletedAt).not.toBeNull();

    const visible = await listExerciseCatalogExercises();
    expect(visible.some((exercise) => exercise.id === defId)).toBe(false);

    const all = await listExerciseCatalogExercises({ includeDeleted: true });
    const found = all.find((exercise) => exercise.id === defId);
    expect(found).toBeDefined();
    expect(found?.deletedAt).not.toBeNull();
  }, 60_000);
});
