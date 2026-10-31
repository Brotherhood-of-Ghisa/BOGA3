/* eslint-disable import/first */

/**
 * Outcome: weekly muscle targets and the count-secondary default are per
 * account ([[muscle.weekly-targets]], [[muscle.secondary-filter]]), end to end
 * against the live server. Each "device" is an in-memory, fully migrated local
 * database plus its own kv store, and the app restarts on it when the suite
 * switches to it. The cycle, the one-time adoption's direct read of the
 * settings row and the coach's write are all real.
 *
 *   1. Upgrade: two devices hold different local targets and the server holds
 *      none. The first to sync uploads its targets; the second adopts them,
 *      drops its own and pushes nothing over them.
 *   2. A coach sets targets (the service-role `agent_set_muscle_targets`, which
 *      `PUT /v1/agent/muscle-targets` calls; `mcp-smoke` and the agent API
 *      contract prove the MCP tool and the route reach it). Each device shows
 *      them in Today's Plan after its next sync, and a change on one device
 *      reaches the other.
 *
 * Each test resets `user_e`'s server rows first. Runs in the sync-infra lane
 * (`./boga test sync-infra`); the stubbed-server version is
 * `__tests__/sync-muscle-targets.test.ts`.
 */

import { createHash } from 'crypto';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedTestClient,
  createLocalServiceRoleClient,
  readSyncTestEndpoint,
  resetFixtureServerRows,
  SYNC_RPC_SCHEMA,
  USER_E,
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

import { Storage } from 'expo-sqlite/kv-store';

