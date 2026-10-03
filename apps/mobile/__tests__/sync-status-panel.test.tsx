/* eslint-disable import/first */

/**
 * The Settings sync-status panel: renders the four signed-in fields — last
 * successful sync time, pending (dirty) change count, network state (with an
 * unknown network shown as "Checking…", never as offline or online), and error
 * state — from an injected status source, refreshes on focus, and nudges a sync
 * cycle on the manual refresh press. Each field carries a stable testID so the
 * Maestro flow and these unit tests can pin it.
 */

// Stub useFocusEffect with a real effect so it mirrors the navigation
// focus/blur lifecycle: run the (memoized) callback on focus (mount here) AND
// invoke the cleanup it returns on unmount. Calling the callback without
// honoring its cleanup would leak the panel's polling setInterval past the
// test and hang the --detectOpenHandles guard.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  const { useEffect } = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      useEffect(() => callback(), [callback]);
    },
  };
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { StyleSheet } from 'react-native';

import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import { uiRoles } from '@/components/ui';
import type { SyncStatusSnapshot } from '@/src/sync/sync-status';

const baseStatus: SyncStatusSnapshot = {
  lastSuccessAtMs: null,
  dirtyCount: 0,
  errorMessage: null,
  authRequired: false,
  networkState: 'online',
  bootstrapCompleted: true,
  blockedRowCount: 0,
};

const renderPanel = (overrides: Partial<SyncStatusSnapshot> = {}, onRequestSync = jest.fn()) => {
  const readStatus = jest.fn().mockResolvedValue({ ...baseStatus, ...overrides });
  const utils = render(<SyncStatusPanel onRequestSync={onRequestSync} readStatus={readStatus} />);
  return { readStatus, onRequestSync, ...utils };
};

