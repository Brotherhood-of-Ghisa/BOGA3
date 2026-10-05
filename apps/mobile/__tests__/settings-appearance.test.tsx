/* eslint-disable import/first */

/**
 * Settings → Preferences → Appearance (`docs/specs/ui/design-language.md` "Presets"): the
 * theme presets in a sheet, a choice saved per device at once and applied on
 * the next launch, and the failures that must be logged rather than silent.
 *
 * The choice lives in expo-sqlite's key-value store, faked in memory for every
 * suite by jest.setup.ts and read back here. The row reads no SQLite data.
 * Replaced: the router, the auth hook, the bodyweight row and the sync-status
 * panel (their own specs), and the log sink, which is observed. A failed read
 * or save is forced once with `jest.spyOn`; an unusable stored choice at
 * launch with `jest.replaceProperty`.
 */

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
// The sync-status panel has its own spec.
jest.mock('@/components/sync-status/sync-status-panel', () => ({ SyncStatusPanel: () => null }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Modal } from 'react-native';
import { Storage } from 'expo-sqlite/kv-store';

import * as themeLaunch from '@/components/ui/theme-launch';
import { THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import { ensureExerciseListPreferencesLoaded } from '@/src/exercise-catalog/list-preferences';
import SettingsRoute from '../app/(tabs)/settings';

// This suite launches in the default theme (nothing stored at import).

beforeEach(async () => {
  mockLogEvent.mockReset();
  mockPush.mockReset();
  // Settings' date-format controls load their preferences on mount; load them
  // first so the render settles inside the test.
  await ensureExerciseListPreferencesLoaded();
});

afterEach(() => {
  jest.restoreAllMocks();
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
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'warn',
      event: 'theme.save_failed',
      context: { presetId: 'forest', error: 'disk full' },
    }),
  );
});

it('shows the theme in use, and logs why, when the store cannot be read', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
    throw new Error('database is locked');
  });
  render(<SettingsRoute />);

  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'database is locked' } }),
  );
});

it('replaces an unusable stored choice when the default is chosen again', async () => {
  // This launch fell back to Warm because the stored id names no preset.
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'neon');
  jest.replaceProperty(themeLaunch, 'launchTheme', {
    ...themeLaunch.launchTheme,
    problem: { kind: 'unknown-preset', storedId: 'neon' },
  });
  render(<SettingsRoute />);
  const sheet = within(openSheet());
  expect(sheet.getByRole('radio', { name: 'Warm, default' }).props.accessibilityState).toEqual({ checked: true });

  fireEvent.press(sheet.getByTestId('settings-appearance-option-warm'));

  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('warm'));
});

it('shows a choice made earlier this run, read from the store', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Plum from next launch')).toBeTruthy();
});

it('offers a custom colour last, opening the picker once the sheet has gone', () => {
  render(<SettingsRoute />);
  const sheet = within(openSheet());
  const custom = sheet.getByTestId('settings-appearance-option-custom');
  expect(custom.props.accessibilityState).toEqual({ checked: false });
  expect(sheet.getByText('Pick any colour')).toBeTruthy();

  fireEvent.press(custom);
  // The sheet's modal must be gone before a route can be pushed over it.
  expect(mockPush).not.toHaveBeenCalled();
  act(() => screen.UNSAFE_getByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith('/theme-colour');

  // Dismissing the sheet any other way opens nothing.
  mockPush.mockReset();
  act(() => screen.UNSAFE_getByType(Modal).props.onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
});

it('names a custom colour chosen earlier this run, checked in the sheet', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'hue:200');
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Custom (Teal) from next launch')).toBeTruthy();

  const sheet = within(openSheet());
  expect(sheet.getByTestId('settings-appearance-option-custom').props.accessibilityState).toEqual({ checked: true });
  expect(sheet.getByText('Teal, 200°')).toBeTruthy();
  expect(sheet.getByRole('radio', { name: 'Warm, default' }).props.accessibilityState).toEqual({ checked: false });
});
