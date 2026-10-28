import { Storage } from 'expo-sqlite/kv-store';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, getAccountLocalPreferenceState,
  retryAccountLocalPreferences, setAccountLocalPreferenceAccount, setAccountLocalPreferences } from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue } from '@/src/preferences/model';
import { effectiveMuscleTargetOverrides, muscleWeeklyTarget, withMuscleTarget } from '@/src/preferences/muscle-targets';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import { preferenceKey } from '@/src/preferences/storage';

const account = async (id: string | null = 'A') => {
  setAccountLocalPreferenceAccount(id, true);
  await ensureAccountLocalPreferencesLoaded();
};
const values = () => getAccountLocalPreferenceState().values;
afterEach(() => jest.restoreAllMocks());

it('preserves the legacy single target and restores independent account-local setups after restart', async () => {
  Storage.setItemSync(preferenceKey('account:A', 'weeklyWorkingSetTarget'), '11');
  await account();
  expect(values()).toMatchObject({ weeklyWorkingSetTarget: 11, muscleTargetMode: 'single', muscleTargetOverrides: {} });
  const overrides = { detailed: { chest: 12, 'disabled-custom': 7 }, broad: { chest: 18 }, custom: { neck: 5 } };
  setAccountLocalPreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: overrides });
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
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('full'); });
  setAccountLocalPreferences({ muscleTargetOverrides: { detailed: { chest: 12 } } });
  expect(values().muscleTargetOverrides).toEqual({});
  expect(getAccountLocalPreferenceState().pending.muscleTargetOverrides).toEqual({ detailed: { chest: 12 } });
  write.mockRestore();
  await retryAccountLocalPreferences();
  expect(values().muscleTargetOverrides).toEqual({ detailed: { chest: 12 } });
  expect(getAccountLocalPreferenceState().pending).toEqual({});
  await account('B');
  expect(values().muscleTargetOverrides).toEqual({});
});

it('caps each muscle against its own target before averaging, with missing muscles at zero', () => {
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 12, calves: 4 }, 8, 1, { chest: 12 })).toBe(.75);
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 100 }, 8, 1, { chest: 12 })).toBe(.5);
  expect(groupedTargetAttainment(['chest', 'calves'], { chest: 12, calves: 4 }, 8, 2, { chest: 12 })).toBe(.375);
});
