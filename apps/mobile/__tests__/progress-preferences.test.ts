import { Storage } from 'expo-sqlite/kv-store';
import { execFileSync } from 'node:child_process';
import {
  __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState, retryAccountLocalPreferences, setAccountLocalPreferenceAccount, setAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue, preferenceValidationMessages } from '@/src/preferences/model';
import { preferenceKey } from '@/src/preferences/storage';
import { getSessionSetTypeCycle, nextSessionSetType, defaultSessionSetType } from '@/src/data/set-types';
import { groupedTargetAttainment, muscleTargetAttainment } from '@/src/preferences/targets';
import { calendarWeekBounds, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';

const account = async (id: string | null = 'A', configured = true) => {
  setAccountLocalPreferenceAccount(id, configured);
  await ensureAccountLocalPreferencesLoaded();
};
const values = () => getAccountLocalPreferenceState().values;
afterEach(() => jest.restoreAllMocks());

it('extends existing scoped browsing choices and restores all five settings after relaunch', async () => {
  Storage.setItemSync(preferenceKey('account:A', 'dateFormat'), 'MM-DD-YYYY');
  await account();
  expect(values()).toEqual({ ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, dateFormat: 'MM-DD-YYYY' });
  const choices = { weeklyWorkingSetTarget: 12, displayEfforts: ['warm_up', 'unspecified', 'rir_2', 'rir_0'] as import('@/src/exercise-calculations/effort-policy').EffortChoice[],
    targetWindowWeeks: 1, historyLookbackWeeks: 104, heatmapView: 'weekly' as const };
  setAccountLocalPreferences(choices);
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toEqual({ ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, dateFormat: 'MM-DD-YYYY', ...choices });
  await account('B'); expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account(null); expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account('A'); expect(values().weeklyWorkingSetTarget).toBe(12);
  await account(null, false); expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  setAccountLocalPreferences({ heatmapView: 'daily' });
  await account('A'); expect(values().historyLookbackWeeks).toBe(104);
  await account(null, false); expect(values().heatmapView).toBe('daily');
});

it.each([null, 'monthly', '"weekly"', 'null', ''])('uses Daily for missing or invalid heatmap storage %s', async raw => {
  const key = preferenceKey('account:A', 'heatmapView');
  if (raw !== null) Storage.setItemSync(key, raw);
  await account();
  expect(values().heatmapView).toBe('daily');
  expect(Storage.getItemSync(key)).toBe(raw);
});

it.each(['daily', 'weekly'] as const)('preserves the saved %s view across relaunch and account switches', async view => {
  const key = preferenceKey('account:A', 'heatmapView');
  Storage.setItemSync(key, view);
  await account();
  expect(values().heatmapView).toBe(view);
  await account('B');
  expect(values().heatmapView).toBe('daily');
  await account(null);
  expect(values().heatmapView).toBe('daily');
  __resetAccountLocalPreferencesForTests();
  await account('A');
  expect(values().heatmapView).toBe(view);
  expect(Storage.getItemSync(key)).toBe(view);
});

it.each(['invalid JSON', 'null', '[]', '{}', '0', '-1', '1.5', '9007199254740992'])
('defaults malformed target storage %s', async raw => {
  Storage.setItemSync(preferenceKey('account:A', 'weeklyWorkingSetTarget'), raw);
  await account(); expect(values().weeklyWorkingSetTarget).toBe(8);
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid whole numbers %s without writing', async invalid => {
  await account();
  const write = jest.spyOn(Storage, 'setItemSync');
  setAccountLocalPreferences({ historyLookbackWeeks: invalid });
  expect(values().historyLookbackWeeks).toBe(52);
  expect(getAccountLocalPreferenceState().error).toMatch(/positive whole/);
  setAccountLocalPreferences({ weeklyWorkingSetTarget: invalid });
  expect(values().weeklyWorkingSetTarget).toBe(8);
  expect(write).not.toHaveBeenCalled();
});

// Progress's remembered filters. The period is deliberately not one of them:
// every visit opens on Settings' Progress period ([[comparison.window]]).
it('restores the remembered Progress filters after relaunch, per account, as plain text', async () => {
  await account();
  expect(values().progressBreakdown).toBe('muscle');
  expect(values().progressMetric).toBe('workingSetCount');
  expect(Object.keys(values())).not.toContain('progressPeriod');

  setAccountLocalPreferences({ progressBreakdown: 'exercise', progressMetric: 'totalVolume' });
  // Each is its own scoped key, written as its own text: a JSON-quoted value
  // is what the shared `heatmapView` branch avoids, and would read back null.
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressBreakdown'))).toBe('exercise');
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressMetric'))).toBe('totalVolume');

  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toMatchObject({ progressBreakdown: 'exercise', progressMetric: 'totalVolume' });

  await account('B');
  expect(values()).toMatchObject({ progressBreakdown: 'muscle', progressMetric: 'workingSetCount' });
  await account('A');
  expect(values().progressMetric).toBe('totalVolume');
});

it.each(['progressBreakdown', 'progressMetric'] as const)(
  'keeps the stored %s when an unreadable value is offered, and reports why', async field => {
    Storage.setItemSync(preferenceKey('account:A', field), '"muscle"');
    await account();
    expect(values()[field]).toBe(DEFAULT_ACCOUNT_LOCAL_PREFERENCES[field]);

    setAccountLocalPreferences({ [field]: 'sideways' });
    expect(values()[field]).toBe(DEFAULT_ACCOUNT_LOCAL_PREFERENCES[field]);
    expect(getAccountLocalPreferenceState().error).toBe(preferenceValidationMessages[field]);
  });

it('validates window limits, RIR zero and the last visible grade', () => {
  expect(isPreferenceValue('targetWindowWeeks', 52)).toBe(true);
  expect(isPreferenceValue('targetWindowWeeks', 53)).toBe(false);
  expect(isPreferenceValue('historyLookbackWeeks', 520)).toBe(true);
  expect(isPreferenceValue('historyLookbackWeeks', 521)).toBe(false);
  expect(isPreferenceValue('weeklyWorkingSetTarget', { quads: 8 })).toBe(false);
  expect(isPreferenceValue('heatmapView', 'monthly')).toBe(false);
  for (const invalid of [[], [0, 0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]]) {
    expect(isPreferenceValue('displayEfforts', invalid)).toBe(false);
  }
  expect(isPreferenceValue('displayEfforts', ['rir_0', 'technique'])).toBe(true);
  expect(isPreferenceValue('workingSetEfforts', [])).toBe(true);
  expect(isPreferenceValue('volumeEfforts', ['rir_12'])).toBe(false);
});

it('persists the 520-week limit and rejects 521 without changing the saved value', async () => {
  await account();
  setAccountLocalPreferences({ historyLookbackWeeks: 520 });
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values().historyLookbackWeeks).toBe(520);
  const write = jest.spyOn(Storage, 'setItemSync');
  setAccountLocalPreferences({ historyLookbackWeeks: 521 });
  expect(values().historyLookbackWeeks).toBe(520);
  expect(getAccountLocalPreferenceState().error).toMatch(/up to 520/);
  expect(write).not.toHaveBeenCalled();
});

