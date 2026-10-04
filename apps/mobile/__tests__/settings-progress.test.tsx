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
  expect(screen.getByLabelText('Weekly working sets per muscle')).toHaveProp('value', '8');
  expect(screen.getByLabelText('Progress period (weeks)')).toHaveProp('value', '4');
  expect(screen.getByLabelText('Heatmap view')).toBeTruthy();
  expect(screen.queryByText('Weekly muscle targets')).toBeNull();
  editNumber(id, '12');
  expect(values().weeklyWorkingSetTarget).toBe(12);
  editNumber(id, '0');
  expect(values().weeklyWorkingSetTarget).toBe(12);
  expect(screen.getByTestId(id)).toHaveProp('value', '0');
  expect(within(screen.getByTestId('settings-section-data-sync')).getByTestId('settings-sync-status-error'))
    .toHaveTextContent(/positive whole number/);
  expect(within(screen.getByTestId('settings-section-progress')).queryByText(/positive whole number/)).toBeNull();
  editNumber(id, '8');
  expect(values().weeklyWorkingSetTarget).toBe(8);
  expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
});

it('offers nine fixed labels and independent Display, Working set and Volume controls with no Add', async () => {
  await openSettings();
  expect(screen.queryByTestId('settings-add-rir-input')).toBeNull();
  expect(screen.queryByText('Add')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(27);
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
