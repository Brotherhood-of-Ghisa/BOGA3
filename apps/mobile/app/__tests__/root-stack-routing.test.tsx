/* eslint-disable import/first */

/**
 * The root stack through the real Expo Router: which route a user lands on as
 * auth and the first sync change, with the navigator mounted throughout.
 *
 * The old route guard and first-sync gate swapped the whole navigator out for a
 * `<Redirect>` or the block. On expo-router 57 that unmount reverts the route, so
 * sign-in and sign-out looped until React aborted with "Maximum update depth
 * exceeded". Every transition here fails on that error.
 */

type MockAuth = { isConfigured: boolean; session: unknown; status: 'ready' };
let mockAuth: MockAuth;
const mockAuthListeners = new Set<() => void>();
const mockSetAuth = (next: Partial<MockAuth>) => {
  mockAuth = { ...mockAuth, ...next };
  mockAuthListeners.forEach((listener) => listener());
};

jest.mock('@/src/auth', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useAuth: () => {
      const snapshot = React.useSyncExternalStore(
        (listener: () => void) => {
          mockAuthListeners.add(listener);
          return () => mockAuthListeners.delete(listener);
        },
        () => mockAuth,
      );
      return {
        ...snapshot,
        clearAuthError: () => undefined,
        disabledReason: snapshot.isConfigured ? null : 'Supabase mobile auth is not configured.',
        lastError: null,
        signInWithPassword: async () => undefined,
      };
    },
  };
});

import { act, screen } from '@testing-library/react-native';
import { router as navigate, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { RootStack } from '@/components/navigation/root-stack';
import {
  __resetAuthRequiredSignalForTests,
  clearAuthRequired,
  markAuthRequired,
} from '@/src/sync/auth-required-signal';
import { __resetSyncGateStateForTests, publishSyncGateState } from '@/src/sync/sync-gate-state';

import IndexRoute from '../index';
import SignInRoute from '../sign-in';

const SESSION = { user: { id: 'user-a' } };


const render = (initialUrl: string) =>
  renderRouter(
    {
      _layout: RootStack,
      'sign-in': SignInRoute,
      'sync-setup': () => <Text testID="sync-setup-stub">Setting up</Text>,
      index: IndexRoute,
      '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
      '(tabs)/today': () => <Text testID="today-stub">Today</Text>,
      profile: () => <Text testID="profile-stub">Profile</Text>,
      'maestro-harness': () => <Text testID="harness-stub">Harness</Text>,
    },
    { initialUrl },
  );

const setBootstrapped = (done: boolean) =>
  act(async () => {
    publishSyncGateState({
      bootstrapCompletedAt: done ? new Date(1_700_000_000_000) : null,
      lastCycleErrorCode: null,
      forcedProgress: null,
    });
  });

const signIn = () =>
  act(async () => {
    // The auth service clears the signal before publishing the live session.
    clearAuthRequired();
    mockSetAuth({ session: SESSION });
  });

let consoleErrors: string[];

beforeEach(() => {
  mockAuth = { isConfigured: true, session: null, status: 'ready' };
  mockAuthListeners.clear();
  __resetAuthRequiredSignalForTests();
  __resetSyncGateStateForTests();
  consoleErrors = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
  // The layout declares every app route; this test mounts only a few of them.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  expect(consoleErrors.filter((message) => message.includes('Maximum update depth'))).toEqual([]);
});

it('lands a signed-out launch on sign-in', async () => {
  const router = render('/');

  expect(await screen.findByTestId('sign-in-screen')).toBeTruthy();
  expect(router.getPathname()).toBe('/sign-in');
});

it('keeps a signed-out deep link to an app route on sign-in', async () => {
  const router = render('/profile');

  expect(await screen.findByTestId('sign-in-screen')).toBeTruthy();
  expect(router.getPathname()).toBe('/sign-in');
  expect(screen.queryByTestId('profile-stub')).toBeNull();
});

it('moves from sign-in to the first-sync block, then to the app once the first sync drains', async () => {
  const router = render('/');
  await screen.findByTestId('sign-in-screen');

  await signIn();
  expect(screen.getByTestId('sync-setup-stub')).toBeTruthy();
  expect(router.getPathname()).toBe('/sync-setup');

  await setBootstrapped(true);
  expect(screen.getByTestId('today-stub')).toBeTruthy();
  expect(router.getPathname()).toBe('/today');
});

it('goes straight to the app when a restored session has already synced', async () => {
  mockAuth = { ...mockAuth, session: SESSION };
  await setBootstrapped(true);
  const router = render('/');

  expect(await screen.findByTestId('today-stub')).toBeTruthy();
  expect(router.getPathname()).toBe('/today');
});

it('returns to sign-in from a pushed app screen on sign-out, and back to the app on sign-in', async () => {
  mockAuth = { ...mockAuth, session: SESSION };
  await setBootstrapped(true);
  const router = render('/');
  await screen.findByTestId('today-stub');
  act(() => navigate.push('/profile'));
  expect(screen.getByTestId('profile-stub')).toBeTruthy();

  await act(async () => mockSetAuth({ session: null }));
  expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
  expect(router.getPathname()).toBe('/sign-in');

  await signIn();
  expect(router.getPathname()).toBe('/today');
});

it('routes a signed-in user to sign-in when a cycle reports no signed-in user', async () => {
  mockAuth = { ...mockAuth, session: SESSION };
  await setBootstrapped(true);
  const router = render('/');
  await screen.findByTestId('today-stub');

  await act(async () => markAuthRequired());

  expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
  expect(router.getPathname()).toBe('/sign-in');
});

it('holds on sign-in, without looping, while a live session still has auth-required raised', async () => {
  const router = render('/');
  await screen.findByTestId('sign-in-screen');
  markAuthRequired();

  // A cycle that started before sign-in ends after it, still with no signed-in user.
  await act(async () => mockSetAuth({ session: SESSION }));
  expect(router.getPathname()).toBe('/sign-in');

  // The next cycle converges with the session and clears the signal.
  await act(async () => clearAuthRequired());
  expect(router.getPathname()).toBe('/sync-setup');
});

it('keeps the dev/test harness reachable over the first-sync block, and not while signed out', async () => {
  mockAuth = { ...mockAuth, session: SESSION };
  const signedInRouter = render('/maestro-harness');
  expect(await screen.findByTestId('harness-stub')).toBeTruthy();
  expect(signedInRouter.getPathname()).toBe('/maestro-harness');
  signedInRouter.unmount();

  mockAuth = { ...mockAuth, session: null };
  const signedOutRouter = render('/maestro-harness');
  expect(await screen.findByTestId('sign-in-screen')).toBeTruthy();
  expect(signedOutRouter.getPathname()).toBe('/sign-in');
});

it('opens the app on an unconfigured build and still reaches the disabled sign-in screen', async () => {
  mockAuth = { isConfigured: false, session: null, status: 'ready' };
  const router = render('/');

  expect(await screen.findByTestId('today-stub')).toBeTruthy();
  act(() => navigate.push('/sign-in'));

  expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
  expect(router.getPathname()).toBe('/sign-in');
});
