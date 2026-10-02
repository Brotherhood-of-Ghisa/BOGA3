/* eslint-disable import/first */

/**
 * The profile route's states and account flows that the Settings/Profile
 * navigation suite does not reach: restoring and auth-disabled states, the
 * failures each action can hit (including non-Error rejections), Cancel and
 * "no changes", a pending email, a profile read that lands after the user
 * changed, and what an account switch or sign-out resets. The auth session
 * and the profile are server state, faked at that boundary as
 * `settings-profile-navigation.test.tsx` does.
 */

const mockUseAuth = jest.fn();
const mockLoadUserProfile = jest.fn();
const mockSaveUsername = jest.fn();

jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/src/auth/profile', () => ({
  loadUserProfile: (...args: unknown[]) => mockLoadUserProfile(...args),
  saveUsername: (...args: unknown[]) => mockSaveUsername(...args),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileRoute from '../profile';

type User = { id: string; email?: string | null; new_email?: string | null };

const authValue = (overrides: Record<string, unknown> = {}) => ({
  clearAuthError: jest.fn(),
  disabledReason: null,
  isConfigured: true,
  lastError: null,
  session: null,
  signInWithPassword: jest.fn().mockResolvedValue({}),
  signOut: jest.fn().mockResolvedValue(undefined),
  status: 'ready',
  updateUserEmail: jest.fn().mockResolvedValue({ emailChangePending: false }),
  updateUserPassword: jest.fn().mockResolvedValue({}),
  user: null as User | null,
  ...overrides,
});

const profileRecord = (username: string | null, id = 'user-1') => ({
  id, username, createdAt: '2026-03-04T12:00:00.000Z', updatedAt: '2026-03-04T12:05:00.000Z',
});

const USER: User = { id: 'user-1', email: 'member@example.test' };

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const valueOf = (testID: string) => screen.getByTestId(testID).props.value;

beforeEach(() => {
  mockUseAuth.mockReset();
  mockLoadUserProfile.mockReset().mockResolvedValue({ profile: profileRecord('member-lifter') });
  mockSaveUsername.mockReset();
});

const signedIn = async (overrides: Record<string, unknown> = {}) => {
  const auth = authValue({ user: USER, ...overrides });
  mockUseAuth.mockReturnValue(auth);
  const view = render(<ProfileRoute />);
  await waitFor(() => expect(screen.getByText('member-lifter')).toBeOnTheScreen());
  return { auth, view };
};

describe('profile route states', () => {
  it('shows the restoring panel and disables sign-in while auth restores', () => {
    mockUseAuth.mockReturnValue(authValue({ status: 'restoring' }));
    render(<ProfileRoute />);
    expect(screen.getByTestId('profile-restoring-state')).toBeOnTheScreen();
    expect(screen.getByTestId('profile-sign-in-button')).toBeDisabled();
  });

  it.each<[string | null, string]>([
    ['Set EXPO_PUBLIC_SUPABASE_URL.', 'Set EXPO_PUBLIC_SUPABASE_URL.'],
    [null, 'Supabase mobile auth is not configured.'],
  ])('explains why auth is unavailable (%s) and disables sign-in', (disabledReason, message) => {
    mockUseAuth.mockReturnValue(authValue({ isConfigured: false, disabledReason }));
    render(<ProfileRoute />);
    expect(screen.getByTestId('profile-auth-disabled-card')).toHaveTextContent(message, { exact: false });
    expect(screen.getByTestId('profile-sign-in-button')).toBeDisabled();
  });

  it('shows the last auth error inline when signed out', () => {
    mockUseAuth.mockReturnValue(authValue({ lastError: 'Session expired.' }));
    render(<ProfileRoute />);
    expect(screen.getByTestId('profile-inline-error')).toHaveTextContent('Session expired.');
  });

  it('shows a pending email beside the current one', async () => {
    await signedIn({ user: { ...USER, new_email: ' next@example.test ' } });
    expect(screen.getByText('next@example.test')).toBeOnTheScreen();
    expect(screen.getByText('member@example.test')).toBeOnTheScreen();
  });

  it('shows "Email unavailable" and "Not set" when the account has neither', async () => {
    mockLoadUserProfile.mockResolvedValue({ profile: profileRecord(null) });
    mockUseAuth.mockReturnValue(authValue({ user: { id: 'user-1', email: null } }));
    render(<ProfileRoute />);
    await waitFor(() => expect(screen.getByText('Not set')).toBeOnTheScreen());
    expect(screen.getByText('Email unavailable')).toBeOnTheScreen();
  });
});

