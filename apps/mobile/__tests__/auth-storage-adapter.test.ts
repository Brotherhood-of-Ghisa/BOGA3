/**
 * The auth storage adapter must persist arbitrarily large values across the
 * device keychain even though a single keychain entry has a fixed byte ceiling.
 *
 * A signed-in session serialises past that ceiling, and the keychain's native
 * write silently drops an oversized single entry (the JS promise still
 * resolves). When that happens the session never persists, so the next read
 * returns null and an authenticated request goes out unsigned — the server then
 * answers "no signed-in user" on a freshly signed-in client.
 *
 * These tests model the keychain with a fake that enforces the real ceiling:
 * an oversized single-entry write stores nothing (mirroring the device), so a
 * round-trip only succeeds if the adapter splits the value into entries that
 * each fit. A small value must still round-trip unchanged through a single
 * entry.
 */

// The keychain entry size the device enforces; an entry over this stores nothing.
const KEYCHAIN_ENTRY_BYTES_LIMIT = 2048;

const utf8ByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

// A fake keychain: every key is an independent entry, and a write whose value
// exceeds the ceiling is dropped (the device behaviour the bug rode in on).
const keychain = new Map<string, string>();

const mockGetItemAsync = jest.fn(async (key: string): Promise<string | null> => keychain.get(key) ?? null);
const mockSetItemAsync = jest.fn(async (key: string, value: string): Promise<void> => {
  if (utf8ByteLength(value) > KEYCHAIN_ENTRY_BYTES_LIMIT) {
    // Native keychain silently fails to persist an oversized entry.
    return;
  }
  keychain.set(key, value);
});
const mockDeleteItemAsync = jest.fn(async (key: string): Promise<void> => {
  keychain.delete(key);
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: [string]) => mockGetItemAsync(...args),
  setItemAsync: (...args: [string, string]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: [string]) => mockDeleteItemAsync(...args),
}));

import {
  __resetAuthStorageAdapterForTests,
  getAuthStorageAdapter,
} from '@/src/auth/storage';

const adapter = getAuthStorageAdapter();

// A realistic Supabase session JSON: a long JWT access token, a refresh token,
// and a full user object. Serialised, it runs well past a single keychain entry.
const buildSessionLikeValue = (): string => {
  const longJwt = `header.${'a'.repeat(1400)}.signature`;
  return JSON.stringify({
    access_token: longJwt,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_800_000_000,
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
};

beforeEach(() => {
  keychain.clear();
  mockGetItemAsync.mockClear();
  mockSetItemAsync.mockClear();
  mockDeleteItemAsync.mockClear();
  __resetAuthStorageAdapterForTests();
});

describe('auth storage adapter', () => {
  it('round-trips a small value through a single keychain entry unchanged', async () => {
    await adapter.setItem('sb-auth-token', 'short-value');

    expect(await adapter.getItem('sb-auth-token')).toBe('short-value');
    // No envelope, no chunk entries: exactly one entry holds the literal value.
    expect(keychain.get('sb-auth-token')).toBe('short-value');
    expect([...keychain.keys()]).toEqual(['sb-auth-token']);
  });

  it('persists and reassembles a session-sized value that exceeds one keychain entry', async () => {
    const session = buildSessionLikeValue();
    expect(utf8ByteLength(session)).toBeGreaterThan(KEYCHAIN_ENTRY_BYTES_LIMIT);

    await adapter.setItem('sb-auth-token', session);

    // The fix proves itself here: a freshly written oversized value reads back
    // byte-for-byte, so the cycle's client sees the signed-in session.
    expect(await adapter.getItem('sb-auth-token')).toBe(session);

    // It was split across multiple entries, each within the keychain ceiling.
    expect(keychain.size).toBeGreaterThan(1);
    for (const value of keychain.values()) {
      expect(utf8ByteLength(value)).toBeLessThanOrEqual(KEYCHAIN_ENTRY_BYTES_LIMIT);
    }
  });

  it('reports an absent value (null) when nothing was ever written', async () => {
    expect(await adapter.getItem('sb-auth-token')).toBeNull();
  });

  it('removing a chunked value clears every entry so a later read is null', async () => {
    await adapter.setItem('sb-auth-token', buildSessionLikeValue());
    expect(keychain.size).toBeGreaterThan(1);

    await adapter.removeItem('sb-auth-token');

    expect(keychain.size).toBe(0);
    expect(await adapter.getItem('sb-auth-token')).toBeNull();
  });

  it('replacing a large value with a small one leaves no stale chunk entries behind', async () => {
    await adapter.setItem('sb-auth-token', buildSessionLikeValue());
    expect(keychain.size).toBeGreaterThan(1);

    await adapter.setItem('sb-auth-token', 'small');

    expect(await adapter.getItem('sb-auth-token')).toBe('small');
    expect([...keychain.keys()]).toEqual(['sb-auth-token']);
  });

  it('round-trips a value containing multi-byte characters without corruption', async () => {
    const multiByte = `${'😀'.repeat(600)}-${'é'.repeat(600)}`;
    expect(utf8ByteLength(multiByte)).toBeGreaterThan(KEYCHAIN_ENTRY_BYTES_LIMIT);

    await adapter.setItem('sb-auth-token', multiByte);

    expect(await adapter.getItem('sb-auth-token')).toBe(multiByte);
  });
});
