/**
 * Synced weekly muscle targets and count-secondary ([[muscle.weekly-targets]],
 * [[muscle.secondary-filter]]) through the whole sync cycle, with a stubbed
 * server:
 *
 *  - upload once: the first device to sync while the server holds no targets
 *    pushes its kv values; a device that finds server targets adopts them; both
 *    drop their kv copy, and neither repeats the check;
 *  - a pulled settings row refreshes the in-memory preferences at once;
 *  - a pull that omits the keys or carries null keeps the local values.
 */

import { eq } from 'drizzle-orm';
import { Storage } from 'expo-sqlite/kv-store';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import { CURRENT_APP_VERSION } from '@/src/data/exercise-catalog-seeds';
import { syncRuntimeState, userSettings } from '@/src/data/schema';
import { writeBodyweightCalculationsEnabled } from '@/src/data/user-settings';
import {
  ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState,
  drainAccountLocalSyncedWrites,
  setAccountLocalPreferenceAccount,
  setAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { muscleWeeklyTarget } from '@/src/preferences/muscle-targets';
import { preferenceKey } from '@/src/preferences/storage';
import '@/src/sync/synced-preferences-store';
import { syncedTargetsAdoptedKey, syncedMuscleVolumeAdoptedKey } from '@/src/preferences/synced';
import { wipeLocalForAccountSwitch } from '@/src/sync/account-wipe';
import { applyPullPage, entityToWire, runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import { createInMemoryDatabase, type InMemoryDatabaseFixture, type InMemoryTestDatabase } from './helpers/in-memory-db';

const OWNER = 'user-a';
const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockRpc = jest.fn();
const mockSelectSettings = jest.fn();
const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) throw new Error('Test database not initialised');
    return mockBootstrapState.database;
  }),
}));

// The cycle's RPCs, plus the one direct read of the server's settings row.
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => {
    const thenable = (run: () => Promise<unknown>) => {
      const result = run();
      return Object.assign(result, { setHeader: () => result, abortSignal: () => result });
    };
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' }, access_token: 'fixture' } } }) },
      schema: () => ({
        rpc: (name: string, args?: unknown) => thenable(() => mockRpc(name, args)),
        from: (table: string) => ({
          select: (columns: string) => ({
            eq: (column: string, value: string) => ({
              maybeSingle: () => thenable(() => mockSelectSettings({ table, columns, column, value })),
            }),
          }),
        }),
      }),
    };
  }),
}));

jest.mock('@/src/auth/session-user', () => ({ getSignedInUserId: async () => 'user-a' }));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;
let pushed: WireEntity[];
let pullPage: WireEntity[];

const profile = `account:${OWNER}` as const;
const values = () => getAccountLocalPreferenceState().values;
const kv = (field: Parameters<typeof preferenceKey>[1]) => Storage.getItemSync(preferenceKey(profile, field));
const settingsRow = () => database.select().from(userSettings).where(eq(userSettings.id, 'settings')).get();
const serverRow = (row: Record<string, unknown> | null) =>
  mockSelectSettings.mockResolvedValue({ data: row, error: null });

// The server row as a direct read returns it (jsonb overrides), and as the sync
// wire carries it (JSON text).
const A_TARGETS = {
  weekly_working_set_target: 11,
  muscle_target_mode: 'per_muscle',
  muscle_target_overrides: { detailed: { chest: 14 } },
  count_secondary_muscles: false,
  volume_primary_only: false,
};
const A_WIRE = { ...A_TARGETS, muscle_target_overrides: JSON.stringify(A_TARGETS.muscle_target_overrides) };

const settingsWire = (ms: number, fields: Record<string, unknown>): WireEntity => ({
  type: 'user_settings',
  id: 'settings',
  client_updated_at_ms: ms,
  fields: { bodyweight_calculations_enabled: false, created_at: ms, updated_at: ms, deleted_at: null, ...fields } as WireEntity['fields'],
});

const storeKvTargets = () => {
  Storage.setItemSync(preferenceKey(profile, 'weeklyWorkingSetTarget'), '6');
  Storage.setItemSync(preferenceKey(profile, 'muscleTargetMode'), 'per-muscle');
  Storage.setItemSync(preferenceKey(profile, 'muscleTargetOverrides'), JSON.stringify({ broad: { back: 9 } }));
};

