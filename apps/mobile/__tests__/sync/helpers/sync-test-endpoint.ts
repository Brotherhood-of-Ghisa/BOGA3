/**
 * Shared setup for the suites that exercise the sync cycle against a REAL
 * Postgres + PostgREST + RLS endpoint (round-trip, multi-device LWW, and the
 * auth-required cases), rather than a stubbed RPC.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SYNC_TEST_SUPABASE_URL` / `SYNC_TEST_SUPABASE_ANON_KEY`). Any Supabase
 * endpoint that carries the sync server schema (with the `user_a` auth fixture
 * provisioned) works — **typically THIS worktree's slot-isolated local stack**.
 * You normally never export these by hand: `./supabase/scripts/test-sync-infra.sh`
 * ensures the local baseline and exports them automatically. There is nothing
 * remote, hosted, or "branch-provisioned" about this lane — it runs locally.
 *
 * These suites run only through their own dedicated script, invoked
 * deliberately when an endpoint is available — there is no path that runs them
 * without one. So a missing, partial, or unreachable endpoint is always a
 * misconfiguration, and the helper FAILS HARD rather than skipping:
 *   - either var unset (including both) -> throw, naming the missing var, so the
 *     run goes red instead of quietly passing without exercising the endpoint.
 *   - both set but the endpoint is unreachable / sign-in fails -> the callers
 *     throw from `createAuthedTestClient`, so a broken endpoint also fails the
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

export interface SyncTestEndpointConfig {
  url: string;
  anonKey: string;
}

/**
 * Reads the sync-test endpoint config from the environment, failing hard when
 * it is absent or incomplete.
 *
 * Returns the config only when BOTH `SYNC_TEST_SUPABASE_URL` and
 * `SYNC_TEST_SUPABASE_ANON_KEY` are set. If either is missing it THROWS, naming
 * the missing var(s): these suites run only through their dedicated,
 * deliberately invoked script, so a missing endpoint is never an expected
 * state — it is a misconfiguration that must fail the run loudly rather than
 * pass without exercising the endpoint.
 */
export const readSyncTestEndpoint = (): SyncTestEndpointConfig => {
  const url = process.env.SYNC_TEST_SUPABASE_URL;
  const anonKey = process.env.SYNC_TEST_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) {
    missing.push('SYNC_TEST_SUPABASE_URL');
  }
  if (!anonKey) {
    missing.push('SYNC_TEST_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Sync-test endpoint config is incomplete: ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} unset. ` +
        'These suites talk to a real Postgres + PostgREST + RLS endpoint. The normal way to run ' +
        'them is `./supabase/scripts/test-sync-infra.sh`, which boots THIS worktree\'s local ' +
        'Supabase stack and exports both vars for you. To run the jest lane directly, export ' +
        'SYNC_TEST_SUPABASE_URL and SYNC_TEST_SUPABASE_ANON_KEY pointing at any Supabase endpoint ' +
        'that carries the sync server schema (with the user_a auth fixture provisioned).',
    );
  }

  return { url: url!, anonKey: anonKey! };
};

/** Credentials of a deterministic local auth fixture (`auth-fixture-constants.sh`). */
export interface FixtureCredentials {
  email: string;
  password: string;
}

// The deterministic local auth fixture the round-trip authenticates as. These
// are the same credentials the repo's backend contract suites provision.
const USER_A: FixtureCredentials = { email: 'user_a.local@example.test', password: 'ScaffoldingUserA!234' };

/**
 * The fresh-device / account-switch suite's dedicated fixtures (`user_e`,
 * `user_f` in `supabase/scripts/auth-fixture-constants.sh`). No other suite or
 * flow signs in as them, so the suite may reset their server rows.
 */
export const USER_E: FixtureCredentials = { email: 'user_e.local@example.test', password: 'ScaffoldingUserE!234' };
export const USER_F: FixtureCredentials = { email: 'user_f.local@example.test', password: 'ScaffoldingUserF!234' };

// The Postgres schema the sync RPCs live in.
export const SYNC_RPC_SCHEMA = 'app_public';

type AnySupabaseClient = {
  auth: {
    signInWithPassword: (creds: { email: string; password: string }) => Promise<{
      data: { session: { access_token: string; user: { id: string } } | null };
      error: { message: string } | null;
    }>;
    signOut: () => Promise<unknown>;
  };
  schema: (name: string) => {
    rpc: (fn: string, args?: unknown) => Promise<unknown>;
    from: (table: string) => {
      delete: () => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
    };
  };
  rpc: (fn: string, args?: unknown) => Promise<unknown>;
};

