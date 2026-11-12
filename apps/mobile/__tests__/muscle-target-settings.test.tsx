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
import MuscleListRoute from '../app/settings-muscle-list';
import { uiTextFor } from '@/components/ui';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { launchTheme } from '@/components/ui/theme-launch';
import { rolesFor } from './helpers/theme';
import { muscleGroups } from '@/src/data/schema';
import { stampLocalDataOwner } from '@/src/data/local-wipe';
import * as setup from '@/src/data/muscle-report-settings';
import * as userSettingsData from '@/src/data/user-settings';
import '@/src/sync/synced-preferences-store';
import { syncedTargetsAdoptedKey } from '@/src/preferences/synced';
import { Storage } from 'expo-sqlite/kv-store';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, getAccountLocalPreferenceState,
  setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const roles = rolesFor(launchTheme.appearance);
const uiText = uiTextFor(roles);

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

const loadedMuscles = async () => {
  const rows = await setup.listMuscleReportRows();
  await screen.findByLabelText(`Muscles, ${rows.length} / ${rows.length} on`);
  return rows;
};

it('keeps targets on Muscles and opens the muscle list and combined muscles, with no breakdown switch', async () => {
  render(<MusclesRoute />);
  await loadedMuscles();
  expect(screen.getByLabelText('Combined muscles, 0')).toBeOnTheScreen();
  expect(screen.queryByTestId('settings-muscle-targets-row')).toBeNull();
  expect(screen.queryByTestId('settings-muscle-preset-broad')).toBeNull();
  expect(screen.queryByText(/Breakdown|Detailed|Broad|Custom/)).toBeNull();
  fireEvent.press(screen.getByTestId('settings-muscle-target-mode-per-muscle'));
  fireEvent.press(screen.getByTestId('settings-muscle-targets-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-muscle-targets');
  fireEvent.press(screen.getByTestId('settings-muscle-list-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-muscle-list');
  fireEvent.press(screen.getByTestId('settings-combined-muscles-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-combined-muscles');
  edit('settings-weekly-working-set-target', '11');
  expect(values().weeklyWorkingSetTarget).toBe(11);
  await act(async () => { await setup.applyBroadTemplate(); });
  await screen.findByLabelText('Combined muscles, 11');
  expect(screen.getByTestId('settings-weekly-working-set-target')).toHaveProp('value', '11');
});

const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' } as const;
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm } as const;

it('draws Muscles on the row vocabulary: section headings as micro-labels, row names as options, values muted', async () => {
  render(<MusclesRoute />);
  await loadedMuscles();
  expect(screen.getByText('Weekly targets')).toHaveStyle(LABEL);
  expect(screen.getByText('Muscle setup')).toHaveStyle(LABEL);
  expect(screen.getByText('Target mode')).toHaveStyle(uiText.option);
  expect(screen.getByText('Default target (sets / week)')).toHaveStyle(uiText.option);
  expect(screen.getByText('Combined muscles')).toHaveStyle(uiText.option);
  const status = within(screen.getByTestId('settings-muscle-list-row')).getByText(/\d+ \/ \d+ on/);
  expect(status).toHaveStyle({ fontFamily: uiFonts.body.family, color: roles.inkMuted });
  within(status).getAllByText(/^\d+$/).forEach(figure => expect(figure).toHaveStyle({ fontFamily: uiFonts.figure.family }));
  expect(screen.getByTestId('settings-muscle-list-row')).toHaveTextContent(/^Muscles/);
});

it('draws a muscle target row: the name as an option, a blank showing the default, an error as meta', async () => {
  updatePreferences({ muscleTargetMode: 'per-muscle' });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByText('Pectoralis')).toHaveStyle(uiText.option);
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('placeholder', '8');
  expect(screen.queryByTestId('settings-muscle-target-chest-reset')).toBeNull();
  edit('settings-muscle-target-chest', '0');
  expect(screen.getByTestId('settings-muscle-target-chest-error')).toHaveStyle({ ...META, color: roles.danger });
});

it('lists a combined muscle under its key, with no note about a breakdown', async () => {
  await act(async () => { await setup.applyBroadTemplate(); });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-cm_chest');
  expect(screen.getByText('Chest')).toBeOnTheScreen();
  expect(screen.queryByText(/apply to the/)).toBeNull();
});

it('clearing the default target commits the standard default, which the blank field shows', async () => {
  render(<MusclesRoute />);
  await screen.findByTestId('settings-weekly-working-set-target');
  expect(screen.getByTestId('settings-weekly-working-set-target')).toHaveProp('placeholder', '8');
  edit('settings-weekly-working-set-target', '11');
  expect(values().weeklyWorkingSetTarget).toBe(11);
  edit('settings-weekly-working-set-target', '');
  expect(values().weeklyWorkingSetTarget).toBe(8);
  expect(screen.getByTestId('settings-weekly-working-set-target')).toHaveProp('value', '8');
  expect(screen.queryByTestId('settings-weekly-working-set-target-error')).toBeNull();
  edit('settings-weekly-working-set-target', '0');
  expect(screen.getByTestId('settings-weekly-working-set-target-error')).toHaveTextContent('Enter a positive whole number.');
  expect(values().weeklyWorkingSetTarget).toBe(8);
});

it('lists only enabled muscles, including custom muscles, and restores hidden overrides on re-enable', async () => {
  await setup.listMuscleReportRows();
  await setup.setMuscleTracked(['chest'], false);
  localDatabase().insert(muscleGroups).values({ id: 'custom-neck', displayName: 'Neck', familyName: 'Back', sortOrder: 99, isEditable: 1 }).run();
  updatePreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: { chest: 14 } });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-custom-neck');
  expect(screen.queryByTestId('settings-muscle-target-chest')).toBeNull();
  expect(screen.getByTestId('settings-muscle-target-custom-neck')).toHaveProp('placeholder', '8');
  await act(async () => { await setup.setMuscleTracked(['chest'], true); });
  expect(await screen.findByTestId('settings-muscle-target-chest')).toHaveProp('value', '14');
  await act(async () => { await setup.setMuscleTracked(['chest'], false); });
  await waitForGone(() => screen.queryByTestId('settings-muscle-target-chest'));
  expect(values().muscleTargetOverrides.chest).toBe(14);
});

