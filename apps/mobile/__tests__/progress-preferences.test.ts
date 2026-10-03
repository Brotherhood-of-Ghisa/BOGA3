import { Storage } from 'expo-sqlite/kv-store';
import { execFileSync } from 'node:child_process';
import {
  __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState, retryAccountLocalPreferences, setAccountLocalPreferenceAccount, setAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue } from '@/src/preferences/model';
import { preferenceKey } from '@/src/preferences/storage';
import { getSessionSetTypeCycle, nextSessionSetType, defaultSessionSetType } from '@/src/data/set-types';
import { groupedTargetAttainment, muscleTargetAttainment } from '@/src/preferences/targets';
import { calendarWeekBounds, keepHistorySelection, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';

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
  const choices = { weeklyWorkingSetTarget: 12, visibleEffortGrades: [0, 2, 12],
    targetWindowWeeks: 1, historyLookbackWeeks: 104, heatmapView: 'daily' as const };
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

it('validates window limits, RIR zero and the last visible grade', () => {
  expect(isPreferenceValue('targetWindowWeeks', 52)).toBe(true);
  expect(isPreferenceValue('targetWindowWeeks', 53)).toBe(false);
  expect(isPreferenceValue('weeklyWorkingSetTarget', { quads: 8 })).toBe(false);
  expect(isPreferenceValue('heatmapView', 'monthly')).toBe(false);
  for (const invalid of [[], [0, 0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]]) {
    expect(isPreferenceValue('visibleEffortGrades', invalid)).toBe(false);
  }
  expect(isPreferenceValue('visibleEffortGrades', [0, 12])).toBe(true);
});

it('retains failed input and durable values, retries partial saves and clears errors on a valid edit', async () => {
  await account();
  const native = Storage.setItemSync;
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementation((key, value) => {
    if (key.endsWith('.historyLookbackWeeks')) throw Error('disk full');
    native(key, value);
  });
  setAccountLocalPreferences({ targetWindowWeeks: 4, historyLookbackWeeks: 104, heatmapView: 'daily' });
  expect(values().historyLookbackWeeks).toBe(52);
  expect(values().heatmapView).toBe('weekly');
  expect(getAccountLocalPreferenceState().pending).toEqual({ historyLookbackWeeks: 104, heatmapView: 'daily' });
  write.mockRestore();
  await retryAccountLocalPreferences();
  expect(values().historyLookbackWeeks).toBe(104);
  expect(values().heatmapView).toBe('daily');
  expect(getAccountLocalPreferenceState().error).toBeNull();
  setAccountLocalPreferences({ visibleEffortGrades: [] });
  expect(getAccountLocalPreferenceState().error).toMatch(/at least one/);
  setAccountLocalPreferences({ visibleEffortGrades: [0] });
  expect(getAccountLocalPreferenceState().error).toBeNull();
});

it('uses saved grades for cycling and rolls hidden inherited effort to the next harder visible grade', () => {
  expect(getSessionSetTypeCycle([0, 12, 2])).toEqual(['warm_up', null, 'rir_12', 'rir_2', 'rir_0']);
  expect(nextSessionSetType(null, [0, 12])).toBe('rir_12');
  expect(nextSessionSetType('rir_2', [0, 12])).toBe('warm_up');
  expect(defaultSessionSetType('rir_2')).toBe('rir_2');
  expect(defaultSessionSetType('rir_12', [0, 3])).toBe('rir_3');
  expect(defaultSessionSetType('rir_3', [0, 2])).toBe('rir_2');
  expect(defaultSessionSetType('rir_2', [0, 12])).toBe('rir_0');
  expect(defaultSessionSetType('rir_0', [2, 12])).toBe('rir_0');
  expect(defaultSessionSetType('rir_2', [0, 2, 12])).toBe('rir_2');
  expect(defaultSessionSetType('warm_up', [12])).toBeNull();
  expect(defaultSessionSetType(null, [12])).toBeNull();
  expect(defaultSessionSetType(undefined, [12])).toBe('warm_up');
});

it('caps constituent muscle attainment before averaging, including untrained muscles', () => {
  expect(muscleTargetAttainment(4, 8)).toBe(.5);
  expect(muscleTargetAttainment(16, 8, 4)).toBe(.5);
  expect(muscleTargetAttainment(16, 8)).toBe(1);
  expect(groupedTargetAttainment(['quads', 'calves'], { quads: 100 }, 4)).toBe(.5);
  expect(groupedTargetAttainment(['quads', 'chest'], { quads: 6, chest: 6 }, 12)).toBe(.5);
  expect(groupedTargetAttainment([], {}, 8)).toBe(0);
});

it('aligns to local Monday, keeps the same elapsed previous span, and recovers week selection', () => {
  const now = new Date(2026, 9, 3, 15, 20);
  expect(calendarWeekBounds(1, now).start).toEqual(new Date(2026, 8, 28));
  const bounds = calendarWeekBounds(4, now);
  expect(bounds.start).toEqual(new Date(2026, 8, 7));
  expect(shiftCalendarWeeks(now, -4)).toEqual(new Date(2026, 8, 5, 15, 20));
  expect(keepHistorySelection('2026-09-14', 4, now)).toBe('2026-09-14');
  expect(keepHistorySelection('2025-01-06', 4, now)).toBe('2026-09-28');
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
