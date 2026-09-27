/* eslint-disable import/first */

const mockUseAuth = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthRouteGuard } from '@/components/navigation/auth-route-guard';

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
      <Text testID="guard-child">root navigator</Text>
    </AuthRouteGuard>,
  );

const childTestId = 'guard-child';
const loadingTestId = 'auth-guard-loading';

// Which routes the navigator then offers (sign-in, the first-sync block, the app)
// is covered by root-route-access.test.ts and root-stack-routing.test.tsx.
describe('AuthRouteGuard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('shows a neutral loading state instead of the navigator while the session restore is in flight', () => {
    mockUseAuth.mockReturnValue(createAuthValue({ status: 'restoring' }));

    renderGuard();

    expect(screen.getByTestId(loadingTestId)).toBeTruthy();
    expect(screen.queryByTestId(childTestId)).toBeNull();
  });

  it.each([
    ['signed out', createAuthValue({ session: null })],
    ['signed in', createAuthValue({ session: { user: { id: 'user-1' } } })],
    ['auth unconfigured', createAuthValue({ isConfigured: false })],
  ])('renders the navigator once the restore resolves (%s)', (_label, auth) => {
    mockUseAuth.mockReturnValue(auth);

    renderGuard();

    expect(screen.getByTestId(childTestId)).toBeTruthy();
    expect(screen.queryByTestId(loadingTestId)).toBeNull();
  });
});
