/* eslint-disable import/first */

/**
 * Launch outcome — logging in on a FRESH SECOND DEVICE, with remote data already
 * present, restores all of the user's exercises / sessions / sets / gyms / tags
 * within one minute of foreground.
 *
 * This is the launch contract's cross-device recovery guarantee, asserted end to
 * end against a REAL Postgres + PostgREST + RLS endpoint. It differs from the
 * same-device reinstall case in that the restoring store was NEVER the store that
 * wrote the data: device A pushes the data and is then set aside; a completely
 * independent device B (its own local store, its own first-sync flag, its own
 * cursors — never primed by A) signs in to the same remote account and runs the
 * production first-sign-in bootstrapper. Because the first full pull returns the
 * other device's rows, the starter-catalog seeder no-ops and device B restores
 * the account's data exactly, within the foreground window.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`); the shared live-branch
 * helper FAILS HARD when either is unset. Each run wipes the test user's server
 * rows first and uses a unique id prefix, so repeated or parallel runs against
 * the shared fixture user never collide.
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

// The cycle resolves its database and Supabase client through these two
// dependencies; pointing the database holder at a given in-memory store is how
// the test swaps "which device" the cycle/bootstrapper is acting as.
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

const config = readLiveBranchConfig();

const RESTORE_WINDOW_MS = 60_000;

const RUN = `second-device-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

// `muscle_groups` is a client-only taxonomy seeded into every store on launch
// (it never crosses the wire); seeding it on both devices keeps the muscle-
// mapping's local FK resolvable on the writer and the restorer alike.
const MUSCLE_GROUP_ID = 'chest';

describe('a fresh second device restores the account within the foreground window', () => {
  // Device A is the one that writes the data; device B is the fresh device that
  // restores it. They are entirely separate stores.
  let deviceA: InMemoryDatabaseFixture;
  let deviceB: InMemoryDatabaseFixture;
  let authed: AuthedBranchClient;

  /** Inserts the full FK-correct chain (one row per family) into device A. */
  const seedFullChainOnDeviceA = (): void => {
    const db = deviceA.database;
    const ms = Date.now();
    db.insert(gyms).values({ id: ids.gym, name: 'Cross-Device Gym', localDirty: true, localUpdatedAtMs: ms + 1 }).run();
    db.insert(exerciseDefinitions)
      .values({ id: ids.exerciseDef, name: 'Cross-Device Squat', localDirty: true, localUpdatedAtMs: ms + 2 })
      .run();
    db.insert(exerciseTagDefinitions)
      .values({
        id: ids.tagDef,
        exerciseDefinitionId: ids.exerciseDef,
        name: 'Compound',
        normalizedName: 'compound',
        localDirty: true,
        localUpdatedAtMs: ms + 3,
      })
      .run();
    db.insert(exerciseMuscleMappings)
      .values({
        id: ids.muscleMapping,
        exerciseDefinitionId: ids.exerciseDef,
        muscleGroupId: MUSCLE_GROUP_ID,
        weight: 1,
        localDirty: true,
        localUpdatedAtMs: ms + 4,
      })
      .run();
    db.insert(sessions)
      .values({
        id: ids.session,
        gymId: ids.gym,
        status: 'active',
        startedAt: new Date(ms),
        localDirty: true,
        localUpdatedAtMs: ms + 5,
      })
      .run();
    db.insert(sessionExercises)
      .values({
        id: ids.sessionExercise,
        sessionId: ids.session,
        exerciseDefinitionId: ids.exerciseDef,
        orderIndex: 0,
        name: 'Cross-Device Squat',
        localDirty: true,
        localUpdatedAtMs: ms + 6,
      })
      .run();
    db.insert(exerciseSets)
      .values({
        id: ids.exerciseSet,
        sessionExerciseId: ids.sessionExercise,
        orderIndex: 0,
        weightValue: '315',
        repsValue: '3',
        localDirty: true,
        localUpdatedAtMs: ms + 7,
      })
      .run();
    db.insert(sessionExerciseTags)
      .values({
        id: ids.sessionExerciseTag,
        sessionExerciseId: ids.sessionExercise,
        exerciseTagDefinitionId: ids.tagDef,
        localDirty: true,
        localUpdatedAtMs: ms + 8,
      })
      .run();
  };

  const deviceBFlagSet = (): boolean => {
    const row = deviceB.database
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
    deviceA = createInMemoryDatabase();
    deviceB = createInMemoryDatabase();
    // Both devices seed the client-only muscle-group taxonomy on launch, exactly
    // as the boot data layer does, so the muscle-mapping's local FK resolves on
    // the writer (device A) and the restorer (device B) alike.
    seedMuscleGroups(deviceA.database as unknown as LocalDatabase);
    seedMuscleGroups(deviceB.database as unknown as LocalDatabase);
    mockClientState.client = authed.client;
    await authed.client.schema(SYNC_RPC_SCHEMA).rpc('dev_wipe_my_data');
  }, 30_000);

  afterEach(() => {
    deviceA?.close();
    deviceB?.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('restores every entity family onto a never-before-seen device, seeder no-oping, inside one minute', async () => {
    // Device A pushes the full chain to the server.
    mockBootstrapState.database = deviceA.database;
    seedFullChainOnDeviceA();
    await runSyncCycle();

    // Device B is fresh: nothing local, no first-sync flag, a zero seed marker.
    // Point the cycle's database at it and run the production restore path,
    // timing it.
    mockBootstrapState.database = deviceB.database;
    expect(deviceB.database.select().from(gyms).all()).toHaveLength(0);
    expect(deviceBFlagSet()).toBe(false);
    expect(readSeedsAppliedMarker(deviceB.database as unknown as LocalDatabase)).toBe(0);

    // The in-memory fixture and the production expo-sqlite handle share the
    // drizzle API the bootstrapper uses; the cast bridges the driver types.
    const startedAt = Date.now();
    await runBootstrapper(deviceB.database as unknown as LocalDatabase);
    const elapsedMs = Date.now() - startedAt;

    const db = deviceB.database;
    expect(db.select().from(gyms).where(eq(gyms.id, ids.gym)).get()?.name).toBe('Cross-Device Gym');
    expect(db.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, ids.exerciseDef)).get()?.name).toBe(
      'Cross-Device Squat',
    );
    expect(
      db.select().from(exerciseTagDefinitions).where(eq(exerciseTagDefinitions.id, ids.tagDef)).get()?.normalizedName,
    ).toBe('compound');
    expect(
      db.select().from(exerciseMuscleMappings).where(eq(exerciseMuscleMappings.id, ids.muscleMapping)).get()
        ?.muscleGroupId,
    ).toBe(MUSCLE_GROUP_ID);
    expect(db.select().from(sessions).where(eq(sessions.id, ids.session)).get()?.gymId).toBe(ids.gym);
    expect(
      db.select().from(sessionExercises).where(eq(sessionExercises.id, ids.sessionExercise)).get()?.sessionId,
    ).toBe(ids.session);
    expect(db.select().from(exerciseSets).where(eq(exerciseSets.id, ids.exerciseSet)).get()?.sessionExerciseId).toBe(
      ids.sessionExercise,
    );
    expect(
      db.select().from(sessionExerciseTags).where(eq(sessionExerciseTags.id, ids.sessionExerciseTag)).get()
        ?.exerciseTagDefinitionId,
    ).toBe(ids.tagDef);

    // First sync drained; device B restored the account's own exercise
    // definition from the server.
    expect(deviceBFlagSet()).toBe(true);
    const definitionRows = db.select({ id: exerciseDefinitions.id }).from(exerciseDefinitions).all();
    expect(definitionRows.map((row) => row.id)).toContain(ids.exerciseDef);

    // Device B's seeder did NOT fire: a non-empty pull means the catalog seeder
    // no-ops, so device B's seed marker stays at its fresh-install zero — it
    // would have advanced to the bundle version had the seeder run.
    expect(readSeedsAppliedMarker(deviceB.database as unknown as LocalDatabase)).toBe(0);

    expect(elapsedMs).toBeLessThan(RESTORE_WINDOW_MS);
  }, 90_000);
});
