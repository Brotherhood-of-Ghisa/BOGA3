/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { Storage } from 'expo-sqlite/kv-store';
import { stampLocalDataOwner } from '@/src/data/local-wipe';
import * as userSettingsData from '@/src/data/user-settings';
import '@/src/sync/synced-preferences-store';
import { __resetAccountLocalPreferencesForTests, drainAccountLocalSyncedWrites, ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState, retryAccountLocalPreferences, setAccountLocalPreferenceAccount,
  setAccountLocalPreferences } from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue } from '@/src/preferences/model';
import { effectiveMuscleTargetOverrides, muscleWeeklyTarget, withMuscleTarget } from '@/src/preferences/muscle-targets';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import { preferenceKey } from '@/src/preferences/storage';
import { syncedTargetsAdoptedKey } from '@/src/preferences/synced';
import { closeLocalData, localDataClient, localDatabase, resetLocalData } from './helpers/local-data';

const account = async (id: string | null = 'A') => {
  setAccountLocalPreferenceAccount(id, true);
  await ensureAccountLocalPreferencesLoaded();
};
const values = () => getAccountLocalPreferenceState().values;
beforeEach(() => {
  resetLocalData();
  // A synced store belongs to one account; another account never reads its settings row.
  stampLocalDataOwner(localDatabase(), 'A');
  // Sync has adopted or uploaded A's targets, so they live on the settings row.
  Storage.setItemSync(syncedTargetsAdoptedKey('account:A'), 'true');
});
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

it('reads the kv target until the settings row holds one, and restores the row after restart', async () => {
  Storage.setItemSync(preferenceKey('account:A', 'weeklyWorkingSetTarget'), '11');
  await account();
  expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'single', muscleTargetOverrides: {} });
  const overrides = { chest: 12, 'disabled-custom': 7, cm_back: 18, neck: 5 };
  setAccountLocalPreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: overrides });
  await drainAccountLocalSyncedWrites();
  // The fields move together into the single map; the legacy map and unknown Volume stay null.
  expect(await userSettingsData.readMuscleTargetSettings('A')).toEqual({
    weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle', muscleTargetOverrides: null,
    muscleTargets: JSON.stringify(overrides), countSecondaryMuscles: true, volumePrimaryOnly: null,
  });
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values().muscleTargetOverrides).toEqual(overrides);
  expect(muscleWeeklyTarget(values(), 'chest')).toBe(12);
  expect(muscleWeeklyTarget(values(), 'cm_back')).toBe(18);
  expect(muscleWeeklyTarget(values(), 'neck')).toBe(5);
  await account('B');
  expect(values().muscleTargetOverrides).toEqual({});
  expect(values().muscleTargetMode).toBe('single');
  await account(null);
  expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account('A');
  expect(values().muscleTargetOverrides).toEqual(overrides);
});

const stored = { weeklyWorkingSetTarget: 12, muscleTargetMode: 'per_muscle', muscleTargets: '{"cm_chest":16}',
  countSecondaryMuscles: true, volumePrimaryOnly: false };

it('keeps the stored targets when a synced field changes before the settings row has loaded', async () => {
  await userSettingsData.writeMuscleTargetSettings(stored);
  // No await: the edit lands while the row is still being read.
  setAccountLocalPreferenceAccount('A', true);
  setAccountLocalPreferences({ progressCountSecondary: false });
  await drainAccountLocalSyncedWrites();
  expect(await userSettingsData.readMuscleTargetSettings('A')).toEqual({ ...stored, muscleTargetOverrides: null,
    countSecondaryMuscles: false });
  expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, muscleTargetMode: 'per-muscle',
    muscleTargetOverrides: { cm_chest: 16 }, progressCountSecondary: false });
});

it('saves each counting choice independently without changing targets or the other choice', async () => {
  await userSettingsData.writeMuscleTargetSettings(stored);
  await account();
  setAccountLocalPreferences({ muscleVolumePrimaryOnly: true });
  await drainAccountLocalSyncedWrites();
  expect(await userSettingsData.readMuscleTargetSettings('A')).toEqual({ ...stored, muscleTargetOverrides: null,
    volumePrimaryOnly: true });
  setAccountLocalPreferences({ progressCountSecondary: false });
  await drainAccountLocalSyncedWrites();
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, progressCountSecondary: false,
    muscleVolumePrimaryOnly: true, muscleTargetOverrides: { cm_chest: 16 } });
});

