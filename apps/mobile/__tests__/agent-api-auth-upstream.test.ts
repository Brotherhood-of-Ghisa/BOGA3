import {
  AUTH_RETRY_AFTER_SECONDS, isTokenRejection,
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