describe('signing in and out', () => {
  it.each<[string, string, string]>([
    ['an empty email', '', 'secret'],
    ['an empty password', 'member@example.test', ''],
  ])('asks for both fields on %s', (_label, email, password) => {
    const auth = authValue();
    mockUseAuth.mockReturnValue(auth);
    render(<ProfileRoute />);
    fireEvent.changeText(screen.getByTestId('profile-email-input'), email);
    fireEvent.changeText(screen.getByTestId('profile-password-input'), password);
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));
    expect(screen.getByTestId('profile-inline-error')).toHaveTextContent('Enter your email and password to continue.');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows a generic message when sign-in fails with a non-Error', async () => {
    mockUseAuth.mockReturnValue(authValue({ signInWithPassword: jest.fn().mockRejectedValue('boom') }));
    render(<ProfileRoute />);
    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'member@example.test');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret');
    await act(async () => fireEvent.press(screen.getByTestId('profile-sign-in-button')));
    expect(screen.getByTestId('profile-inline-error')).toHaveTextContent('Unable to sign in right now.');
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('Network down.'), 'Network down.'],
    ['a non-Error', 'boom', 'Unable to sign out right now.'],
  ])('keeps me signed in and shows the failure when sign-out fails with %s', async (_label, failure, message) => {
    await signedIn({ signOut: jest.fn().mockRejectedValue(failure) });
    await act(async () => fireEvent.press(screen.getByTestId('profile-sign-out-button')));
    expect(screen.getByTestId('profile-inline-error')).toHaveTextContent(message);
    expect(screen.getByTestId('profile-sign-out-button')).not.toBeDisabled();
  });

  it('keeps the typed sign-in email after signing out, but not the password', async () => {
    const auth = authValue();
    mockUseAuth.mockReturnValue(auth);
    const view = render(<ProfileRoute />);
    fireEvent.changeText(screen.getByTestId('profile-email-input'), ' member@example.test ');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret');
    await act(async () => fireEvent.press(screen.getByTestId('profile-sign-in-button')));
    mockUseAuth.mockReturnValue({ ...auth, user: USER });
    view.rerender(<ProfileRoute />);
    await waitFor(() => expect(screen.getByText('member-lifter')).toBeOnTheScreen());
    mockUseAuth.mockReturnValue({ ...auth, user: null });
    view.rerender(<ProfileRoute />);
    expect(valueOf('profile-email-input')).toBe('member@example.test');
    expect(valueOf('profile-password-input')).toBe('');
  });
});

describe('editing the profile', () => {
  it('Cancel restores the saved values and closes the form', async () => {
    await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'someone-else');
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), 'new@example.test');
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'hunter22');
    fireEvent.press(screen.getByTestId('profile-cancel-edit-button'));
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(valueOf('profile-username-input')).toBe('member-lifter');
    expect(valueOf('profile-email-update-input')).toBe('member@example.test');
    expect(valueOf('profile-password-update-input')).toBe('');
  });

  it('Cancel restores an empty username when none is saved', async () => {
    mockLoadUserProfile.mockResolvedValue({ profile: profileRecord(null) });
    mockUseAuth.mockReturnValue(authValue({ user: USER }));
    render(<ProfileRoute />);
    await waitFor(() => expect(screen.getByText('Not set')).toBeOnTheScreen());
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'typed');
    fireEvent.press(screen.getByTestId('profile-cancel-edit-button'));
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(valueOf('profile-username-input')).toBe('');
  });

  it('refuses an update with no changes', async () => {
    const { auth } = await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(screen.getByTestId('profile-update-feedback')).toHaveTextContent('No changes to update.');
    expect(mockSaveUsername).not.toHaveBeenCalled();
    expect(auth.updateUserEmail).not.toHaveBeenCalled();
  });

  it('treats an email differing only in case as unchanged', async () => {
    const { auth } = await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), 'MEMBER@example.test');
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(screen.getByTestId('profile-update-feedback')).toHaveTextContent('No changes to update.');
    expect(auth.updateUserEmail).not.toHaveBeenCalled();
  });

  it('saves a username, an email and a password together, and clears the password', async () => {
    mockSaveUsername.mockResolvedValue(profileRecord(null));
    const { auth } = await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), '  ');
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), ' next@example.test ');
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'hunter22');
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(mockSaveUsername).toHaveBeenCalledWith('user-1', '  ');
    expect(auth.updateUserEmail).toHaveBeenCalledWith({ email: 'next@example.test' });
    expect(auth.updateUserPassword).toHaveBeenCalledWith({ password: 'hunter22' });
    expect(screen.getByTestId('profile-update-feedback')).toHaveTextContent('Profile updated.');
    expect(screen.getByText('Not set')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(valueOf('profile-username-input')).toBe('');
    expect(valueOf('profile-email-update-input')).toBe('next@example.test');
    expect(valueOf('profile-password-update-input')).toBe('');
  });

  it('shows a generic message when an update fails with a non-Error, and keeps the form open', async () => {
    mockSaveUsername.mockRejectedValue('boom');
    await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'renamed');
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(screen.getByTestId('profile-update-feedback')).toHaveTextContent('Unable to update profile right now.');
    expect(screen.getByTestId('profile-username-input')).toBeOnTheScreen();
  });
});

