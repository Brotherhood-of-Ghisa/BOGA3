/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: { id: 'A' } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useLocalSearchParams: () => ({}),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native navigation boundary.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import SettingsRoute from '../app/(tabs)/settings';
import { EffortSheet } from '@/components/exercise-page/exercise-sheets';
import { ensureAccountLocalPreferencesLoaded, getAccountLocalPreferenceState, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { closeLocalData, resetLocalData } from './helpers/local-data';

const values = () => getAccountLocalPreferenceState().values;
const openSettings = async () => {
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  render(<SettingsRoute />);
  await waitFor(() => expect(screen.getByTestId('settings-target-window')).toHaveProp('value', '4'));
};
const editNumber = (id: string, value: string) => {
  fireEvent.changeText(screen.getByTestId(id), value);
  fireEvent(screen.getByTestId(id), 'endEditing');
};
beforeEach(() => resetLocalData());
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

it('saves both window settings and the view, and retains invalid numeric drafts in the centralized error flow', async () => {
  await openSettings();
  editNumber('settings-target-window', '1');
  editNumber('settings-history-lookback', '104');
  fireEvent.press(screen.getByTestId('settings-heatmap-view-daily'));
  expect(values()).toMatchObject({ targetWindowWeeks: 1, historyLookbackWeeks: 104, heatmapView: 'daily' });
  editNumber('settings-target-window', '1.5');
  expect(screen.getByTestId('settings-target-window')).toHaveProp('value', '1.5');
  expect(values().targetWindowWeeks).toBe(1);
  expect(within(screen.getByTestId('settings-section-data-sync')).getByTestId('settings-sync-status-error')).toHaveTextContent(/from 1 to 52/);
  expect(within(screen.getByTestId('settings-section-progress')).queryByText(/from 1 to 52/)).toBeNull();
  editNumber('settings-target-window', '4');
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('keeps a failed numeric save as a draft and retries it with Refresh', async () => {
  await openSettings();
  const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  editNumber('settings-history-lookback', '104');
  expect(values().historyLookbackWeeks).toBe(52);
  expect(screen.getByTestId('settings-history-lookback')).toHaveProp('value', '104');
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/could not be saved/);
  expect(screen.queryByText('Retry')).toBeNull();
  write.mockRestore();
  fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
  await waitFor(() => expect(values().historyLookbackWeeks).toBe(104));
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('edits stable muscle targets and removes an override on Reset', async () => {
  await openSettings();
  fireEvent.press(screen.getByTestId('settings-muscle-targets-row'));
  const input = await screen.findByTestId('settings-muscle-target-quads');
  expect(input).toHaveProp('value', '8');
  editNumber('settings-muscle-target-quads', '12');
  expect(values().weeklyMuscleTargets).toEqual({ quads: 12 });
  editNumber('settings-muscle-target-quads', '0');
  expect(values().weeklyMuscleTargets).toEqual({ quads: 12 });
  fireEvent.press(screen.getByTestId('settings-muscle-target-reset-quads'));
  expect(values().weeklyMuscleTargets).toEqual({});
  expect(screen.getByTestId('settings-muscle-target-quads')).toHaveProp('value', '8');
});

it('offers visibility alone, locks W-Up and unspecified, adds RIR zero/custom grades and rejects the last removal', async () => {
  await openSettings();
  for (const id of ['warm-up', 'unspecified']) {
    expect(screen.getByTestId(`settings-effort-${id}-visible`)).toHaveProp('accessibilityState', { checked: true, disabled: true });
  }
  expect(screen.getByLabelText('RIR 2, Visible')).toHaveProp('accessibilityRole', 'checkbox');
  expect(screen.queryByText('Counts as W/set')).toBeNull();
  for (const grade of [1, 2, 3, 0]) fireEvent.press(screen.getByTestId(`settings-effort-rir-${grade}-visible`));
  expect(values().visibleEffortGrades).toEqual([0]);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(/at least one/);
  fireEvent.changeText(screen.getByTestId('settings-add-rir-input'), '-1');
  fireEvent.press(screen.getByTestId('settings-add-rir-button'));
  expect(screen.getByTestId('settings-add-rir-input')).toHaveProp('value', '-1');
  fireEvent.changeText(screen.getByTestId('settings-add-rir-input'), '12');
  fireEvent.press(screen.getByTestId('settings-add-rir-button'));
  expect(values().visibleEffortGrades).toEqual([0, 12]);
  expect(screen.getByLabelText('RIR 12, Visible')).toBeTruthy();
  expect(screen.getByTestId('settings-add-rir-input')).toHaveProp('value', '');
});

it('updates an already mounted effort picker without rewriting its hidden selected grade', async () => {
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  const select = jest.fn();
  render(<EffortSheet visible selected="rir_2" onSelect={select} onDismiss={jest.fn()} />);
  expect(screen.getByTestId('exercise-effort-option-rir_2')).toHaveProp('accessibilityState', { selected: true, disabled: false });
  act(() => updatePreferences({ visibleEffortGrades: [0, 12] }));
  expect(screen.queryByTestId('exercise-effort-option-rir_2')).toBeNull();
  expect(screen.getByTestId('exercise-effort-option-rir_12')).toBeTruthy();
  expect(screen.getByTestId('exercise-effort-option-none')).toBeTruthy();
  expect(screen.getByTestId('exercise-effort-option-warm_up')).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
  await act(async () => { await ensureAccountLocalPreferencesLoaded(); });
});