it.each([['targets', TargetsRoute, 'settings-muscle-target-solo-muscle'], ['muscle list', MuscleListRoute, 'settings-muscle-solo-muscle']] as const)(
  'titles a family section only above two or more muscles on the %s page', async (_page, Route, rowId) => {
    await setup.listMuscleReportRows();
    localDatabase().insert(muscleGroups).values({ id: 'solo-muscle', displayName: 'Solo', familyName: 'Solo family', sortOrder: 99, isEditable: 1 }).run();
    const rows = await setup.listMuscleReportRows();
    const sections = setup.buildSettingsMuscleSections(rows, null);
    const many = sections.find(section => section.muscles.length >= 2)!;
    render(<Route />);
    await screen.findByTestId(rowId);
    expect(within(screen.getByTestId('settings-muscles-family-Solo family')).queryByRole('header')).toBeNull();
    expect(within(screen.getByTestId(`settings-muscles-family-${many.family}`)).getByRole('header')).toHaveTextContent(many.family);
  });

it('inherits the live default, keeps one map across setups and clears one override by blanking it', async () => {
  updatePreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: { chest: 12, cm_chest: 18 } });
  render(<TargetsRoute />);
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '12');
  expect(screen.getByTestId('settings-muscle-target-calves')).toHaveProp('placeholder', '8');
  edit('settings-weekly-working-set-target', '9');
  expect(screen.getByTestId('settings-muscle-target-calves')).toHaveProp('placeholder', '9');
  edit('settings-muscle-target-calves', '6');
  edit('settings-muscle-target-chest', '');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('placeholder', '9');
  expect(values().muscleTargetOverrides).toEqual({ calves: 6, cm_chest: 18 });
  await act(async () => { await setup.applyBroadTemplate(); });
  await waitFor(() => expect(screen.getByTestId('settings-muscle-target-cm_chest')).toHaveProp('value', '18'));
  expect(screen.queryByTestId('settings-muscle-target-chest')).toBeNull();
  expect(screen.queryByTestId('settings-muscle-target-serratus_anterior')).toBeNull();
  edit('settings-muscle-target-cm_chest', '');
  expect(values().muscleTargetOverrides).toEqual({ calves: 6 });
  await act(async () => { await setup.clearCombinedMuscles(); });
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
  expect(values().muscleTargetOverrides.chest).toBe(12);
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
  expect(values().muscleTargetOverrides.chest).toBe(12);
  edit('settings-muscle-target-chest', 'bad');
  await act(async () => { setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); });
  await screen.findByTestId('settings-muscle-target-chest');
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '');
  expect(screen.queryByTestId('settings-muscle-target-chest-error')).toBeNull();
});

it('updates the target list after a muscle is turned Off', async () => {
  await act(async () => { await setup.setMuscleTracked(['calves'], false); });
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
  const load = jest.spyOn(setup, 'readMuscleSetup').mockRejectedValueOnce(Error('read failed'));
  render(<MusclesRoute />);
  await screen.findByTestId('settings-muscles-error');
  expect(screen.getByLabelText('Muscles, Loading…')).toBeOnTheScreen();
  fireEvent.press(screen.getByTestId('settings-muscle-list-row'));
  expect(mockPush).toHaveBeenLastCalledWith('/settings-muscle-list');
  load.mockRestore();
  fireEvent.press(screen.getByText('Retry'));
  await loadedMuscles();
  expect(screen.queryByTestId('settings-muscles-error')).toBeNull();
});

it('ignores a late setup read from the previous account', async () => {
  const actual = await setup.readMuscleSetup();
  let resolve!: (setup: typeof actual) => void;
  const stale = new Promise<typeof actual>(yes => { resolve = yes; });
  const read = jest.spyOn(setup, 'readMuscleSetup').mockReturnValueOnce(stale);
  render(<TargetsRoute />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); });
  await screen.findByTestId('settings-muscle-target-chest');
  await act(async () => { resolve({ definitions: [], rows: [{ ...actual.rows[0], id: 'old-account', displayName: 'Previous account' }] }); });
  expect(screen.queryByTestId('settings-muscle-target-old-account')).toBeNull();
  expect(screen.getByTestId('settings-muscle-target-chest')).toHaveProp('value', '');
  read.mockRestore();
});

it.each(['without', 'with'] as const)('counts muscles On %s combined muscles, Off members included', async combined => {
  const rows = await setup.listMuscleReportRows();
  if (combined === 'with') await setup.applyBroadTemplate();
  await setup.setMuscleTracked(['serratus_anterior'], false);
  render(<MusclesRoute />);
  await screen.findByLabelText(`Muscles, ${rows.length - 1} / ${rows.length} on`);
  expect(screen.getByLabelText(`Combined muscles, ${combined === 'with' ? 11 : 0}`)).toBeOnTheScreen();
  await act(async () => { await setup.setMuscleTracked(rows.map(row => row.id), false); });
  await screen.findByLabelText(`Muscles, 0 / ${rows.length} on`);
});
