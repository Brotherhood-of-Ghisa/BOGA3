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
  const choices = { progressMetric: 'totalVolume' as const, displayEfforts: ['warm_up', 'unspecified', 'rir_2', 'rir_0'] as import('@/src/exercise-calculations/effort-policy').EffortChoice[],
    targetWindowWeeks: 1, historyLookbackWeeks: 104, heatmapView: 'weekly' as const };
  setAccountLocalPreferences(choices);
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toEqual({ ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, dateFormat: 'MM-DD-YYYY', ...choices });
  await account('B'); expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account(null); expect(values()).toEqual(DEFAULT_ACCOUNT_LOCAL_PREFERENCES);
  await account('A'); expect(values().progressMetric).toBe('totalVolume');
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

it.each(['list', '3d'] as const)('remembers the %s Progress layout per account without changing history view', async layout => {
  await account();
  expect(values().progressMuscleLayout).toBe('list');
  setAccountLocalPreferences({ progressMuscleLayout: layout, heatmapView: 'weekly' });
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressMuscleLayout'))).toBe(layout);
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values().progressMuscleLayout).toBe(layout);
  expect(values().heatmapView).toBe('weekly');
  await account('B');
  expect(values().progressMuscleLayout).toBe('list');
  await account('A');
  expect(values().progressMuscleLayout).toBe(layout);
});

