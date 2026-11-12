/* eslint-disable import/first */
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockScreenOptions = jest.fn();
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  Stack: { Screen: ({ options }: { options: unknown }) => { mockScreenOptions(options); return null; } },
}));

import type { ReactElement } from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { MuscleListPage } from '@/components/preferences/muscle-list-settings';
import { MuscleChoicePage } from '@/components/preferences/muscle-choice-settings';
import { CombinedMusclesPage } from '@/components/preferences/combined-muscles-settings';
import { CombinedMuscleEditorPage } from '@/components/preferences/combined-muscle-editor';
import { uiFonts } from '@/components/ui/tokens';
import { launchTheme } from '@/components/ui/theme-launch';
import { rolesFor } from './helpers/theme';
import * as setup from '@/src/data/muscle-report-settings';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded,
  setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const roles = rolesFor(launchTheme.appearance);

beforeEach(async () => {
  resetLocalData(); __resetAccountLocalPreferencesForTests();
  mockPush.mockReset(); mockBack.mockReset(); mockScreenOptions.mockReset();
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
});
afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

const row = async (id: string) => (await setup.readMuscleSetup()).rows.find(candidate => candidate.id === id)!;
const lastTitle = () => (mockScreenOptions.mock.calls.at(-1)?.[0] as { title?: string } | undefined)?.title;
const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked;
/** Presses the destructive button of the Alert the last press opened. */
const confirmAlert = (label: string) => {
  const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as { text: string; onPress?: () => void }[];
  act(() => { buttons.find(button => button.text === label)?.onPress?.(); });
};
const renderPage = async (page: ReactElement, ready: string) => {
  render(page);
  await screen.findByTestId(ready);
};

