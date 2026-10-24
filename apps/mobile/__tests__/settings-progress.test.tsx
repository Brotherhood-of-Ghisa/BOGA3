/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
let mockUserId = 'A';
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native navigation boundary.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import {
  DataSyncSettingsScreen,
  EffortSettingsScreen,
  ProgressSettingsScreen,
  RestTimerSettingsScreen,
} from '@/components/settings/sub-pages';
import ProgressRoute from '../app/(tabs)/progress';
import { EffortSheet } from '@/components/exercise-page/exercise-sheets';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, getAccountLocalPreferenceState, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const values = () => getAccountLocalPreferenceState().values;
// Settings' sub pages that edit preferences, beside Data & sync, which reports
// every preference error and retries it with Refresh.
const SettingsPages = () => (
  <>
    <ProgressSettingsScreen />
    <EffortSettingsScreen />
    <RestTimerSettingsScreen />
    <DataSyncSettingsScreen />
  </>
);
const ProgressSettingsAndPage = () => (
  <>
    <ProgressSettingsScreen />
    <DataSyncSettingsScreen />
    <ProgressRoute />
  </>
);
const openSettings = async () => {
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  render(<SettingsPages />);
  await waitFor(() => expect(screen.getByTestId('settings-target-window')).toHaveProp('value', '4'));
};
const editNumber = (id: string, value: string) => {
  fireEvent.changeText(screen.getByTestId(id), value);
  fireEvent(screen.getByTestId(id), 'endEditing');
};
beforeEach(() => { mockUserId = 'A'; resetLocalData(); });
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

const openSettingsAndProgress = async () => {
  await loadMaestroFixture('exercise-block-history');
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  const page = render(<ProgressSettingsAndPage />);
  await screen.findByTestId('stats-muscle-table');
  return page;
};