it('leaves a row with no target map unwritten until a target is edited, keeping legacy targets for their migration', async () => {
  localDataClient().prepare(`INSERT INTO user_settings (id, weekly_working_set_target, muscle_target_mode,
    muscle_target_overrides, count_secondary_muscles, volume_primary_only) VALUES ('settings', 10, 'per_muscle', ?, 1, 0)`)
    .run('{"detailed":{"chest":12}}');
  await account();
  expect(values().muscleTargetOverrides).toEqual({});
  setAccountLocalPreferences({ weeklyWorkingSetTarget: 9 });
  await drainAccountLocalSyncedWrites();
  expect(await userSettingsData.readMuscleTargetSettings('A')).toMatchObject({
    weeklyWorkingSetTarget: 9, muscleTargets: null, muscleTargetOverrides: '{"detailed":{"chest":12}}' });
  setAccountLocalPreferences({ muscleTargetOverrides: { chest: 14 } });
  await drainAccountLocalSyncedWrites();
  expect(await userSettingsData.readMuscleTargetSettings('A')).toMatchObject({ muscleTargets: '{"chest":14}' });
});

it('inherits the live default, ignores overrides in Single, and resets only one muscle', () => {
  const overrides = { chest: 12, hidden: 6, cm_chest: 16 };
  const preferences = { ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, muscleTargetMode: 'per-muscle' as const, muscleTargetOverrides: overrides };
  expect(muscleWeeklyTarget(preferences, 'calves')).toBe(8);
  expect(muscleWeeklyTarget({ ...preferences, weeklyWorkingSetTarget: 9 }, 'calves')).toBe(9);
  expect(muscleWeeklyTarget({ ...preferences, muscleTargetMode: 'single' }, 'cm_chest')).toBe(8);
  expect(effectiveMuscleTargetOverrides({ ...preferences, muscleTargetMode: 'single' })).toEqual({});
  expect(effectiveMuscleTargetOverrides(preferences)).toBe(overrides);
  const reset = withMuscleTarget(overrides, 'chest', undefined);
  expect(reset).toEqual({ hidden: 6, cm_chest: 16 });
  expect(overrides.chest).toBe(12);
  expect(withMuscleTarget(reset, 'new-muscle', 3)).toEqual({ hidden: 6, cm_chest: 16, 'new-muscle': 3 });
  expect(muscleWeeklyTarget(preferences, 'toString')).toBe(8);
  const special = withMuscleTarget({}, '__proto__', 4);
  expect(muscleWeeklyTarget({ ...preferences, muscleTargetOverrides: special }, '__proto__')).toBe(4);
});

it.each([null, [], 3, { chest: {} }, { chest: null }, { chest: 0 }, { chest: -1 }, { chest: 1.5 }, { chest: Infinity },
  { chest: Number.MAX_SAFE_INTEGER + 1 }, { '': 3 }, { ' ': 3 }, { chest: '8' }, { detailed: { chest: 8 } }])(
  'rejects malformed target maps %j without changing stored choices', async invalid => {
    await account();
    expect(isPreferenceValue('muscleTargetOverrides', invalid)).toBe(false);
    setAccountLocalPreferences({ muscleTargetOverrides: invalid as never });
    expect(values().muscleTargetOverrides).toEqual({});
    expect(getAccountLocalPreferenceState().error).toMatch(/positive whole numbers/);
  });

it('falls back from corrupt storage and retries failed map writes without leaking pending edits to another account', async () => {
  Storage.setItemSync(preferenceKey('account:A', 'muscleTargetOverrides'), '{broken');
  Storage.setItemSync(preferenceKey('account:A', 'muscleTargetMode'), 'unknown');
  await account();
  expect(values().muscleTargetOverrides).toEqual({});
  expect(values().muscleTargetMode).toBe('single');
  const write = jest.spyOn(userSettingsData, 'writeMuscleTargetSettings').mockRejectedValueOnce(Error('full'));
  setAccountLocalPreferences({ muscleTargetOverrides: { chest: 12 } });
  await drainAccountLocalSyncedWrites();
  expect(values().muscleTargetOverrides).toEqual({});
  expect(getAccountLocalPreferenceState().pending.muscleTargetOverrides).toEqual({ chest: 12 });
  expect(getAccountLocalPreferenceState().error).toMatch(/could not be saved/);
  write.mockRestore();
  await retryAccountLocalPreferences();
  await drainAccountLocalSyncedWrites();
  expect(values().muscleTargetOverrides).toEqual({ chest: 12 });
  expect(getAccountLocalPreferenceState().pending).toEqual({});
  expect(getAccountLocalPreferenceState().error).toBeNull();
  await account('B');
  expect(values().muscleTargetOverrides).toEqual({});
});

it('caps each muscle against its own target before averaging, with missing muscles at zero', () => {
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 12, calves: 4 }, 8, 1, { chest: 12 })).toBe(.75);
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 100 }, 8, 1, { chest: 12 })).toBe(.5);
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 12, calves: 4 }, 8, 2, { chest: 12 })).toBe(.375);
});
