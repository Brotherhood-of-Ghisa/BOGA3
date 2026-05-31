/**
 * Shared setup for the two tests that exercise the sync cycle against a REAL
 * deployed Postgres + PostgREST + RLS endpoint (the round-trip and the
 * auth-required cases), rather than a stubbed RPC.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`). These two suites run
 * only through their own dedicated script, which is invoked deliberately when a
 * live endpoint has been provisioned — there is no path that runs them without
 * one. So a missing, partial, or unreachable endpoint is always a
 * misconfiguration, and the helper FAILS HARD rather than skipping:
 *   - either var unset (including both) -> throw, naming the missing var, so the
 *     run goes red instead of quietly passing without exercising the endpoint.
 *   - both set but the endpoint is unreachable / sign-in fails -> the callers
 *     throw from `createAuthedBranchClient`, so a broken endpoint also fails the
 *     run with a clear connection error.
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
 * Reads the live-endpoint config from the environment, failing hard when it is
 * absent or incomplete.
 *
 * Returns the config only when BOTH `SUPABASE_BRANCH_URL` and
 * `SUPABASE_BRANCH_ANON_KEY` are set. If either is missing it THROWS, naming the
 * missing var(s): these suites run only through their dedicated, deliberately
 * invoked script, so a missing endpoint is never an expected state — it is a
 * misconfiguration that must fail the run loudly rather than pass without
 * exercising the endpoint.
 */
export const readLiveBranchConfig = (): LiveBranchConfig => {
  const url = process.env.SUPABASE_BRANCH_URL;
  const anonKey = process.env.SUPABASE_BRANCH_ANON_KEY;

  const missing: string[] = [];
  if (!url) {
    missing.push('SUPABASE_BRANCH_URL');
  }
  if (!anonKey) {
    missing.push('SUPABASE_BRANCH_ANON_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Live-endpoint config is incomplete: ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} unset. ` +
        'These suites talk to a real Postgres + PostgREST + RLS endpoint and run only when one ' +
        'has been provisioned. Export BOTH SUPABASE_BRANCH_URL and SUPABASE_BRANCH_ANON_KEY ' +
        'pointing at a deployed Supabase endpoint that carries the sync server schema (with the ' +
        'user_a auth fixture provisioned) before running them.',
    );
  }

  return { url: url!, anonKey: anonKey! };
};

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
