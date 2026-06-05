/* eslint-disable import/first */

import type { Session } from '@supabase/supabase-js';

const mockCreateClient = jest.fn();
const mockSecureStoreGetItemAsync = jest.fn();
const mockSecureStoreDeleteItemAsync = jest.fn();
const mockSecureStoreSetItemAsync = jest.fn();
const mockLogEvent = jest.fn();
const mockWipeLocalForAccountSwitch = jest.fn();
const mockRequestSync = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: (...args: unknown[]) => mockSecureStoreDeleteItemAsync(...args),
  getItemAsync: (...args: unknown[]) => mockSecureStoreGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSecureStoreSetItemAsync(...args),
}));

jest.mock('@/src/logging', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));

// Stub the local-data wipe so this remains a pure auth-service unit test (no
// real SQLite). The wipe's own behaviour is covered by its dedicated suite.
jest.mock('@/src/sync/account-wipe', () => ({
  wipeLocalForAccountSwitch: (...args: unknown[]) => mockWipeLocalForAccountSwitch(...args),
}));

// Stub the scheduler so the test can observe that a live session kicks a sync
// without wiring the real NetInfo/AppState-driven state machine.
jest.mock('@/src/sync/scheduler', () => ({
  requestSync: (...args: unknown[]) => mockRequestSync(...args),
}));

import {
  __resetAuthForTests,
  bootstrapAuthState,
  getAuthSnapshot,
  getSupabaseMobileClient,
  signInWithPassword,
  signOut,
  updateUserEmail,
  updateUserPassword,
} from '@/src/auth';
import {
  __resetAuthRequiredSignalForTests,
  getAuthRequiredSignal,
  markAuthRequired,
} from '@/src/sync/auth-required-signal';

type MockSessionOptions = {
  accessToken?: string;
  email?: string;
  userId?: string;
};

const createMockSession = ({
  accessToken = 'access-token',
  email = 'user@example.test',
  userId = 'user-1',
}: MockSessionOptions = {}) =>
  ({
    access_token: accessToken,
    expires_at: 1_800_000_000,
    expires_in: 3600,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    user: {
      id: userId,
      email,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-03-04T10:00:00.000Z',
    },
  }) as unknown as Session;

