/* eslint-disable import/first */
const mockPush = jest.fn();
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import MusclesRoute from '../app/settings-muscles';
import TargetsRoute from '../app/settings-muscle-targets';
import EnabledRoute from '../app/settings-enabled-muscles';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { muscleGroups } from '@/src/data/schema';
import { stampLocalDataOwner } from '@/src/data/local-wipe';
import * as setup from '@/src/data/muscle-report-settings';
import * as userSettingsData from '@/src/data/user-settings';
import { syncedTargetsAdoptedKey } from '@/src/preferences/synced';
import { Storage } from 'expo-sqlite/kv-store';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, getAccountLocalPreferenceState,
  setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const values = () => getAccountLocalPreferenceState().values;
const edit = (id: string, value: string) => {
  fireEvent.changeText(screen.getByTestId(id), value);
  fireEvent(screen.getByTestId(id), 'endEditing');
};
beforeEach(async () => {
  resetLocalData(); __resetAccountLocalPreferencesForTests(); mockPush.mockReset();
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
});
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

it('keeps choices and the default on Muscles, opening full target and enablement pages', async () => {
  render(<MusclesRoute />);
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: true }));
  expect(screen.queryByTestId('settings-muscle-targets-row')).toBeNull();
  expect(screen.queryByTestId('settings-muscles-sheet')).toBeNull();
  expect(screen.queryByTestId('settings-track-chest')).toBeNull();
  fireEvent.press(screen.getByTestId('settings-muscle-target-mode-per-muscle'));
  fireEvent.press(screen.getByTestId('settings-muscle-targets-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-muscle-targets');
  fireEvent.press(screen.getByTestId('settings-enabled-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-enabled-muscles');
  edit('settings-weekly-working-set-target', '11');
  expect(values().weeklyWorkingSetTarget).toBe(11);
  fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-broad')).toHaveProp('accessibilityState', { selected: true }));
  expect(screen.getByTestId('settings-enabled-muscles-row')).toBeTruthy();
  expect(screen.getByTestId('settings-weekly-working-set-target')).toHaveProp('value', '11');
});

const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' } as const;
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm } as const;

it('draws Muscles on the text roles: headings and control labels as micro-labels, statuses as meta with figures', async () => {
  render(<MusclesRoute />);
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: true }));
  expect(screen.getByText('Weekly targets')).toHaveStyle(LABEL);
  expect(screen.getByText('Target mode')).toHaveStyle(LABEL);
  expect(screen.getByText('Default target (sets / week)')).toHaveStyle({ fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base });
  const status = within(screen.getByTestId('settings-enabled-muscles-row')).getByText(/\d+ \/ \d+/);
  expect(status).toHaveStyle(META);
  within(status).getAllByText(/^\d+$/).forEach(figure => expect(figure).toHaveStyle({ fontFamily: uiFonts.figure.family }));
});

it('draws a muscle target row: the name in bodyStrong, Default and an error as meta', async () => {
  updatePreferences({ muscleTargetMode: 'per-muscle' });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByText('Pectoralis')).toHaveStyle({ fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base });
  expect(screen.getByTestId('settings-muscle-target-chest-default')).toHaveStyle(META);
  edit('settings-muscle-target-chest', '0');
  expect(screen.getByTestId('settings-muscle-target-chest-error')).toHaveStyle({ ...META, color: uiRoles.danger });
});

it('lists only enabled muscles, including custom muscles, and restores hidden overrides on re-enable', async () => {
  await setup.listMuscleReportRows();
  await setup.setMuscleTracked(['chest'], false);
  localDatabase().insert(muscleGroups).values({ id: 'custom-neck', displayName: 'Neck', familyName: 'Back', sortOrder: 99, isEditable: 1 }).run();
  updatePreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: { detailed: { chest: 14 } } });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-custom-neck');
  expect(screen.queryByTestId('settings-muscle-target-chest')).toBeNull();
  expect(screen.getByTestId('settings-muscle-target-custom-neck')).toHaveProp('placeholder', '8');
  await act(async () => { await setup.setMuscleTracked(['chest'], true); });
  expect(await screen.findByTestId('settings-muscle-target-chest')).toHaveProp('value', '14');
  await act(async () => { await setup.setMuscleTracked(['chest'], false); });
  await waitForGone(() => screen.queryByTestId('settings-muscle-target-chest'));
  expect(values().muscleTargetOverrides.detailed?.chest).toBe(14);
});

