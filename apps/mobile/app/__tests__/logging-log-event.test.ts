/* eslint-disable import/first */

const mockGetSupabaseMobileClient = jest.fn();
const mockInsert = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getSupabaseMobileClient: (...args: unknown[]) => mockGetSupabaseMobileClient(...args),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.3',
  nativeBuildVersion: '45',
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      env: 'test',
    },
    version: '9.9.9',
  },
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

import { logEvent } from '@/src/logging/logEvent';

const buildMockClient = () => ({
  auth: {
    getSession: mockGetSession,
  },
  from: jest.fn(() => ({
    insert: mockInsert,
  })),
});

describe('logEvent', () => {
  beforeEach(() => {
    mockGetSupabaseMobileClient.mockReset();
    mockInsert.mockReset();
    mockGetSession.mockReset();
    mockInsert.mockResolvedValue({
      data: null,
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });
  });

  it('returns without inserting when the Supabase mobile client is unavailable', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(null);

    await expect(
      logEvent({
        level: 'error',
        event: 'auth.restore_failed',
      })
    ).resolves.toBeUndefined();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts the current authenticated user id when userId is omitted', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'current-user-1',
          },
        },
      },
      error: null,
    });

    await logEvent({
      level: 'info',
      source: 'auth',
      event: 'auth.restore_succeeded',
    });

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'current-user-1',
      })
    );
  });

  it('preserves an explicit userId without reading the current session', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());

    await logEvent({
      level: 'info',
      source: 'auth',
      event: 'auth.sign_in_succeeded',
      userId: 'explicit-user-1',
    });

    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'explicit-user-1',
      })
    );
  });

  it('inserts null when userId is omitted and no session is available', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());

    await logEvent({
      level: 'warn',
      source: 'sync',
      event: 'sync.auth_required',
    });

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
      })
    );
  });

  it('preserves an explicit null userId', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());

    await logEvent({
      level: 'info',
      source: 'auth',
      event: 'auth.sign_out_requested',
      userId: null,
    });

    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
      })
    );
  });

  it('still attempts the log insert when the session lookup fails', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockGetSession.mockRejectedValueOnce(new Error('session lookup failed'));

    await expect(
      logEvent({
        level: 'error',
        source: 'sync',
        event: 'sync.flush_transport_failed',
      })
    ).resolves.toBeUndefined();

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
      })
    );
  });

  it('still attempts the log insert when Supabase returns a session lookup error', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'ignored-user-1',
          },
        },
      },
      error: {
        message: 'session unavailable',
      },
    });

    await expect(
      logEvent({
        level: 'error',
        source: 'sync',
        event: 'sync.flush_transport_failed',
      })
    ).resolves.toBeUndefined();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
      })
    );
  });

  it('inserts default source, client metadata, and sanitized context', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());

    await logEvent({
      level: 'warn',
      event: 'sync.flush_transport_failed',
      message: 'network failed',
      userId: 'user-1',
      context: {
        retryCount: 2,
        password: 'secret',
        session: { access_token: 'token' },
        user: { id: 'user-1' },
        apiKey: 'api-key',
        nested: {
          accessToken: 'token',
          cookie: 'session-cookie',
          status: 'transport_failure',
        },
      },
    });

    expect(mockInsert).toHaveBeenCalledWith({
      level: 'warn',
      source: 'app',
      event: 'sync.flush_transport_failed',
      message: 'network failed',
      user_id: 'user-1',
      client_platform: 'ios',
      client_app_version: '1.2.3',
      client_build_number: '45',
      client_runtime_version: null,
      client_update_id: null,
      client_channel: null,
      client_variant: 'test',
      context: {
        retryCount: 2,
        nested: {
          status: 'transport_failure',
        },
      },
    });
  });

  it('never throws when the insert fails', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockInsert.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      logEvent({
        level: 'error',
        source: 'auth',
        event: 'auth.sign_in_failed',
      })
    ).resolves.toBeUndefined();
  });

  it('never throws when Supabase returns an insert error', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'permission denied for table app_logs',
      },
    });

    await expect(
      logEvent({
        level: 'info',
        source: 'auth',
        event: 'auth.sign_in_succeeded',
      })
    ).resolves.toBeUndefined();
  });
});
