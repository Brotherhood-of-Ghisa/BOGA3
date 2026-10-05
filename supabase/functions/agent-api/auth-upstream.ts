// Supabase Auth rejects a token with a 4xx answer. A timeout, rate limit, 5xx
// or network failure (status 0 or none) says nothing about the token, so the
// caller must hear "try again later", not "re-authorize".
//
// `auth.getUser(jwt)` reports the HTTP status on its AuthError: AuthApiError
// for a JSON answer, AuthRetryableFetchError (0 or 502-504) for a network
// failure, AuthUnknownError (no status) for an unreadable answer.
export const AUTH_RETRY_AFTER_SECONDS = 5;

const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export const isTokenRejection = (status: unknown): boolean =>
  typeof status === 'number' &&
  status >= 400 &&
  status < 500 &&
  !RETRYABLE_CLIENT_STATUSES.has(status);