beforeEach(async () => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  database.insert(syncRuntimeState).values({
    id: PRIMARY_RUNTIME_STATE_ID,
    appliedSeedMigrationAppVersion: CURRENT_APP_VERSION,
    bootstrapCompletedAt: new Date(1_700_000_000_000),
    accountUserId: OWNER,
  }).run();
  mockBootstrapState.database = database;
  pushed = [];
  pullPage = [];
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (name: string, args: { entities?: WireEntity[]; layer?: number }) => {
    if (name === 'sync_pull') {
      const entities = args.layer === 0 ? pullPage : [];
      pullPage = [];
      return { data: { entities, next_cursor: null, has_more: false }, error: null };
    }
    if (name === 'sync_push') {
      pushed.push(...(args.entities ?? []));
      return { data: { ok: true, server_received_at: '2026-10-28T10:00:00.000Z' }, error: null };
    }
    return { data: null, error: null };
  });
  mockSelectSettings.mockReset();
  serverRow(null);
  mockLogEvent.mockClear();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
});

const signIn = async () => {
  setAccountLocalPreferenceAccount(OWNER, true);
  await ensureAccountLocalPreferencesLoaded();
};

describe('upload once', () => {
  it('keeps fresh direct Sets after a bodyweight insert pushes through a failed adoption read and retries', async () => {
    await signIn();
    expect(values().progressCountSecondary).toBe(false);
    await writeBodyweightCalculationsEnabled(true);
    mockSelectSettings.mockResolvedValueOnce({ data: null, error: { message: 'temporary settings read failure' } });
    await runSyncCycle();
    const first = pushed.find(entity => entity.type === 'user_settings')!;
    expect(first.fields).toMatchObject({ bodyweight_calculations_enabled: true,
      count_secondary_muscles: false, volume_primary_only: null });
    expect(Storage.getItemSync(syncedMuscleVolumeAdoptedKey(profile))).toBeNull();
    serverRow({ weekly_working_set_target: null, muscle_target_mode: null, muscle_target_overrides: null,
      count_secondary_muscles: first.fields.count_secondary_muscles, volume_primary_only: null,
      client_updated_at_ms: first.client_updated_at_ms });
    await runSyncCycle();
    expect(values()).toMatchObject({ progressCountSecondary: false, muscleVolumePrimaryOnly: false });
    expect(settingsRow()).toMatchObject({ countSecondaryMuscles: false, volumePrimaryOnly: false,
      bodyweightCalculationsEnabled: true });
    expect(Storage.getItemSync(syncedMuscleVolumeAdoptedKey(profile))).toBe('true');
  });

  it('uploads the first device\'s kv targets when the server holds none, then drops the kv copy', async () => {
    storeKvTargets();
    Storage.setItemSync(preferenceKey(profile, 'progressCountSecondary'), 'false');
    await signIn();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 6, muscleTargetMode: 'per-muscle' });

    await expect(runSyncCycle()).resolves.toBe('converged');

    const upload = pushed.filter(entity => entity.type === 'user_settings');
    expect(upload).toHaveLength(1);
    expect(upload[0].fields).toMatchObject({
      weekly_working_set_target: 6,
      muscle_target_mode: 'per_muscle',
      muscle_target_overrides: JSON.stringify({ broad: { back: 9 } }),
      count_secondary_muscles: false,
    });
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
    expect(kv('muscleTargetOverrides')).toBeNull();
    expect(kv('progressCountSecondary')).toBeNull();
    expect(Storage.getItemSync(syncedTargetsAdoptedKey(profile))).toBe('true');
    // The values now come from the row and are unchanged.
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 6, muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { broad: { back: 9 } }, progressCountSecondary: false });

    // Checked once per account: a later cycle never asks again.
    await runSyncCycle();
    expect(mockSelectSettings).toHaveBeenCalledTimes(1);
  });

  it('fills a target the first device never stored with its default', async () => {
    Storage.setItemSync(preferenceKey(profile, 'weeklyWorkingSetTarget'), '10');
    await signIn();
    await runSyncCycle();
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      weekly_working_set_target: 10, muscle_target_mode: 'single', muscle_target_overrides: '{}',
      count_secondary_muscles: true,
    });
  });

  it('uploads the largest target the app accepts unchanged', async () => {
    Storage.setItemSync(preferenceKey(profile, 'weeklyWorkingSetTarget'), String(Number.MAX_SAFE_INTEGER));
    await signIn();
    await runSyncCycle();
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields.weekly_working_set_target)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it('uploads the independent new-account defaults even before a target edit', async () => {
    await signIn();
    await runSyncCycle();
    expect(pushed.filter(entity => entity.type === 'user_settings')).toHaveLength(1);
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      count_secondary_muscles: false, volume_primary_only: false, weekly_working_set_target: 8,
    });
    expect(Storage.getItemSync(syncedTargetsAdoptedKey(profile))).toBe('true');
  });

  it('adopts the server targets a second device finds in a pulled row and drops its own kv copy', async () => {
    storeKvTargets();
    await signIn();
    pullPage = [settingsWire(500, A_WIRE)];
    serverRow(A_TARGETS);

    await runSyncCycle();

    expect(pushed.filter(entity => entity.type === 'user_settings')).toEqual([]);
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
    expect(kv('muscleTargetMode')).toBeNull();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { detailed: { chest: 14 } }, progressCountSecondary: false });
    expect(muscleWeeklyTarget(values(), 'detailed', 'chest')).toBe(14);
  });

  it('adopts server targets an older app pulled without the columns, without pushing over them', async () => {
    // The older app stored the row at the server's stamp with no target columns,
    // so a re-pull would not replace it; only the direct read finds the targets.
    database.insert(userSettings).values({ id: 'settings', localDirty: false, localUpdatedAtMs: 500 }).run();
    storeKvTargets();
    await signIn();
    serverRow(A_TARGETS);

    await runSyncCycle();

    expect(pushed.filter(entity => entity.type === 'user_settings')).toEqual([]);
    expect(settingsRow()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle',
      countSecondaryMuscles: false, localDirty: false, localUpdatedAtMs: 500 });
    expect(JSON.parse(settingsRow()!.muscleTargetOverrides!)).toEqual({ detailed: { chest: 14 } });
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, progressCountSecondary: false });
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
  });

  it('replaces an edit made before the first sync with the server targets, never pushing it', async () => {
    storeKvTargets();
    await signIn();
    setAccountLocalPreferences({ weeklyWorkingSetTarget: 7 });
    // Until sync adopts or uploads, an edit stays this device's own kv value.
    expect(kv('weeklyWorkingSetTarget')).toBe('7');
    expect(settingsRow()).toBeUndefined();
    serverRow(A_TARGETS);
    pullPage = [settingsWire(500, A_WIRE)];

    await runSyncCycle();

    expect(pushed.filter(entity => entity.type === 'user_settings')).toEqual([]);
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'per-muscle' });
    // After adoption an edit goes to the settings row and pushes.
    setAccountLocalPreferences({ weeklyWorkingSetTarget: 13 });
    await runSyncCycle();
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      weekly_working_set_target: 13, muscle_target_mode: 'per_muscle',
    });
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
  });

  it('after a sign-out wipe, an edit before the restore pull cannot push defaults over the account targets', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    await signIn();
    pullPage = [settingsWire(500, A_WIRE)];
    await runSyncCycle();
    expect(values().weeklyWorkingSetTarget).toBe(11);

    await wipeLocalForAccountSwitch();
    expect(Storage.getItemSync(syncedTargetsAdoptedKey(profile))).toBeNull();
    await signIn();
    setAccountLocalPreferences({ weeklyWorkingSetTarget: 7 });
    expect(settingsRow()).toBeUndefined();
    pushed = [];
    serverRow(A_TARGETS);
    pullPage = [settingsWire(500, A_WIRE)];

    await runSyncCycle();

    expect(pushed.filter(entity => entity.type === 'user_settings')).toEqual([]);
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetOverrides: { detailed: { chest: 14 } } });
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
  });

  it('keeps the kv copy and retries next cycle when the server row cannot be read', async () => {
    storeKvTargets();
    await signIn();
    mockSelectSettings.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });

    await expect(runSyncCycle()).resolves.toBe('converged');
    expect(pushed.filter(entity => entity.type === 'user_settings')).toEqual([]);
    expect(kv('weeklyWorkingSetTarget')).toBe('6');
    expect(Storage.getItemSync(syncedTargetsAdoptedKey(profile))).toBeNull();
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'sync.muscle_targets_adoption_failed' }));

    await runSyncCycle();
    expect(pushed.filter(entity => entity.type === 'user_settings')).toHaveLength(1);
    expect(kv('weeklyWorkingSetTarget')).toBeNull();
  });
});