it.each(['heatmap', 'invalid', '"3d"'])('falls back to List for retired or invalid Progress layout %s', async raw => {
  const key = preferenceKey('account:A', 'progressMuscleLayout');
  Storage.setItemSync(key, raw);
  Storage.setItemSync(preferenceKey('account:A', 'heatmapView'), 'weekly');
  await account();
  expect(values().progressMuscleLayout).toBe('list');
  expect(values().heatmapView).toBe('weekly');
  expect(Storage.getItemSync(key)).toBe(raw);
  expect(isPreferenceValue('progressMuscleLayout', raw)).toBe(false);
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

// What Progress opens on, set in Settings.
it('restores the Progress defaults after relaunch, per account, as plain text', async () => {
  await account();
  expect(values().progressBreakdown).toBe('muscle');
  expect(values().progressMetric).toBe('workingSetCount');
  // Each table has its own metric: only the Exercise table can hold 1RM.
  expect(values().progressExerciseMetric).toBe('workingSetCount');
  expect(values()).toMatchObject({ progressPeriod: 'window', progressGrouped: true, progressCountSecondary: true });

  setAccountLocalPreferences({ progressExerciseMetric: 'estimatedOneRepMax' });
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressExerciseMetric'))).toBe('estimatedOneRepMax');
  expect(values().progressMetric).toBe('workingSetCount');
  setAccountLocalPreferences({ progressBreakdown: 'exercise', progressMetric: 'totalVolume' });
  // Each is its own scoped key, written as its own text: a JSON-quoted value
  // is what the shared `heatmapView` branch avoids, and would read back null.
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressBreakdown'))).toBe('exercise');
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressMetric'))).toBe('totalVolume');

  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toMatchObject({ progressBreakdown: 'exercise', progressMetric: 'totalVolume',
    progressExerciseMetric: 'estimatedOneRepMax' });

  await account('B');
  expect(values()).toMatchObject({ progressBreakdown: 'muscle', progressMetric: 'workingSetCount',
    progressExerciseMetric: 'workingSetCount' });
  await account('A');
  expect(values().progressMetric).toBe('totalVolume');
});

it('stores the period as text and grouping as a boolean', async () => {
  await account();
  setAccountLocalPreferences({ progressPeriod: 'this-week', progressGrouped: false });
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressPeriod'))).toBe('this-week');
  expect(Storage.getItemSync(preferenceKey('account:A', 'progressGrouped'))).toBe('false');
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values()).toMatchObject({ progressPeriod: 'this-week', progressGrouped: false });
  await account('B');
  expect(values()).toMatchObject({ progressPeriod: 'window', progressGrouped: true });
});

it('still reads a count-secondary choice an earlier version stored as a kv boolean', async () => {
  // Synced on the settings row now; the kv copy is the fallback until sync moves it.
  Storage.setItemSync(preferenceKey('account:A', 'progressCountSecondary'), 'false');
  await account();
  expect(values().progressCountSecondary).toBe(false);
});

it.each([
  ['progressPeriod', '"window"'], ['progressPeriod', '7'], ['progressGrouped', 'yes'], ['progressCountSecondary', '1'],
] as const)('opens on the default for an unreadable stored %s %s', async (field, raw) => {
  Storage.setItemSync(preferenceKey('account:A', field), raw);
  await account();
  expect(values()[field]).toBe(DEFAULT_ACCOUNT_LOCAL_PREFERENCES[field]);
  expect(isPreferenceValue(field, raw)).toBe(false);
});

it.each(['progressBreakdown', 'progressMuscleLayout', 'progressMetric', 'progressExerciseMetric'] as const)(
  'keeps the stored %s when an unreadable value is offered, and reports why', async field => {
    Storage.setItemSync(preferenceKey('account:A', field), '"muscle"');
    await account();
    expect(values()[field]).toBe(DEFAULT_ACCOUNT_LOCAL_PREFERENCES[field]);

    setAccountLocalPreferences({ [field]: 'sideways' });
    expect(values()[field]).toBe(DEFAULT_ACCOUNT_LOCAL_PREFERENCES[field]);
    expect(getAccountLocalPreferenceState().error).toBe(preferenceValidationMessages[field]);
  });

it('validates window limits, rest timer limits, RIR zero and the last visible grade', () => {
  expect(isPreferenceValue('targetWindowWeeks', 52)).toBe(true);
  expect(isPreferenceValue('targetWindowWeeks', 53)).toBe(false);
  expect(isPreferenceValue('historyLookbackWeeks', 520)).toBe(true);
  expect(isPreferenceValue('historyLookbackWeeks', 521)).toBe(false);
  expect(isPreferenceValue('restTimerAutoStart', true)).toBe(true);
  expect(isPreferenceValue('restTimerAutoStart', false)).toBe(true);
  expect(isPreferenceValue('restTimerAutoStart', 'true')).toBe(false);
  expect(isPreferenceValue('restTimerDurationSec', 15)).toBe(true);
  expect(isPreferenceValue('restTimerDurationSec', 600)).toBe(true);
  expect(isPreferenceValue('restTimerDurationSec', 14)).toBe(false);
  expect(isPreferenceValue('restTimerDurationSec', 601)).toBe(false);
  expect(isPreferenceValue('repeatingTimerIntervalSec', 15)).toBe(true);
  expect(isPreferenceValue('repeatingTimerIntervalSec', 600)).toBe(true);
  expect(isPreferenceValue('repeatingTimerIntervalSec', 14)).toBe(false);
  expect(isPreferenceValue('repeatingTimerIntervalSec', 601)).toBe(false);
  expect(isPreferenceValue('weeklyWorkingSetTarget', { quads: 8 })).toBe(false);
  expect(isPreferenceValue('heatmapView', 'monthly')).toBe(false);
  // 1RM is the Exercise table's alone: the Muscle table's metric rejects it.
  expect(isPreferenceValue('progressMetric', 'estimatedOneRepMax')).toBe(false);
  expect(isPreferenceValue('progressExerciseMetric', 'estimatedOneRepMax')).toBe(true);
  expect(isPreferenceValue('progressExerciseMetric', 'sideways')).toBe(false);
  for (const invalid of [[], [0, 0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]]) {
    expect(isPreferenceValue('displayEfforts', invalid)).toBe(false);
  }
  expect(isPreferenceValue('displayEfforts', ['rir_0', 'technique'])).toBe(true);
  expect(isPreferenceValue('workingSetEfforts', [])).toBe(true);
  expect(isPreferenceValue('volumeEfforts', ['rir_12'])).toBe(false);
});

it('persists rest timer preferences per account and rejects out-of-range durations without writing', async () => {
  await account();
  expect(values().restTimerAutoStart).toBe(true);
  expect(values().restTimerDurationSec).toBe(90);

  setAccountLocalPreferences({ restTimerAutoStart: false, restTimerDurationSec: 120 });
  __resetAccountLocalPreferencesForTests();
  await account();
  expect(values().restTimerAutoStart).toBe(false);
  expect(values().restTimerDurationSec).toBe(120);

  const write = jest.spyOn(Storage, 'setItemSync');
  setAccountLocalPreferences({ restTimerDurationSec: 10 });
  expect(values().restTimerDurationSec).toBe(120);
  expect(getAccountLocalPreferenceState().error).toMatch(/from 15 to 600/);
  expect(write).not.toHaveBeenCalled();
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

// Today is always cards; a layout saved by the retired setting is never read back.
it.each(['list', 'cards'])('ignores a Today layout %s the retired setting saved', async raw => {
  Storage.setItemSync('boga3.accountPreferences.v1.account%3AA.todayLayout', raw);
  await account();
  expect(values()).not.toHaveProperty('todayLayout');
  expect(getAccountLocalPreferenceState().error).toBeNull();
});