describe('loading the profile', () => {
  it('still saves a username after the profile failed to load', async () => {
    mockLoadUserProfile.mockRejectedValue(new Error('Profile unavailable.'));
    mockSaveUsername.mockResolvedValue(profileRecord('fresh-name'));
    mockUseAuth.mockReturnValue(authValue({ user: USER }));
    render(<ProfileRoute />);
    await waitFor(() => expect(screen.getByTestId('profile-load-error')).toHaveTextContent('Profile unavailable.'));
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'fresh-name');
    expect(screen.queryByTestId('profile-load-error')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(mockSaveUsername).toHaveBeenCalledWith('user-1', 'fresh-name');
    expect(screen.getByText('fresh-name')).toBeOnTheScreen();
  });

  it('shows a generic message when the load fails with a non-Error', async () => {
    mockLoadUserProfile.mockRejectedValue('boom');
    mockUseAuth.mockReturnValue(authValue({ user: USER }));
    render(<ProfileRoute />);
    await waitFor(() => expect(screen.getByTestId('profile-load-error')).toHaveTextContent('Unable to load profile right now.'));
  });

  it.each<[string, (load: Deferred) => void]>([
    ['succeeds', (load) => load.resolve({ profile: profileRecord('stale-name') })],
    ['fails', (load) => load.reject(new Error('Stale failure.'))],
  ])("ignores the previous account's load that %s after switching accounts", async (_label, settle) => {
    const first = deferred();
    mockLoadUserProfile.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ profile: profileRecord('second-lifter', 'user-2') });
    const auth = authValue({ user: USER });
    mockUseAuth.mockReturnValue(auth);
    const view = render(<ProfileRoute />);
    mockUseAuth.mockReturnValue({ ...auth, user: { id: 'user-2', email: 'second@example.test' } });
    view.rerender(<ProfileRoute />);
    await waitFor(() => expect(screen.getByText('second-lifter')).toBeOnTheScreen());
    await act(async () => settle(first));
    expect(screen.getByText('second-lifter')).toBeOnTheScreen();
    expect(screen.queryByText('stale-name')).toBeNull();
    expect(screen.queryByTestId('profile-load-error')).toBeNull();
  });

  it('resets the edit form and feedback when switching accounts', async () => {
    const { auth, view } = await signedIn();
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    await act(async () => fireEvent.press(screen.getByTestId('profile-update-button')));
    expect(screen.getByTestId('profile-update-feedback')).toBeOnTheScreen();
    mockLoadUserProfile.mockResolvedValue({ profile: profileRecord('second-lifter', 'user-2') });
    mockUseAuth.mockReturnValue({ ...auth, user: { id: 'user-2', email: 'second@example.test' } });
    view.rerender(<ProfileRoute />);
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
    expect(screen.queryByTestId('profile-update-feedback')).toBeNull();
    await waitFor(() => expect(screen.getByText('second-lifter')).toBeOnTheScreen());
    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(valueOf('profile-email-update-input')).toBe('second@example.test');
  });

  it('ignores a load that finishes after signing out', async () => {
    const load = deferred();
    mockLoadUserProfile.mockReturnValueOnce(load.promise);
    const auth = authValue({ user: USER });
    mockUseAuth.mockReturnValue(auth);
    const view = render(<ProfileRoute />);
    mockUseAuth.mockReturnValue({ ...auth, user: null });
    view.rerender(<ProfileRoute />);
    await act(async () => load.resolve({ profile: profileRecord('stale-name') }));
    expect(screen.getByTestId('profile-signed-out-card')).toBeOnTheScreen();
    mockUseAuth.mockReturnValue(auth);
    mockLoadUserProfile.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(<ProfileRoute />);
    expect(screen.getByText('Loading...')).toBeOnTheScreen();
    expect(screen.queryByText('stale-name')).toBeNull();
  });
});
