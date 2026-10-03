/* eslint-disable import/first */

/**
 * The Settings onboarding surface: section order, release metadata, the
 * external setup link and the signed-out state. Nothing here reads or writes
 * app data; the screen runs over the in-memory SQLite fixture
 * (helpers/local-data.ts) with its real preferences store. Replaced: the
 * router, the system browser, the auth hook, dev mode, build metadata and the
 * native navigation focus lifecycle.
 */

const mockOpenUrl = jest.fn();
const mockPush = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenUrl(...args),
}));

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  const { useEffect } = require('react');
  return {
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
  };
});

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('@/src/utils/agent-connect', () => ({
  getAgentConnectUrl: () => 'https://setup.example.test/connect',
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => true,
}));

jest.mock('@/src/utils/runtime-metadata', () => ({
  formatVersionBuild: () => 'Version 1.2.3 (build 45)',
  readAppRuntimeMetadata: () => ({
    buildNumber: '45',
    displayFlavor: 'preview',
    releaseCodename: 'Jemiliano',
    version: '1.2.3',
  }),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsRoute from '../app/(tabs)/settings';
import {
  __resetExerciseListPreferencesForTests,
  ensureExerciseListPreferencesLoaded,
} from '@/src/exercise-catalog/list-preferences';
import { closeLocalData, resetLocalData } from './helpers/local-data';

// The preferences card reads its store on mount; load it first so the read
// lands in the test.
const renderSettings = async () => {
  await ensureExerciseListPreferencesLoaded();
  return render(<SettingsRoute />);
};

describe('settings onboarding surface', () => {
  afterEach(() => {
    closeLocalData();
  });

  beforeEach(() => {
    resetLocalData();
    __resetExerciseListPreferencesForTests();
    mockOpenUrl.mockReset().mockResolvedValue(true);
    mockPush.mockReset();
    mockUseAuth.mockReset().mockReturnValue({
      user: { email: 'member@example.test', id: 'user-1' },
    });
  });

  it('renders the visible title and agreed signed-in section order with release metadata', async () => {
    const result = await renderSettings();
    const tree = JSON.stringify(result.toJSON());
    const orderedSectionIds = [
      'settings-section-account',
      'settings-section-ai-coaching',
      'settings-section-preferences',
      'settings-section-data-sync',
      'settings-section-about',
      'settings-section-developer-tools',
    ];

    expect(screen.getByText('Settings')).toBeTruthy();
    expect(orderedSectionIds.map((id) => tree.indexOf(id))).toEqual(
      orderedSectionIds.map((id) => expect.any(Number)),
    );
    for (let index = 1; index < orderedSectionIds.length; index += 1) {
      expect(tree.indexOf(orderedSectionIds[index])).toBeGreaterThan(
        tree.indexOf(orderedSectionIds[index - 1]),
      );
    }
    expect(screen.getByText('member@example.test')).toBeTruthy();
    expect(screen.getByText('Version 1.2.3 (build 45)')).toBeTruthy();
    expect(screen.getByText('Release Jemiliano')).toBeTruthy();
    expect(screen.getByText('Flavor Preview')).toBeTruthy();
  });

  it('opens the public setup page as an external link', async () => {
    await renderSettings();

    const connectRow = screen.getByTestId('settings-connect-agent-row');
    expect(connectRow.props.accessibilityRole).toBe('link');
    expect(connectRow.props.accessibilityHint).toContain('system browser');
    fireEvent.press(connectRow);

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith('https://setup.example.test/connect');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps a failed browser launch inline and retryable', async () => {
    mockOpenUrl.mockRejectedValueOnce(new Error('No browser'));
    await renderSettings();

    fireEvent.press(screen.getByTestId('settings-connect-agent-row'));
    expect(await screen.findByText('Couldn’t open the setup page. Try again.')).toBeTruthy();

    mockOpenUrl.mockResolvedValueOnce(true);
    fireEvent.press(screen.getByTestId('settings-connect-agent-row'));

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('settings-connect-agent-error')).toBeNull();
    });
  });

  it('keeps signed-in-only management hidden while leaving setup and sync guidance useful', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    await renderSettings();

    expect(screen.getByText('Sign in and manage your account.')).toBeTruthy();
    expect(screen.getByTestId('settings-connect-agent-row')).toBeTruthy();
    expect(screen.queryByTestId('settings-connected-agents-row')).toBeNull();
    expect(screen.getByTestId('settings-sync-signed-out-card')).toBeTruthy();
  });
});