import { getSignedInUserId } from '@/src/auth/session-user';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { CURRENT_APP_VERSION, SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { deriveMuscleReportPreset, listMuscleReportRows } from '@/src/data/muscle-report-settings';
import { muscleGroups, syncRuntimeState } from '@/src/data/schema';
import {
  __resetAccountLocalPreferencesForTests,
  drainAccountLocalSyncedWrites,
  ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState,
  setAccountLocalPreferenceAccount,
  setAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { effectiveMuscleTargetOverrides } from '@/src/preferences/muscle-targets';
import { preferenceKey } from '@/src/preferences/storage';
import { syncedPreferenceFields, syncedTargetsAdoptedKey, type SyncedPreferenceField } from '@/src/preferences/synced';
import '@/src/sync/synced-preferences-store';
import { runSyncCycle } from '@/src/sync/cycle';
import { loadTodayPlan } from '@/src/today-plan';

const config = readSyncTestEndpoint();
const mockedSignedInUserId = jest.mocked(getSignedInUserId);
const LIVE_TIMEOUT_MS = 60_000;

type ServerSettings = {
  weekly_working_set_target: number | null;
  muscle_target_mode: string | null;
  muscle_target_overrides: unknown;
  count_secondary_muscles: boolean | null;
  volume_primary_only: boolean | null;
  client_updated_at_ms: number;
  deleted_at: number | null;
};

/** One device: its local database and its kv store, kept while another device runs. */
type Device = { database: InMemoryTestDatabase; kv: Map<string, string> };

let account: AuthedTestClient;
let profile: `account:${string}`;
let current: Device | null = null;
let runSeq = 0;
const fixtures: InMemoryDatabaseFixture[] = [];

/**
 * A device that has synced this account before, on an app version that kept
 * the targets in kv: the system muscles are seeded and the first sign-in is
 * done, so the cycle's own adoption step is what changes.
 */
const newDevice = (kvTargets: Partial<Record<SyncedPreferenceField, string>> = {}): Device => {
  const fixture = createInMemoryDatabase();
  fixtures.push(fixture);
  const { database } = fixture;
  const now = new Date();
  for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
    database.insert(muscleGroups).values({ ...muscleGroup, createdAt: now, updatedAt: now }).run();
  }
  database.insert(syncRuntimeState).values({
    id: PRIMARY_RUNTIME_STATE_ID,
    appliedSeedMigrationAppVersion: CURRENT_APP_VERSION,
    bootstrapCompletedAt: now,
    accountUserId: account.userId,
  }).run();
  const kv = new Map(Object.entries(kvTargets).map(([field, value]) =>
    [preferenceKey(profile, field as SyncedPreferenceField), value]));
  return { database, kv };
};

/** Puts `device` in hand: its kv store and database, and the app started on it. */
const useDevice = async (device: Device): Promise<void> => {
  mockBootstrapState.database = device.database;
  mockClientState.client = account.client;
  mockedSignedInUserId.mockResolvedValue(account.userId);
  if (current === device) return;
  if (current) {
    current.kv = new Map(Storage.getAllKeysSync().map((key) => [key, Storage.getItemSync(key) ?? '']));
  }
  Storage.clearSync();
  for (const [key, value] of device.kv) Storage.setItemSync(key, value);
  current = device;
  __resetAccountLocalPreferencesForTests();
  setAccountLocalPreferenceAccount(account.userId, true);
  await ensureAccountLocalPreferencesLoaded();
};

const syncOn = async (device: Device): Promise<void> => {
  await useDevice(device);
  await expect(runSyncCycle()).resolves.toBe('converged');
};

const preferences = () => getAccountLocalPreferenceState().values;

/** The device in hand's kv copy of each synced field (null once dropped). */
const kvTargets = () => Object.fromEntries(syncedPreferenceFields.map((field) =>
  [field, Storage.getItemSync(preferenceKey(profile, field))]));

/** Each muscle's target on Today's Plan, read as `useTodayPlan` reads it on the device in hand. */
const todayPlanTargets = async (): Promise<Record<string, number>> => {
  const values = preferences();
  const setup = deriveMuscleReportPreset(await listMuscleReportRows());
  const plan = await loadTodayPlan(new Date(), {
    weeklyTarget: values.weeklyWorkingSetTarget,
    overrides: effectiveMuscleTargetOverrides(values, setup),
    countSecondary: values.progressCountSecondary,
  });
  return Object.fromEntries(plan.muscles.map((muscle) => [muscle.muscleGroupId, muscle.target]));
};

const serverSettings = async (): Promise<ServerSettings | null> => {
  const { data, error } = await createLocalServiceRoleClient(config).schema(SYNC_RPC_SCHEMA)
    .from('user_settings')
    .select('weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,volume_primary_only,client_updated_at_ms,deleted_at')
    .eq('owner_user_id', account.userId)
    .eq('id', 'settings')
    .maybeSingle();
  if (error) throw new Error(`could not read the server settings row: ${error.message}`);
  return data as ServerSettings | null;
};

/** The coach's write, at the revision `get_training_status` would report. */
const coachSetsTargets = async (changes: Record<string, unknown>): Promise<void> => {
  const row = await serverSettings();
  runSeq += 1;
  const { error } = await createLocalServiceRoleClient(config).schema(SYNC_RPC_SCHEMA)
    .rpc('agent_set_muscle_targets', {
      p_owner: account.userId,
      p_client_id: 'muscle-targets-live',
      p_idempotency_key: `muscle-targets-live-${Date.now()}-${runSeq}`,
      p_payload_sha256: createHash('sha256').update(JSON.stringify(changes)).digest('hex'),
      p_expected_revision: row && row.deleted_at === null ? row.client_updated_at_ms : 0,
      // The route derives the scope from the server's muscle rows; the devices
      // hold the same system muscles, so the device's setup is the one it derives.
      p_scope: deriveMuscleReportPreset(await listMuscleReportRows()),
      p_changes: changes,
    }) as { error: { message: string } | null };
  if (error) throw new Error(`the coach's write failed: ${error.message}`);
};

beforeAll(async () => {
  account = await createAuthedTestClient(config, USER_E);
  profile = `account:${account.userId}`;
}, LIVE_TIMEOUT_MS);

afterAll(async () => {
  await account?.teardown();
});

beforeEach(async () => {
  __resetClockForTests();
  current = null;
  await resetFixtureServerRows(config, account.userId);
}, LIVE_TIMEOUT_MS);

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
  mockBootstrapState.database = null;
  mockClientState.client = null;
});

