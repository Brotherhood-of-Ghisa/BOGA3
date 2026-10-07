/* eslint-disable import/first */

const mockUseAuth = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Leaving sign-in once the user may use the app is the root stack's job
// (root-stack-routing.test.tsx), not this screen's.
jest.mock('expo-router', () => {
  const Stack = () => null;
  Stack.displayName = 'MockStack';
  const StackScreen = () => null;
  StackScreen.displayName = 'MockStackScreen';
  Stack.Screen = StackScreen;
  return {
    Stack,
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '../app/sign-in';
import { __resetAuthRequiredSignalForTests, getAuthRequiredSignal, markAuthRequired } from '@/src/sync/auth-required-signal';

type AuthValue = {
  clearAuthError: jest.Mock;
  disabledReason: string | null;
  isConfigured: boolean;
  lastError: string | null;
  session: unknown;
  signInWithPassword: jest.Mock;
  status: 'idle' | 'restoring' | 'ready';
};

const createAuthValue = (overrides: Partial<AuthValue> = {}): AuthValue => ({
  clearAuthError: jest.fn(),
  disabledReason: null,
  isConfigured: true,
  lastError: null,
  session: null,
  signInWithPassword: jest.fn().mockResolvedValue({}),
  status: 'ready',
  ...overrides,
});

describe('SignInScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    __resetAuthRequiredSignalForTests();
  });

  it('renders the credential form when auth is configured and signed out', () => {
    mockUseAuth.mockReturnValue(createAuthValue());

    render(<SignInScreen />);

    expect(screen.getByTestId('sign-in-card')).toBeTruthy();
    expect(screen.getByTestId('sign-in-email-input')).toBeTruthy();
    expect(screen.getByTestId('sign-in-password-input')).toBeTruthy();
    expect(screen.getByTestId('sign-in-submit-button')).toBeTruthy();
    expect(screen.queryByText(/keep it in sync/)).toBeNull();
  });

  it('submits the trimmed email + password and clears the auth-required signal on success', async () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);
    markAuthRequired();

    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email-input'), ' user@example.test ');
    fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('sign-in-submit-button'));

    await waitFor(() => {
      expect(authValue.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.test',
        password: 'secret-pass',
      });
    });
    await waitFor(() => {
      expect(getAuthRequiredSignal()).toBe(false);
    });
  });

  it('blocks submit on an invalid email and shows an inline message', () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);

    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'not-an-email');
    fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('sign-in-submit-button'));

    expect(authValue.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('keeps the user on the sign-in screen and shows the inline error on failure', async () => {
    const authValue = createAuthValue({
      signInWithPassword: jest.fn().mockRejectedValue(new Error('Invalid login credentials')),
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'user@example.test');
    fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'WrongPassword!1');
    fireEvent.press(screen.getByTestId('sign-in-submit-button'));

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeTruthy();
    });
    expect(screen.getByTestId('sign-in-card')).toBeTruthy();
  });

  it('shows the disabled-reason message instead of a form when auth is unconfigured', () => {
    mockUseAuth.mockReturnValue(
      createAuthValue({
        isConfigured: false,
        disabledReason: 'Supabase mobile auth is not configured. Missing EXPO_PUBLIC_SUPABASE_URL.',
      }),
    );

    render(<SignInScreen />);

    expect(screen.getByTestId('sign-in-auth-disabled-card')).toBeTruthy();
    expect(
      screen.getByText('Supabase mobile auth is not configured. Missing EXPO_PUBLIC_SUPABASE_URL.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('sign-in-card')).toBeNull();
  });
});
