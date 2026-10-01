/* eslint-disable import/first */

/**
 * The root layout's boot wiring: on mount it boots the local data layer, the
 * auth state and the exercise catalog, starts the sync scheduler and its gate
 * bridge, registers the background task, then nudges sync once boot settles.
 *
 * The data half runs for real: the local data layer and the catalog cache boot
 * over the migrated in-memory SQLite fixture (helpers/local-data.ts). The rest
 * is native or server wiring this suite only observes being called, so it is
 * replaced: auth, the sync scheduler, the gate bridge, the background task,
 * route access, the gesture root, the status bar and the navigator.
 */

import type { ReactNode } from 'react';

const mockBootstrapAuthState = jest.fn();
const mockStartSyncScheduler = jest.fn();
const mockStopSyncScheduler = jest.fn();
const mockRequestSync = jest.fn();
const mockStartSyncGateStateBridge = jest.fn();
const mockStopSyncGateStateBridge = jest.fn();
const mockRegisterBackgroundSyncTask = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
const mockStackScreen = jest.fn();
const mockStack = jest.fn();
const mockReportLaunchThemeProblem = jest.fn();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('@/src/sync/scheduler', () => ({
  startSyncScheduler: (...args: unknown[]) => mockStartSyncScheduler(...args),
  stopSyncScheduler: (...args: unknown[]) => mockStopSyncScheduler(...args),
  requestSync: (...args: unknown[]) => mockRequestSync(...args),
}));

jest.mock('@/src/sync/sync-gate-state-bridge', () => ({
  startSyncGateStateBridge: (...args: unknown[]) => mockStartSyncGateStateBridge(...args),
  stopSyncGateStateBridge: (...args: unknown[]) => mockStopSyncGateStateBridge(...args),
}));

// Route access is covered by its own specs (root-route-access, root-stack-routing);
// here every app route is open so this test stays focused on the boot-effect
// wiring and the stack's screen options.
jest.mock('@/src/navigation/root-route-access', () => ({
  useRootRouteAccess: () => 'app',
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
    useAuth: () => ({ isConfigured: true }),
  };
});

// The restore guard is covered by its own spec; here it is a pass-through so
// this test stays focused on the boot-effect wiring.
jest.mock('@/components/navigation/auth-route-guard', () => ({
  AuthRouteGuard: ({ children }: { children: ReactNode }) => children,
}));

// The launch-theme report is only observed: it logs, and logging has its own spec.
jest.mock('@/src/appearance/launch-theme-report', () => ({
  reportLaunchThemeProblem: (...args: unknown[]) => mockReportLaunchThemeProblem(...args),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-gesture-handler', () => {
  const { View: MockView } = jest.requireActual('react-native');

  return {
    GestureHandlerRootView: ({ children }: { children: ReactNode }) => (
      <MockView testID="gesture-handler-root">{children}</MockView>
    ),
  };
});

jest.mock('expo-router', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const Stack = ({ children, screenOptions }: { children: ReactNode; screenOptions?: unknown }) => {
    mockStack({ screenOptions });
    return <MockView testID="root-stack">{children}</MockView>;
  };
  const StackScreen = ({ name, options }: { name: string; options?: unknown }) => {
    mockStackScreen({ name, options });
    return <MockView testID={`screen-${name}`} />;
  };

  // Renders only the groups whose guard is on, as the real navigator does.
  const StackProtected = ({ children, guard }: { children: ReactNode; guard: boolean }) =>
    guard ? <>{children}</> : null;

  Stack.displayName = 'MockStack';
  StackScreen.displayName = 'MockStackScreen';
  StackProtected.displayName = 'MockStackProtected';
  Stack.Screen = StackScreen;
  Stack.Protected = StackProtected;

  return {
    Stack,
  };
});

import { act, render, screen, waitFor } from '@testing-library/react-native';

import RootLayout from '../_layout';
import * as themeLaunch from '@/components/ui/theme-launch';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { getExerciseCatalogSnapshot } from '@/src/exercise-catalog/cache';
import { closeLocalData, localDataClient, resetLocalData } from './helpers/local-data';