it('inherits the live default, preserves independent breakdown maps and resets one override', async () => {
  updatePreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: { detailed: { chest: 12 }, broad: { chest: 18 } } });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '12');
  expect(screen.getByTestId('settings-muscle-target-calves')).toHaveProp('placeholder', '8');
  edit('settings-weekly-working-set-target', '9');
  expect(screen.getByTestId('settings-muscle-target-calves')).toHaveProp('placeholder', '9');
  edit('settings-muscle-target-calves', '6');
  fireEvent.press(screen.getByTestId('settings-muscle-target-chest-reset'));
  expect(screen.getByTestId('settings-muscle-target-chest-default')).toHaveTextContent('Default');
  expect(values().muscleTargetOverrides).toEqual({ detailed: { calves: 6 }, broad: { chest: 18 } });
  await act(async () => { await setup.setMuscleReportPreset('broad'); });
  await waitFor(() => expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '18'));
  expect(screen.queryByTestId('settings-muscle-target-serratus_anterior')).toBeNull();
  edit('settings-muscle-target-chest', '');
  expect(values().muscleTargetOverrides.broad).toEqual({});
  await act(async () => { await setup.setMuscleReportPreset('detailed'); });
  await waitFor(() => expect(screen.getByTestId('settings-muscle-target-calves')).toHaveProp('value', '6'));
});

it.each(['0', '-1', '1.5', 'bad', '9007199254740992'])('keeps invalid target draft %s out of saved preferences', async draft => {
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  edit('settings-muscle-target-chest', draft);
  expect(screen.getByTestId('settings-muscle-target-chest-error')).toHaveTextContent('Enter a positive whole number.');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', draft);
  expect(values().muscleTargetOverrides).toEqual({});
  edit('settings-muscle-target-chest', '12');
  expect(values().muscleTargetOverrides.detailed?.chest).toBe(12);
});

it('retains and retries failed saves, then clears drafts on account change', async () => {
  // A synced store belongs to one account; account B never reads A's settings row.
  stampLocalDataOwner(localDatabase(), 'A');
  Storage.setItemSync(syncedTargetsAdoptedKey('account:A'), 'true');
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  const write = jest.spyOn(userSettingsData, 'writeMuscleTargetSettings').mockRejectedValueOnce(Error('full'));
  edit('settings-muscle-target-chest', '12');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '12');
  expect(await screen.findByTestId('settings-muscle-preferences-error')).toHaveTextContent(/could not be saved/);
  expect(values().muscleTargetOverrides).toEqual({});
  write.mockRestore();
  fireEvent.press(screen.getByText('Retry'));
  await waitForGone(() => screen.queryByTestId('settings-muscle-preferences-error'));
  expect(values().muscleTargetOverrides.detailed?.chest).toBe(12);
  edit('settings-muscle-target-chest', 'bad');
  await act(async () => { setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); });
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '');
  expect(screen.queryByTestId('settings-muscle-target-chest-error')).toBeNull();
});

it('offers all detailed switches on the enablement page and updates the target list after returning', async () => {
  const page = render(<EnabledRoute />);
  await screen.findByTestId('settings-track-calves');
  fireEvent.press(screen.getByTestId('settings-track-calves'));
  await waitFor(() => expect(screen.getByTestId('settings-track-calves')).toHaveProp('accessibilityState', { checked: false }));
  page.unmount();
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.queryByTestId('settings-muscle-target-calves')).toBeNull();
});

it('shows the default with a usable empty state when no muscles are enabled', async () => {
  const rows = await setup.listMuscleReportRows();
  await setup.setMuscleTracked(rows.map(row => row.id), false);
  render(<TargetsRoute />);
  expect(await screen.findByTestId('settings-muscle-targets-empty')).toHaveStyle(META);
  expect(screen.getByTestId('settings-weekly-working-set-target')).toHaveProp('value', '8');
});

it('reports a load failure and retries without replacing the full page', async () => {
  const load = jest.spyOn(setup, 'listMuscleReportRows').mockRejectedValueOnce(Error('read failed'));
  render(<MusclesRoute />);
  await screen.findByTestId('settings-muscles-error');
  fireEvent.press(screen.getByTestId('settings-enabled-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-enabled-muscles');
  load.mockRestore();
  fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: true }));
  expect(screen.queryByTestId('settings-muscles-error')).toBeNull();
});