describe('pulled settings', () => {
  it('waits for full-row pull before completing newer incomplete settings without reverting bodyweight', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    database.insert(userSettings).values({ id: 'settings', weeklyWorkingSetTarget: 8, muscleTargetMode: 'single',
      muscleTargetOverrides: '{}', countSecondaryMuscles: true, volumePrimaryOnly: null,
      bodyweightCalculationsEnabled: false, localDirty: false, localUpdatedAtMs: 500 }).run();
    serverRow({ ...A_TARGETS, weekly_working_set_target: 12, volume_primary_only: null, client_updated_at_ms: 700 });
    await signIn();
    await runSyncCycle();
    expect(pushed).toEqual([]);
    expect(settingsRow()).toMatchObject({ bodyweightCalculationsEnabled: false, localDirty: false, localUpdatedAtMs: 500 });
    expect(Storage.getItemSync(syncedMuscleVolumeAdoptedKey(profile))).toBeNull();

    pullPage = [settingsWire(700, { ...A_WIRE, weekly_working_set_target: 12,
      volume_primary_only: null, bodyweight_calculations_enabled: true })];
    await runSyncCycle();
    expect(pushed.filter(entity => entity.type === 'user_settings')).toHaveLength(1);
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      weekly_working_set_target: 12, volume_primary_only: false, bodyweight_calculations_enabled: true,
    });
    expect(settingsRow()).toMatchObject({ weeklyWorkingSetTarget: 12, volumePrimaryOnly: false,
      bodyweightCalculationsEnabled: true, localDirty: false });
    expect(Storage.getItemSync(syncedMuscleVolumeAdoptedKey(profile))).toBe('true');
  });

  it('adopts a newer direct server read instead of re-stamping a clean stale pull over it', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    database.insert(userSettings).values({ id: 'settings', weeklyWorkingSetTarget: 8, muscleTargetMode: 'single',
      muscleTargetOverrides: '{}', countSecondaryMuscles: true, volumePrimaryOnly: null,
      localDirty: false, localUpdatedAtMs: 500 }).run();
    serverRow({ ...A_TARGETS, weekly_working_set_target: 12, volume_primary_only: true, client_updated_at_ms: 700 });
    await signIn();
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, progressCountSecondary: false,
      muscleVolumePrimaryOnly: true });
    expect(settingsRow()).toMatchObject({ weeklyWorkingSetTarget: 12, volumePrimaryOnly: true, localDirty: false });
    expect(pushed).toEqual([]);
  });

  it('keeps unknown Volume null during a pre-adoption Sets edit, then discovers the other device choice', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    database.insert(userSettings).values({ id: 'settings', weeklyWorkingSetTarget: 11, muscleTargetMode: 'single',
      muscleTargetOverrides: '{}', countSecondaryMuscles: true, volumePrimaryOnly: null,
      localDirty: false, localUpdatedAtMs: 500 }).run();
    serverRow({ ...A_TARGETS, muscle_target_mode: 'single', muscle_target_overrides: {},
      volume_primary_only: true, client_updated_at_ms: 700 });
    await signIn();
    setAccountLocalPreferences({ progressCountSecondary: false });
    await drainAccountLocalSyncedWrites();
    expect(settingsRow()).toMatchObject({ countSecondaryMuscles: false, volumePrimaryOnly: null });
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, progressCountSecondary: false,
      muscleVolumePrimaryOnly: true });
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      count_secondary_muscles: false, volume_primary_only: true,
    });
  });

  it('adopts the known legacy implicit Sets default on a fresh device without inventing a Volume restriction', async () => {
    serverRow({ ...A_TARGETS, count_secondary_muscles: null, volume_primary_only: null, client_updated_at_ms: 500 });
    pullPage = [settingsWire(500, { ...A_WIRE, count_secondary_muscles: null, volume_primary_only: null })];
    await signIn();
    await runSyncCycle();
    expect(values()).toMatchObject({ progressCountSecondary: true, muscleVolumePrimaryOnly: false });
  });

  it('preserves an explicit new Volume edit when the legacy server has not stored that choice yet', async () => {
    storeKvTargets();
    Storage.setItemSync(preferenceKey(profile, 'progressCountSecondary'), 'false');
    await signIn();
    setAccountLocalPreferences({ muscleVolumePrimaryOnly: true });
    const legacy = { ...A_TARGETS, volume_primary_only: null };
    pullPage = [settingsWire(500, { ...A_WIRE, volume_primary_only: null })];
    serverRow(legacy);
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, progressCountSecondary: false,
      muscleVolumePrimaryOnly: true });
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({ volume_primary_only: true });
  });

  it.each([null, false])('keeps unuploaded KV targets beside a bodyweight-only row with stored Sets %j', async storedSets => {
    storeKvTargets();
    Storage.setItemSync(preferenceKey(profile, 'weeklyWorkingSetTarget'), '12');
    Storage.setItemSync(preferenceKey(profile, 'progressCountSecondary'), 'false');
    database.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true,
      countSecondaryMuscles: storedSets, volumePrimaryOnly: false,
      localDirty: false, localUpdatedAtMs: 500 }).run();
    const bodyweightOnly = { weekly_working_set_target: null, muscle_target_mode: null, muscle_target_overrides: null,
      count_secondary_muscles: storedSets, volume_primary_only: false };
    pullPage = [settingsWire(500, { ...bodyweightOnly, bodyweight_calculations_enabled: true })];
    serverRow(bodyweightOnly);
    await signIn();
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { broad: { back: 9 } }, progressCountSecondary: false, muscleVolumePrimaryOnly: false });
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      weekly_working_set_target: 12, muscle_target_mode: 'per_muscle',
      muscle_target_overrides: '{"broad":{"back":9}}', count_secondary_muscles: false, volume_primary_only: false,
      bodyweight_calculations_enabled: true,
    });
  });

  it('keeps offline target edits when an upgrade projects Volume at the original server edit clock', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    database.insert(userSettings).values({ id: 'settings', weeklyWorkingSetTarget: 12, muscleTargetMode: 'per_muscle',
      muscleTargetOverrides: '{"broad":{"back":17}}', countSecondaryMuscles: null,
      localDirty: true, localUpdatedAtMs: 500 }).run();
    serverRow({ ...A_TARGETS, count_secondary_muscles: null });
    // A schema/default upgrade must not advance the edit clock past offline edits.
    pullPage = [settingsWire(100, { ...A_WIRE, count_secondary_muscles: null })];
    await signIn();
    await runSyncCycle();
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      weekly_working_set_target: 12, muscle_target_mode: 'per_muscle',
      muscle_target_overrides: '{"broad":{"back":17}}', count_secondary_muscles: true, volume_primary_only: false,
    });
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, muscleTargetOverrides: { broad: { back: 17 } },
      progressCountSecondary: true, muscleVolumePrimaryOnly: false });
  });

  it.each([true, false])('upgrades an already-adopted legacy Sets choice %s without coupling Volume', async legacy => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    database.insert(userSettings).values({ id: 'settings', weeklyWorkingSetTarget: 11, muscleTargetMode: 'single',
      muscleTargetOverrides: '{}', countSecondaryMuscles: legacy, localUpdatedAtMs: 500 }).run();
    serverRow({ ...A_TARGETS, muscle_target_mode: 'single', muscle_target_overrides: {}, count_secondary_muscles: legacy,
      volume_primary_only: null });
    await signIn();
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, progressCountSecondary: legacy,
      muscleVolumePrimaryOnly: false });
    expect(settingsRow()).toMatchObject({ countSecondaryMuscles: legacy, volumePrimaryOnly: false });
    expect(pushed.find(entity => entity.type === 'user_settings')?.fields).toMatchObject({
      count_secondary_muscles: legacy, volume_primary_only: false, weekly_working_set_target: 11,
    });
    await runSyncCycle();
    expect(mockSelectSettings).toHaveBeenCalledTimes(1);
  });

  it('adopts an explicit server Volume choice instead of resetting it during legacy migration', async () => {
    Storage.setItemSync(preferenceKey(profile, 'progressCountSecondary'), 'true');
    await signIn();
    pullPage = [settingsWire(500, { ...A_WIRE, volume_primary_only: true })];
    serverRow({ ...A_TARGETS, volume_primary_only: true });
    await runSyncCycle();
    expect(values()).toMatchObject({ progressCountSecondary: false, muscleVolumePrimaryOnly: true });
    expect(pushed).toEqual([]);
    expect(kv('muscleVolumePrimaryOnly')).toBeNull();
    const legacyFields: Record<string, unknown> = { ...A_WIRE };
    delete legacyFields.volume_primary_only;
    database.transaction(tx => applyPullPage(tx as Transaction,
      [settingsWire(600, legacyFields)], 'user_settings'));
    expect(settingsRow()?.volumePrimaryOnly).toBe(true);
    database.transaction(tx => applyPullPage(tx as Transaction,
      [settingsWire(700, { ...A_WIRE, volume_primary_only: null })], 'user_settings'));
    expect(settingsRow()?.volumePrimaryOnly).toBe(true);
  });

  it('refreshes the in-memory targets and count-secondary as soon as a pull changes them', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    Storage.setItemSync(syncedMuscleVolumeAdoptedKey(profile), 'true');
    await signIn();
    expect(muscleWeeklyTarget(values(), 'detailed', 'chest')).toBe(8);

    pullPage = [settingsWire(700, A_WIRE)];
    await runSyncCycle();
    expect(muscleWeeklyTarget(values(), 'detailed', 'chest')).toBe(14);
    expect(values().progressCountSecondary).toBe(false);

    // A pull that leaves the map unchanged keeps its object, so nothing republishes
    // for it, even when the server's jsonb text orders the keys differently.
    pullPage = [settingsWire(720, { ...A_WIRE,
      muscle_target_overrides: JSON.stringify({ detailed: { chest: 14, back: 9 }, broad: { quads: 8 } }) })];
    await runSyncCycle();
    const overrides = values().muscleTargetOverrides;
    pullPage = [settingsWire(750, { ...A_WIRE, bodyweight_calculations_enabled: true,
      muscle_target_overrides: JSON.stringify({ broad: { quads: 8 }, detailed: { back: 9, chest: 14 } }) })];
    await runSyncCycle();
    expect(values().muscleTargetOverrides).toBe(overrides);

    pullPage = [settingsWire(800, { ...A_WIRE, weekly_working_set_target: 12, muscle_target_mode: 'single',
      count_secondary_muscles: true })];
    await runSyncCycle();
    expect(muscleWeeklyTarget(values(), 'detailed', 'chest')).toBe(12);
    expect(values().progressCountSecondary).toBe(true);
  });

  it('ignores invalid server values and falls back to the kv value or default', async () => {
    Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
    Storage.setItemSync(syncedMuscleVolumeAdoptedKey(profile), 'true');
    Storage.setItemSync(preferenceKey(profile, 'weeklyWorkingSetTarget'), '9');
    await signIn();
    pullPage = [settingsWire(700, { weekly_working_set_target: 0, muscle_target_mode: 'sometimes',
      muscle_target_overrides: JSON.stringify({ detailed: { chest: -1 } }), count_secondary_muscles: null })];
    await runSyncCycle();
    expect(values()).toMatchObject({ weeklyWorkingSetTarget: 9, muscleTargetMode: 'single',
      muscleTargetOverrides: {}, progressCountSecondary: true });
  });

  it('keeps local targets when a pull omits the keys or carries null', () => {
    database.insert(userSettings).values({
      id: 'settings', weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle',
      muscleTargetOverrides: '{"broad":{"back":9}}', countSecondaryMuscles: false, localUpdatedAtMs: 100,
    }).run();
    database.transaction(tx => applyPullPage(tx as Transaction, [settingsWire(200, {})], 'user_settings'));
    expect(settingsRow()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle',
      muscleTargetOverrides: '{"broad":{"back":9}}', countSecondaryMuscles: false, localUpdatedAtMs: 200 });
    database.transaction(tx => applyPullPage(tx as Transaction, [settingsWire(300, {
      weekly_working_set_target: null, muscle_target_mode: null, muscle_target_overrides: null,
      count_secondary_muscles: null, bodyweight_calculations_enabled: true })], 'user_settings'));
    expect(settingsRow()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle',
      countSecondaryMuscles: false, bodyweightCalculationsEnabled: true, localUpdatedAtMs: 300 });
    // The row still serializes the four keys for push.
    expect(entityToWire(settingsRow() as never, 'user_settings').fields).toMatchObject({
      weekly_working_set_target: 11, muscle_target_mode: 'per_muscle',
      muscle_target_overrides: '{"broad":{"back":9}}', count_secondary_muscles: false,
    });
  });
});