it('offers only List and 3D for both breakdowns, persists 3D and falls back to List for 1RM', async () => {
  const page = await openSettingsAndProgress();
  const selector = within(screen.getByTestId('settings-muscle-view-row'));
  expect(selector.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual(['List', '3D']);
  expect(screen.queryByTestId('settings-muscle-view-heatmap')).toBeNull();
  fireEvent.press(screen.getByTestId('settings-muscle-view-3d'));
  await screen.findByTestId('stats-muscle-body-card');
  fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
  await screen.findByTestId('stats-exercise-list');
  expect(screen.getByTestId('stats-muscle-body-card')).toBeTruthy();
  fireEvent.press(screen.getByTestId('stats-metric-chip'));
  fireEvent.press(screen.getByTestId('stats-metric-chip'));
  expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('1RM');
  expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
  expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
  expect(values().progressMuscleLayout).toBe('3d');
  fireEvent.press(screen.getByTestId('stats-metric-chip'));
  await screen.findByTestId('stats-muscle-body-card');
  page.unmount();
  __resetAccountLocalPreferencesForTests();
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  render(<ProgressSettingsAndPage />);
  await screen.findByTestId('stats-muscle-body-card');
  expect(screen.getByTestId('settings-muscle-view-3d')).toHaveProp('accessibilityState', { selected: true });
  fireEvent.press(screen.getByTestId('settings-muscle-view-list'));
  // The breakdown chosen on the page was for that visit: this one opens on Muscle.
  await screen.findByTestId('stats-muscle-table');
  expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
});

it('sets what Progress opens on: view, period, each metric, grouping and secondary sets', async () => {
  const page = await openSettingsAndProgress();
  const defaults = within(screen.getByTestId('settings-progress-defaults'));
  expect(defaults.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual(
    ['Muscle', 'Exercise', '4 weeks', 'This week', 'Sets', 'Volume', 'Sets', 'Volume', '1RM']);
  fireEvent.press(screen.getByTestId('settings-progress-breakdown-exercise'));
  fireEvent.press(screen.getByTestId('settings-progress-period-this-week'));
  fireEvent.press(screen.getByTestId('settings-progress-metric-totalVolume'));
  fireEvent.press(screen.getByTestId('settings-progress-exercise-metric-estimatedOneRepMax'));
  fireEvent.press(screen.getByTestId('settings-progress-grouped'));
  fireEvent.press(screen.getByTestId('settings-progress-count-secondary'));
  expect(values()).toMatchObject({ progressBreakdown: 'exercise', progressPeriod: 'this-week', progressMetric: 'totalVolume',
    progressExerciseMetric: 'estimatedOneRepMax', progressGrouped: false, progressCountSecondary: false });
  expect(screen.getByTestId('settings-progress-grouped')).toHaveProp('accessibilityState', { checked: false });

  // The mounted page follows each default as it changes.
  await screen.findByTestId('stats-exercise-list');
  expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
  expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('1RM');
  fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
  await screen.findByTestId('stats-muscle-table');
  expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
  // Off is the default now, so the Filters button reads unchanged.
  expect(screen.getByTestId('stats-filters')).toHaveProp('accessibilityLabel', 'Filters');
  expect(screen.queryAllByTestId(/^stats-family-header-/)).toHaveLength(0);
  fireEvent.press(screen.getByTestId('stats-filters'));
  expect(screen.getByTestId('stats-group-toggle')).toHaveProp('accessibilityState', { checked: false });
  expect(screen.getByTestId('stats-secondary-toggle')).toHaveProp('accessibilityState', { checked: false });
  fireEvent.press(screen.getByTestId('stats-group-toggle'));
  expect(screen.getByTestId('stats-filters')).toHaveProp('accessibilityLabel', 'Filters: grouped');
  // A choice on Progress lasts for the visit and leaves Settings alone.
  expect(values().progressGrouped).toBe(false);
  page.unmount();
});

it('offers no period default when the Progress period is one week', async () => {
  await openSettings();
  expect(screen.getByTestId('settings-progress-period-window')).toBeTruthy();
  editNumber('settings-target-window', '1');
  expect(screen.queryByTestId('settings-progress-period-window')).toBeNull();
});

it('keeps an unsaved 3D choice as a Settings draft and applies it to Exercise after Refresh', async () => {
  await openSettingsAndProgress();
  fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
  await screen.findByTestId('stats-exercise-list');
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  fireEvent.press(screen.getByTestId('settings-muscle-view-3d'));
  expect(values().progressMuscleLayout).toBe('list');
  expect(screen.getByTestId('settings-muscle-view-3d')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
  expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/could not be saved/);
  write.mockRestore();
  fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
  expect(await screen.findByTestId('stats-muscle-body-card')).toBeTruthy();
  expect(values().progressMuscleLayout).toBe('3d');
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('restores the shared Exercise layout per account without carrying another account’s 3D choice', async () => {
  const page = await openSettingsAndProgress();
  fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
  await screen.findByTestId('stats-exercise-list');
  fireEvent.press(screen.getByTestId('settings-muscle-view-3d'));
  await screen.findByTestId('stats-muscle-body-card');

  await act(async () => {
    mockUserId = 'B';
    setAccountLocalPreferenceAccount('B', true);
    await ensureAccountLocalPreferencesLoaded();
  });
  page.rerender(<ProgressSettingsAndPage />);
  await screen.findByTestId('stats-muscle-table');
  fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
  await screen.findByTestId('stats-exercise-list');
  expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
  expect(screen.getByTestId('settings-muscle-view-list')).toHaveProp('accessibilityState', { selected: true });

  await act(async () => {
    mockUserId = 'A';
    setAccountLocalPreferenceAccount('A', true);
    await ensureAccountLocalPreferencesLoaded();
  });
  page.rerender(<ProgressSettingsAndPage />);
  await screen.findByTestId('stats-muscle-body-card');
  expect(screen.getByTestId('settings-muscle-view-3d')).toHaveProp('accessibilityState', { selected: true });
});

it('saves both window settings, and retains invalid numeric drafts in the centralized error flow', async () => {
  await openSettings();
  // The heatmap view is chosen on the history page itself, not here.
  expect(screen.queryByTestId('settings-heatmap-view-daily')).toBeNull();
  expect(screen.queryByText('Heatmap view')).toBeNull();
  editNumber('settings-target-window', '1');
  editNumber('settings-history-lookback', '104');
  expect(values()).toMatchObject({ targetWindowWeeks: 1, historyLookbackWeeks: 104 });
  editNumber('settings-target-window', '1.5');
  expect(screen.getByTestId('settings-target-window')).toHaveProp('value', '1.5');
  expect(values().targetWindowWeeks).toBe(1);
  expect(within(screen.getByTestId('settings-data-sync-screen')).getByTestId('settings-sync-status-error')).toHaveTextContent(/from 1 to 52/);
  expect(within(screen.getByTestId('settings-progress-screen')).queryByText(/from 1 to 52/)).toBeNull();
  editNumber('settings-target-window', '4');
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it.each([
  ['settings-history-lookback', 'historyLookbackWeeks', 52, 104],
  ['settings-weekly-working-set-target', 'weeklyWorkingSetTarget', 8, 12],
] as const)('keeps a failed %s save as a draft and retries it with Refresh', async (id, field, previous, next) => {
  await openSettings();
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  editNumber(id, String(next));
  expect(values()[field]).toBe(previous);
  expect(screen.getByTestId(id)).toHaveProp('value', String(next));
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/could not be saved/);
  expect(screen.queryByText('Retry')).toBeNull();
  write.mockRestore();
  fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
  await waitFor(() => expect(values()[field]).toBe(next));
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('edits one shared weekly target inline and retains invalid drafts in the centralized error flow', async () => {
  await openSettings();
  const id = 'settings-weekly-working-set-target';
  expect(screen.getByLabelText('Target weekly working sets per muscle')).toHaveProp('value', '8');
  expect(screen.getByLabelText('Progress period (weeks)')).toHaveProp('value', '4');
  expect(screen.queryByText('Weekly muscle targets')).toBeNull();
  editNumber(id, '12');
  expect(values().weeklyWorkingSetTarget).toBe(12);
  editNumber(id, '0');
  expect(values().weeklyWorkingSetTarget).toBe(12);
  expect(screen.getByTestId(id)).toHaveProp('value', '0');
  expect(within(screen.getByTestId('settings-data-sync-screen')).getByTestId('settings-sync-status-error'))
    .toHaveTextContent(/positive whole number/);
  expect(within(screen.getByTestId('settings-progress-screen')).queryByText(/positive whole number/)).toBeNull();
  editNumber(id, '8');
  expect(values().weeklyWorkingSetTarget).toBe(8);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('keeps the effort choices on their own page, not under Progress', async () => {
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  render(<ProgressSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('settings-target-window')).toHaveProp('value', '4'));
  expect(screen.queryByTestId('settings-effort-selections')).toBeNull();
  screen.unmount();
  render(<EffortSettingsScreen />);
  expect(screen.getByTestId('settings-effort-selections')).toBeTruthy();
});

it('offers nine fixed labels and independent Display, Working set and Volume controls with no Add', async () => {
  await openSettings();
  expect(screen.queryByTestId('settings-add-rir-input')).toBeNull();
  expect(screen.queryByText('Add')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(27);
  // The column headers name each choice; no sentence explains them (copy.no-inline-explanation).
  expect(within(screen.getByTestId('settings-effort-selections')).queryByText(/Display chooses|Groups keep/)).toBeNull();
  expect(screen.getAllByRole('checkbox').slice(-6).map(checkbox => checkbox.props.accessibilityLabel)).toEqual([
    'Technique, Display', 'Technique, Working set', 'Technique, Volume',
    'Cooldown, Display', 'Cooldown, Working set', 'Cooldown, Volume',
  ]);
  expect(screen.getByLabelText('Technique, Display')).toHaveProp('accessibilityState', { checked: true });
  expect(screen.getByLabelText('Technique, Working set')).toHaveProp('accessibilityState', { checked: false });
  fireEvent.press(screen.getByLabelText('RIR-2, Display'));
  expect(values().displayEfforts).not.toContain('rir_2');
  expect(values().workingSetEfforts).toContain('rir_2');
  expect(values().volumeEfforts).toContain('rir_2');
  fireEvent.press(screen.getByLabelText('Technique, Volume'));
  expect(values().volumeEfforts).toContain('technique');
  expect(values().workingSetEfforts).not.toContain('technique');
  for (const id of [...values().displayEfforts]) fireEvent.press(screen.getByTestId(`settings-effort-${id}-displayEfforts`));
  expect(values().displayEfforts).toHaveLength(1);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/at least one/);
});

it('retains a failed calculation checkbox edit and retries through the centralized Refresh', async () => {
  await openSettings();
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  fireEvent.press(screen.getByLabelText('Technique, Working set'));
  expect(values().workingSetEfforts).not.toContain('technique');
  expect(screen.getByLabelText('Technique, Working set')).toHaveProp('accessibilityState', { checked: true });
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/could not be saved/);
  write.mockRestore();
  fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
  await waitFor(() => expect(values().workingSetEfforts).toContain('technique'));
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('edits rest timer auto-start and duration on its page and surfaces invalid durations in the centralized error flow', async () => {
  await openSettings();
  expect(screen.getByTestId('settings-rest-timer-duration')).toHaveProp('value', '90');
  expect(screen.getByTestId('settings-rest-timer-auto-start-on')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('settings-rest-timer-auto-start-off')).toHaveProp('accessibilityState', { selected: false });

  fireEvent.press(screen.getByTestId('settings-rest-timer-auto-start-off'));
  expect(values().restTimerAutoStart).toBe(false);
  expect(screen.getByTestId('settings-rest-timer-auto-start-off')).toHaveProp('accessibilityState', { selected: true });

  editNumber('settings-rest-timer-duration', '150');
  expect(values().restTimerDurationSec).toBe(150);

  editNumber('settings-rest-timer-duration', '10');
  expect(values().restTimerDurationSec).toBe(150);
  expect(screen.getByTestId('settings-rest-timer-duration')).toHaveProp('value', '10');
  expect(within(screen.getByTestId('settings-data-sync-screen')).getByTestId('settings-sync-status-error'))
    .toHaveTextContent(/from 15 to 600/);

  editNumber('settings-rest-timer-duration', '90');
  expect(values().restTimerDurationSec).toBe(90);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');

  editNumber('settings-repeating-timer-interval', '45');
  expect(values().repeatingTimerIntervalSec).toBe(45);

  editNumber('settings-repeating-timer-interval', '5');
  expect(values().repeatingTimerIntervalSec).toBe(45);
  expect(screen.getByTestId('settings-repeating-timer-interval')).toHaveProp('value', '5');
  expect(within(screen.getByTestId('settings-data-sync-screen')).getByTestId('settings-sync-status-error'))
    .toHaveTextContent(/from 15 to 600/);

  editNumber('settings-repeating-timer-interval', '60');
  expect(values().repeatingTimerIntervalSec).toBe(60);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('updates a mounted picker while keeping its hidden selected effort intact', async () => {
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  const select = jest.fn();
  render(<EffortSheet visible selected="rir_2" onSelect={select} onDismiss={jest.fn()} />);
  expect(screen.getByTestId('exercise-effort-option-rir_2')).toHaveProp('accessibilityState', { selected: true, disabled: false });
  act(() => updatePreferences({ displayEfforts: ['rir_0', 'technique'] }));
  expect(screen.queryByTestId('exercise-effort-option-rir_2')).toBeNull();
  expect(screen.getByTestId('exercise-effort-option-technique')).toBeTruthy();
  expect(screen.queryByTestId('exercise-effort-option-none')).toBeNull();
  expect(screen.queryByTestId('exercise-effort-option-warm_up')).toBeNull();
  expect(select).not.toHaveBeenCalled();
  await act(async () => { await ensureAccountLocalPreferencesLoaded(); });
});
