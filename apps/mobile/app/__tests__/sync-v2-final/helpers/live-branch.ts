/**
 * Shared setup for the two tests that exercise the sync cycle against a REAL
 * deployed Postgres + PostgREST + RLS endpoint (the round-trip and the
 * auth-required cases), rather than a stubbed RPC.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`); when either is unset the
 * tests skip with a clear message so CI stays green when no endpoint is wired.
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

/** Reads the live-endpoint config from the environment, or null if unset. */
export const readLiveBranchConfig = (): LiveBranchConfig | null => {
  const url = process.env.SUPABASE_BRANCH_URL;
  const anonKey = process.env.SUPABASE_BRANCH_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }
  return { url, anonKey };
};

/** Human-readable skip reason when the live endpoint is not configured. */
export const LIVE_BRANCH_SKIP_REASON =
  'SUPABASE_BRANCH_URL / SUPABASE_BRANCH_ANON_KEY not set — skipping the live cycle round-trip. ' +
  'Point these at a deployed Supabase endpoint carrying the sync server schema to run it.';

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
