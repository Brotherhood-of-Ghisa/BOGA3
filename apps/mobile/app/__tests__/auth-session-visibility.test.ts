/**
 * End-to-end session visibility through the real auth client wired with the
 * production storage adapter.
 *
 * The sync cycle authenticates by asking the same Supabase auth client for the
 * current session — the client reads it back from storage, not from memory. So
 * "does a freshly signed-in user authenticate?" reduces to "after sign-in, does
 * the auth client's own session read return the session it just persisted?".
 *
 * These tests drive the real GoTrue auth client (the engine inside the Supabase
 * client) against a mocked network and a fake keychain that enforces the device
 * byte ceiling, asserting:
 *   - after a sign-in whose session exceeds one keychain entry, a later session
 *     read still returns the session (so the cycle sees the signed-in user and
 *     raises no spurious "no signed-in user"); and
 *   - with nothing signed in, the session read returns null (so a genuinely
 *     absent session still drives the real route-to-sign-in path).
 */

import { GoTrueClient } from '@supabase/auth-js';

import {
  __resetAuthStorageAdapterForTests,
  getAuthStorageAdapter,
} from '@/src/auth/storage';

const KEYCHAIN_ENTRY_BYTES_LIMIT = 2048;
const utf8ByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

// The fake keychain. A jest.mock factory is hoisted above module-scoped
// declarations and may only close over variables whose name is `mock`-prefixed,
// so the map and its accessors carry that prefix.
const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string): Promise<string | null> => mockKeychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string): Promise<void> => {
    if (Buffer.byteLength(value, 'utf8') > 2048) {
      // The device keychain silently drops an oversized single entry.
      return;
    }
    mockKeychain.set(key, value);
  },
  deleteItemAsync: async (key: string): Promise<void> => {
    mockKeychain.delete(key);
  },
}));

// A long, realistic access token plus user object so the serialised session runs
// past a single keychain entry — the condition that exposed the persistence bug.
const buildSignInResponseBody = () => ({
  access_token: `header.${'a'.repeat(1400)}.signature`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'r'.repeat(256),
  user: {
    id: '00000000-0000-0000-0000-000000000000',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'signed-in-user@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { username: 'x'.repeat(128) },
    created_at: '2026-03-04T10:00:00.000Z',
    updated_at: '2026-03-04T10:00:00.000Z',
  },
});

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const createAuthClient = (fetchImpl: typeof fetch) =>
  new GoTrueClient({
    url: 'https://example.supabase.co/auth/v1',
    storage: getAuthStorageAdapter(),
    storageKey: 'sb-example-auth-token',
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: fetchImpl,
  });

beforeEach(() => {
  mockKeychain.clear();
  __resetAuthStorageAdapterForTests();
});

describe('auth session visibility after sign-in', () => {
  it('a freshly signed-in oversized session is visible to a later session read', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(buildSignInResponseBody()),
    ) as unknown as typeof fetch;
    const client = createAuthClient(fetchImpl);

    const { data: signInData, error: signInError } = await client.signInWithPassword({
      email: 'signed-in-user@example.test',
      password: 'correct-horse-battery-staple',
    });
    expect(signInError).toBeNull();
    expect(signInData.session).not.toBeNull();

    // The session serialised past a single keychain entry, so without chunking
    // the persisted read would be null here (the reported bug).
    const persisted = mockKeychain.get('sb-example-auth-token') ?? null;
    expect(persisted).not.toBeNull();
    expect(utf8ByteLength(JSON.stringify(signInData.session))).toBeGreaterThan(
      KEYCHAIN_ENTRY_BYTES_LIMIT,
    );

    // What the cycle does: read the session back from the auth client. It must
    // see the signed-in user so its request carries the JWT and the server does
    // not answer "no signed-in user".
    const { data: sessionData } = await client.getSession();
    expect(sessionData.session).not.toBeNull();
    expect(sessionData.session?.access_token).toBe(signInData.session?.access_token);
    expect(sessionData.session?.user.email).toBe('signed-in-user@example.test');
  });

  it('the same session survives a fresh client reading from the same storage', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(buildSignInResponseBody()),
    ) as unknown as typeof fetch;

    const { data: signInData } = await createAuthClient(fetchImpl).signInWithPassword({
      email: 'signed-in-user@example.test',
      password: 'correct-horse-battery-staple',
    });

    // A new client (e.g. after a reload) restores the session purely from
    // storage — exactly the durability the cycle depends on.
    const restored = await createAuthClient(fetchImpl).getSession();
    expect(restored.data.session).not.toBeNull();
    expect(restored.data.session?.access_token).toBe(signInData.session?.access_token);
  });

  it('with no session persisted, a session read returns null so the route-to-sign-in path still fires', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const client = createAuthClient(fetchImpl);

    const { data } = await client.getSession();

    expect(data.session).toBeNull();
    // Nothing was persisted, so the genuine "no signed-in user" condition is
    // intact — the fix does not mask an absent session.
    expect(mockKeychain.size).toBe(0);
  });
});