describe('Settings sync-status panel', () => {
  it('keeps simultaneous sync and preference errors in one Error row and uses Refresh for both', async () => {
    const readStatus = jest.fn().mockResolvedValue({ ...baseStatus, errorMessage: 'server unreachable' });
    const onRequestSync = jest.fn();
    const onRefreshPreferences = jest.fn().mockResolvedValue(undefined);
    const preferenceError = 'Preferences could not be saved. Try again.';
    const { rerender } = render(<SyncStatusPanel readStatus={readStatus} onRequestSync={onRequestSync}
      onRefreshPreferences={onRefreshPreferences} preferenceError={preferenceError} />);
    await waitFor(() => expect(screen.getByTestId('settings-sync-status-error'))
      .toHaveTextContent(/server unreachable[\s\S]*Preferences could not be saved\. Try again\./));
    expect(screen.getAllByTestId('settings-sync-status-error-row')).toHaveLength(1);
    expect(screen.queryByText('Retry')).toBeNull();
    const readsBefore = readStatus.mock.calls.length;
    await act(async () => { fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button')); });
    expect(onRefreshPreferences).toHaveBeenCalledTimes(1);
    expect(onRequestSync).toHaveBeenCalledTimes(1);
    expect(readStatus.mock.calls.length).toBeGreaterThan(readsBefore);
    rerender(<SyncStatusPanel readStatus={readStatus} onRequestSync={onRequestSync}
      onRefreshPreferences={onRefreshPreferences} preferenceError={null} />);
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('server unreachable');
    expect(screen.getByTestId('settings-sync-status-error')).not.toHaveTextContent(preferenceError);
  });

  it('uses the existing signed-out card for preference failures and Refresh retries without starting sync', async () => {
    const readStatus = jest.fn();
    const onRequestSync = jest.fn();
    const onRefreshPreferences = jest.fn().mockResolvedValue(undefined);
    const preferenceError = 'Preferences could not be loaded. Try again.';
    const { rerender } = render(<SyncStatusPanel isSignedIn={false} readStatus={readStatus}
      onRequestSync={onRequestSync} onRefreshPreferences={onRefreshPreferences} preferenceError={preferenceError} />);
    expect(screen.getByTestId('settings-sync-signed-out-card')).toBeTruthy();
    expect(screen.queryByTestId('settings-sync-status-card')).toBeNull();
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent(preferenceError);
    expect(screen.queryByTestId('settings-sync-status-network')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button')); });
    expect(onRefreshPreferences).toHaveBeenCalledTimes(1);
    expect(readStatus).not.toHaveBeenCalled();
    expect(onRequestSync).not.toHaveBeenCalled();
    rerender(<SyncStatusPanel isSignedIn={false} readStatus={readStatus} onRequestSync={onRequestSync} />);
    expect(screen.getByText('Sign in through Account to sync your training data.')).toBeTruthy();
    expect(screen.queryByTestId('settings-sync-status-error')).toBeNull();
    expect(screen.queryByTestId('settings-sync-status-refresh-button')).toBeNull();
  });

  it('hides a previous account’s sync error when signed out while keeping current preference feedback', async () => {
    const readStatus = jest.fn().mockResolvedValue({ ...baseStatus, errorMessage: 'previous sync failed' });
    const { rerender } = render(<SyncStatusPanel readStatus={readStatus} />);
    await waitFor(() => expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('previous sync failed'));
    rerender(<SyncStatusPanel isSignedIn={false} readStatus={readStatus}
      preferenceError="Preferences could not be saved. Try again." />);
    expect(screen.getByTestId('settings-sync-status-error')).not.toHaveTextContent('previous sync failed');
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('Preferences could not be saved. Try again.');
  });

  it.each(['sign-out', 'unmount'])('cancels deferred Refresh after %s without starting sync or leaving a timer', async transition => {
    jest.useFakeTimers();
    const scheduleTimeout = jest.spyOn(global, 'setTimeout');
    try {
      let finishRecovery!: () => void;
      const recovery = new Promise<void>(resolve => { finishRecovery = resolve; });
      const readStatus = jest.fn().mockResolvedValue(baseStatus);
      const onRequestSync = jest.fn();
      const props = { readStatus, onRequestSync, onRefreshPreferences: () => recovery,
        preferenceError: 'Preferences could not be saved. Try again.' };
      const { rerender, unmount } = render(<SyncStatusPanel {...props} />);
      await act(async () => { fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button')); });
      if (transition === 'sign-out') rerender(<SyncStatusPanel {...props} isSignedIn={false} />);
      else unmount();
      scheduleTimeout.mockClear();
      await act(async () => { finishRecovery(); });
      expect(onRequestSync).not.toHaveBeenCalled();
      expect(readStatus).toHaveBeenCalledTimes(1);
      expect(scheduleTimeout).not.toHaveBeenCalledWith(expect.any(Function), 1500);
      if (transition === 'sign-out') {
        expect(screen.getByTestId('settings-sync-status-refresh-button')).toHaveTextContent('Refresh');
        unmount();
      }
    } finally {
      scheduleTimeout.mockRestore();
      jest.useRealTimers();
    }
  });

  it('discards a delayed status read across sign-out and sign-in', async () => {
    let finishOldRead!: (status: SyncStatusSnapshot) => void;
    const oldRead = new Promise<SyncStatusSnapshot>(resolve => { finishOldRead = resolve; });
    const readStatus = jest.fn().mockReturnValueOnce(oldRead)
      .mockResolvedValue({ ...baseStatus, dirtyCount: 2, errorMessage: 'current error' });
    const { rerender } = render(<SyncStatusPanel readStatus={readStatus} />);
    rerender(<SyncStatusPanel isSignedIn={false} readStatus={readStatus} />);
    rerender(<SyncStatusPanel readStatus={readStatus} />);
    await waitFor(() => expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('current error'));
    await act(async () => { finishOldRead({ ...baseStatus, dirtyCount: 9, errorMessage: 'previous error' }); });
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('current error');
    expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('2');
  });

  it('renders the card and every field testID', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-card')).toBeTruthy();
    });
    expect(screen.getByTestId('settings-sync-status-last-success')).toBeTruthy();
    expect(screen.getByTestId('settings-sync-status-dirty-count')).toBeTruthy();
    expect(screen.getByTestId('settings-sync-status-network')).toBeTruthy();
    expect(screen.getByTestId('settings-sync-status-error')).toBeTruthy();
  });

  it('shows "Never" for last success and the dirty count from the source', async () => {
    renderPanel({ lastSuccessAtMs: null, dirtyCount: 7 });
    // Gate on the dirty count reaching 7 — the only value here that differs
    // before and after the mocked read resolves, so it is the unambiguous
    // post-resolution signal. "Never" renders both pre-resolution (the null
    // initial state) and post-resolution (lastSuccessAtMs: null), so waiting on
    // it would be satisfied by the initial render and let the dirty-count
    // assertion race the still-unresolved promise.
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('7');
    });
    expect(screen.getByTestId('settings-sync-status-last-success')).toHaveTextContent('Never');
  });

  it('renders a formatted timestamp when a successful sync exists', async () => {
    const at = new Date('2026-01-02T03:04:05Z').getTime();
    renderPanel({ lastSuccessAtMs: at });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-last-success')).not.toHaveTextContent('Never');
    });
  });

  it('renders the offline network state as the wifi-off glyph and the word, in ink', async () => {
    renderPanel({ networkState: 'offline' });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-network')).toHaveTextContent('Offline');
    });
    expect(screen.getByTestId('settings-sync-status-network-offline-glyph', { includeHiddenElements: true })).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('settings-sync-status-network').props.style).color).toBe(
      uiRoles.ink,
    );
  });

  it('shows no offline glyph while online', async () => {
    renderPanel({ networkState: 'online' });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-network')).toHaveTextContent('Online');
    });
    expect(screen.queryByTestId('settings-sync-status-network-offline-glyph', { includeHiddenElements: true })).toBeNull();
  });

  it('shows an unknown network as "Checking…", neither offline nor online', async () => {
    // Gate on the dirty count: "Checking…" is also the pre-resolution value,
    // so waiting on it alone would not prove the unknown snapshot rendered.
    renderPanel({ networkState: 'unknown', dirtyCount: 2 });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('settings-sync-status-network')).toHaveTextContent('Checking…');
    expect(screen.queryByTestId('settings-sync-status-network-offline-glyph', { includeHiddenElements: true })).toBeNull();
  });

  it('shows "Checking…" rather than "Online" before the first snapshot loads', () => {
    const readStatus = jest.fn(() => new Promise<SyncStatusSnapshot>(() => {}));
    render(<SyncStatusPanel onRequestSync={jest.fn()} readStatus={readStatus} />);
    expect(readStatus).toHaveBeenCalled();
    expect(screen.getByTestId('settings-sync-status-network')).toHaveTextContent('Checking…');
    expect(screen.queryByTestId('settings-sync-status-network-offline-glyph', { includeHiddenElements: true })).toBeNull();
  });

  it('renders the latest cycle error in danger', async () => {
    renderPanel({ errorMessage: 'server unreachable' });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('server unreachable');
    });
    expect(StyleSheet.flatten(screen.getByTestId('settings-sync-status-error').props.style).color).toBe(
      uiRoles.danger,
    );
  });

  it('shows a sign-in-required error when the cycle reported no signed-in user', async () => {
    renderPanel({ authRequired: true, errorMessage: null });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('Sign-in required');
    });
  });

  it('shows "None" for the error when the latest cycle was clean', async () => {
    // "None" is the error field's value both before the mocked read resolves
    // (the null initial state) and after (a clean cycle), so gating on it would
    // be satisfied by the initial render without ever waiting for resolution.
    // Carry a non-default dirty count as the unambiguous post-resolution signal,
    // then assert the clean cycle resolves to "None".
    renderPanel({ dirtyCount: 3, errorMessage: null, authRequired: false });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('3');
    });
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
  });

  it('nudges a sync cycle and re-reads on manual refresh', async () => {
    const onRequestSync = jest.fn();
    const { readStatus } = renderPanel({ dirtyCount: 1 }, onRequestSync);
    await waitFor(() => {
      expect(readStatus).toHaveBeenCalled();
    });
    const callsBefore = readStatus.mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
    });

    expect(onRequestSync).toHaveBeenCalledTimes(1);
    expect(readStatus.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('enters refreshing state on manual refresh and settles back to idle', async () => {
    jest.useFakeTimers();
    try {
      const onRequestSync = jest.fn();
      renderPanel({ dirtyCount: 1 }, onRequestSync);
      await waitFor(() => {
        expect(screen.getByTestId('settings-sync-status-refresh-button')).toHaveTextContent('Refresh');
      });

      const button = screen.getByTestId('settings-sync-status-refresh-button');
      await act(async () => {
        fireEvent.press(button);
      });

      expect(button).toHaveTextContent('Refreshing…');
      expect(button.props.accessibilityState).toMatchObject({ disabled: true });

      await act(async () => {
        jest.advanceTimersByTime(1600);
      });

      expect(button).toHaveTextContent('Refresh');
      expect(button.props.accessibilityState).toMatchObject({ disabled: false });
    } finally {
      jest.useRealTimers();
    }
  });
});
