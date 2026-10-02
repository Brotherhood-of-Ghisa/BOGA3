/* eslint-disable import/first */

const mockUseAuth = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import {
  __resetSyncGateStateForTests,
  getSyncGateStateSnapshot,
  publishSyncGateState,
} from '@/src/sync/sync-gate-state';

type AuthValue = {
  isConfigured: boolean;
  session: unknown;
  status: 'idle' | 'restoring' | 'ready';
};

const createAuthValue = (overrides: Partial<AuthValue> = {}): AuthValue => ({
  isConfigured: true,
  session: null,
  status: 'ready',
  ...overrides,
});

const signedIn = { session: { user: { id: 'user-1' } } };

const guarded = () => (
  <AuthRouteGuard>
    <Text testID="guard-child">root navigator</Text>
  </AuthRouteGuard>
);

const childTestId = 'guard-child';
const loadingTestId = 'auth-guard-loading';

const markBootstrapFlagRead = () =>
  act(() => {
    publishSyncGateState({ ...getSyncGateStateSnapshot(), bootstrapFlagKnown: true });
  });

// Which routes the navigator then offers (sign-in, the first-sync block, the app)
// is covered by root-route-access.test.ts and root-stack-routing.test.tsx.
describe('AuthRouteGuard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    __resetSyncGateStateForTests();
  });

  it.each(['idle', 'restoring'] as const)(
    'holds the navigator behind a neutral loading state while auth is %s',
    (status) => {
      mockUseAuth.mockReturnValue(createAuthValue({ status }));

      render(guarded());

      expect(screen.getByTestId(loadingTestId)).toBeTruthy();
      expect(screen.queryByTestId(childTestId)).toBeNull();
    },
  );

  it.each([
    ['signed out', createAuthValue({ session: null })],
    ['auth unconfigured', createAuthValue({ isConfigured: false })],
  ])('renders the navigator once auth is ready (%s), without waiting on the first-sync flag', (_label, auth) => {
    mockUseAuth.mockReturnValue(auth);

    render(guarded());

    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('holds a signed-in user until the persisted first-sync flag has been read', () => {
    mockUseAuth.mockReturnValue(createAuthValue(signedIn));

    render(guarded());
    expect(screen.getByTestId(loadingTestId)).toBeTruthy();

    markBootstrapFlagRead();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });

  it('never unmounts the navigator once it has mounted', () => {
    mockUseAuth.mockReturnValue(createAuthValue());
    const view = render(guarded());
    expect(screen.getByTestId(childTestId)).toBeTruthy();

    // A sign-in lands before the flag read would otherwise hold the navigator.
    mockUseAuth.mockReturnValue(createAuthValue(signedIn));
    view.rerender(guarded());

    expect(screen.getByTestId(childTestId)).toBeTruthy();
    expect(screen.queryByTestId(loadingTestId)).toBeNull();
  });
});