it('keeps Custom reporting unchanged until a preset is explicitly selected', async () => {
  await setup.listMuscleReportRows();
  localDatabase().update(muscleGroups).set({ reportGroup: 'chest' }).where(eq(muscleGroups.id, 'biceps')).run();
  render(<MusclesRoute />);
  expect(await screen.findByTestId('settings-muscle-custom')).toHaveStyle({ ...LABEL, color: uiRoles.ink });
  expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: false });
  expect(screen.getByTestId('settings-muscle-preset-broad')).toHaveProp('accessibilityState', { selected: false });
  fireEvent.press(screen.getByTestId('settings-enabled-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-enabled-muscles');
  expect(setup.deriveMuscleReportPreset(await setup.listMuscleReportRows())).toBe('custom');
  fireEvent.press(screen.getByTestId('settings-muscle-preset-detailed'));
  await waitForGone(() => screen.queryByTestId('settings-muscle-custom'));
  expect(screen.getByTestId('settings-enabled-muscles-row')).toBeTruthy();
});

it('retains the displayed preset on a failed database write and retries that choice', async () => {
  render(<MusclesRoute />);
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: true }));
  const write = jest.spyOn(localDatabase(), 'transaction').mockImplementationOnce(() => { throw Error('disk full'); });
  fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
  await screen.findByTestId('settings-muscles-error');
  expect(screen.getByTestId('settings-muscle-preset-detailed')).toHaveProp('accessibilityState', { selected: true });
  write.mockRestore();
  fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByTestId('settings-muscle-preset-broad')).toHaveProp('accessibilityState', { selected: true }));
  expect(screen.getByTestId('settings-enabled-muscles-row')).toBeTruthy();
  expect(screen.getByTestId('settings-muscle-preset-broad')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.queryByTestId('settings-muscles-error')).toBeNull();
});

it('ignores a late setup read from the previous account', async () => {
  const actual = await setup.listMuscleReportRows();
  let resolve!: (rows: typeof actual) => void;
  const stale = new Promise<typeof actual>(yes => { resolve = yes; });
  const read = jest.spyOn(setup, 'listMuscleReportRows').mockReturnValueOnce(stale);
  render(<TargetsRoute />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); });
  await screen.findByTestId('settings-muscle-target-chest');
  await act(async () => { resolve([{ ...actual[0], id: 'old-account', displayName: 'Previous account' }]); });
  expect(screen.queryByTestId('settings-muscle-target-old-account')).toBeNull();
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '');
  read.mockRestore();
});

it.each(['detailed', 'broad'] as const)('keeps enablement counts and navigation independent of the %s breakdown', async preset => {
  const rows = await setup.listMuscleReportRows();
  await setup.setMuscleReportPreset(preset);
  await setup.setMuscleTracked(['serratus_anterior'], false);
  const page = render(<MusclesRoute />);
  const label = `Enabled muscles, ${rows.length - 1} / ${rows.length}`;
  await screen.findByLabelText(label);
  fireEvent.press(screen.getByTestId('settings-enabled-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-enabled-muscles');
  page.unmount();
  const enabledPage = render(<EnabledRoute />);
  await screen.findByTestId('settings-track-serratus_anterior');
  expect(screen.getByTestId('settings-track-serratus_anterior')).toHaveProp('accessibilityState', { checked: false });
  expect(screen.getByTestId('settings-track-chest')).toHaveProp('accessibilityState', { checked: true });
  fireEvent.press(screen.getByTestId('settings-track-serratus_anterior'));
  await waitFor(() => expect(screen.getByTestId('settings-track-serratus_anterior')).toHaveProp('accessibilityState', { checked: true }));
  expect(setup.deriveMuscleReportPreset(await setup.listMuscleReportRows())).toBe(preset);
  enabledPage.unmount();
  render(<MusclesRoute />);
  await screen.findByLabelText(`Enabled muscles, ${rows.length} / ${rows.length}`);
  await act(async () => { await setup.setMuscleTracked(rows.map(row => row.id), false); });
  await screen.findByLabelText(`Enabled muscles, 0 / ${rows.length}`);
  fireEvent.press(screen.getByTestId('settings-enabled-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-enabled-muscles');
});
