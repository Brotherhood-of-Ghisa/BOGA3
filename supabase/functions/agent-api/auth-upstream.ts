// Supabase Auth rejects a token with a 4xx answer. A timeout, rate limit, 5xx
// or network failure (status 0 or none) says nothing about the token, so the
// caller must hear "try again later", not "re-authorize".
//
// `auth.getUser(jwt)` reports the HTTP status on its AuthError: AuthApiError
// for a JSON answer, AuthRetryableFetchError (0 or 502-504) for a network
// failure, AuthUnknownError (no status) for an unreadable answer.
export const AUTH_RETRY_AFTER_SECONDS = 5;

// An outage must be reported inside the window this function advertises. The
// gateway in front of Auth holds a connection open to a stopped Auth container
// for ~30 s before answering, and the auth client retries on top of that, so an
// unbounded check spends over a minute to report an outage it could see at once
// — far past the Retry-After it then returns. Bound every Auth call instead.
export const AUTH_UPSTREAM_TIMEOUT_MS = 3_000;

// For the Auth upstream only. PostgREST data reads keep the default fetch: a
// report over a long training history may legitimately outlast one token check.
export const authUpstreamFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(AUTH_UPSTREAM_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export const isTokenRejection = (status: unknown): boolean =>
  typeof status === 'number' &&
  status >= 400 &&
  status < 500 &&
  !RETRYABLE_CLIENT_STATUSES.has(status);
