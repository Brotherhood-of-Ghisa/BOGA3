/* eslint-disable import/first */

/**
 * Settings → Appearance (`docs/specs/ui/design-language.md` "Presets"): the
 * theme presets as radio rows on a page, a choice saved per device at once and
 * applied on the next launch, the Custom colour row that opens the picker, and
 * the failures that must be logged rather than silent. Settings home's row
 * names the choice and pushes the page.
 *
 * The choice lives in expo-sqlite's key-value store, faked in memory for every
 * suite by jest.setup.ts and read back here. Replaced: the router, the auth
 * hook, the bodyweight row and the sync-status panel (their own specs), and the
 * log sink, which is observed. A failed read or save is forced once with
 * `jest.spyOn`; an unusable stored choice at launch with `jest.replaceProperty`.
 */

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
// The sync-status panel has its own spec.
jest.mock('@/components/sync-status/sync-status-panel', () => ({ SyncStatusPanel: () => null }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';

import * as themeLaunch from '@/components/ui/theme-launch';
import { THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { ensureExerciseListPreferencesLoaded } from '@/src/exercise-catalog/list-preferences';
import SettingsAppearanceRoute from '../app/settings-appearance';
import SettingsRoute from '../app/settings';

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

const radio = (name: string) => screen.getByRole('radio', { name });

it('names the theme in use on Settings home and pushes the Appearance page', () => {
  render(<SettingsRoute />);
  fireEvent.press(screen.getByLabelText('Appearance, Warm'));
  expect(mockPush).toHaveBeenCalledWith('/settings-appearance');
});

it('lists every preset as a radio row with its swatch, the current one checked', () => {
  render(<SettingsAppearanceRoute />);
  for (const id of ['warm', 'slate', 'forest', 'plum']) {
    expect(screen.getByTestId(`settings-appearance-option-${id}`)).toBeTruthy();
    // Decoration: hidden from accessibility, the label names the preset.
    expect(screen.getByTestId(`settings-appearance-swatch-${id}`, { includeHiddenElements: true })).toBeTruthy();
  }
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });
  expect(radio('Slate').props.accessibilityState).toEqual({ checked: false });
  // Only the section's footnote states when a choice applies; nothing is pending.
  expect(screen.getByText('Applies next launch')).toBeTruthy();
  expect(screen.queryByText('Next launch')).toBeNull();
  // The vocabulary's rows only: no button on the page.
  expect(screen.queryByRole('button', { name: /use this colour|save|apply/i })).toBeNull();
});

it('shows a preset’s detail as meta beside its swatch', () => {
  render(<SettingsAppearanceRoute />);
  expect(screen.getByText('Default')).toHaveStyle({ fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm });
});

it('saves a choice at once and labels it as applying next launch', async () => {
  render(<SettingsAppearanceRoute />);

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('slate'));
  expect(radio('Slate, next launch').props.accessibilityState).toEqual({ checked: true });
  expect(within(screen.getByTestId('settings-appearance-option-slate')).getByText('Next launch')).toBeTruthy();

  // Choosing the theme in use again leaves nothing pending.
  fireEvent.press(screen.getByTestId('settings-appearance-option-warm'));
  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('warm'));
  expect(screen.queryByText('Next launch')).toBeNull();
  expect(within(screen.getByTestId('settings-appearance-option-warm')).getByText('Default')).toBeTruthy();
});

it('keeps the previous choice and says nothing changed, in a danger notice, when the save fails', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<SettingsAppearanceRoute />);

  fireEvent.press(screen.getByTestId('settings-appearance-option-forest'));

  expect(await screen.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
  expect(screen.getByTestId('settings-appearance-error').props.accessibilityRole).toBe('alert');
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBeNull();
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
  render(<SettingsAppearanceRoute />);
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });

  fireEvent.press(screen.getByTestId('settings-appearance-option-warm'));

  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('warm'));
});

it('shows a choice made earlier this run, read from the store', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Plum from next launch')).toBeTruthy();
});

it('updates Settings home when the Appearance page saves a choice', async () => {
  render(
    <>
      <SettingsRoute />
      <SettingsAppearanceRoute />
    </>,
  );
  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

  expect(await screen.findByLabelText('Appearance, Slate from next launch')).toBeTruthy();
});

it('offers a custom colour last, a navigate row that pushes the picker route', () => {
  render(<SettingsAppearanceRoute />);
  const custom = screen.getByTestId('settings-appearance-option-custom');
  // The label and chevron say it opens a picker; no value while no custom colour is chosen.
  expect(within(custom).getAllByText(/./).map(node => node.props.children)).toEqual(['Custom colour']);

  fireEvent.press(custom);

  expect(mockPush).toHaveBeenCalledWith('/theme-colour');
});

it('names a custom colour chosen earlier this run on its row, no preset checked', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'hue:200');
  render(<SettingsAppearanceRoute />);

  expect(within(screen.getByTestId('settings-appearance-option-custom')).getByText('Teal, 200° · Next launch')).toBeTruthy();
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: false });
});