describe('auth service bootstrap', () => {
  const originalSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const mockUnsubscribe = jest.fn();
  const mockGetSession = jest.fn();
  const mockOnAuthStateChange = jest.fn();
  const mockSignInWithPassword = jest.fn();
  const mockSignOut = jest.fn();
  const mockUpdateUser = jest.fn();

  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    mockCreateClient.mockReset();
    mockSecureStoreGetItemAsync.mockReset();
    mockSecureStoreDeleteItemAsync.mockReset();
    mockSecureStoreSetItemAsync.mockReset();
    mockGetSession.mockReset();
    mockOnAuthStateChange.mockReset();
    mockSignInWithPassword.mockReset();
    mockSignOut.mockReset();
    mockUpdateUser.mockReset();
    mockUnsubscribe.mockReset();
    mockLogEvent.mockReset();
    mockWipeLocalForAccountSwitch.mockReset();
    mockWipeLocalForAccountSwitch.mockResolvedValue(undefined);
    mockRequestSync.mockReset();
    __resetAuthRequiredSignalForTests();

    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: mockUnsubscribe,
        },
      },
    });

    mockCreateClient.mockReturnValue({
      auth: {
        getSession: mockGetSession,
        onAuthStateChange: mockOnAuthStateChange,
        signInWithPassword: mockSignInWithPassword,
        signOut: mockSignOut,
        updateUser: mockUpdateUser,
      },
    });

    __resetAuthForTests();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
    __resetAuthForTests();
  });

  it('stays ready and unconfigured when the Supabase env vars are missing', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    __resetAuthForTests();

    const snapshot = await bootstrapAuthState();

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.isConfigured).toBe(false);
    expect(snapshot.session).toBeNull();
    expect(snapshot.disabledReason).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(snapshot.disabledReason).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('bootstraps the auth client and resolves a logged-out session state when no session is stored', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });

    const snapshot = await bootstrapAuthState();
    const client = getSupabaseMobileClient();

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage: expect.objectContaining({
            getItem: expect.any(Function),
            removeItem: expect.any(Function),
            setItem: expect.any(Function),
          }),
        }),
      })
    );
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(client).toBeTruthy();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.session).toBeNull();
    expect(snapshot.user).toBeNull();
    expect(snapshot.lastError).toBeNull();
  });

  it('reuses the restored bootstrap state instead of refetching the session on later calls', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });

    await bootstrapAuthState();
    await bootstrapAuthState();

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it('restores a stored session on bootstrap', async () => {
    const storedSession = createMockSession();

    mockGetSession.mockResolvedValue({
      data: {
        session: storedSession,
      },
      error: null,
    });

    const snapshot = await bootstrapAuthState();

    expect(snapshot.status).toBe('ready');
    expect(snapshot.session).toBe(storedSession);
    expect(snapshot.user?.id).toBe('user-1');
    expect(snapshot.user?.email).toBe('user@example.test');
  });

  it('surfaces session restore failures without leaving the bootstrap stuck', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: {
        message: 'Session restore failed',
      },
    });

    const snapshot = await bootstrapAuthState();

    expect(snapshot.status).toBe('ready');
    expect(snapshot.session).toBeNull();
    expect(snapshot.user).toBeNull();
    expect(snapshot.lastError).toBe('Session restore failed');
  });

  it('surfaces invalid sign-in failures and preserves the logged-out snapshot', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });
    mockSignInWithPassword.mockResolvedValue({
      data: {
        session: null,
      },
      error: {
        message: 'Invalid login credentials',
      },
    });

    await bootstrapAuthState();

    await expect(
      signInWithPassword({
        email: 'user@example.test',
        password: 'WrongPassword!999',
      })
    ).rejects.toMatchObject({
      message: 'Invalid login credentials',
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'WrongPassword!999',
    });
    expect(getAuthSnapshot()).toMatchObject({
      status: 'ready',
      session: null,
      user: null,
      lastError: 'Invalid login credentials',
    });
  });

  it('logs successful sign-ins after the authenticated session is available', async () => {
    const signedInSession = createMockSession();

    mockSignInWithPassword.mockResolvedValue({
      data: {
        session: signedInSession,
      },
      error: null,
    });

    await signInWithPassword({
      email: 'user@example.test',
      password: 'CorrectPassword!123',
    });

    expect(mockLogEvent).toHaveBeenCalledWith({
      level: 'info',
      source: 'auth',
      event: 'auth.sign_in_succeeded',
      message: 'User authentication completed successfully.',
      userId: 'user-1',
    });
  });

  it('signs out and clears the restored session snapshot', async () => {
    const storedSession = createMockSession();

    mockGetSession.mockResolvedValue({
      data: {
        session: storedSession,
      },
      error: null,
    });
    mockSignOut.mockResolvedValue({
      error: null,
    });

    await bootstrapAuthState();
    await signOut();

    const snapshot = getAuthSnapshot();

    expect(mockLogEvent).toHaveBeenCalledWith({
      level: 'info',
      source: 'auth',
      event: 'auth.sign_out_requested',
      message: 'User session termination was requested.',
      userId: 'user-1',
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // Sign-out clears the previous account's local data so it can't leak into
    // the next account that signs in on this device.
    expect(mockWipeLocalForAccountSwitch).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.session).toBeNull();
    expect(snapshot.user).toBeNull();
    expect(snapshot.lastError).toBeNull();
  });

  it('does not wipe local data when sign-out fails', async () => {
    const storedSession = createMockSession();

    mockGetSession.mockResolvedValue({
      data: { session: storedSession },
      error: null,
    });
    mockSignOut.mockResolvedValue({
      error: { message: 'network unreachable' },
    });

    await bootstrapAuthState();
    await expect(signOut()).rejects.toMatchObject({ message: 'network unreachable' });

    // A failed sign-out leaves the user signed in, so the local store must be
    // preserved — wiping it would strand the still-signed-in account.
    expect(mockWipeLocalForAccountSwitch).not.toHaveBeenCalled();
  });

  it('wipes local data when the active account changes to a different user', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: createMockSession({ userId: 'user-1' }) },
      error: null,
    });

    await bootstrapAuthState();

    // The captured onAuthStateChange handler is what Supabase invokes when the
    // signed-in account changes. Drive it with a session for a different user.
    const handler = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;

    handler('SIGNED_IN', createMockSession({ userId: 'user-2', email: 'other@example.test' }));
    await Promise.resolve();

    expect(mockWipeLocalForAccountSwitch).toHaveBeenCalledTimes(1);
    expect(getAuthSnapshot().user?.id).toBe('user-2');
  });

  it('does not wipe local data when the same account re-emits an auth state change', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: createMockSession({ userId: 'user-1' }) },
      error: null,
    });

    await bootstrapAuthState();

    const handler = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;

    // A token refresh re-emits the same account — no switch, so no wipe.
    handler('TOKEN_REFRESHED', createMockSession({ userId: 'user-1' }));
    await Promise.resolve();

    expect(mockWipeLocalForAccountSwitch).not.toHaveBeenCalled();
  });

  it('clears a stale "no signed-in user" signal when a live session arrives, so the route guard cannot oscillate', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await bootstrapAuthState();

    // A pre-sign-in cycle raised the signal while no user was signed in.
    markAuthRequired();
    expect(getAuthRequiredSignal()).toBe(true);

    // Supabase reports a fresh sign-in. The signal must clear synchronously with
    // the session becoming live so the route guard never observes the
    // contradictory (session present + auth-required) state, whose competing
    // redirects would otherwise spin into a "Maximum update depth" loop.
    const handler = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;
    handler('SIGNED_IN', createMockSession({ userId: 'user-1' }));

    expect(getAuthRequiredSignal()).toBe(false);
    expect(getAuthSnapshot().session?.user?.id).toBe('user-1');
  });

  it('kicks the first authenticated sync cycle when a live session arrives so the first-sync gate drains promptly', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await bootstrapAuthState();

    const handler = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;

    // No session: nothing to sync, so the scheduler is not nudged.
    handler('INITIAL_SESSION', null);
    expect(mockRequestSync).not.toHaveBeenCalled();

    // A live session: nudge the scheduler now rather than waiting for the idle
    // backstop, so the first signed-in cycle drains and the gate dismisses.
    handler('SIGNED_IN', createMockSession({ userId: 'user-1' }));
    expect(mockRequestSync).toHaveBeenCalledTimes(1);
  });

  it('leaves the "no signed-in user" signal untouched when an auth state change carries no session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: createMockSession({ userId: 'user-1' }) },
      error: null,
    });
    await bootstrapAuthState();

    markAuthRequired();
    expect(getAuthRequiredSignal()).toBe(true);

    const handler = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;
    // A sign-out carries no session, so the "needs sign-in" condition stands.
    handler('SIGNED_OUT', null);

    expect(getAuthRequiredSignal()).toBe(true);
  });

  it('updates the signed-in email and reports pending confirmation when auth keeps the current email active', async () => {
    const storedSession = createMockSession();

    mockGetSession.mockResolvedValue({
      data: {
        session: storedSession,
      },
      error: null,
    });
    mockUpdateUser.mockResolvedValue({
      data: {
        user: {
          ...storedSession.user,
          email: 'user@example.test',
          new_email: 'next@example.test',
        },
      },
      error: null,
    });

    await bootstrapAuthState();
    const result = await updateUserEmail({
      email: ' next@example.test ',
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      email: 'next@example.test',
    });
    expect(result.emailChangePending).toBe(true);
    expect(result.user?.new_email).toBe('next@example.test');
  });

  it('updates the signed-in password without mutating the current session snapshot', async () => {
    const storedSession = createMockSession();

    mockGetSession.mockResolvedValue({
      data: {
        session: storedSession,
      },
      error: null,
    });
    mockUpdateUser.mockResolvedValue({
      data: {
        user: storedSession.user,
      },
      error: null,
    });

    await bootstrapAuthState();
    const result = await updateUserPassword({
      password: 'StrongPassword!234',
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'StrongPassword!234',
    });
    expect(result.user?.id).toBe('user-1');
    expect(getAuthSnapshot().user?.id).toBe('user-1');
  });
});
