/* eslint-disable import/first */

const mockUseAuth = jest.fn();
let mockPathname = '/stats-history';
const mockRequestSync = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// The gate reads the progress snapshot from the shared scheduler-status
// accessor. Drive it from a mutable holder the test sets per assertion; the gate
// re-reads it on each render the gate-state holder triggers.
let mockProgress: SyncProgress = {
  phase: 'idle',
  layersCompleted: 0,
  rowsApplied: 0,
  offline: false,
};

// `mockUseLiveScheduler` switches the accessor to the REAL scheduler (driven by
// the NetInfo stub below) for the suite that proves the gate renders what the
// live network projection reports, end to end through `useSyncGateState`.
let mockUseLiveScheduler = false;

jest.mock('@/src/sync/scheduler', () => {
  const actual = jest.requireActual<typeof import('@/src/sync/scheduler')>('@/src/sync/scheduler');
  return {
    ...actual,
    requestSync: (...args: unknown[]) => mockRequestSync(...args),
    getSchedulerStatus: () =>
      mockUseLiveScheduler ? actual.getSchedulerStatus() : { progress: mockProgress },
  };
});

// The real scheduler's collaborators: no cycle ever runs to completion here, and
// the NetInfo listener is captured so a test controls whether (and what) the
// network has reported.
jest.mock('@/src/sync/cycle', () => ({
  runSyncCycle: () => new Promise(() => {}),
}));

type NetInfoSnapshot = { isConnected: boolean | null };
const mockNetInfo: { listener: ((state: NetInfoSnapshot) => void) | null } = { listener: null };
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetInfoSnapshot) => void) => {
      mockNetInfo.listener = listener;
      return () => {
        mockNetInfo.listener = null;
      };
    },
  },
}));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: () => Promise.resolve(),
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Redirect = ({ href }: { href: string }) =>
    React.createElement(Text, { testID: 'sync-gate-redirect' }, href);
  Redirect.displayName = 'MockRedirect';
  return {
    Redirect,
    usePathname: () => mockPathname,
  };
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { uiRoles } from '@/components/ui';
import { INITIAL_SYNC_PROGRESS, type SyncProgress } from '@/src/sync/progress';
import { startSyncScheduler, stopSyncScheduler } from '@/src/sync/scheduler';
import { SyncGate, SYNC_GATE_TEST_IDS } from '@/src/sync/SyncGate';
import {
  __resetSyncGateStateForTests,
  publishSyncGateState,
  type LastCycleErrorCode,
} from '@/src/sync/sync-gate-state';

type AuthValue = {
  isConfigured: boolean;
  session: unknown;
};

const signedInAuth: AuthValue = { isConfigured: true, session: { user: { id: 'user-1' } } };

const childTestId = 'sync-gate-child';
const redirectTestId = 'sync-gate-redirect';

const renderGate = () =>
  render(
    <SyncGate>
      <Text testID={childTestId}>data screen</Text>
    </SyncGate>,
  );

/**
 * Publishes a fresh gate-state snapshot (and, when given, the progress the
 * shared accessor reports) inside React's act() so subscribers re-render. The
 * progress value is updated before the gate-state holder is published so the
 * gate re-reads it on the same render.
 */
const publish = (overrides: {
  bootstrapCompletedAt?: Date | null;
  lastCycleErrorCode?: LastCycleErrorCode | null;
  progress?: SyncProgress;
}) => {
  if (overrides.progress) {
    mockProgress = overrides.progress;
  }
  act(() => {
    publishSyncGateState({
      bootstrapCompletedAt: overrides.bootstrapCompletedAt ?? null,
      lastCycleErrorCode: overrides.lastCycleErrorCode ?? null,
    });
  });
};

