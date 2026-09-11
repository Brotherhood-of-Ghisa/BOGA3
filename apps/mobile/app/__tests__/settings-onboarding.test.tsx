/* eslint-disable import/first */

const mockOpenUrl = jest.fn();
const mockPush = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenUrl(...args),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
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

jest.mock('@/src/exercise-catalog/list-preferences', () => ({
  useExerciseListPreferences: () => [{ dateFormat: 'DD-MM-YYYY' }, jest.fn()],
}));

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

import SettingsRoute from '../(tabs)/settings';

describe('settings onboarding surface', () => {
  beforeEach(() => {
    mockOpenUrl.mockReset().mockResolvedValue(true);
    mockPush.mockReset();
    mockUseAuth.mockReset().mockReturnValue({
      user: { email: 'member@example.test', id: 'user-1' },
    });
  });

  it('renders the visible title and agreed signed-in section order with release metadata', () => {
    const result = render(<SettingsRoute />);
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
    render(<SettingsRoute />);

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
    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-connect-agent-row'));
    expect(await screen.findByText('Couldn’t open the setup page. Try again.')).toBeTruthy();

    mockOpenUrl.mockResolvedValueOnce(true);
    fireEvent.press(screen.getByTestId('settings-connect-agent-row'));

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('settings-connect-agent-error')).toBeNull();
    });
  });

  it('keeps signed-in-only management hidden while leaving setup and sync guidance useful', () => {
    mockUseAuth.mockReturnValue({ user: null });
    render(<SettingsRoute />);

    expect(screen.getByText('Sign in and manage your account.')).toBeTruthy();
    expect(screen.getByTestId('settings-connect-agent-row')).toBeTruthy();
    expect(screen.queryByTestId('settings-connected-agents-row')).toBeNull();
    expect(screen.getByTestId('settings-sync-signed-out-card')).toBeTruthy();
  });
});
