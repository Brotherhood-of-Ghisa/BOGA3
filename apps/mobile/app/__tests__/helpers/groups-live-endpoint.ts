/**
 * Live endpoint setup for `groups-api-live.test.ts`: reads the per-run users
 * that supabase/tests/groups-api-live.sh provisions, and signs each in with the
 * REAL `@supabase/supabase-js` (via `jest.requireActual`, past the inert
 * client the unit suite installs).
 *
 * Fails hard when the env is missing: the suite runs only through its lane,
 * so a missing var is a misconfiguration, never a reason to skip. Clients are
 * created without session persistence or token refresh, so no timer keeps the
 * process alive (the open-handle guard).
 */

export interface GroupsLiveEnv {
  url: string;
  anonKey: string;
  ownerEmail: string;
  memberEmail: string;
  password: string;
  runTag: string;
}

const VARS = {
  url: 'GROUPS_LIVE_SUPABASE_URL',
  anonKey: 'GROUPS_LIVE_SUPABASE_ANON_KEY',
  ownerEmail: 'GROUPS_LIVE_OWNER_EMAIL',
  memberEmail: 'GROUPS_LIVE_MEMBER_EMAIL',
  password: 'GROUPS_LIVE_PASSWORD',
  runTag: 'GROUPS_LIVE_RUN_TAG',
} as const;

export const readGroupsLiveEnv = (): GroupsLiveEnv => {
  const missing = Object.values(VARS).filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `groups-api-live: ${missing.join(', ')} unset. Run it through \`./boga test groups-api-live\`, ` +
        'which provisions the run users against this worktree\'s local Supabase and exports these vars.',
    );
  }
  if (process.env.EXPO_PUBLIC_USE_RN_FETCH !== '1') {
    throw new Error("groups-api-live needs EXPO_PUBLIC_USE_RN_FETCH=1: jest-expo's expo/fetch stub returns empty bodies");
  }
  return Object.fromEntries(Object.entries(VARS).map(([key, name]) => [key, process.env[name]!])) as unknown as GroupsLiveEnv;
};

type RpcResult = { data: unknown; error: { message: string } | null };

type LiveSupabaseClient = {
  auth: {
    signInWithPassword: (creds: { email: string; password: string }) => Promise<{
      data: { session: { access_token: string } | null; user: { id: string } | null };
      error: { message: string } | null;
    }>;
    signOut: () => Promise<unknown>;
  };
  schema: (name: string) => { rpc: (fn: string, args?: unknown) => Promise<RpcResult> };
};

export interface LiveClient {
  client: LiveSupabaseClient;
  userId: string;
  teardown: () => Promise<void>;
}

const NO_TIMER_AUTH = { persistSession: false, autoRefreshToken: false } as const;

export const signInLiveClient = async (env: GroupsLiveEnv, email: string): Promise<LiveClient> => {
  const { createClient } = jest.requireActual('@supabase/supabase-js') as {
    createClient: (url: string, key: string, opts?: unknown) => LiveSupabaseClient;
  };
  const authClient = createClient(env.url, env.anonKey, { auth: NO_TIMER_AUTH });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password: env.password });
  if (error || !data.session || !data.user) {
    throw new Error(`groups-api-live: could not sign in ${email}: ${error?.message ?? 'no session'}`);
  }
  // The app's client sends the sync protocol header on every call; so does this one.
  const client = createClient(env.url, env.anonKey, {
    auth: NO_TIMER_AUTH,
    global: { headers: { 'x-boga-sync-protocol': '3', Authorization: `Bearer ${data.session.access_token}` } },
  });
  return {
    client,
    userId: data.user.id,
    teardown: async () => {
      await authClient.auth.signOut().catch(() => undefined);
      await client.auth.signOut().catch(() => undefined);
    },
  };
};
