/* eslint-disable import/first */

const mockUseAuth = jest.fn();
let mockPathname = '/stats-history';

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Redirect = ({ href }: { href: string }) =>
    React.createElement(Text, { testID: 'guard-redirect' }, href);
  Redirect.displayName = 'MockRedirect';
  return {
    Redirect,
    usePathname: () => mockPathname,
  };
});

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';
import { __resetAuthRequiredSignalForTests, markAuthRequired } from '@/src/sync/auth-required-signal';

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

const renderGuard = () =>
  render(
    <AuthRouteGuard>
      <Text testID="guard-child">data screen</Text>
    </AuthRouteGuard>,
  );

const childTestId = 'guard-child';
const redirectTestId = 'guard-redirect';
const loadingTestId = 'auth-guard-loading';

describe('AuthRouteGuard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockPathname = '/stats-history';
    __resetAuthRequiredSignalForTests();
  });

  it('redirects to the sign-in route when auth is configured and there is no session', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ isConfigured: true, session: null }));

    renderGuard();

    expect(screen.getByTestId(redirectTestId).props.children).toBe('/sign-in');
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('renders children when a session exists', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ session: { user: { id: 'user-1' } } }));

    renderGuard();

    expect(screen.getByTestId(childTestId)).toBeTruthy();
    expect(screen.queryByTestId(redirectTestId)).toBeNull();
  });

  it('shows a neutral loading state while the session restore is in flight', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ status: 'restoring' }));

    renderGuard();

    expect(screen.getByTestId(loadingTestId)).toBeTruthy();
    // It must not flash either the sign-in redirect or a data screen.
    expect(screen.queryByTestId(redirectTestId)).toBeNull();
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('routes an AUTH_REQUIRED sync outcome to the sign-in route even when a stale session is still present', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ session: { user: { id: 'user-1' } } }));
    markAuthRequired();

    renderGuard();

    expect(screen.getByTestId(redirectTestId).props.children).toBe('/sign-in');
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('redirects to sign-in when auth is unconfigured and there is no session', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ isConfigured: false, session: null }));

    renderGuard();

    expect(screen.getByTestId(redirectTestId).props.children).toBe('/sign-in');
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it('does not redirect when already on the sign-in route (no redirect loop)', () => {
    mockPathname = '/sign-in';
    mockUseAuth.mockReturnValue(createAuthValue({ isConfigured: true, session: null }));

    renderGuard();

    expect(screen.queryByTestId(redirectTestId)).toBeNull();
    expect(screen.getByTestId(childTestId)).toBeTruthy();
  });
});
