/* eslint-disable import/first */

const mockPush = jest.fn();
const mockOpenURL = jest.fn();
const mockUseAuth = jest.fn();
const mockIsDevMode = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenURL(...args),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/utils/agent-connect', () => ({
  getAgentConnectUrl: () => 'https://example.test/connect',
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import MoreScreen from '../(tabs)/more';

describe('More screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockOpenURL.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReset().mockReturnValue({ user: { id: 'user-1' } });
    mockIsDevMode.mockReset().mockReturnValue(false);
  });

  it('organizes every production destination under the approved sections', () => {
    render(<MoreScreen />);

    expect(screen.getByTestId('more-section-community')).toBeTruthy();
    expect(screen.getByTestId('more-section-tools')).toBeTruthy();
    expect(screen.getByTestId('more-section-library-account')).toBeTruthy();
    expect(screen.getByTestId('more-groups-row')).toBeTruthy();
    expect(screen.getByTestId('more-connect-agent-row')).toBeTruthy();
    expect(screen.getByTestId('more-connected-agents-row')).toBeTruthy();
    expect(screen.getByTestId('more-exercise-database-row')).toBeTruthy();
    expect(screen.getByTestId('more-settings-row')).toBeTruthy();
    expect(screen.queryByTestId('more-developer-logs-row')).toBeNull();
  });

  it.each([
    ['more-groups-row', '/groups'],
    ['more-connected-agents-row', '/connected-agents'],
    ['more-exercise-database-row', '/exercise-catalog'],
    ['more-settings-row', '/settings'],
  ])('opens %s at its existing route', (testID, route) => {
    render(<MoreScreen />);

    fireEvent.press(screen.getByTestId(testID));

    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('opens MCP setup externally and keeps external semantics accessible', async () => {
    render(<MoreScreen />);

    const row = screen.getByTestId('more-connect-agent-row');
    expect(row.props.accessibilityRole).toBe('link');
    expect(row.props.accessibilityLabel).toContain('opens in browser');
    fireEvent.press(row);

    await waitFor(() => {
      expect(mockOpenURL).toHaveBeenCalledWith('https://example.test/connect');
    });
  });

  it('shows an inline error when the MCP setup page cannot open', async () => {
    mockOpenURL.mockRejectedValue(new Error('browser unavailable'));
    render(<MoreScreen />);

    fireEvent.press(screen.getByTestId('more-connect-agent-row'));

    expect(await screen.findByTestId('more-connect-agent-error')).toHaveTextContent(
      'Couldn’t open the setup page. Try again.',
    );
    expect(screen.getByTestId('more-settings-row')).toBeTruthy();
  });

  it('hides account-bound agents when there is no authenticated user', () => {
    mockUseAuth.mockReturnValue({ user: null });
    render(<MoreScreen />);

    expect(screen.queryByTestId('more-connected-agents-row')).toBeNull();
    expect(screen.getByTestId('more-groups-row')).toBeTruthy();
    expect(screen.getByTestId('more-settings-row')).toBeTruthy();
  });

  it('exposes developer logs only through the shared development-mode gate', () => {
    mockIsDevMode.mockReturnValue(true);
    render(<MoreScreen />);

    fireEvent.press(screen.getByTestId('more-developer-logs-row'));

    expect(mockPush).toHaveBeenCalledWith('/dev-logs');
  });
});