describe('SyncGate', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(signedInAuth);
    mockPathname = '/stats-history';
    mockRequestSync.mockReset();
    mockProgress = INITIAL_SYNC_PROGRESS;
    __resetSyncGateStateForTests();
  });

  it('renders the full-screen block when the bootstrap flag is null', () => {
    renderGate();

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.block)).toBeTruthy();
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('dismisses the block and renders the app once the bootstrap flag is set', () => {
    renderGate();
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.block)).toBeTruthy();

    publish({ bootstrapCompletedAt: new Date(1_700_000_000_000) });

    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('does not block when auth is unconfigured (no sync will ever set the flag)', () => {
    mockUseAuth.mockReturnValue({ isConfigured: false, session: null });

    renderGate();

    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('does not block a signed-out user (the auth guard handles that redirect)', () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, session: null });

    renderGate();

    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('renders the current phase label from the progress snapshot', () => {
    renderGate();

    publish({ progress: { ...INITIAL_SYNC_PROGRESS, phase: 'pull' } });
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.phaseLabel).props.children).toBe(
      'Restoring your data',
    );

    publish({ progress: { ...INITIAL_SYNC_PROGRESS, phase: 'seed' } });
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.phaseLabel).props.children).toBe(
      'Loading the exercise catalog',
    );
  });

  it('renders an activity indicator and an advancing detail line', () => {
    renderGate();

    publish({ progress: { phase: 'pull', layersCompleted: 0, rowsApplied: 0, offline: false } });
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeTruthy();
    const initial = screen.getByTestId(SYNC_GATE_TEST_IDS.activityDetail).props.children;

    // Advancing the stubbed counters advances the rendered liveness detail.
    publish({ progress: { phase: 'pull', layersCompleted: 2, rowsApplied: 17, offline: false } });
    const advanced = screen.getByTestId(SYNC_GATE_TEST_IDS.activityDetail).props.children;

    expect(initial).toBe('Layer 1 of 4');
    expect(advanced).toBe('Layer 3 of 4 · 17 items');
    expect(advanced).not.toBe(initial);
  });

  it('shows the offline message instead of a spinner when the network is unreachable', () => {
    renderGate();

    publish({ progress: { ...INITIAL_SYNC_PROGRESS, phase: 'pull', offline: true } });

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeNull();
  });

  it('renders the harness-pinned in-progress block regardless of the bootstrap flag or live offline state', () => {
    renderGate();

    // The harness pin must win over BOTH a set bootstrap flag (which would
    // normally dismiss the gate) and a live offline projection (which would
    // normally hide the spinner): the block stays up with a queryable activity
    // indicator so a Maestro flow can assert the online in-progress state.
    mockProgress = { ...INITIAL_SYNC_PROGRESS, offline: true };
    act(() => {
      publishSyncGateState({
        bootstrapCompletedAt: new Date(1_700_000_000_000),
        lastCycleErrorCode: null,
        forcedProgress: { phase: 'pull', layersCompleted: 1, rowsApplied: 3, offline: false },
      });
    });

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.block)).toBeTruthy();
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeNull();
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('shows the error message and a single Retry on a non-auth cycle error', () => {
    renderGate();

    publish({ lastCycleErrorCode: 'INTERNAL' });

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.errorMessage)).toBeTruthy();
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.retryButton)).toBeTruthy();
  });

  it('shows the cycle error in danger, not as muted text (T05-D3)', () => {
    renderGate();

    publish({ lastCycleErrorCode: 'INTERNAL' });

    expect(StyleSheet.flatten(screen.getByTestId(SYNC_GATE_TEST_IDS.errorMessage).props.style).color).toBe(
      uiRoles.danger
    );
  });

  it('fires exactly one cycle when Retry is pressed', () => {
    renderGate();

    publish({ lastCycleErrorCode: 'FK_VIOLATION' });
    fireEvent.press(screen.getByTestId(SYNC_GATE_TEST_IDS.retryButton));

    expect(mockRequestSync).toHaveBeenCalledTimes(1);
  });

  it('routes to sign-in and renders no Retry when the latest outcome is AUTH_REQUIRED', () => {
    renderGate();

    publish({ lastCycleErrorCode: 'AUTH_REQUIRED' });

    expect(screen.getByTestId(redirectTestId).props.children).toBe('/sign-in');
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.retryButton)).toBeNull();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
  });

  it('renders the sign-in route through rather than blocking or looping on it', () => {
    mockPathname = '/sign-in';
    renderGate();

    publish({ lastCycleErrorCode: 'AUTH_REQUIRED' });

    expect(screen.queryByTestId(redirectTestId)).toBeNull();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('renders the test-harness route through the block so it can lift the gate', () => {
    // The harness is the screen that flips the first-sync flag; if the block hid
    // it, nothing could ever mount to lift the block. So even with the flag null
    // and a non-auth error pending, the harness route renders through.
    mockPathname = '/maestro-harness';
    renderGate();

    publish({ lastCycleErrorCode: 'INTERNAL' });

    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.queryByTestId(redirectTestId)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('renders the test-harness route through when Expo exposes the dev-client path prefix', () => {
    mockPathname = '/--/maestro-harness';
    renderGate();

    publish({ lastCycleErrorCode: 'INTERNAL' });

    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.block)).toBeNull();
    expect(screen.queryByTestId(redirectTestId)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });
});

describe('SyncGate on the live scheduler network projection', () => {
  const reportNetwork = (isConnected: boolean | null) => {
    if (mockNetInfo.listener === null) {
      throw new Error('the scheduler did not register a NetInfo listener');
    }
    mockNetInfo.listener({ isConnected });
    // The bridge's poll republishes the gate holder, which re-renders the gate
    // and re-reads the live scheduler status; publish once to stand in for it.
    publish({});
  };

  const expectProgressNotOffline = () => {
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeTruthy();
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityDetail)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeNull();
  };

  const expectOffline = () => {
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeNull();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(signedInAuth);
    mockPathname = '/stats-history';
    __resetSyncGateStateForTests();
    mockUseLiveScheduler = true;
    startSyncScheduler();
  });

  afterEach(() => {
    stopSyncScheduler();
    mockUseLiveScheduler = false;
    jest.useRealTimers();
  });

  it('shows the normal progress, not the offline copy, before NetInfo has reported (online device, first sign-in)', () => {
    // The observed ios-sync-e2e capture: the gate mounts right after sign-in,
    // before NetInfo's first event reaches the scheduler. The network state is
    // unknown, not offline, so the gate must not claim the device is offline.
    renderGate();

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.block)).toBeTruthy();
    expectProgressNotOffline();

    // A poll-tick republish with NetInfo still silent keeps the progress body.
    publish({});
    expectProgressNotOffline();
  });

  it('shows the offline copy only once NetInfo reports isConnected === false', () => {
    renderGate();
    expectProgressNotOffline();

    reportNetwork(false);
    expectOffline();

    reportNetwork(true);
    expectProgressNotOffline();

    reportNetwork(false);
    expectOffline();
  });

  it('treats a still-undetermined NetInfo report (isConnected null) as unknown, not offline', () => {
    renderGate();

    reportNetwork(null);
    expectProgressNotOffline();

    reportNetwork(true);
    expectProgressNotOffline();
  });
});
