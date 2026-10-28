/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { Storage } from 'expo-sqlite/kv-store';
import { stampLocalDataOwner } from '@/src/data/local-wipe';
import * as userSettingsData from '@/src/data/user-settings';
import '@/src/preferences/synced-store';
import { __resetAccountLocalPreferencesForTests, drainAccountLocalSyncedWrites, ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState, retryAccountLocalPreferences, setAccountLocalPreferenceAccount,
  setAccountLocalPreferences } from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue } from '@/src/preferences/model';
import { effectiveMuscleTargetOverrides, muscleWeeklyTarget, withMuscleTarget } from '@/src/preferences/muscle-targets';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import { preferenceKey } from '@/src/preferences/storage';
import { syncedTargetsAdoptedKey } from '@/src/preferences/synced';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

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
  const overrides = { detailed: { chest: 12, 'disabled-custom': 7 }, broad: { chest: 18 }, custom: { neck: 5 } };
  setAccountLocalPreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: overrides });
  await drainAccountLocalSyncedWrites();
  // The edit writes all four synced values together, the kv target included.
  expect(await userSettingsData.readMuscleTargetSettings('A')).toEqual({
    weeklyWorkingSetTarget: 11, muscleTargetMode: 'per_muscle', muscleTargetOverrides: JSON.stringify(overrides),
    countSecondaryMuscles: true,
  });
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values().muscleTargetOverrides).toEqual(overrides);
  expect(muscleWeeklyTarget(values(), 'detailed', 'chest')).toBe(12);
  expect(muscleWeeklyTarget(values(), 'broad', 'chest')).toBe(18);
  expect(muscleWeeklyTarget(values(), 'custom', 'neck')).toBe(5);
  await account('B');
  expect(values().muscleTargetOverrides).toEqual({});
  expect(values().muscleTargetMode).toBe('single');
  await account(null);
  expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account('A');
  expect(values().muscleTargetOverrides).toEqual(overrides);
});

it('keeps the stored targets when a synced field changes before the settings row has loaded', async () => {
  await userSettingsData.writeMuscleTargetSettings({ weeklyWorkingSetTarget: 12, muscleTargetMode: 'per_muscle',
    muscleTargetOverrides: '{"broad":{"chest":16}}', countSecondaryMuscles: true });
  // No await: the edit lands while the row is still being read.
  setAccountLocalPreferenceAccount('A', true);
  setAccountLocalPreferences({ progressCountSecondary: false });
  await drainAccountLocalSyncedWrites();
  expect(await userSettingsData.readMuscleTargetSettings('A')).toEqual({ weeklyWorkingSetTarget: 12,
    muscleTargetMode: 'per_muscle', muscleTargetOverrides: '{"broad":{"chest":16}}', countSecondaryMuscles: false });
  expect(values()).toMatchObject({ weeklyWorkingSetTarget: 12, muscleTargetMode: 'per-muscle',
    muscleTargetOverrides: { broad: { chest: 16 } }, progressCountSecondary: false });
});

it('inherits the live default, ignores overrides in Single, and resets only one muscle', () => {
  const overrides = { detailed: { chest: 12, hidden: 6 }, broad: { chest: 16 } };
  const preferences = { ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, muscleTargetMode: 'per-muscle' as const, muscleTargetOverrides: overrides };
  expect(muscleWeeklyTarget(preferences, 'detailed', 'calves')).toBe(8);
  expect(muscleWeeklyTarget({ ...preferences, weeklyWorkingSetTarget: 9 }, 'detailed', 'calves')).toBe(9);
  expect(muscleWeeklyTarget({ ...preferences, muscleTargetMode: 'single' }, 'broad', 'chest')).toBe(8);
  expect(effectiveMuscleTargetOverrides({ ...preferences, muscleTargetMode: 'single' }, 'detailed')).toEqual({});
  const reset = withMuscleTarget(overrides, 'detailed', 'chest', undefined);
  expect(reset).toEqual({ detailed: { hidden: 6 }, broad: { chest: 16 } });
  expect(overrides.detailed.chest).toBe(12);
  expect(withMuscleTarget(reset, 'custom', 'new-muscle', 3).custom).toEqual({ 'new-muscle': 3 });
  expect(muscleWeeklyTarget(preferences, 'detailed', 'toString')).toBe(8);
  const special = withMuscleTarget({}, 'detailed', '__proto__', 4);
  expect(muscleWeeklyTarget({ ...preferences, muscleTargetOverrides: special }, 'detailed', '__proto__')).toBe(4);
});

it.each([null, [], 3, { invalid: {} }, { detailed: null }, { broad: [] }, { detailed: { chest: 0 } },
  { detailed: { chest: -1 } }, { broad: { chest: 1.5 } }, { detailed: { chest: Infinity } },
  { detailed: { chest: Number.MAX_SAFE_INTEGER + 1 } }, { custom: { '': 3 } }, { detailed: { chest: '8' } }])(
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
  setAccountLocalPreferences({ muscleTargetOverrides: { detailed: { chest: 12 } } });
  await drainAccountLocalSyncedWrites();
  expect(values().muscleTargetOverrides).toEqual({});
  expect(getAccountLocalPreferenceState().pending.muscleTargetOverrides).toEqual({ detailed: { chest: 12 } });
  expect(getAccountLocalPreferenceState().error).toMatch(/could not be saved/);
  write.mockRestore();
  await retryAccountLocalPreferences();
  await drainAccountLocalSyncedWrites();
  expect(values().muscleTargetOverrides).toEqual({ detailed: { chest: 12 } });
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
