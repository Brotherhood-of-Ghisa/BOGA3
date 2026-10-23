/**
 * The longest one request through the Supabase client may stay open. The
 * server's statement timeout is 8 s, so a request still open after this has
 * lost its connection without reporting an error (seen on iOS when the app was
 * suspended mid-request). Without a bound such a request never settles: a sync
 * cycle waiting on it holds the local-data lock and keeps the scheduler
 * RUNNING, which ignores every later sync request until the app is killed.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 30_000;

/** The rejection a timed-out request settles with. */
export class SupabaseRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Supabase request timed out after ${timeoutMs} ms`);
    this.name = 'SupabaseRequestTimeoutError';
  }
}

/**
 * Wraps `fetch` so every request aborts and rejects once `timeoutMs` passes.
 * The rejection does not wait for the transport to honour the abort, so the
 * caller always settles even if the underlying request ignores it. A caller's
 * own `signal` still aborts the request early.
 */
export const createFetchWithTimeout = (
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs: number = SUPABASE_REQUEST_TIMEOUT_MS,
): typeof fetch => async (input, init) => {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? null;
  const forwardAbort = () => controller.abort();
  if (callerSignal?.aborted) {
    forwardAbort();
  } else {
    callerSignal?.addEventListener('abort', forwardAbort);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SupabaseRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([baseFetch(input, { ...init, signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
};
