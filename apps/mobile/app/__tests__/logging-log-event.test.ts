/* eslint-disable import/first */

const mockGetSupabaseMobileClient = jest.fn();
const mockInsert = jest.fn();
const mockIsDevMode = jest.fn();
const mockAppStateAddListener = jest.fn();
const mockAppStateRemove = jest.fn();

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
    addEventListener: (...args: unknown[]) => mockAppStateAddListener(...args),
  },
}));

import { __resetLogBufferForTests, getRecentLogs } from '@/src/logging/buffer';
import { __resetLoggingUserIdForTests, setLoggingUserId } from '@/src/logging/currentUser';
import {
  __resetLogFlushForTests,
  FLUSH_INTERVAL_MS,
  flushLogs,
  startLogFlushLoop,
  stopLogFlushLoop,
} from '@/src/logging/flush';
import { logEvent } from '@/src/logging/logEvent';

const buildMockClient = () => ({
  from: jest.fn(() => ({
    insert: mockInsert,
  })),
});

const insertedRows = (call = 0): Record<string, unknown>[] => mockInsert.mock.calls[call][0];

const allInsertedRows = (): Record<string, unknown>[] =>
  mockInsert.mock.calls.flatMap((call) => call[0] as Record<string, unknown>[]);

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

const resetLoggingTestState = () => {
  mockGetSupabaseMobileClient.mockReset();
  mockInsert.mockReset();
  mockIsDevMode.mockReset();
  mockAppStateAddListener.mockReset();
  mockAppStateRemove.mockReset();
  mockInsert.mockResolvedValue({ data: null, error: null });
  mockGetSupabaseMobileClient.mockReturnValue(buildMockClient());
  mockIsDevMode.mockReturnValue(false);
  mockAppStateAddListener.mockReturnValue({ remove: mockAppStateRemove });

  __resetLogBufferForTests();
  __resetLoggingUserIdForTests();
  __resetLogFlushForTests();

  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
};

const restoreLoggingTestState = () => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
};

describe('logEvent + flush', () => {
  beforeEach(resetLoggingTestState);
  afterEach(restoreLoggingTestState);

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

  it('reports overflow once via an INSERTED drop notice, losing only the oldest records', async () => {
    // 205 warns signed out → pending caps at 200, oldest 5 dropped (no flush yet).
    for (let index = 0; index < 205; index += 1) {
      await logEvent({ level: 'warn', source: 'sync', event: `sync.warn_${index}` });
    }
    expect(mockInsert).not.toHaveBeenCalled();

    // Drain fully (200 records / 50 per batch). Assert against what reached the
    // backend, not the in-memory ring — that ring assertion is what hid C1.
    setLoggingUserId('user-1');
    for (let index = 0; index < 6; index += 1) {
      await flushLogs();
    }

    const rows = allInsertedRows();
    const notices = rows.filter((row) => row.event === 'logging.dropped');
    expect(notices).toHaveLength(1); // not a perpetual duplicate-notice loop
    expect(notices[0].context).toEqual({ droppedCount: 5 });

    const survived = rows.filter((row) => row.event !== 'logging.dropped').map((row) => row.event);
    expect(survived).toHaveLength(200); // the notice did not evict a real record
    expect(survived).toContain('sync.warn_5'); // newest 200 survive
    expect(survived).toContain('sync.warn_204');
    expect(survived).not.toContain('sync.warn_0'); // oldest 5 genuinely dropped
    expect(survived).not.toContain('sync.warn_4');

    // Idempotent once drained — no residual counter re-arming another notice.
    mockInsert.mockClear();
    await flushLogs();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('removes flushed records by identity so mid-insert overflow cannot drop un-inserted logs', async () => {
    setLoggingUserId('user-1');

    // Hang the first insert so a backlog builds while one flush is in flight.
    let resolveInsert: (value: unknown) => void = () => {};
    mockInsert.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInsert = resolve;
      })
    );

    // Kicks a flush that peeks [inflight_0] and hangs on the insert.
    await logEvent({ level: 'warn', source: 'sync', event: 'inflight_0' });
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Flood past capacity while that insert hangs: the queue front (incl.
    // inflight_0) is trimmed. Each kick early-returns on the in-flight guard.
    for (let index = 0; index < 205; index += 1) {
      await logEvent({ level: 'warn', source: 'sync', event: `flood_${index}` });
    }

    // Resolve the in-flight insert. Its post-await removal must target inflight_0
    // BY SEQ (already trimmed → no-op), NOT splice the current front (flood_5).
    // Count-based removal would have silently dropped flood_5 here.
    resolveInsert({ data: null, error: null });
    await Promise.resolve();
    await Promise.resolve();

    for (let index = 0; index < 6; index += 1) {
      await flushLogs();
    }

    const inserted = allInsertedRows().map((row) => row.event);
    expect(inserted).toContain('inflight_0'); // inserted by the very first flush
    expect(inserted).toContain('flood_5'); // queue front at resolve time — must survive
    expect(inserted).toContain('flood_204');
    expect(inserted.filter((event) => String(event).startsWith('flood_'))).toHaveLength(200);
    expect(inserted).not.toContain('flood_0'); // among the oldest genuinely dropped
  });
});

describe('flush loop lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetLoggingTestState();
  });

  afterEach(() => {
    stopLogFlushLoop();
    restoreLoggingTestState();
    jest.useRealTimers();
  });

  it('drains the backlog on the interval without an explicit flush call', async () => {
    await logEvent({ level: 'warn', source: 'sync', event: 'sync.warn' }); // signed out → buffered
    expect(mockInsert).not.toHaveBeenCalled();

    setLoggingUserId('user-1');
    startLogFlushLoop();
    expect(mockInsert).not.toHaveBeenCalled(); // nothing until the interval fires

    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(insertedRows()[0]).toEqual(expect.objectContaining({ event: 'sync.warn' }));
  });

  it('flushes when the app transitions to the background', async () => {
    await logEvent({ level: 'error', source: 'sync', event: 'sync.error' });
    setLoggingUserId('user-1');
    startLogFlushLoop();

    const handler = mockAppStateAddListener.mock.calls.at(-1)?.[1] as (status: string) => void;
    expect(typeof handler).toBe('function');

    handler('background'); // kicks flushLogs synchronously up to the insert
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(insertedRows()[0]).toEqual(expect.objectContaining({ event: 'sync.error' }));
  });

  it('is idempotent and tears down the interval + AppState listener on stop', async () => {
    startLogFlushLoop();
    startLogFlushLoop(); // second call is a no-op
    expect(mockAppStateAddListener).toHaveBeenCalledTimes(1);

    await logEvent({ level: 'warn', source: 'sync', event: 'pending_after_stop' }); // signed out → buffered
    stopLogFlushLoop();
    expect(mockAppStateRemove).toHaveBeenCalledTimes(1);

    // Even with a backlog and a valid session, no flush fires once stopped.
    setLoggingUserId('user-1');
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 3);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
