/* eslint-disable import/first */

const mockPush = jest.fn();
const mockUseAuth = jest.fn();
const mockLoadUserProfile = jest.fn();
const mockSaveUsername = jest.fn();
const mockResetLocalDataAndReseed = jest.fn();
const mockAlert = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/auth/profile', () => ({
  loadUserProfile: (...args: unknown[]) => mockLoadUserProfile(...args),
  saveUsername: (...args: unknown[]) => mockSaveUsername(...args),
}));

jest.mock('@/src/data', () => ({
  resetLocalDataAndReseed: (...args: unknown[]) => mockResetLocalDataAndReseed(...args),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ProfileRoute from '../profile';
import SettingsRoute from '../(tabs)/settings';

type MockUseAuthValue = {
  clearAuthError: jest.Mock;
  disabledReason: string | null;
  isConfigured: boolean;
  lastError: string | null;
  session: null;
  signInWithPassword: jest.Mock;
  signOut: jest.Mock;
  status: 'idle' | 'restoring' | 'ready';
  updateUserEmail: jest.Mock;
  updateUserPassword: jest.Mock;
  user: { email?: string | null; id: string } | null;
};

const createAuthValue = (overrides: Partial<MockUseAuthValue> = {}): MockUseAuthValue => ({
  clearAuthError: jest.fn(),
  disabledReason: null,
  isConfigured: true,
  lastError: null,
  session: null,
  signInWithPassword: jest.fn().mockResolvedValue({}),
  signOut: jest.fn().mockResolvedValue(undefined),
  status: 'ready',
  updateUserEmail: jest.fn().mockResolvedValue({
    emailChangePending: false,
    user: {
      id: 'user-1',
      email: 'member@example.test',
    },
  }),
  updateUserPassword: jest.fn().mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'member@example.test',
    },
  }),
  user: null,
  ...overrides,
});

const createProfileRecord = (overrides: Partial<{ createdAt: string; id: string; updatedAt: string; username: string | null }> = {}) => ({
  createdAt: '2026-03-04T12:00:00.000Z',
  id: 'user-1',
  updatedAt: '2026-03-04T12:05:00.000Z',
  username: 'member-lifter',
  ...overrides,
});

