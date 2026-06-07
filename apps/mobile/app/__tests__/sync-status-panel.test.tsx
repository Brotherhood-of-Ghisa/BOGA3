/* eslint-disable import/first */

/**
 * The Settings sync-status panel: renders the four signed-in fields — last
 * successful sync time, pending (dirty) change count, network state, and error
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

import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
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

  it('renders the offline network state', async () => {
    renderPanel({ networkState: 'offline' });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-network')).toHaveTextContent('Offline');
    });
  });

  it('renders the latest cycle error', async () => {
    renderPanel({ errorMessage: 'server unreachable' });
    await waitFor(() => {
      expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('server unreachable');
    });
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
});
