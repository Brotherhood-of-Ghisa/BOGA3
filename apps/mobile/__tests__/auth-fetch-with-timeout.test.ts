/**
 * The Supabase client's request timeout. A request whose connection dies
 * without an error (seen on iOS after the app was suspended mid-request) must
 * settle: the wrapper aborts the transport and rejects after the timeout even
 * when the transport ignores the abort, and the real client turns that into a
 * `status: 0` RPC error the callers already classify (sync: INTERNAL, retried
 * on the next tick).
 */

import {
  createFetchWithTimeout,
  SUPABASE_REQUEST_TIMEOUT_MS,
  SupabaseRequestTimeoutError,
} from '@/src/auth/fetch-with-timeout';

const never = () => new Promise<never>(() => undefined);
const okResponse = () => new Response('{}', { status: 200 });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createFetchWithTimeout', () => {
  it('aborts and rejects a request that never settles once the timeout passes', async () => {
    const baseFetch = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => never());
    const request = createFetchWithTimeout(baseFetch)('https://example.test/rpc');
    const rejection = expect(request).rejects.toThrow(
      new SupabaseRequestTimeoutError(SUPABASE_REQUEST_TIMEOUT_MS),
    );
    const signal = baseFetch.mock.calls[0][1]?.signal;

    await jest.advanceTimersByTimeAsync(SUPABASE_REQUEST_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(signal?.aborted).toBe(true);
  });

  it('returns an in-time response and leaves no timer behind', async () => {
    const response = okResponse();
    const baseFetch = jest.fn(() => Promise.resolve(response));

    await expect(createFetchWithTimeout(baseFetch)('https://example.test/rpc', { method: 'POST' }))
      .resolves.toBe(response);

    expect(baseFetch).toHaveBeenCalledWith('https://example.test/rpc', expect.objectContaining({ method: 'POST' }));
    expect(jest.getTimerCount()).toBe(0);
  });

  it("forwards the caller's abort to the request", async () => {
    const baseFetch = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => never());
    const caller = new AbortController();

    void createFetchWithTimeout(baseFetch)('https://example.test/rpc', { signal: caller.signal });
    const signal = baseFetch.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    caller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('starts aborted when the caller signal is already aborted', () => {
    const baseFetch = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => never());
    const caller = new AbortController();
    caller.abort();

    void createFetchWithTimeout(baseFetch)('https://example.test/rpc', { signal: caller.signal });

    expect(baseFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe('the mobile Supabase client', () => {
  const originalFetch = Object.getOwnPropertyDescriptor(global, 'fetch');
  const originalEnv = { ...process.env };

  afterEach(() => {
    if (originalFetch) Object.defineProperty(global, 'fetch', originalFetch);
    process.env = { ...originalEnv };
  });

  /**
   * The setup file stubs `createClient` so no suite opens a real transport.
   * Capture the options the app passes and build a real client from them,
   * with the session timers off, so the request runs through supabase-js and
   * postgrest-js exactly as on device.
   */
  const buildRealClientFromAppOptions = () => {
    let options: Record<string, unknown> = {};
    jest.isolateModules(() => {
      jest.requireActual<typeof import('@/src/auth/supabase')>('@/src/auth/supabase').getSupabaseMobileClient();
      const { createClient } = jest.requireMock<{ createClient: jest.Mock }>('@supabase/supabase-js');
      options = createClient.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    });
    const { createClient } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    return createClient('https://example.supabase.test', 'anon-key', {
      ...options,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  };

  it('turns a sync RPC that never answers into a status-0 timeout error', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.test';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    const client = buildRealClientFromAppOptions();
    // Loading the app module installs Expo's `fetch` accessor, so swap the
    // transport in afterwards; the wrapper reads `fetch` per request.
    const transport = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => never());
    Object.defineProperty(global, 'fetch', { value: transport, configurable: true, writable: true });

    const settled = Promise.resolve(
      client.schema('app_public').rpc('sync_pull', { layer: 0, cursor: null, limit: 1 }),
    );
    await jest.advanceTimersByTimeAsync(SUPABASE_REQUEST_TIMEOUT_MS);
    const { error, status } = await settled;

    expect(status).toBe(0);
    expect(error?.message).toBe(
      `SupabaseRequestTimeoutError: Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS} ms`,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
