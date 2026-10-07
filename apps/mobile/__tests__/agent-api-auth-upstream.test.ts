import {
  AUTH_RETRY_AFTER_SECONDS, AUTH_UPSTREAM_TIMEOUT_MS, authUpstreamFetch, isTokenRejection,
} from '../../../supabase/functions/agent-api/auth-upstream.ts';

// jest.setup mocks the client; the error classes getUser returns are real.
const {
  AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError,
} = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');

describe('agent-api Supabase Auth failure classification', () => {
  it.each([
    ['bad or expired JWT', new AuthApiError('invalid JWT', 403, 'bad_jwt')],
    ['missing authorization', new AuthApiError('no token', 401, 'no_authorization')],
    ['deleted user', new AuthApiError('user not found', 404, 'user_not_found')],
    ['revoked session', new AuthSessionMissingError()],
  ])('treats a getUser %s as a token rejection', (_case, error) => {
    expect(isTokenRejection(error.status)).toBe(true);
  });

  it.each([
    ['network failure', new AuthRetryableFetchError('fetch failed', 0)],
    ['gateway error', new AuthRetryableFetchError('Bad Gateway', 502)],
    ['Auth outage', new AuthRetryableFetchError('Service Unavailable', 503)],
    ['gateway timeout', new AuthRetryableFetchError('Gateway Timeout', 504)],
    ['internal error', new AuthApiError('database error', 500, 'unexpected_failure')],
    ['rate limit', new AuthApiError('rate limited', 429, 'over_request_rate_limit')],
    ['request timeout', new AuthApiError('timeout', 408, undefined)],
    ['unreadable answer', new AuthUnknownError('not JSON', new SyntaxError('bad'))],
  ])('treats a getUser %s as Auth unavailable, not a rejection', (_case, error) => {
    expect(isTokenRejection(error.status)).toBe(false);
  });

  it.each([401, 403, 400, 404])('treats a grants %i answer as a rejection', (status) => {
    expect(isTokenRejection(status)).toBe(true);
  });

  it.each([500, 502, 503, 504, 429, 408, 200, 0])(
    'does not treat a grants %i answer as a rejection',
    (status) => {
      expect(isTokenRejection(status)).toBe(false);
    },
  );

  it('tells callers when to retry', () => {
    expect(AUTH_RETRY_AFTER_SECONDS).toBe(5);
  });
});

describe('agent-api Auth upstream call budget', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; jest.useRealTimers(); });

  it('reports an outage well inside the Retry-After it advertises', () => {
    expect(AUTH_UPSTREAM_TIMEOUT_MS).toBeLessThan(AUTH_RETRY_AFTER_SECONDS * 1000);
  });

  it('aborts a call that never answers, rather than waiting out the gateway', async () => {
    // A stopped Auth container leaves the gateway holding the connection open.
    // Drive the abort from a short caller deadline so this test costs no real
    // wait; the 3 s platform budget itself is AbortSignal.timeout's behaviour.
    globalThis.fetch = jest.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    await expect(authUpstreamFetch('http://auth.invalid/auth/v1/user', {
      signal: AbortSignal.timeout(10),
    })).rejects.toThrow('aborted');
  });

  it('passes a caller signal through alongside the budget', async () => {
    const seen: AbortSignal[] = [];
    globalThis.fetch = jest.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      if (init?.signal) seen.push(init.signal);
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;

    const caller = new AbortController();
    await authUpstreamFetch('http://auth.invalid/auth/v1/user', { signal: caller.signal });
    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(false);

    caller.abort();
    expect(seen[0].aborted).toBe(true);
  });

  it('leaves the request init otherwise intact', async () => {
    const calls: { input: unknown; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn((input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;

    await authUpstreamFetch('http://auth.invalid/auth/v1/user/oauth/grants', {
      headers: { apikey: 'anon-key' },
    });
    expect(calls[0].init?.headers).toEqual({ apikey: 'anon-key' });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
});
