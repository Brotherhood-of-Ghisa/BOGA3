/* eslint-disable import/first */

// Covers the developer-only wipe affordances on the Settings screen: the
// dev-mode visibility gate (neither button in release, both in dev) and the
// two-step "wipe remote then wipe local" flow that prevents the just-deleted
// server rows from being re-pushed by the next sync cycle.

const mockPush = jest.fn();
const mockIsDevMode = jest.fn();
const mockResetLocalDataAndReseed = jest.fn();
const mockWipeLocalAndReBootstrap = jest.fn();
const mockWipeRemoteForCurrentUser = jest.fn();
const mockAlert = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/data', () => ({
  resetLocalDataAndReseed: (...args: unknown[]) => mockResetLocalDataAndReseed(...args),
}));

jest.mock('@/src/sync/dev-affordances', () => ({
  wipeLocalAndReBootstrap: (...args: unknown[]) => mockWipeLocalAndReBootstrap(...args),
  wipeRemoteForCurrentUser: (...args: unknown[]) => mockWipeRemoteForCurrentUser(...args),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SettingsRoute from '../(tabs)/settings';

describe('settings developer wipe affordances', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockIsDevMode.mockReset().mockReturnValue(true);
    mockResetLocalDataAndReseed.mockReset();
    mockWipeLocalAndReBootstrap.mockReset().mockResolvedValue(undefined);
    mockWipeRemoteForCurrentUser.mockReset().mockResolvedValue({ rowsDeleted: 0 });
    mockAlert.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlert(...args));
  });

  it('renders neither wipe button when not in dev mode', () => {
    mockIsDevMode.mockReturnValue(false);

    render(<SettingsRoute />);

    expect(screen.queryByTestId('settings-dev-tools-card')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-local-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-remote-button')).toBeNull();
  });

  it('renders both wipe buttons when in dev mode', () => {
    mockIsDevMode.mockReturnValue(true);

    render(<SettingsRoute />);

    expect(screen.getByTestId('settings-dev-wipe-local-button')).toBeTruthy();
    expect(screen.getByTestId('settings-dev-wipe-remote-button')).toBeTruthy();
  });

  it('wipes local and re-bootstraps when the local button is pressed', async () => {
    render(<SettingsRoute />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-dev-wipe-local-button'));
    });

    await waitFor(() => {
      expect(mockWipeLocalAndReBootstrap).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('settings-dev-wipe-local-feedback')).toBeTruthy();
  });

  it('confirms before the remote wipe and then wipes remote AND local in order', async () => {
    mockWipeRemoteForCurrentUser.mockResolvedValue({ rowsDeleted: 5 });
    const order: string[] = [];
    mockWipeRemoteForCurrentUser.mockImplementation(async () => {
      order.push('remote');
      return { rowsDeleted: 5 };
    });
    mockWipeLocalAndReBootstrap.mockImplementation(async () => {
      order.push('local');
    });

    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-dev-wipe-remote-button'));

    // The destructive remote wipe is gated behind a confirmation modal.
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = mockAlert.mock.calls[0] as [
      string,
      string,
      { text: string; style?: string; onPress?: () => void }[],
    ];
    expect(title).toBe('Wipe remote data?');
    expect(message).toContain('EVERY row on the server owned by your account');

    const confirmButton = buttons.find((button) => button.style === 'destructive');
    expect(confirmButton).toBeDefined();

    // Nothing runs until the user confirms.
    expect(mockWipeRemoteForCurrentUser).not.toHaveBeenCalled();
    expect(mockWipeLocalAndReBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      confirmButton?.onPress?.();
    });

    await waitFor(() => {
      expect(mockWipeRemoteForCurrentUser).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockWipeLocalAndReBootstrap).toHaveBeenCalledTimes(1);
    });
    // Remote first, then local — so the local rows do not re-push the deleted
    // server rows.
    expect(order).toEqual(['remote', 'local']);
    expect(await screen.findByText(/Deleted 5 server rows/)).toBeTruthy();
  });

  it('does not wipe local if the remote wipe fails', async () => {
    mockWipeRemoteForCurrentUser.mockRejectedValue(new Error('FORBIDDEN_ENV: nope'));

    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-dev-wipe-remote-button'));
    const [, , buttons] = mockAlert.mock.calls[0] as [
      string,
      string,
      { text: string; style?: string; onPress?: () => void }[],
    ];
    await act(async () => {
      buttons.find((button) => button.style === 'destructive')?.onPress?.();
    });

    await waitFor(() => {
      expect(screen.getByText('FORBIDDEN_ENV: nope')).toBeTruthy();
    });
    expect(mockWipeLocalAndReBootstrap).not.toHaveBeenCalled();
  });
});
