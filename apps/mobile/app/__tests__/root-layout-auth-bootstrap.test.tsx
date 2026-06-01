/* eslint-disable import/first */

import type { ReactNode } from 'react';

const mockBootstrapLocalDataLayer = jest.fn();
const mockBootstrapAuthState = jest.fn();
const mockEnsureExerciseCatalogLoaded = jest.fn();
const mockStartSyncScheduler = jest.fn();
const mockStopSyncScheduler = jest.fn();
const mockRequestSync = jest.fn();
const mockStartSchedulerStateBridge = jest.fn();
const mockStopSchedulerStateBridge = jest.fn();
const mockRegisterBackgroundSyncTask = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());

jest.mock('@/src/data', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

jest.mock('@/src/sync/scheduler', () => ({
  startSyncScheduler: (...args: unknown[]) => mockStartSyncScheduler(...args),
  stopSyncScheduler: (...args: unknown[]) => mockStopSyncScheduler(...args),
  requestSync: (...args: unknown[]) => mockRequestSync(...args),
}));

jest.mock('@/src/sync/scheduler-state-bridge', () => ({
  startSchedulerStateBridge: (...args: unknown[]) => mockStartSchedulerStateBridge(...args),
  stopSchedulerStateBridge: (...args: unknown[]) => mockStopSchedulerStateBridge(...args),
}));

// The sync gate is covered by its own spec; here it is a pass-through so this
// test stays focused on the boot-effect wiring.
jest.mock('@/src/sync/SyncGate', () => ({
  SyncGate: ({ children }: { children: ReactNode }) => children,
}));

// Mocking the background-task module also avoids loading the real native task
// manager (its module-load defineTask call) in this UI wiring test.
jest.mock('@/src/sync/background-task', () => ({
  registerBackgroundSyncTask: (...args: unknown[]) => mockRegisterBackgroundSyncTask(...args),
}));

jest.mock('@/src/auth', () => {
  const AuthProvider = ({ children }: { children: ReactNode }) => children;
  AuthProvider.displayName = 'MockAuthProvider';

  return {
    AuthProvider,
    bootstrapAuthState: (...args: unknown[]) => mockBootstrapAuthState(...args),
  };
});

// The route-layer auth guard is covered by its own spec; here it is a pass-
// through so this test stays focused on the boot-effect wiring.
jest.mock('@/components/navigation/auth-route-guard', () => ({
  AuthRouteGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/src/exercise-catalog/cache', () => ({
  ensureExerciseCatalogLoaded: (...args: unknown[]) => mockEnsureExerciseCatalogLoaded(...args),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('expo-router', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const Stack = ({ children }: { children: ReactNode }) => <MockView testID="root-stack">{children}</MockView>;
  const StackScreen = ({ name }: { name: string }) => <MockView testID={`screen-${name}`} />;

  Stack.displayName = 'MockStack';
  StackScreen.displayName = 'MockStackScreen';
  Stack.Screen = StackScreen;

  return {
    Stack,
  };
});

import { render, screen, waitFor } from '@testing-library/react-native';

import RootLayout from '../_layout';

describe('RootLayout auth bootstrap wiring', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
    mockBootstrapAuthState.mockReset();
    mockEnsureExerciseCatalogLoaded.mockReset();
    mockStartSyncScheduler.mockReset();
    mockStopSyncScheduler.mockReset();
    mockRequestSync.mockReset();
    mockStartSchedulerStateBridge.mockReset();
    mockStopSchedulerStateBridge.mockReset();
    mockRegisterBackgroundSyncTask.mockReset();
    mockRegisterBackgroundSyncTask.mockResolvedValue(undefined);
    mockBootstrapLocalDataLayer.mockResolvedValue(undefined);
    mockBootstrapAuthState.mockResolvedValue(undefined);
    mockEnsureExerciseCatalogLoaded.mockResolvedValue(undefined);
  });

  it('starts local data bootstrap and auth bootstrap on mount', async () => {
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockBootstrapLocalDataLayer).toHaveBeenCalledTimes(1);
    });
    expect(mockBootstrapAuthState).toHaveBeenCalledTimes(1);
    expect(mockEnsureExerciseCatalogLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('root-stack')).toBeTruthy();
    // Tab roots (incl. settings) live in the `(tabs)` group registered as a single screen
    expect(screen.getByTestId('screen-(tabs)')).toBeTruthy();
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
  });

  it('starts the sync scheduler on mount and fires the cold-launch nudge after boot', async () => {
    render(<RootLayout />);

    expect(mockStartSyncScheduler).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockRequestSync).toHaveBeenCalledTimes(1);
    });
  });

  it('registers the background sync task on mount', () => {
    render(<RootLayout />);

    expect(mockRegisterBackgroundSyncTask).toHaveBeenCalledTimes(1);
  });

  it('stops the sync scheduler on unmount', () => {
    const view = render(<RootLayout />);
    view.unmount();

    expect(mockStopSyncScheduler).toHaveBeenCalledTimes(1);
  });

  it('starts the scheduler-state bridge after the scheduler wires successfully', () => {
    render(<RootLayout />);

    expect(mockStartSyncScheduler).toHaveBeenCalledTimes(1);
    expect(mockStartSchedulerStateBridge).toHaveBeenCalledTimes(1);
    // The scheduler wires before the bridge observes it.
    expect(mockStartSyncScheduler.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartSchedulerStateBridge.mock.invocationCallOrder[0],
    );
  });

  it('lets a scheduler wiring failure crash boot rather than starting the gate bridge', () => {
    // A broken native build re-throws from scheduler wiring. That must surface as
    // the crash it is — it must NOT be swallowed into a recoverable gate state,
    // so the bridge that drives the gate never starts.
    const wiringFailure = new Error('listener wiring failed');
    mockStartSyncScheduler.mockImplementation(() => {
      throw wiringFailure;
    });

    expect(() => render(<RootLayout />)).toThrow(wiringFailure);
    expect(mockStartSchedulerStateBridge).not.toHaveBeenCalled();
  });
});