const loadCreateClient = (): ((url: string, key: string, opts?: unknown) => AnySupabaseClient) => {
  const actual = jest.requireActual('@supabase/supabase-js') as {
    createClient: (url: string, key: string, opts?: unknown) => AnySupabaseClient;
  };
  return actual.createClient;
};

const NO_TIMER_AUTH = { persistSession: false, autoRefreshToken: false } as const;

export interface AuthedTestClient {
  /** The schema-scoped client the cycle dispatches RPCs through. */
  client: AnySupabaseClient;
  /** The minted test-user access token. */
  jwt: string;
  /** The signed-in fixture's auth user id. */
  userId: string;
  /** Signs out and releases the client so no handle leaks. */
  teardown: () => Promise<void>;
}

/**
 * Signs in the local auth fixture against the test endpoint and returns a
 * client carrying that user's JWT, ready for the cycle to use. The returned
 * client is NOT schema-scoped — the cycle selects the schema itself; callers
 * that talk to the RPCs directly should call `.schema(SYNC_RPC_SCHEMA)`.
 */
export const createAuthedTestClient = async (
  config: SyncTestEndpointConfig,
  credentials: FixtureCredentials = USER_A,
): Promise<AuthedTestClient> => {
  if (process.env.EXPO_PUBLIC_USE_RN_FETCH !== '1') {
    throw new Error(
      'live-endpoint sync suites need EXPO_PUBLIC_USE_RN_FETCH=1 (set by `npm run test:sync:infra`): ' +
        "jest-expo's expo/fetch stub returns empty bodies",
    );
  }
  const createClient = loadCreateClient();

  const authClient = createClient(config.url, config.anonKey, { auth: NO_TIMER_AUTH });
  const { data, error } = await authClient.auth.signInWithPassword(credentials);
  if (error || !data.session) {
    throw new Error(
      `could not sign in the test auth fixture ${credentials.email}: ${error?.message ?? 'no session'}`,
    );
  }
  const jwt = data.session.access_token;
  const userId = data.session.user.id;

  const client = createClient(config.url, config.anonKey, {
    auth: NO_TIMER_AUTH,
    global: { headers: { 'x-boga-sync-protocol': '3', Authorization: `Bearer ${jwt}` } },
  });

  return {
    client,
    jwt,
    userId,
    teardown: async () => {
      await authClient.auth.signOut().catch(() => undefined);
      await client.auth.signOut().catch(() => undefined);
    },
  };
};

/** An anon (no-JWT) client for the auth-required path. */
export interface AnonTestClient {
  client: AnySupabaseClient;
  teardown: () => Promise<void>;
}

export const createAnonTestClient = (config: SyncTestEndpointConfig): AnonTestClient => {
  const createClient = loadCreateClient();
  const client = createClient(config.url, config.anonKey, { auth: NO_TIMER_AUTH });
  return {
    client,
    teardown: async () => {
      await client.auth.signOut().catch(() => undefined);
    },
  };
};

/**
 * The Sync v2 tables, children before the rows they reference — the same list
 * and order as `supabase/scripts/sync-e2e-fixture-reset.sh` (each REST delete is
 * its own transaction).
 */
const SYNC_TABLES_CHILD_FIRST = [
  'session_exercise_tags',
  'exercise_sets',
  'session_exercises',
  'exercise_muscle_mappings',
  'exercise_tag_definitions',
  'sessions',
  'exercise_group_links',
  'exercise_definitions',
  'muscle_groups',
  'gyms',
  'body_weight_measurements',
  'user_settings',
] as const;

/**
 * Hard-deletes every Sync v2 row a fixture user owns, with the service role, so
 * a test starts from an empty server account. `dev_wipe_my_data` cannot do this
 * locally (it refuses unless `app.env` is set, which the local REST path does
 * not set). Needs `SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY` (exported by
 * `supabase/scripts/test-sync-infra.sh`); only ever pass a dedicated fixture.
 */
export const resetFixtureServerRows = async (
  config: SyncTestEndpointConfig,
  userId: string,
): Promise<void> => {
  const serviceRoleKey = process.env.SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY is unset: run the lane through ' +
        '`./boga test sync-infra`, which exports it for this worktree\'s local stack.',
    );
  }
  const { hostname } = new URL(config.url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(`refusing to hard-delete fixture rows on a non-local endpoint: ${config.url}`);
  }
  const admin = loadCreateClient()(config.url, serviceRoleKey, { auth: NO_TIMER_AUTH });
  for (const table of SYNC_TABLES_CHILD_FIRST) {
    const { error } = await admin.schema(SYNC_RPC_SCHEMA).from(table).delete().eq('owner_user_id', userId);
    if (error) {
      throw new Error(`could not reset ${table} for fixture ${userId}: ${error.message}`);
    }
  }
};