it('retains failed input and durable values, retries partial saves and clears errors on a valid edit', async () => {
  await account();
  const native = Storage.setItemSync;
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementation((key, value) => {
    if (key.endsWith('.historyLookbackWeeks')) throw Error('disk full');
    native(key, value);
  });
  setAccountLocalPreferences({ targetWindowWeeks: 4, historyLookbackWeeks: 104, heatmapView: 'weekly' });
  expect(values().historyLookbackWeeks).toBe(52);
  expect(values().heatmapView).toBe('daily');
  expect(getAccountLocalPreferenceState().pending).toEqual({ historyLookbackWeeks: 104, heatmapView: 'weekly' });
  write.mockRestore();
  await retryAccountLocalPreferences();
  expect(values().historyLookbackWeeks).toBe(104);
  expect(values().heatmapView).toBe('weekly');
  expect(getAccountLocalPreferenceState().error).toBeNull();
  setAccountLocalPreferences({ displayEfforts: [] });
  expect(getAccountLocalPreferenceState().error).toMatch(/at least one/);
  setAccountLocalPreferences({ displayEfforts: ['rir_0'] });
  expect(getAccountLocalPreferenceState().error).toBeNull();
});

it('cycles fixed visible choices and gives new rows a visible effort without editing history', () => {
  const display = ['warm_up', 'unspecified', 'rir_2', 'rir_0', 'technique'] as const;
  expect(getSessionSetTypeCycle(display)).toEqual(['warm_up', null, 'rir_2', 'rir_0', 'technique']);
  expect(nextSessionSetType(null, display)).toBe('rir_2');
  expect(nextSessionSetType('rir_12', display)).toBe('warm_up');
  expect(nextSessionSetType('technique', display)).toBe('warm_up');
  expect(defaultSessionSetType('rir_12', display)).toBe('rir_2');
  expect(defaultSessionSetType('rir_3', display)).toBe('rir_2');
  expect(defaultSessionSetType('rir_0', ['rir_2'])).toBe('rir_2');
  expect(defaultSessionSetType('warm_up', display)).toBeNull();
  expect(defaultSessionSetType(undefined, ['technique'])).toBe('technique');
});