describe('synced muscle targets against a live endpoint', () => {
  it('round-trips independent choices through another device and reinstall, preserving them on target-only writes', async () => {
    const phone = newDevice({ progressCountSecondary: 'true' });
    const tablet = newDevice();
    await syncOn(phone);
    expect(preferences()).toMatchObject({ progressCountSecondary: true, muscleVolumePrimaryOnly: false });
    setAccountLocalPreferences({ muscleVolumePrimaryOnly: true });
    await drainAccountLocalSyncedWrites();
    await syncOn(phone);
    await syncOn(tablet);
    expect(preferences()).toMatchObject({ progressCountSecondary: true, muscleVolumePrimaryOnly: true });
    setAccountLocalPreferences({ progressCountSecondary: false });
    await drainAccountLocalSyncedWrites();
    await syncOn(tablet);
    await syncOn(phone);
    expect(preferences()).toMatchObject({ progressCountSecondary: false, muscleVolumePrimaryOnly: true });
    await coachSetsTargets({ default_weekly_sets: 13 });
    await syncOn(newDevice());
    expect(preferences()).toMatchObject({ weeklyWorkingSetTarget: 13, progressCountSecondary: false,
      muscleVolumePrimaryOnly: true });
    expect(await serverSettings()).toMatchObject({ count_secondary_muscles: false, volume_primary_only: true });
  }, LIVE_TIMEOUT_MS);

  it('upgrades two devices with different local targets: the first to sync uploads, the second adopts', async () => {
    const first = newDevice({
      weeklyWorkingSetTarget: '12',
      muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: JSON.stringify({ detailed: { chest: 15 } }),
      progressCountSecondary: 'false',
    });
    const second = newDevice({ weeklyWorkingSetTarget: '6', progressCountSecondary: 'true' });

    await syncOn(first);
    const uploaded = await serverSettings();
    expect(uploaded).toMatchObject({
      weekly_working_set_target: 12,
      muscle_target_mode: 'per_muscle',
      muscle_target_overrides: { detailed: { chest: 15 } },
      count_secondary_muscles: false,
    });
    expect(kvTargets()).toEqual({
      weeklyWorkingSetTarget: null, muscleTargetMode: null, muscleTargetOverrides: null, progressCountSecondary: null,
      muscleVolumePrimaryOnly: null,
    });

    await syncOn(second);
    expect(preferences()).toMatchObject({
      weeklyWorkingSetTarget: 12,
      muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { detailed: { chest: 15 } },
      progressCountSecondary: false,
    });
    expect(kvTargets()).toEqual({
      weeklyWorkingSetTarget: null, muscleTargetMode: null, muscleTargetOverrides: null, progressCountSecondary: null,
      muscleVolumePrimaryOnly: null,
    });
    expect(Storage.getItemSync(syncedTargetsAdoptedKey(profile))).toBe('true');
    expect(await todayPlanTargets()).toMatchObject({ chest: 15, delts_front: 12 });
    // The second device pushed nothing over the first device's targets.
    expect((await serverSettings())?.client_updated_at_ms).toBe(uploaded?.client_updated_at_ms);
  }, LIVE_TIMEOUT_MS);

  it('shows a coach\'s targets on each device after its next sync, and carries one device\'s change to the other', async () => {
    const phone = newDevice();
    const tablet = newDevice();
    // Neither device held targets: both adopt the account's, of which there are none yet.
    await syncOn(phone);
    await syncOn(tablet);

    await coachSetsTargets({ default_weekly_sets: 10, mode: 'per_muscle', overrides: { chest: 14 } });

    await syncOn(phone);
    expect(preferences()).toMatchObject({ weeklyWorkingSetTarget: 10, muscleTargetMode: 'per-muscle' });
    expect(await todayPlanTargets()).toMatchObject({ chest: 14, delts_front: 10 });

    setAccountLocalPreferences({ weeklyWorkingSetTarget: 7 });
    await drainAccountLocalSyncedWrites();
    await syncOn(phone);
    expect(await serverSettings()).toMatchObject({
      weekly_working_set_target: 7, muscle_target_mode: 'per_muscle', muscle_target_overrides: { detailed: { chest: 14 } },
    });

    await syncOn(tablet);
    expect(preferences()).toMatchObject({ weeklyWorkingSetTarget: 7, muscleTargetMode: 'per-muscle' });
    expect(await todayPlanTargets()).toMatchObject({ chest: 14, delts_front: 7 });
  }, LIVE_TIMEOUT_MS);
});
