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

jest.mock('@/src/sync/scheduler', () => ({
  requestSync: (...args: unknown[]) => mockRequestSync(...args),
  getSchedulerStatus: () => ({ progress: mockProgress }),
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
import { Text } from 'react-native';

import { INITIAL_SYNC_PROGRESS, type SyncProgress } from '@/src/sync/progress';
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

  it('shows the error message and a single Retry on a non-auth cycle error', () => {
    renderGate();

    publish({ lastCycleErrorCode: 'INTERNAL' });

    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.errorMessage)).toBeTruthy();
    expect(screen.getByTestId(SYNC_GATE_TEST_IDS.retryButton)).toBeTruthy();
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
});
