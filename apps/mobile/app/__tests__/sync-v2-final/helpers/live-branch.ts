/**
 * Shared setup for the two tests that exercise the sync cycle against a REAL
 * deployed Postgres + PostgREST + RLS endpoint (the round-trip and the
 * auth-required cases), rather than a stubbed RPC.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`). The three states are
 * handled distinctly so only a genuinely-clean absence skips and anything broken
 * fails loudly:
 *   - BOTH unset    -> the documented "CI without a live endpoint" path: skip,
 *                      but loudly, so a green run never silently means "didn't
 *                      run".
 *   - PARTIALLY set -> a misconfiguration (one var present, one missing): throw,
 *                      so the run goes red instead of quietly skipping.
 *   - both set but the endpoint is unreachable / sign-in fails -> the callers
 *     throw from `createAuthedBranchClient` rather than catching into a skip, so
 *     a broken endpoint also fails the run.
 *
 * The real `@supabase/supabase-js` is loaded via `jest.requireActual` so it
 * bypasses the global inert client mock the unit suite installs. Clients are
 * created with `persistSession: false` and `autoRefreshToken: false` so they
 * open no GoTrue refresh timer — leaving a live timer would keep the Node
 * process alive and trip the open-handle guard. Callers must still `signOut` /
 * drop their references in teardown.
 *
 * The sync RPCs are exposed under the `app_public` Postgres schema, so the
 * client the cycle talks to selects that schema; the cycle does the same in
 * production. A test-user JWT is minted by signing in the deterministic local
 * auth fixture (`user_a`) so the RLS-enforced RPCs accept the call.
 */

export interface LiveBranchConfig {
  url: string;
  anonKey: string;
}

/**
 * Reads the live-endpoint config from the environment.
 *
 * Returns the config when BOTH vars are set, or `null` when BOTH are unset (the
 * clean "no endpoint wired" path that skips). When exactly one var is set it
 * THROWS — a half-configured run is a misconfiguration, not a reason to skip, so
 * it must fail loudly instead of masquerading as a green skip.
 */
export const readLiveBranchConfig = (): LiveBranchConfig | null => {
  const url = process.env.SUPABASE_BRANCH_URL;
  const anonKey = process.env.SUPABASE_BRANCH_ANON_KEY;
  const urlSet = Boolean(url);
  const keySet = Boolean(anonKey);

  if (urlSet !== keySet) {
    const present = urlSet ? 'SUPABASE_BRANCH_URL' : 'SUPABASE_BRANCH_ANON_KEY';
    const missing = urlSet ? 'SUPABASE_BRANCH_ANON_KEY' : 'SUPABASE_BRANCH_URL';
    throw new Error(
      `Live-endpoint config is half-set: ${present} is present but ${missing} is missing. ` +
        'Set BOTH to run the live cycle tests, or NEITHER to skip them. A partial config is a ' +
        'misconfiguration and fails the run on purpose rather than silently skipping.',
    );
  }

  if (!urlSet) {
    return null;
  }
  return { url: url!, anonKey: anonKey! };
};

/**
 * Loud, unmistakable skip banner emitted when BOTH env vars are unset. Printed
 * (not warned quietly) so a reader scanning the output cannot miss that the live
 * round-trip did not actually run — a green suite must never silently mean
 * "the live test was skipped".
 */
export const LIVE_BRANCH_SKIP_REASON =
  '\n' +
  '================================================================\n' +
  'SKIPPING LIVE SYNC ROUND-TRIP — no endpoint configured.\n' +
  'SUPABASE_BRANCH_URL and SUPABASE_BRANCH_ANON_KEY are both unset, so\n' +
  'the cycle was NOT exercised against a real Postgres + PostgREST + RLS\n' +
  'endpoint. The rest of the suite ran; this lane is green-by-skip only.\n' +
  'Set BOTH vars to a deployed Supabase endpoint carrying the sync server\n' +
  'schema (with the user_a auth fixture provisioned) to actually run it.\n' +
  '================================================================';

// The deterministic local auth fixture the round-trip authenticates as. These
// are the same credentials the repo's backend contract suites provision.
const FIXTURE_EMAIL = 'user_a.local@example.test';
const FIXTURE_PASSWORD = 'ScaffoldingUserA!234';

// The Postgres schema the sync RPCs live in.
export const SYNC_RPC_SCHEMA = 'app_public';

type AnySupabaseClient = {
  auth: {
    signInWithPassword: (creds: { email: string; password: string }) => Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
    signOut: () => Promise<unknown>;
  };
  schema: (name: string) => { rpc: (fn: string, args?: unknown) => Promise<unknown> };
  rpc: (fn: string, args?: unknown) => Promise<unknown>;
};

const loadCreateClient = (): ((url: string, key: string, opts?: unknown) => AnySupabaseClient) => {
  const actual = jest.requireActual('@supabase/supabase-js') as {
    createClient: (url: string, key: string, opts?: unknown) => AnySupabaseClient;
  };
  return actual.createClient;
};

const NO_TIMER_AUTH = { persistSession: false, autoRefreshToken: false } as const;

export interface AuthedBranchClient {
  /** The schema-scoped client the cycle dispatches RPCs through. */
  client: AnySupabaseClient;
  /** The minted test-user access token. */
  jwt: string;
  /** Signs out and releases the client so no handle leaks. */
  teardown: () => Promise<void>;
}

/**
 * Signs in the local auth fixture against the live endpoint and returns a
 * client carrying that user's JWT, ready for the cycle to use. The returned
 * client is NOT schema-scoped — the cycle selects the schema itself; callers
 * that talk to the RPCs directly should call `.schema(SYNC_RPC_SCHEMA)`.
 */
export const createAuthedBranchClient = async (
  config: LiveBranchConfig,
): Promise<AuthedBranchClient> => {
  const createClient = loadCreateClient();

  const authClient = createClient(config.url, config.anonKey, { auth: NO_TIMER_AUTH });
  const { data, error } = await authClient.auth.signInWithPassword({
    email: FIXTURE_EMAIL,
    password: FIXTURE_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`could not sign in the test auth fixture: ${error?.message ?? 'no session'}`);
  }
  const jwt = data.session.access_token;

  const client = createClient(config.url, config.anonKey, {
    auth: NO_TIMER_AUTH,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  return {
    client,
    jwt,
    teardown: async () => {
      await authClient.auth.signOut().catch(() => undefined);
      await client.auth.signOut().catch(() => undefined);
    },
  };
};

/** An anon (no-JWT) client for the auth-required path. */
export interface AnonBranchClient {
  client: AnySupabaseClient;
  teardown: () => Promise<void>;
}

export const createAnonBranchClient = (config: LiveBranchConfig): AnonBranchClient => {
  const createClient = loadCreateClient();
  const client = createClient(config.url, config.anonKey, { auth: NO_TIMER_AUTH });
  return {
    client,
    teardown: async () => {
      await client.auth.signOut().catch(() => undefined);
    },
  };
};