it('migrates the former visible grades to fixed choices while leaving legacy storage intact', async () => {
  const key = 'boga3.accountPreferences.v1.account%3AA.visibleEffortGrades';
  Storage.setItemSync(key, '[0,2,12]');
  await account();
  expect(values().displayEfforts).toEqual(['warm_up', 'unspecified', 'rir_4', 'rir_2', 'rir_0', 'technique', 'cooldown']);
  expect(Storage.getItemSync(key)).toBe('[0,2,12]');
});

it('caps constituent muscle attainment before averaging, including untrained muscles', () => {
  expect(muscleTargetAttainment(4, 8)).toBe(.5);
  expect(muscleTargetAttainment(16, 8, 4)).toBe(.5);
  expect(muscleTargetAttainment(16, 8)).toBe(1);
  expect(groupedTargetAttainment(['quads', 'calves'], { quads: 100 }, 4)).toBe(.5);
  expect(groupedTargetAttainment(['quads', 'chest'], { quads: 6, chest: 6 }, 12)).toBe(.5);
  expect(groupedTargetAttainment([], {}, 8)).toBe(0);
});

it('aligns current calendar-week windows to local Monday and now', () => {
  const now = new Date(2026, 9, 3, 15, 20);
  expect(calendarWeekBounds(1, now).start).toEqual(new Date(2026, 8, 28));
  const bounds = calendarWeekBounds(4, now);
  expect(bounds.start).toEqual(new Date(2026, 8, 7));
  expect(bounds.end).toEqual(now);
  expect(shiftCalendarWeeks(now, -4)).toEqual(new Date(2026, 8, 5, 15, 20));
});

it.each([[2, 8, 167, '2026-03-02T05:00:00.000Z'], [10, 1, 169, '2026-10-26T04:00:00.000Z']])
('preserves wall time across the DST transition in month %i', (month, day, elapsedHours, monday) => {
  const script = `const { shiftCalendarWeeks, calendarWeekBounds } = require('./src/utils/calendar-weeks.ts');
    const now = new Date(2026, ${month}, ${day}, 12, 30);
    const previous = shiftCalendarWeeks(now, -1);
    process.stdout.write(JSON.stringify([now.getHours(), previous.getHours(),
      (now - previous) / 3600000, calendarWeekBounds(1, now).start.toISOString()]));`;
  const measured = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }));
  expect(measured).toEqual([12, 12, elapsedHours, monday]);
});
