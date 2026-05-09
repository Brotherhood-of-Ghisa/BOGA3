/* eslint-disable import/first */

import type { Session } from '@supabase/supabase-js';

const mockCreateClient = jest.fn();
const mockSecureStoreGetItemAsync = jest.fn();
const mockSecureStoreDeleteItemAsync = jest.fn();
const mockSecureStoreSetItemAsync = jest.fn();
const mockLogEvent = jest.fn();

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
    expect(snapshot.status).toBe('ready');
    expect(snapshot.session).toBeNull();
    expect(snapshot.user).toBeNull();
    expect(snapshot.lastError).toBeNull();
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