describe('the Muscles list', () => {
  it('lists every muscle by family, valued Off, On or its combined muscle, and opens its page', async () => {
    const key = await setup.createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps', 'triceps'] });
    await setup.setMuscleTracked(['forearms_grip'], false);
    await renderPage(<MuscleListPage />, 'settings-muscle-biceps');
    expect(screen.getByLabelText('Biceps, Arms')).toBeOnTheScreen();
    expect(screen.getByLabelText('Forearms, Off')).toBeOnTheScreen();
    expect(screen.getByLabelText('Calves, On')).toBeOnTheScreen();
    expect(within(screen.getByTestId('settings-muscles-family-Arms')).getByRole('header')).toHaveTextContent('Arms');
    expect(within(screen.getByTestId('settings-muscle-forearms_grip')).getByText('Off')).toHaveStyle({ color: roles.inkMuted });
    fireEvent.press(screen.getByTestId('settings-muscle-biceps'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings-muscle?id=biceps');
    // An Off member reads Off whatever combined muscle it keeps.
    await act(async () => { await setup.setMuscleTracked(['triceps'], false); });
    await screen.findByLabelText('Triceps, Off');
    expect((await row('triceps')).reportGroup).toBe(key);
  });
});

describe('one muscle', () => {
  it('saves Off, On and a combined muscle of its family at once, titled with its name', async () => {
    const arms = await setup.createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps'] });
    await setup.createCombinedMuscle({ name: 'Back', family: 'Back', memberIds: ['back_lats'] });
    await renderPage(<MuscleChoicePage muscleId="triceps" />, 'settings-muscle-on');
    expect(lastTitle()).toBe('Triceps');
    expect(checked('settings-muscle-on')).toBe(true);
    expect(screen.getByLabelText('Arms, Biceps')).toBeOnTheScreen();
    expect(screen.queryByText('Back')).toBeNull();
    fireEvent.press(screen.getByTestId(`settings-muscle-combine-${arms}`));
    await waitFor(() => expect(checked(`settings-muscle-combine-${arms}`)).toBe(true));
    expect(screen.getByLabelText('Arms, Biceps, Triceps')).toBeOnTheScreen();
    expect(await row('triceps')).toMatchObject({ reportGroup: arms, tracked: 1 });
    fireEvent.press(screen.getByTestId('settings-muscle-off'));
    await waitFor(() => expect(checked('settings-muscle-off')).toBe(true));
    expect(await row('triceps')).toMatchObject({ reportGroup: arms, tracked: 0 });
    // On returns an Off member to its combined muscle…
    fireEvent.press(screen.getByTestId('settings-muscle-on'));
    await waitFor(() => expect(checked(`settings-muscle-combine-${arms}`)).toBe(true));
    // …and takes an On member out of it.
    fireEvent.press(screen.getByTestId('settings-muscle-on'));
    await waitFor(() => expect(checked('settings-muscle-on')).toBe(true));
    expect(await row('triceps')).toMatchObject({ reportGroup: null, tracked: 1 });
  });

  it('writes nothing when the current choice is tapped again', async () => {
    await renderPage(<MuscleChoicePage muscleId="calves" />, 'settings-muscle-on');
    const write = jest.spyOn(localDatabase(), 'transaction');
    fireEvent.press(screen.getByTestId('settings-muscle-on'));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-muscle-off')).toBeEnabled();
  });

  it('opens a new combined muscle of its family with it ticked', async () => {
    await renderPage(<MuscleChoicePage muscleId="back_lats" />, 'settings-muscle-new-combined');
    expect(screen.getByText('Combine into')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('settings-muscle-new-combined'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings-combined-muscle?family=Back&member=back_lats');
  });

  it('keeps the choice on a failed write and retries it', async () => {
    await renderPage(<MuscleChoicePage muscleId="calves" />, 'settings-muscle-off');
    const write = jest.spyOn(localDatabase(), 'transaction').mockImplementationOnce(() => { throw Error('disk full'); });
    fireEvent.press(screen.getByTestId('settings-muscle-off'));
    expect(await screen.findByTestId('settings-muscles-error')).toHaveTextContent(/Couldn’t save the change/);
    expect(checked('settings-muscle-on')).toBe(true);
    write.mockRestore();
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(checked('settings-muscle-off')).toBe(true));
    expect(screen.queryByTestId('settings-muscles-error')).toBeNull();
  });

  it('says so when the muscle is gone', async () => {
    await renderPage(<MuscleChoicePage muscleId="nope" />, 'settings-muscle-missing');
  });
});

describe('Combined muscles', () => {
  it('shows the empty state, then each by family with its members, opening the editor', async () => {
    render(<CombinedMusclesPage />);
    const headerAdd = () => (mockScreenOptions.mock.calls.at(-1)?.[0] as { headerRight: () => ReactElement }).headerRight();
    // Before the setup is read the header + waits.
    expect(headerAdd().props).toMatchObject({ testID: 'settings-combined-muscles-add', disabled: true });
    await screen.findByTestId('settings-combined-muscles-empty');
    expect(screen.getByText('No combined muscles.')).toBeOnTheScreen();
    expect(headerAdd().props.disabled).toBe(false);
    fireEvent.press(screen.getByTestId('settings-combined-muscles-new'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings-combined-muscle');
    const options = mockScreenOptions.mock.calls.at(-1)?.[0] as { headerRight: () => ReactElement };
    render(options.headerRight());
    fireEvent.press(screen.getByTestId('settings-combined-muscles-add'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings-combined-muscle');
  });

  it('lists each with its members and replaces them all from Broad once confirmed', async () => {
    const key = await setup.createCombinedMuscle({ name: 'Guns', family: 'Arms', memberIds: ['biceps', 'triceps'] });
    jest.spyOn(Alert, 'alert');
    await renderPage(<CombinedMusclesPage />, `settings-combined-${key}`);
    expect(screen.getByLabelText('Guns, Biceps, Triceps')).toBeOnTheScreen();
    expect(within(screen.getByTestId('settings-combined-family-Arms')).getByRole('header')).toHaveTextContent('Arms');
    fireEvent.press(screen.getByTestId(`settings-combined-${key}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/settings-combined-muscle?key=${key}`);
    fireEvent.press(screen.getByTestId('settings-combined-muscles-broad'));
    confirmAlert('Cancel');
    expect((await setup.readMuscleSetup()).definitions).toHaveLength(1);
    fireEvent.press(screen.getByTestId('settings-combined-muscles-broad'));
    confirmAlert('Start from Broad');
    await screen.findByTestId('settings-combined-cm_chest');
    expect(screen.queryByTestId(`settings-combined-${key}`)).toBeNull();
  });
});

describe('the combined-muscle editor', () => {
  it('creates one: a family chosen first, Save needing a name and a muscle, then back', async () => {
    await renderPage(<CombinedMuscleEditorPage combinedKey={null} family={null} memberId={null} />, 'settings-combined-muscle-family-Arms');
    expect(lastTitle()).toBe('New combined muscle');
    expect(screen.queryByText('Muscles')).toBeNull();
    const save = () => screen.getByTestId('settings-combined-muscle-save');
    expect(save()).toBeDisabled();
    fireEvent.press(screen.getByTestId('settings-combined-muscle-family-Arms'));
    fireEvent.press(screen.getByTestId('settings-combined-muscle-member-biceps'));
    expect(save()).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), '  ');
    expect(save()).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), 'Guns');
    expect(save()).toHaveTextContent('Add combined muscle');
    // Changing family drops the other family's ticks.
    fireEvent.press(screen.getByTestId('settings-combined-muscle-family-Back'));
    expect(save()).toBeDisabled();
    fireEvent.press(screen.getByTestId('settings-combined-muscle-family-Arms'));
    fireEvent.press(screen.getByTestId('settings-combined-muscle-member-triceps'));
    fireEvent.press(save());
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const created = (await setup.readMuscleSetup()).definitions[0];
    expect(created).toMatchObject({ name: 'Guns', family: 'Arms' });
    expect(await row('triceps')).toMatchObject({ reportGroup: created.key, tracked: 1 });
    expect((await row('biceps')).reportGroup).toBeNull();
  });

  it('opens from a muscle with its family fixed and it ticked; ticking another moves it out of its combined muscle', async () => {
    const back = await setup.createCombinedMuscle({ name: 'Upper back', family: 'Back', memberIds: ['back_lats'] });
    await setup.setMuscleTracked(['back_lats'], false);
    await setup.createCombinedMuscle({ name: 'Wings', family: 'Back', memberIds: ['back_lats'] });
    await renderPage(<CombinedMuscleEditorPage combinedKey={null} family="Back" memberId="traps_upper" />, 'settings-combined-muscle-family');
    expect(screen.getByLabelText('Family: Back')).toBeOnTheScreen();
    expect(checked('settings-combined-muscle-member-traps_upper')).toBe(true);
    expect(screen.getByLabelText('Lats, in Wings')).toBeOnTheScreen();
    expect(within(screen.getByTestId('settings-combined-muscle-member-back_lats')).getByText('in Wings'))
      .toHaveStyle({ fontFamily: uiFonts.body.family, color: roles.inkMuted });
    fireEvent.press(screen.getByTestId('settings-combined-muscle-member-back_lats'));
    expect(screen.queryByText('in Wings')).toBeNull();
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), 'Traps');
    fireEvent.press(screen.getByTestId('settings-combined-muscle-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const traps = (await setup.readMuscleSetup()).definitions.find(muscle => muscle.name === 'Traps')!;
    expect((await row('back_lats')).reportGroup).toBe(traps.key);
    expect((await setup.readMuscleSetup()).definitions.map(muscle => muscle.key)).toContain(back);
  });

  it('edits one: renames, drops a member back to its own, and deletes it once confirmed', async () => {
    const key = await setup.createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps', 'triceps'] });
    jest.spyOn(Alert, 'alert');
    await renderPage(<CombinedMuscleEditorPage combinedKey={key} family={null} memberId={null} />, 'settings-combined-muscle-delete');
    expect(lastTitle()).toBe('Arms');
    expect(screen.getByTestId('settings-combined-muscle-name')).toHaveProp('value', 'Arms');
    expect(screen.getByTestId('settings-combined-muscle-save')).toHaveTextContent('Save');
    fireEvent.press(screen.getByTestId('settings-combined-muscle-member-triceps'));
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), 'Bis');
    fireEvent.press(screen.getByTestId('settings-combined-muscle-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect((await setup.readMuscleSetup()).definitions).toEqual([{ key, name: 'Bis', family: 'Arms' }]);
    expect(await row('triceps')).toMatchObject({ reportGroup: null, tracked: 1 });
    fireEvent.press(screen.getByTestId('settings-combined-muscle-delete'));
    expect(Alert.alert).toHaveBeenLastCalledWith('Delete Bis?', undefined, expect.any(Array));
    confirmAlert('Delete');
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(2));
    expect((await setup.readMuscleSetup()).definitions).toEqual([]);
    expect(await row('biceps')).toMatchObject({ reportGroup: null, tracked: 1 });
  });

  it('keeps Off members Off and in it on Save, so a combined muscle with every member Off can be renamed', async () => {
    const key = await setup.createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps', 'triceps'] });
    await setup.setMuscleTracked(['biceps', 'triceps'], false);
    await renderPage(<CombinedMuscleEditorPage combinedKey={key} family={null} memberId={null} />, 'settings-combined-muscle-save');
    expect(checked('settings-combined-muscle-member-biceps')).toBe(true);
    expect(screen.getByLabelText('Triceps, Off')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), 'Guns');
    expect(screen.getByTestId('settings-combined-muscle-save')).toBeEnabled();
    fireEvent.press(screen.getByTestId('settings-combined-muscle-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await row('biceps')).toMatchObject({ reportGroup: key, tracked: 0 });
    expect(await row('triceps')).toMatchObject({ reportGroup: key, tracked: 0 });
    expect((await setup.readMuscleSetup()).definitions[0].name).toBe('Guns');
  });

  it('never reads as missing while a delete saves, and stays with the error when it fails', async () => {
    const key = await setup.createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps'] });
    jest.spyOn(Alert, 'alert');
    await renderPage(<CombinedMuscleEditorPage combinedKey={key} family={null} memberId={null} />, 'settings-combined-muscle-delete');
    jest.spyOn(setup, 'deleteCombinedMuscle').mockRejectedValueOnce(Error('disk full'));
    fireEvent.press(screen.getByTestId('settings-combined-muscle-delete'));
    confirmAlert('Delete');
    expect(await screen.findByTestId('settings-muscles-error')).toHaveTextContent(/Couldn’t save the change/);
    expect(screen.getByTestId('settings-combined-muscle-name')).toHaveProp('value', 'Arms');
    expect(mockBack).not.toHaveBeenCalled();
    // Hold the delete after it is stored: the catalogue invalidation's re-read lands first.
    const remove = setup.deleteCombinedMuscle;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(setup, 'deleteCombinedMuscle').mockImplementationOnce(async target => { await remove(target); await held; });
    fireEvent.press(screen.getByTestId('settings-combined-muscle-delete'));
    confirmAlert('Delete');
    await waitFor(async () => expect((await setup.readMuscleSetup()).definitions).toEqual([]));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.queryByTestId('settings-combined-muscle-missing')).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(screen.queryByTestId('settings-combined-muscle-missing')).toBeNull();
    expect((await setup.readMuscleSetup()).definitions).toEqual([]);
  });

  it('shows a rule the save breaks and stays, without a Retry that would save twice', async () => {
    await renderPage(<CombinedMuscleEditorPage combinedKey={null} family="Arms" memberId="biceps" />, 'settings-combined-muscle-save');
    fireEvent.changeText(screen.getByTestId('settings-combined-muscle-name'), 'Arms');
    jest.spyOn(setup, 'createCombinedMuscle').mockRejectedValueOnce(new setup.CombinedMuscleError('Not allowed.'));
    fireEvent.press(screen.getByTestId('settings-combined-muscle-save'));
    expect(await screen.findByTestId('settings-muscles-error')).toHaveTextContent(/^Not allowed\./);
    expect(mockBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Retry'));
    await waitForGone(() => screen.queryByTestId('settings-muscles-error'));
    expect((await setup.readMuscleSetup()).definitions).toEqual([]);
  });

  it('says so when the combined muscle is gone', async () => {
    await renderPage(<CombinedMuscleEditorPage combinedKey="cm_gone" family={null} memberId={null} />, 'settings-combined-muscle-missing');
  });
});