describe('settings and profile routes', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockUseAuth.mockReset();
    mockLoadUserProfile.mockReset();
    mockSaveUsername.mockReset();
    mockResetLocalDataAndReseed.mockReset();
    mockAlert.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlert(...args));
  });

  it('opens the profile route from settings', () => {
    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-profile-row'));

    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('exposes the dev reset surface in development builds and invokes the reset helper after confirmation', async () => {
    mockResetLocalDataAndReseed.mockResolvedValue({
      database: { name: 'fake-db' },
      resetAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    render(<SettingsRoute />);

    expect(screen.getByTestId('settings-dev-tools-card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-dev-reset-button'));

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [, , buttons] = mockAlert.mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
    const resetButton = buttons.find((button) => button.text === 'Reset');
    expect(resetButton).toBeDefined();

    await act(async () => {
      resetButton?.onPress?.();
    });

    await waitFor(() => {
      expect(mockResetLocalDataAndReseed).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-dev-reset-feedback')).toBeTruthy();
    });
    expect(screen.getByText('Local data wiped and the exercise catalog re-seeded.')).toBeTruthy();
  });

  it('surfaces dev reset failures inline without crashing the screen', async () => {
    mockResetLocalDataAndReseed.mockRejectedValue(new Error('Cannot wipe local data right now.'));

    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-dev-reset-button'));
    const [, , buttons] = mockAlert.mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
    await act(async () => {
      buttons.find((button) => button.text === 'Reset')?.onPress?.();
    });

    await waitFor(() => {
      expect(screen.getByText('Cannot wipe local data right now.')).toBeTruthy();
    });
  });

  it('renders logged-out profile state and submits email/password sign in', async () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);
    expect(
      screen.queryByText(
        'Use your provisioned email and password to unlock account management without affecting local-only tracker flows.'
      )
    ).toBeNull();

    fireEvent.changeText(screen.getByTestId('profile-email-input'), ' user@example.test ');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    await waitFor(() => {
      expect(authValue.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.test',
        password: 'secret-pass',
      });
    });
    expect(screen.getByTestId('profile-signed-out-card')).toBeTruthy();
  });

  it('blocks sign in when the email address is not valid', () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'not-an-email');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    expect(authValue.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('surfaces inline auth failure feedback near the sign-in form and clears stale errors on input', () => {
    const authValue = createAuthValue({
      lastError: 'Invalid login credentials',
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    expect(screen.getByTestId('profile-inline-error')).toBeTruthy();
    expect(screen.getByText('Invalid login credentials')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'next@example.test');

    expect(authValue.clearAuthError).toHaveBeenCalledTimes(1);
  });

  it('shows submit-time sign-in failures inline without leaving the logged-out state', async () => {
    const authValue = createAuthValue({
      signInWithPassword: jest.fn().mockRejectedValue(new Error('Invalid login credentials')),
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'user@example.test');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'WrongPassword!999');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-out-card')).toBeTruthy();
  });

  it('renders logged-in profile state in view mode with edit and sign-out actions', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(mockLoadUserProfile).toHaveBeenCalledWith('user-1');
    });
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByText('member@example.test')).toBeTruthy();
    expect(screen.getByText('member-lifter')).toBeTruthy();
    expect(screen.queryByTestId('profile-sync-card')).toBeNull();
    expect(screen.getByTestId('profile-edit-button')).toBeTruthy();
    expect(screen.getByTestId('profile-sign-out-button')).toBeTruthy();
    expect(screen.queryByTestId('profile-update-button')).toBeNull();
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
    expect(screen.queryByText('Account')).toBeNull();
    expect(
      screen.queryByText(
        'Manage your app username plus authenticated email/password updates without affecting local-only tracker flows.'
      )
    ).toBeNull();

    fireEvent.press(screen.getByTestId('profile-sign-out-button'));

    await waitFor(() => {
      expect(authValue.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('updates username from edit mode with the single update action', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord({
        username: 'old-name',
      }),
      wasProvisioned: false,
    });
    mockSaveUsername.mockResolvedValue(
      createProfileRecord({
        updatedAt: '2026-03-04T12:10:00.000Z',
        username: 'new-name',
      })
    );
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('old-name')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(screen.getByTestId('profile-cancel-edit-button')).toBeTruthy();
    expect(screen.getByTestId('profile-update-button')).toBeTruthy();
    expect(screen.queryByTestId('profile-sign-out-button')).toBeNull();
    expect(screen.queryByTestId('profile-edit-button')).toBeNull();
    fireEvent.changeText(screen.getByTestId('profile-username-input'), ' new-name ');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(mockSaveUsername).toHaveBeenCalledWith('user-1', ' new-name ');
    });
    expect(screen.getByText('Profile updated.')).toBeTruthy();
    expect(screen.queryByTestId('profile-update-button')).toBeNull();
  });

  it('shows inline username update failures while keeping the signed-in shell active', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord({
        username: 'old-name',
      }),
      wasProvisioned: false,
    });
    mockSaveUsername.mockRejectedValue(new Error('Unable to save username right now.'));
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('old-name')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'new-name');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to save username right now.')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByTestId('profile-update-button')).toBeTruthy();
  });

  it('shows inline profile load failures without dropping the signed-in account shell', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockRejectedValue(new Error('Unable to load profile right now.'));
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load profile right now.')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByText('member@example.test')).toBeTruthy();
  });

  it('submits authenticated email updates from edit mode and distinguishes pending confirmation messaging', async () => {
    const authValue = createAuthValue({
      updateUserEmail: jest.fn().mockResolvedValue({
        emailChangePending: true,
        user: {
          id: 'user-1',
          email: 'member@example.test',
          new_email: 'next@example.test',
        },
      }),
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), ' next@example.test ');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(authValue.updateUserEmail).toHaveBeenCalledWith({
        email: 'next@example.test',
      });
    });
    expect(screen.getByText('Email change submitted. Confirm the change from your email inbox before it fully takes effect.')).toBeTruthy();
  });

  it('blocks profile updates when the edited email is invalid', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), 'not-an-email');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    expect(authValue.updateUserEmail).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('submits password updates from edit mode, clears the field, and shows success feedback', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'StrongPassword!234');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(authValue.updateUserPassword).toHaveBeenCalledWith({
        password: 'StrongPassword!234',
      });
    });
    expect(screen.getByText('Profile updated.')).toBeTruthy();
    expect(screen.queryByTestId('profile-password-update-input')).toBeNull();
  });

  it('shows inline update failures and still clears the password field after submit', async () => {
    const authValue = createAuthValue({
      updateUserPassword: jest.fn().mockRejectedValue(new Error('Unable to update password right now.')),
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'StrongPassword!234');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to update password right now.')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-password-update-input').props.value).toBe('');
  });
});
