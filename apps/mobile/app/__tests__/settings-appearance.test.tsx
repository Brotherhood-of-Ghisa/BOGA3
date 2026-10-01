/* eslint-disable import/first */

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
// The sync-status panel has its own spec.
jest.mock('@/components/sync-status/sync-status-panel', () => ({ SyncStatusPanel: () => null }));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';

import { THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import { ensureExerciseListPreferencesLoaded } from '@/src/exercise-catalog/list-preferences';
import SettingsRoute from '../(tabs)/settings';

// Settings → Preferences → Appearance (`docs/specs/ui/ux-rules.md` §9b): the
// presets in a sheet, a choice saved per device at once, applied next launch.
// This suite launches in the default theme (nothing stored at import).

beforeEach(async () => {
  Storage.clearSync();
  // Settings' date-format controls load their preferences on mount; load them
  // first so the render settles inside the test.
  await ensureExerciseListPreferencesLoaded();
});

const openSheet = () => {
  fireEvent.press(screen.getByTestId('settings-appearance-row'));
  return screen.getByTestId('settings-appearance-sheet');
};

it('names the theme in use and lists every preset, the current one checked', () => {
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();

  const sheet = within(openSheet());
  for (const id of ['warm', 'slate', 'forest', 'plum']) {
    expect(sheet.getByTestId(`settings-appearance-option-${id}`)).toBeTruthy();
    // Decoration: hidden from accessibility, the label names the preset.
    expect(sheet.getByTestId(`settings-appearance-swatch-${id}`, { includeHiddenElements: true })).toBeTruthy();
  }
  expect(sheet.getByRole('radio', { name: 'Warm, default' }).props.accessibilityState).toEqual({ checked: true });
  expect(sheet.getByRole('radio', { name: 'Slate' }).props.accessibilityState).toEqual({ checked: false });
  expect(sheet.getByTestId('settings-appearance-note')).toHaveTextContent(
    'A new theme applies the next time you open BoGa.',
  );
});

it('saves a choice at once and says it applies next launch', async () => {
  render(<SettingsRoute />);
  const sheet = within(openSheet());

  fireEvent.press(sheet.getByTestId('settings-appearance-option-slate'));

  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('slate'));
  expect(sheet.getByRole('radio', { name: 'Slate' }).props.accessibilityState).toEqual({ checked: true });
  expect(sheet.getByTestId('settings-appearance-note')).toHaveTextContent(
    'Slate applies the next time you open BoGa. Close BoGa fully, then open it again.',
  );
  expect(screen.getByLabelText('Appearance, Slate from next launch')).toBeTruthy();

  // Choosing the theme in use again leaves nothing pending.
  fireEvent.press(sheet.getByTestId('settings-appearance-option-warm'));
  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('warm'));
  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();
});

it('keeps the previous choice and says nothing changed when the save fails', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<SettingsRoute />);
  const sheet = within(openSheet());

  fireEvent.press(sheet.getByTestId('settings-appearance-option-forest'));

  expect(await sheet.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
  expect(sheet.getByRole('radio', { name: 'Warm, default' }).props.accessibilityState).toEqual({ checked: true });
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBeNull();
  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();
});

it('shows a choice made earlier this run, read from the store', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Plum from next launch')).toBeTruthy();
});
