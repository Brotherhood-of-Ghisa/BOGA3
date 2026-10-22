/* eslint-disable import/first */

const mockUseAuth = jest.fn();
const mockListConnectedAgents = jest.fn();
const mockRevokeConnectedAgent = jest.fn();
const mockSetAgentPlanPermission = jest.fn();
const mockSetAgentPlanEditEnabled = jest.fn();
const mockAlert = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/auth/connected-agents', () => ({
  listConnectedAgents: (...args: unknown[]) => mockListConnectedAgents(...args),
  revokeConnectedAgent: (...args: unknown[]) => mockRevokeConnectedAgent(...args),
  setAgentPlanPermission: (...args: unknown[]) => mockSetAgentPlanPermission(...args),
  setAgentPlanEditEnabled: (...args: unknown[]) => mockSetAgentPlanEditEnabled(...args),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ConnectedAgentsScreen from '../app/connected-agents';

const agent = {
  clientId: 'client-a',
  grantedAt: '2026-07-24T12:00:00.000Z',
  lastAccessAt: '2026-07-25T13:00:00.000Z',
  name: 'Coach Agent',
  planAccessEnabled: false,
  planEditEnabled: false,
  scopes: ['openid', 'profile'],
};

describe('Connected agents screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'user-a' } });
    mockListConnectedAgents.mockResolvedValue([agent]);
    mockRevokeConnectedAgent.mockResolvedValue(undefined);
    mockSetAgentPlanPermission.mockResolvedValue(undefined);
    mockSetAgentPlanEditEnabled.mockResolvedValue(undefined);
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

  it('leaves the title to the native header, with no intro under it', async () => {
    render(<ConnectedAgentsScreen />);

    await screen.findByTestId('connected-agent-client-a');
    expect(screen.queryByText('Connected agents')).toBeNull();
    expect(screen.queryByText(/^Agents can read training data only/)).toBeNull();
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

  it('shows change access and edit access off by default with the client named in disclosures', async () => {
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    expect(
      screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
    ).toEqual({ checked: false });
    const disclosure = screen.getByTestId('connected-agent-plan-disclosure-client-a');
    expect(String(disclosure.props.children)).toContain('Coach Agent');
    expect(String(disclosure.props.children)).toMatch(/upcoming and unscheduled plans/);
    expect(String(disclosure.props.children)).toMatch(/create new plans and programmes/);
    expect(String(disclosure.props.children)).toMatch(/add, edit, delete or restore exercises and their muscles/);
    expect(String(disclosure.props.children)).toMatch(/recalculate your past figures/);
    expect(String(disclosure.props.children)).toMatch(/never start a workout or change your logged sets/);
    expect(String(disclosure.props.children)).not.toMatch(/never edit or delete plans/);

    expect(
      screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
    ).toEqual({ checked: false });
    const editDisclosure = screen.getByTestId('connected-agent-plan-edit-disclosure-client-a');
    expect(String(editDisclosure.props.children)).toContain('Coach Agent');
    expect(String(editDisclosure.props.children)).toMatch(/edit pending session plans and training programmes/);
    expect(String(editDisclosure.props.children)).toMatch(/never edit workouts in progress or change logged workout history/);
  });

  it('enables plan access optimistically and persists it for the live grant', async () => {
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-access-client-a'));
    });

    expect(mockSetAgentPlanPermission).toHaveBeenCalledWith(
      'client-a',
      true,
      '2026-07-24T12:00:00.000Z',
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });

  it('enables plan edit optimistically and persists it for the live grant', async () => {
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-edit-client-a'));
    });

    expect(mockSetAgentPlanEditEnabled).toHaveBeenCalledWith(
      'client-a',
      true,
      '2026-07-24T12:00:00.000Z',
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });

  it('reverts the edit toggle and shows a retryable error when the write fails', async () => {
    mockSetAgentPlanEditEnabled.mockRejectedValue(
      new Error('Unable to update access for this coach right now.'),
    );
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-edit-client-a'));
    });

    expect(await screen.findByTestId('connected-agents-error')).toBeTruthy();
    expect(screen.getByText('Unable to update access for this coach right now.')).toBeTruthy();
    expect(
      screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
    ).toEqual({ checked: false });
  });

  it('reverts the toggle and shows a retryable error when the write fails', async () => {
    mockSetAgentPlanPermission.mockRejectedValue(
      new Error('Unable to update access for this coach right now.'),
    );
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-access-client-a'));
    });

    expect(await screen.findByTestId('connected-agents-error')).toBeTruthy();
    expect(screen.getByText('Unable to update access for this coach right now.')).toBeTruthy();
    expect(
      screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
    ).toEqual({ checked: false });
  });

  it('renders switches disabled and shows a warning when plan permission is unavailable', async () => {
    mockListConnectedAgents.mockResolvedValue([
      { ...agent, planAccessEnabled: 'unavailable', planEditEnabled: 'unavailable' },
    ]);
    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');

    const switchComponent = screen.getByTestId('connected-agent-plan-access-client-a');
    expect(switchComponent.props.accessibilityState).toEqual({ checked: false, disabled: true });
    const editSwitchComponent = screen.getByTestId('connected-agent-plan-edit-client-a');
    expect(editSwitchComponent.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(screen.getByTestId('connected-agent-plan-unavailable-client-a')).toBeTruthy();
    expect(
      screen.getByText('Change settings are temporarily unavailable for this coach.'),
    ).toBeTruthy();

    // Pressing does not invoke permissions update
    await act(async () => {
      fireEvent.press(switchComponent);
      fireEvent.press(editSwitchComponent);
    });
    expect(mockSetAgentPlanPermission).not.toHaveBeenCalled();
    expect(mockSetAgentPlanEditEnabled).not.toHaveBeenCalled();
  });

  it('serializes toggles per client so concurrent writes across distinct clients settle independently', async () => {
    const agentB = {
      clientId: 'client-b',
      grantedAt: '2026-07-25T12:00:00.000Z',
      lastAccessAt: null,
      name: 'Coach B',
      planAccessEnabled: false,
      planEditEnabled: false,
      scopes: ['openid'],
    };
    mockListConnectedAgents.mockResolvedValue([agent, agentB]);

    let resolveA: () => void = () => {};
    let resolveB: () => void = () => {};
    const promiseA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<void>((resolve) => {
      resolveB = resolve;
    });

    mockSetAgentPlanPermission.mockImplementation((clientId: string) => {
      if (clientId === 'client-a') return promiseA;
      if (clientId === 'client-b') return promiseB;
      return Promise.resolve();
    });

    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');
    await screen.findByTestId('connected-agent-client-b');

    // Toggle client A then client B concurrently
    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-access-client-a'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-access-client-b'));
    });

    // Both writes have been initiated
    expect(mockSetAgentPlanPermission).toHaveBeenCalledWith('client-a', true, agent.grantedAt);
    expect(mockSetAgentPlanPermission).toHaveBeenCalledWith('client-b', true, agentB.grantedAt);

    // Both switches show disabled while in flight
    expect(
      screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
    ).toEqual({ checked: true, disabled: true });
    expect(
      screen.getByTestId('connected-agent-plan-access-client-b').props.accessibilityState,
    ).toEqual({ checked: true, disabled: true });

    // Client B completes first
    await act(async () => {
      resolveB();
    });

    await waitFor(() => {
      // Client B is no longer disabled, Client A is still disabled
      expect(
        screen.getByTestId('connected-agent-plan-access-client-b').props.accessibilityState,
      ).toEqual({ checked: true });
      expect(
        screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
      ).toEqual({ checked: true, disabled: true });
    });

    // Client A completes second
    await act(async () => {
      resolveA();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('connected-agent-plan-access-client-a').props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });

  it('serializes edit toggles per client so concurrent writes across distinct clients settle independently', async () => {
    const agentB = {
      clientId: 'client-b',
      grantedAt: '2026-07-25T12:00:00.000Z',
      lastAccessAt: null,
      name: 'Coach B',
      planAccessEnabled: false,
      planEditEnabled: false,
      scopes: ['openid'],
    };
    mockListConnectedAgents.mockResolvedValue([agent, agentB]);

    let resolveA: () => void = () => {};
    let resolveB: () => void = () => {};
    const promiseA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<void>((resolve) => {
      resolveB = resolve;
    });

    mockSetAgentPlanEditEnabled.mockImplementation((clientId: string) => {
      if (clientId === 'client-a') return promiseA;
      if (clientId === 'client-b') return promiseB;
      return Promise.resolve();
    });

    render(<ConnectedAgentsScreen />);
    await screen.findByTestId('connected-agent-client-a');
    await screen.findByTestId('connected-agent-client-b');

    // Toggle client A then client B edit switches concurrently
    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-edit-client-a'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('connected-agent-plan-edit-client-b'));
    });

    // Both writes have been initiated
    expect(mockSetAgentPlanEditEnabled).toHaveBeenCalledWith('client-a', true, agent.grantedAt);
    expect(mockSetAgentPlanEditEnabled).toHaveBeenCalledWith('client-b', true, agentB.grantedAt);

    // Both edit switches show disabled while in flight
    expect(
      screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
    ).toEqual({ checked: true, disabled: true });
    expect(
      screen.getByTestId('connected-agent-plan-edit-client-b').props.accessibilityState,
    ).toEqual({ checked: true, disabled: true });

    // Client B completes first
    await act(async () => {
      resolveB();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('connected-agent-plan-edit-client-b').props.accessibilityState,
      ).toEqual({ checked: true });
      expect(
        screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
      ).toEqual({ checked: true, disabled: true });
    });

    // Client A completes second
    await act(async () => {
      resolveA();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('connected-agent-plan-edit-client-a').props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });
});
