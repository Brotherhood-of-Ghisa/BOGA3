/* eslint-disable import/first */

/**
 * Launch outcome — reinstalling on the SAME device, then logging in, restores
 * every exercise / session / set / gym / tag within one minute of foreground.
 *
 * This is the launch contract's same-device recovery guarantee, asserted end to
 * end against a REAL Postgres + PostgREST + RLS endpoint (not a stubbed RPC).
 * It proves the production first-sign-in restore path, not a unit of it:
 *
 *   1. A signed-in user populates the server with a full, FK-correct chain that
 *      spans all eight syncable entity families (gym, exercise definition, tag
 *      definition, muscle mapping, session, session exercise, set, session-
 *      exercise tag). The real sync cycle pushes that chain so the server holds
 *      it under the test user.
 *   2. The local store is dropped wholesale, standing in for a reinstall: the
 *      first-sync flag, the cursors, and every local row are gone.
 *   3. The PRODUCTION first-sign-in bootstrapper runs against the populated
 *      server. Because the first full pull returns rows, the starter-catalog
 *      seeder no-ops (the server is authoritative for a returning user), and the
 *      bootstrapper restores the user's own data and stamps the first-sync flag.
 *   4. Every family is present locally again, and the whole restore completes
 *      well within the one-minute foreground window.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`); the shared live-branch
 * helper FAILS HARD when either is unset, so this suite never passes without
 * actually exercising the endpoint. Each run wipes the test user's server rows
 * first (a dev helper) and uses a unique id prefix, so repeated or parallel runs
 * against the shared fixture user never collide.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedBranchClient,
  readLiveBranchConfig,
  SYNC_RPC_SCHEMA,
  type AuthedBranchClient,
} from './helpers/live-branch';

// Local + server handles live on mock-prefixed holders so the hoisted jest.mock
// factories can close over them (the factory bodies come from the shared
// sync-cycle mock helper, required from inside the hoisted factory — the only
// hoist-safe way to reference a non-`mock` import).
const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { readSeedsAppliedMarker, seedMuscleGroups } from '@/src/data/exercise-catalog-seeds';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExercises,
  sessionExerciseTags,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { runBootstrapper } from '@/src/sync/bootstrapper';
import { runSyncCycle } from '@/src/sync/cycle';

// Fails the suite here when the endpoint env is missing; these suites run only
// when a live endpoint has been provisioned.
const config = readLiveBranchConfig();

// The one-minute foreground window the launch contract promises a restore lands
// within.
const RESTORE_WINDOW_MS = 60_000;

// Distinct id prefix per run so repeated / parallel runs against the shared
// fixture user never collide on a primary key.
const RUN = `reinstall-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ids = {
  gym: `${RUN}-gym`,
  exerciseDef: `${RUN}-exdef`,
  tagDef: `${RUN}-tagdef`,
  muscleMapping: `${RUN}-mm`,
  session: `${RUN}-session`,
  sessionExercise: `${RUN}-sx`,
  exerciseSet: `${RUN}-set`,
  sessionExerciseTag: `${RUN}-sxtag`,
};

// A muscle-group id the mapping points at. `muscle_groups` is a client-only
// taxonomy that never crosses the wire: in production it is seeded into the
// local store on every launch (so the mapping's local FK always resolves) and
// the mapping itself round-trips through the server. The tests seed the
// taxonomy on each store the same way the boot data layer does.
const MUSCLE_GROUP_ID = 'chest';

describe('same-device reinstall restores every entity family within the foreground window', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let authed: AuthedBranchClient;

  /** Seeds the client-only muscle-group taxonomy into the current store, as the
   *  production boot data layer does on every launch — so the muscle-mapping's
   *  local FK resolves both when it is created and when it is restored. */
  const seedClientTaxonomy = (): void => {
    seedMuscleGroups(database as unknown as LocalDatabase);
  };

  /** Inserts one dirty row in every syncable family, FK-correct across layers. */
  const seedFullDirtyChain = (): void => {
    const ms = Date.now();
    database
      .insert(gyms)
      .values({ id: ids.gym, name: 'Restore Gym', localDirty: true, localUpdatedAtMs: ms + 1 })
      .run();
    database
      .insert(exerciseDefinitions)
      .values({
        id: ids.exerciseDef,
        name: 'Restore Bench Press',
        localDirty: true,
        localUpdatedAtMs: ms + 2,
      })
      .run();
    database
      .insert(exerciseTagDefinitions)
      .values({
        id: ids.tagDef,
        exerciseDefinitionId: ids.exerciseDef,
        name: 'Heavy',
        normalizedName: 'heavy',
        localDirty: true,
        localUpdatedAtMs: ms + 3,
      })
      .run();
    database
      .insert(exerciseMuscleMappings)
      .values({
        id: ids.muscleMapping,
        exerciseDefinitionId: ids.exerciseDef,
        muscleGroupId: MUSCLE_GROUP_ID,
        weight: 1,
        localDirty: true,
        localUpdatedAtMs: ms + 4,
      })
      .run();
    database
      .insert(sessions)
      .values({
        id: ids.session,
        gymId: ids.gym,
        status: 'active',
        startedAt: new Date(ms),
        localDirty: true,
        localUpdatedAtMs: ms + 5,
      })
      .run();
    database
      .insert(sessionExercises)
      .values({
        id: ids.sessionExercise,
        sessionId: ids.session,
        exerciseDefinitionId: ids.exerciseDef,
        orderIndex: 0,
        name: 'Restore Bench Press',
        localDirty: true,
        localUpdatedAtMs: ms + 6,
      })
      .run();
    database
      .insert(exerciseSets)
      .values({
        id: ids.exerciseSet,
        sessionExerciseId: ids.sessionExercise,
        orderIndex: 0,
        weightValue: '225',
        repsValue: '5',
        localDirty: true,
        localUpdatedAtMs: ms + 7,
      })
      .run();
    database
      .insert(sessionExerciseTags)
      .values({
        id: ids.sessionExerciseTag,
        sessionExerciseId: ids.sessionExercise,
        exerciseTagDefinitionId: ids.tagDef,
        localDirty: true,
        localUpdatedAtMs: ms + 8,
      })
      .run();
  };

  /** Re-create a fresh, empty local store — the reinstall: every local row, the
   *  first-sync flag, and the cursors are gone. The client-only muscle-group
   *  taxonomy is re-seeded, exactly as the boot data layer does post-reinstall. */
  const reinstallLocalStore = (): void => {
    fixture.close();
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedClientTaxonomy();
  };

  /** True once `bootstrap_completed_at` has been stamped on the runtime row. */
  const bootstrapFlagSet = (): boolean => {
    const row = database
      .select({ at: syncRuntimeState.bootstrapCompletedAt })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    return row?.at != null;
  };

  beforeAll(async () => {
    authed = await createAuthedBranchClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(async () => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    mockClientState.client = authed.client;
    seedClientTaxonomy();

    // Start each run from an empty server slate (the fixture user persists).
    await authed.client.schema(SYNC_RPC_SCHEMA).rpc('dev_wipe_my_data');
  }, 30_000);

  afterEach(() => {
    fixture?.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('restores all eight entity families after a reinstall, with the seeder no-oping, inside one minute', async () => {
    // Populate the server with the full chain via the real cycle.
    seedFullDirtyChain();
    await runSyncCycle();

    // Reinstall: drop the entire local store. The fresh store has a zero seed
    // marker — if the restore-side seeder ran, it would advance to the bundle
    // version, so the marker is the proof the seeder did or did not fire.
    reinstallLocalStore();
    expect(database.select().from(gyms).all()).toHaveLength(0);
    expect(bootstrapFlagSet()).toBe(false);
    expect(readSeedsAppliedMarker(database as unknown as LocalDatabase)).toBe(0);

    // Run the production first-sign-in restore path and time it. The in-memory
    // fixture and the production expo-sqlite handle share the drizzle API the
    // bootstrapper uses; the cast bridges the two driver-specific types.
    const startedAt = Date.now();
    await runBootstrapper(database as unknown as LocalDatabase);
    const elapsedMs = Date.now() - startedAt;

    // Every family came back from the server.
    expect(database.select().from(gyms).where(eq(gyms.id, ids.gym)).get()?.name).toBe('Restore Gym');
    expect(
      database.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, ids.exerciseDef)).get()?.name,
    ).toBe('Restore Bench Press');
    expect(
      database.select().from(exerciseTagDefinitions).where(eq(exerciseTagDefinitions.id, ids.tagDef)).get()
        ?.normalizedName,
    ).toBe('heavy');
    expect(
      database.select().from(exerciseMuscleMappings).where(eq(exerciseMuscleMappings.id, ids.muscleMapping)).get()
        ?.muscleGroupId,
    ).toBe(MUSCLE_GROUP_ID);
    expect(database.select().from(sessions).where(eq(sessions.id, ids.session)).get()?.gymId).toBe(ids.gym);
    expect(
      database.select().from(sessionExercises).where(eq(sessionExercises.id, ids.sessionExercise)).get()?.sessionId,
    ).toBe(ids.session);
    expect(
      database.select().from(exerciseSets).where(eq(exerciseSets.id, ids.exerciseSet)).get()?.sessionExerciseId,
    ).toBe(ids.sessionExercise);
    expect(
      database.select().from(sessionExerciseTags).where(eq(sessionExerciseTags.id, ids.sessionExerciseTag)).get()
        ?.exerciseTagDefinitionId,
    ).toBe(ids.tagDef);

    // The bootstrapper marked the first sync as drained, restoring the user's
    // own exercise definition from the server.
    expect(bootstrapFlagSet()).toBe(true);
    const definitionRows = database.select({ id: exerciseDefinitions.id }).from(exerciseDefinitions).all();
    expect(definitionRows.map((row) => row.id)).toContain(ids.exerciseDef);

    // The restore-side seeder did NOT fire: a non-empty pull means the catalog
    // seeder no-ops (the server is authoritative for a returning user), so the
    // exercise-catalog seed marker stays at its fresh-install zero — it would
    // have advanced to the bundle version had the seeder run.
    expect(readSeedsAppliedMarker(database as unknown as LocalDatabase)).toBe(0);

    // The whole restore landed within the one-minute foreground window.
    expect(elapsedMs).toBeLessThan(RESTORE_WINDOW_MS);
  }, 90_000);
});