describe('RootLayout auth bootstrap wiring', () => {
  afterEach(async () => {
    // Let a boot still in flight settle before its database closes.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    closeLocalData();
  });

  beforeEach(() => {
    resetLocalData();
    mockBootstrapAuthState.mockReset();
    mockStartSyncScheduler.mockReset();
    mockStopSyncScheduler.mockReset();
    mockRequestSync.mockReset();
    mockStartSyncGateStateBridge.mockReset();
    mockStopSyncGateStateBridge.mockReset();
    mockRegisterBackgroundSyncTask.mockReset();
    mockStackScreen.mockReset();
    mockReportLaunchThemeProblem.mockReset();
    mockRegisterBackgroundSyncTask.mockResolvedValue(undefined);
    mockBootstrapAuthState.mockResolvedValue(undefined);
  });

  it('reports why the launch theme is not the stored choice, once on mount', () => {
    const problem = { kind: 'unknown-preset', storedId: 'neon' } as const;
    jest.replaceProperty(themeLaunch, 'launchTheme', { ...themeLaunch.launchTheme, problem });

    render(<RootLayout />);

    expect(mockReportLaunchThemeProblem).toHaveBeenCalledTimes(1);
    expect(mockReportLaunchThemeProblem).toHaveBeenCalledWith(problem);
    jest.restoreAllMocks();
  });

  it('boots the local data layer, the exercise catalog and auth on mount', async () => {
    render(<RootLayout />);

    // The data layer boots (the starter catalog seeded) and the catalog loads from it.
    await waitFor(() => {
      expect(getExerciseCatalogSnapshot().status).toBe('ready');
    });
    const seeded = localDataClient().prepare('SELECT COUNT(*) AS n FROM exercise_definitions').get() as { n: number };
    expect(getExerciseCatalogSnapshot().exercises).toHaveLength(seeded.n);
    expect(seeded.n).toBeGreaterThan(0);
    expect(mockBootstrapAuthState).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('gesture-handler-root')).toBeTruthy();
    expect(screen.getByTestId('root-stack')).toBeTruthy();
    // Tab roots (incl. settings) live in the `(tabs)` group registered as a single screen
    expect(screen.getByTestId('screen-(tabs)')).toBeTruthy();
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
    expect(screen.getByTestId('screen-connected-agents')).toBeTruthy();
  });

  it('gives every detail screen an arrow-only native back affordance', () => {
    render(<RootLayout />);

    expect(mockStack).toHaveBeenCalledWith({
      screenOptions: {
        headerBackButtonDisplayMode: 'minimal',
        // One design-language header style on every stack route.
        headerStyle: { backgroundColor: uiRoles.surface },
        headerTitleStyle: {
          fontFamily: uiFonts.display.family,
          fontWeight: '700',
          fontSize: uiTypography.size.xl,
          color: uiRoles.ink,
        },
        headerTintColor: uiRoles.ink,
      },
    });
    // The back item's hidden label (read by VoiceOver) is the previous title: never "(tabs)".
    expect(mockStackScreen).toHaveBeenCalledWith({ name: '(tabs)', options: { headerShown: false, title: 'Back' } });
    expect(mockStackScreen).toHaveBeenCalledWith({ name: 'sessions', options: { title: 'Sessions' } });
    expect(mockStackScreen).toHaveBeenCalledWith({
      name: 'group-session/[memberId]/[sessionId]',
      options: { title: 'Session' },
    });
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

  it('starts the sync-gate state bridge after the scheduler wires successfully', () => {
    render(<RootLayout />);

    expect(mockStartSyncScheduler).toHaveBeenCalledTimes(1);
    expect(mockStartSyncGateStateBridge).toHaveBeenCalledTimes(1);
    // The scheduler wires before the bridge observes it.
    expect(mockStartSyncScheduler.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartSyncGateStateBridge.mock.invocationCallOrder[0],
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
    expect(mockStartSyncGateStateBridge).not.toHaveBeenCalled();
  });
});
