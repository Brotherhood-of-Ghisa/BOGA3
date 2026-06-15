/* eslint-disable import/first */

const mockGetSupabaseMobileClient = jest.fn();
const mockInsert = jest.fn();
const mockIsDevMode = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getSupabaseMobileClient: (...args: unknown[]) => mockGetSupabaseMobileClient(...args),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: (...args: unknown[]) => mockIsDevMode(...args),
  DEV_BUNDLE_ID: 'com.phano.boga3.dev',
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
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import { __resetLogBufferForTests, getRecentLogs } from '@/src/logging/buffer';
import { __resetLoggingUserIdForTests, setLoggingUserId } from '@/src/logging/currentUser';
import { __resetLogFlushForTests, flushLogs } from '@/src/logging/flush';
import { logEvent } from '@/src/logging/logEvent';

const buildMockClient = () => ({
  from: jest.fn(() => ({
    insert: mockInsert,
  })),
});

const insertedRows = (call = 0): Record<string, unknown>[] => mockInsert.mock.calls[call][0];

describe('logEvent + flush', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGetSupabaseMobileClient.mockReset();
    mockInsert.mockReset();
    mockIsDevMode.mockReset();
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
    mockIsDevMode.mockReturnValue(false);

    __resetLogBufferForTests();
    __resetLoggingUserIdForTests();
    __resetLogFlushForTests();

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints every level to the matching console channel and buffers it', async () => {
    await logEvent({ level: 'debug', source: 'sync', event: 'sync.debug' });
    await logEvent({ level: 'info', source: 'auth', event: 'auth.info' });
    await logEvent({ level: 'warn', source: 'app', event: 'app.warn' });
    await logEvent({ level: 'error', source: 'database', event: 'db.error' });

    expect(logSpy).toHaveBeenCalledWith('[sync] sync.debug');
    expect(logSpy).toHaveBeenCalledWith('[auth] auth.info');
    expect(warnSpy).toHaveBeenCalledWith('[app] app.warn');
    expect(errorSpy).toHaveBeenCalledWith('[database] db.error');

    const events = getRecentLogs().map((entry) => entry.event);
    expect(events).toEqual(['sync.debug', 'auth.info', 'app.warn', 'db.error']);
  });

  it('does not persist debug/info to Supabase even when signed in', async () => {
    setLoggingUserId('user-1');

    await logEvent({ level: 'debug', source: 'sync', event: 'sync.debug' });
    await logEvent({ level: 'info', source: 'auth', event: 'auth.info' });
    await flushLogs();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('buffers warn/error while signed out and flushes them in one batch after login', async () => {
    // Signed out: the table only accepts authenticated inserts, so nothing is
    // written yet — anon access stays fully revoked.
    await logEvent({ level: 'warn', source: 'auth', event: 'auth.sign_in_failed' });
    await logEvent({ level: 'error', source: 'sync', event: 'sync.boot_failed' });
    expect(mockInsert).not.toHaveBeenCalled();

    // Login mirrors the user id and flushes the backlog in a single insert.
    setLoggingUserId('later-user');
    await flushLogs();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.event)).toEqual(['auth.sign_in_failed', 'sync.boot_failed']);
    // Captured at log time → these happened before login, so user_id stays null
    // (RLS accepts a null user_id from an authenticated session).
    expect(rows.every((row) => row.user_id === null)).toBe(true);
  });

  it('stamps the signed-in user and inserts on a warn while signed in', async () => {
    setLoggingUserId('user-1');

    await logEvent({ level: 'warn', source: 'sync', event: 'sync.flush_failed' });
    await flushLogs();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(insertedRows()[0]).toEqual(expect.objectContaining({ user_id: 'user-1' }));
  });

  it('honours an explicit userId over the auth mirror', async () => {
    setLoggingUserId('mirror-user');

    await logEvent({ level: 'warn', source: 'auth', event: 'auth.x', userId: 'explicit-user' });
    await flushLogs();

    expect(insertedRows()[0]).toEqual(expect.objectContaining({ user_id: 'explicit-user' }));
  });

  it('preserves an explicit null userId while still inserting', async () => {
    setLoggingUserId('mirror-user');

    await logEvent({ level: 'error', source: 'auth', event: 'auth.x', userId: null });
    await flushLogs();

    expect(insertedRows()[0]).toEqual(expect.objectContaining({ user_id: null }));
  });

  it('never inserts while signed out (table is authenticated-only)', async () => {
    await logEvent({ level: 'error', source: 'sync', event: 'sync.boot_failed' });
    await flushLogs();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts default source, client metadata, an event timestamp, and sanitized context', async () => {
    setLoggingUserId('user-1');

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
    await flushLogs();

    const row = insertedRows()[0];
    expect(row).toEqual(
      expect.objectContaining({
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
      })
    );
    expect(typeof row.created_at).toBe('string');
    expect(Number.isNaN(new Date(row.created_at as string).getTime())).toBe(false);
  });

  it('never throws when the insert rejects (records stay queued for retry)', async () => {
    setLoggingUserId('user-1');
    mockInsert.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      logEvent({ level: 'error', source: 'auth', event: 'auth.sign_in_failed' })
    ).resolves.toBeUndefined();
    await expect(flushLogs()).resolves.toBeUndefined();
  });

  it('never throws when Supabase returns an insert error', async () => {
    setLoggingUserId('user-1');
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table app_logs' },
    });

    await expect(
      logEvent({ level: 'warn', source: 'auth', event: 'auth.x' })
    ).resolves.toBeUndefined();
    await expect(flushLogs()).resolves.toBeUndefined();
  });

  it('returns without inserting when the Supabase client is unavailable', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(null);
    setLoggingUserId('user-1');

    await expect(
      logEvent({ level: 'error', event: 'auth.restore_failed' })
    ).resolves.toBeUndefined();
    await flushLogs();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('emits a loud drop notice when the pending queue overflows', async () => {
    // Overflow the 200-entry pending queue by 5 while signed out (no flush
    // drains it), then flush once signed in.
    for (let index = 0; index < 205; index += 1) {
      await logEvent({ level: 'warn', source: 'sync', event: `sync.warn_${index}` });
    }

    setLoggingUserId('user-1');
    await flushLogs();

    const dropNotice = getRecentLogs().find((entry) => entry.event === 'logging.dropped');
    expect(dropNotice).toBeDefined();
    expect(dropNotice?.context).toEqual({ droppedCount: 5 });
  });
});
