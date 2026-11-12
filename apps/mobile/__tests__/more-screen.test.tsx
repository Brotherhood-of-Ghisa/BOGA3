/* eslint-disable import/first */

const mockPush = jest.fn();
const mockOpenURL = jest.fn();
const mockUseAuth = jest.fn();
const mockListConnectedAgents = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenURL(...args),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/auth/connected-agents', () => ({
  listConnectedAgents: () => mockListConnectedAgents(),
}));

jest.mock('@/src/utils/agent-connect', () => ({
  getAgentConnectUrl: () => 'https://example.test/connect',
}));

import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';

import { StyleSheet } from 'react-native';

import { useUiText } from '@/components/ui/text-roles';
import { AppThemeProvider } from '@/components/ui/theme-context';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
// The live text roles. Read before the render under test: `renderHook` would
// otherwise take over `screen`.
const liveText = () => renderHook(() => useUiText(), { wrapper: AppThemeProvider }).result.current;
import MoreScreen from '../app/(tabs)/more';

const agent = (name: string) => ({ clientId: name, grantedAt: '', lastAccessAt: null, name, planAccessEnabled: false, scopes: [] });

describe('More screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockOpenURL.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReset().mockReturnValue({ user: { id: 'user-1' } });
    mockListConnectedAgents.mockReset().mockResolvedValue([]);
  });

  it('shows two untitled cards in order, with no page title', async () => {
    renderWithTheme(<MoreScreen />);

    const rowsOf = (testID: string) =>
      screen
        .getByTestId(testID)
        .findAll((node) => typeof node.props.testID === 'string' && node.props.testID.endsWith('-row'), { deep: true })
        .map((node) => node.props.testID)
        .filter((id, index, ids) => ids.indexOf(id) === index);
    expect(rowsOf('more-group-1')).toEqual(['more-planner-row', 'more-exercises-row', 'more-gyms-row']);
    expect(rowsOf('more-group-2')).toEqual(['more-connect-ai-row', 'more-settings-row']);
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.queryByRole('header')).toBeNull();
    await waitFor(() => expect(mockListConnectedAgents).toHaveBeenCalled());
  });

  it.each([
    ['more-planner-row', '/planner'],
    ['more-gyms-row', '/gyms'],
    ['more-exercises-row', '/exercise-catalog'],
    ['more-settings-row', '/settings'],
  ])('opens %s at its route', async (testID, route) => {
    renderWithTheme(<MoreScreen />);
    await waitFor(() => expect(mockListConnectedAgents).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId(testID));

    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('names Planner, Exercises and Settings by their labels alone', async () => {
    renderWithTheme(<MoreScreen />);
    await waitFor(() => expect(mockListConnectedAgents).toHaveBeenCalled());

    expect(screen.getByTestId('more-planner-row').props.accessibilityLabel).toBe('Planner');
    expect(screen.getByTestId('more-exercises-row').props.accessibilityLabel).toBe('Exercises');
    expect(screen.getByTestId('more-settings-row').props.accessibilityLabel).toBe('Settings');
  });

  it('shows the connected agent and opens the agents screen', async () => {
    mockListConnectedAgents.mockResolvedValue([agent('Claude')]);
    renderWithTheme(<MoreScreen />);

    expect(await screen.findByText('Claude')).toBeTruthy();
    const row = screen.getByTestId('more-connect-ai-row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('Connect an AI, Claude');
    fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledWith('/connected-agents');
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('names every connected agent', async () => {
    mockListConnectedAgents.mockResolvedValue([agent('Claude'), agent('ChatGPT')]);
    renderWithTheme(<MoreScreen />);

    expect(await screen.findByText('Claude, ChatGPT')).toBeTruthy();
  });

  it('opens the setup instructions externally when no agent is connected', async () => {
    renderWithTheme(<MoreScreen />);
    await waitFor(() => expect(screen.getByTestId('more-connect-ai-row').props.accessibilityRole).toBe('link'));

    fireEvent.press(screen.getByTestId('more-connect-ai-row'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('https://example.test/connect'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the setup instructions when signed out, without reading agents', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    renderWithTheme(<MoreScreen />);

    const row = screen.getByTestId('more-connect-ai-row');
    expect(row.props.accessibilityRole).toBe('link');
    fireEvent.press(row);

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('https://example.test/connect'));
    expect(mockListConnectedAgents).not.toHaveBeenCalled();
  });

  it('opens the agents screen when the agent list cannot be read', async () => {
    mockListConnectedAgents.mockRejectedValue(new Error('offline'));
    renderWithTheme(<MoreScreen />);
    await waitFor(() => expect(mockListConnectedAgents).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId('more-connect-ai-row'));

    expect(mockPush).toHaveBeenCalledWith('/connected-agents');
  });

  it('shows an inline error when the setup page cannot open', async () => {
    mockOpenURL.mockRejectedValue(new Error('browser unavailable'));
    mockUseAuth.mockReturnValue({ user: null });
    const uiText = liveText();
    renderWithTheme(<MoreScreen />);

    fireEvent.press(screen.getByTestId('more-connect-ai-row'));

    const error = await screen.findByTestId('more-connect-ai-error');
    expect(error).toHaveTextContent('Couldn’t open the setup page. Try again.');
    expect(error).toHaveStyle({ ...StyleSheet.flatten(uiText.bodyStrong), color: roles.danger });
  });
});
