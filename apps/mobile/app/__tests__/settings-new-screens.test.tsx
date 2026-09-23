/* eslint-disable import/first */

jest.mock('expo-linking', () => ({
  openURL: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('@/components/sync-status/sync-status-panel', () => ({
  SyncStatusPanel: () => null,
}));

jest.mock('@/src/data', () => ({
  resetLocalDataAndReseed: jest.fn(),
}));

jest.mock('@/src/sync/dev-affordances', () => ({
  wipeLocalAndReBootstrap: jest.fn(),
  wipeRemoteForCurrentUser: jest.fn(),
}));

// Not dev-gated: the row must render on the real (non-dev) build.
jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => false,
}));

jest.mock('@/src/utils/runtime-metadata', () => ({
  formatVersionBuild: () => null,
  readAppRuntimeMetadata: () => ({}),
}));

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import {
  __resetNewScreensPreferenceForTests,
  getNewScreensEnabledSnapshot,
  setNewScreensEnabled,
} from '@/src/session-recorder/new-screens-preference';

import SettingsRoute from '../(tabs)/settings';

describe('settings new exercise/session screens row', () => {
  beforeEach(() => {
    __resetExerciseListPreferencesForTests();
    __resetNewScreensPreferenceForTests();
  });

  afterEach(() => {
    __resetExerciseListPreferencesForTests();
    __resetNewScreensPreferenceForTests();
  });

  it('sits in the Preferences card after the date format, defaulting to On', async () => {
    const result = render(<SettingsRoute />);
    await act(async () => {});

    const tree = JSON.stringify(result.toJSON());
    const ordered = [
      'settings-preferences-card',
      'settings-date-format-YYYY-MM-DD',
      'settings-new-screens-group',
      'settings-section-data-sync',
    ].map((id) => tree.indexOf(id));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);

    expect(screen.getByText('New exercise & session screens')).toBeTruthy();
    expect(
      screen.getByText('The redesigned exercise page and session view. Turn off to use the previous recorder for now.')
    ).toBeTruthy();
    expect(screen.getByTestId('settings-new-screens-on').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('settings-new-screens-off').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('turns the preference off and back on', async () => {
    render(<SettingsRoute />);
    await act(async () => {});

    fireEvent.press(screen.getByTestId('settings-new-screens-off'));
    await act(async () => {});
    expect(getNewScreensEnabledSnapshot()).toBe(false);
    expect(screen.getByTestId('settings-new-screens-off').props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(screen.getByTestId('settings-new-screens-on'));
    await act(async () => {});
    expect(getNewScreensEnabledSnapshot()).toBe(true);
    expect(screen.getByTestId('settings-new-screens-on').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('reflects a value changed elsewhere, e.g. by the Maestro harness', async () => {
    render(<SettingsRoute />);
    await act(async () => {});

    await act(async () => {
      await setNewScreensEnabled(false);
    });

    expect(screen.getByTestId('settings-new-screens-off').props.accessibilityState).toEqual({
      selected: true,
    });
  });
});
