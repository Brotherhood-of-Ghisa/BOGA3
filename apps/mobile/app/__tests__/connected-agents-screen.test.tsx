/* eslint-disable import/first */

const mockUseAuth = jest.fn();
const mockListConnectedAgents = jest.fn();
const mockRevokeConnectedAgent = jest.fn();
const mockAlert = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/auth/connected-agents', () => ({
  listConnectedAgents: (...args: unknown[]) => mockListConnectedAgents(...args),
  revokeConnectedAgent: (...args: unknown[]) => mockRevokeConnectedAgent(...args),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ConnectedAgentsScreen from '../connected-agents';

const agent = {
  clientId: 'client-a',
  grantedAt: '2026-07-24T12:00:00.000Z',
  lastAccessAt: '2026-07-25T13:00:00.000Z',
  name: 'Coach Agent',
  scopes: ['openid', 'profile'],
};

describe('Connected agents screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'user-a' } });
    mockListConnectedAgents.mockResolvedValue([agent]);
    mockRevokeConnectedAgent.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlert(...args));
  });

  it('shows agent name, read-only access, grant time, and last access', async () => {
    render(<ConnectedAgentsScreen />);

    expect(await screen.findByTestId('connected-agent-client-a')).toBeTruthy();
    expect(screen.getByText('Coach Agent')).toBeTruthy();
    expect(screen.getByText('Read training data')).toBeTruthy();
    expect(screen.getByTestId('connected-agent-granted-client-a')).toBeTruthy();
    expect(screen.getByTestId('connected-agent-last-access-client-a')).toBeTruthy();
    expect(screen.queryByText(/email|billing/i)).toBeNull();
  });

  it('confirms and revokes a grant, then removes it from the list', async () => {
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    fireEvent.press(screen.getByTestId('connected-agent-revoke-client-a'));
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [, , buttons] = mockAlert.mock.calls[0] as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];

    await act(async () => {
      buttons.find((button) => button.text === 'Revoke access')?.onPress?.();
    });

    await waitFor(() => {
      expect(mockRevokeConnectedAgent).toHaveBeenCalledWith('client-a');
    });
    expect(screen.queryByTestId('connected-agent-client-a')).toBeNull();
  });

  it('shows a retryable inline failure without exposing account data', async () => {
    mockListConnectedAgents.mockRejectedValue(new Error('Connection list unavailable.'));
    render(<ConnectedAgentsScreen />);

    expect(await screen.findByTestId('connected-agents-error')).toBeTruthy();
    expect(screen.getByText('Connection list unavailable.')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
