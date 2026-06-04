/* eslint-disable import/first */

/**
 * Launch outcome — the first-sync gate is self-explanatory: while it blocks the
 * app it surfaces the current PHASE, an activity signal that ADVANCES while work
 * happens, and an OFFLINE message when the device cannot reach the network.
 *
 * Unlike the component-level gate suite (which mocks the scheduler outright),
 * this spec wires the gate to the REAL production read path it uses on device:
 * the actual progress producer (`setSyncProgress`), the actual shared
 * scheduler-status accessor (which derives `offline` from the live NetInfo
 * projection), and the actual gate-state holder — only auth, the cycle, NetInfo,
 * AppState, logging, and the router are stubbed. So this asserts the END-TO-END
 * mapping the launch contract promises: a snapshot the bootstrapper publishes,
 * surfaced by the single accessor, renders on the gate as a phase label, an
 * advancing liveness line, and — when the link drops — the offline message
 * instead of an indefinite spinner.
 *
 * Driving the genuine wiring (not a mock of the accessor) is the point: it is
 * the only way to catch a regression where the producer, the accessor's
 * offline-override, or the gate's read seam stop agreeing.
 */

import { AppState, type AppStateStatus } from 'react-native';

import type { LogEventParams } from '@/src/logging/logEvent';

// The real scheduler runs but must not fire real cycles — stub the cycle to a
// promise that never settles so starting the scheduler is inert.
jest.mock('@/src/sync/cycle', () => ({
  runSyncCycle: () => new Promise<void>(() => {}),
}));

// NetInfo stub exposing the registered listener so the test drives the real
// scheduler's online/offline projection through the production path.
type NetInfoSnapshot = { isConnected?: boolean | null; isInternetReachable?: boolean | null };
const mockNetInfoState: { listener: ((state: NetInfoSnapshot) => void) | null } = {
  listener: null,
};
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetInfoSnapshot) => void) => {
      mockNetInfoState.listener = listener;
      return () => {
        mockNetInfoState.listener = null;
      };
    },
  },
}));

const mockLogEvent = jest.fn((_params: LogEventParams) => Promise.resolve());
jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Redirect = ({ href }: { href: string }) =>
    React.createElement(Text, { testID: 'sync-gate-redirect' }, href);
  Redirect.displayName = 'MockRedirect';
  return {
    Redirect,
    usePathname: () => '/stats-history',
  };
});

import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { resetSyncProgress, setSyncProgress, type SyncProgress } from '@/src/sync/progress';
import {
  __resetSchedulerForTests,
  startSyncScheduler,
  stopSyncScheduler,
} from '@/src/sync/scheduler';
import { SyncGate, SYNC_GATE_TEST_IDS } from '@/src/sync/SyncGate';
import { __resetSyncGateStateForTests, publishSyncGateState } from '@/src/sync/sync-gate-state';

const childTestId = 'sync-gate-child';

const renderGate = () =>
  render(
    <SyncGate>
      <Text testID={childTestId}>data screen</Text>
    </SyncGate>,
  );

/** Drives the real scheduler's link projection through the captured NetInfo listener. */
const setLink = (isConnected: boolean) =>
  act(() => {
    mockNetInfoState.listener?.({ isConnected, isInternetReachable: isConnected });
  });

/**
 * Publishes a producer progress snapshot, then republishes the gate-state holder
 * so the gate re-reads the shared accessor on the same render (the holder change
 * is what triggers the re-read of `getSchedulerStatus().progress`).
 */
const produceProgress = (progress: SyncProgress) =>
  act(() => {
    setSyncProgress(progress);
    publishSyncGateState({ bootstrapCompletedAt: null, lastCycleErrorCode: null });
  });

const inProgress = (over: Partial<SyncProgress>): SyncProgress => ({
  phase: 'pull',
  layersCompleted: 0,
  rowsApplied: 0,
  offline: false,
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  mockNetInfoState.listener = null;
  mockLogEvent.mockClear();
  // A signed-in, configured user whose first sync has not yet drained — the only
  // state in which the gate blocks.
  mockUseAuth.mockReset().mockReturnValue({ isConfigured: true, session: { user: { id: 'u-1' } } });

  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }) as never);
  (AppState as { currentState: AppStateStatus }).currentState = 'active';

  resetSyncProgress();
  __resetSyncGateStateForTests();
  __resetSchedulerForTests();
  startSyncScheduler();
});

afterEach(() => {
  stopSyncScheduler();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  resetSyncProgress();
  __resetSyncGateStateForTests();
});

describe('the first-sync gate surfaces phase, advancing activity, and offline state end to end', () => {
  it('renders the current phase label from the real progress accessor', () => {
    setLink(true);
    renderGate();

    produceProgress(inProgress({ phase: 'pull' }));
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.phaseLabel).props.children).toBe('Restoring your data');

    produceProgress(inProgress({ phase: 'seed' }));
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.phaseLabel).props.children).toBe(
      'Loading the exercise catalog',
    );
  });

  it('renders an activity indicator whose detail line advances as the producer counters advance', () => {
    setLink(true);
    renderGate();

    produceProgress(inProgress({ phase: 'pull', layersCompleted: 0, rowsApplied: 0 }));
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeTruthy();
    const initial = screen.getByTestId(SYNC_GATE_TEST_IDS.activityDetail).props.children;

    // The bootstrapper crosses a layer and applies rows: the rendered liveness
    // detail must move forward, proving the gate shows real advancement.
    produceProgress(inProgress({ phase: 'pull', layersCompleted: 2, rowsApplied: 17 }));
    const advanced = screen.getByTestId(SYNC_GATE_TEST_IDS.activityDetail).props.children;

    expect(initial).toBe('Layer 1 of 4');
    expect(advanced).toBe('Layer 3 of 4 · 17 items');
    expect(advanced).not.toBe(initial);
  });

  it('shows the offline message instead of a spinner when the real link projection goes down', () => {
    // Online first: the in-progress block shows its activity indicator.
    setLink(true);
    renderGate();
    produceProgress(inProgress({ phase: 'pull', rowsApplied: 3 }));
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeNull();

    // The link drops. The shared accessor overrides `offline` from the live
    // projection, so the gate swaps the spinner for the offline message without
    // the producer re-publishing an `offline` flag itself.
    setLink(false);
    act(() => {
      publishSyncGateState({ bootstrapCompletedAt: null, lastCycleErrorCode: null });
    });

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.offlineMessage)).toBeTruthy();
    expect(screen.queryByTestId(SYNC_GATE_TEST_IDS.activityIndicator)).toBeNull();
  });
});
