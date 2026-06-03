import * as SecureStore from 'expo-secure-store';

export type AuthStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
  setItem: (key: string, value: string) => Promise<void>;
};

// The device keychain rejects (or silently drops) a single stored value once it
// crosses a fixed byte ceiling. A signed-in Supabase session serialises to well
// over that ceiling — the JWT access token, the refresh token, and the full user
// object together routinely run past 2 KB — so writing the whole session under
// one key can succeed at the JS layer while persisting nothing. The next read
// then returns null, the auth client believes there is no session, and an
// authenticated request goes out unsigned.
//
// To keep arbitrarily large values durable we split any oversized value across
// several keychain entries and stitch them back together transparently on read.
// A small value is still written under its plain key (no envelope), so existing
// single-key entries and short values keep round-tripping unchanged.
//
// The chunk budget is deliberately below the hard ceiling: keys and base bytes
// vary by platform, and leaving headroom keeps every individual entry safely
// within the limit the keychain enforces.
const CHUNK_BUDGET_BYTES = 1800;

// Marks a stored value as a multi-chunk envelope rather than a literal value.
// The token is namespaced and unlikely to collide with any real serialised
// payload (a Supabase session is a JSON object, never this exact string), and a
// read only treats a value as an envelope when it both carries this prefix and
// parses into the expected shape.
const CHUNK_ENVELOPE_PREFIX = '__chunked_secure_store_v1__:';

type ChunkEnvelope = {
  /** Marker so a stored envelope is never confused with a literal value. */
  __chunkedSecureStore: true;
  /** Number of chunk entries written under `${key}.<index>`. */
  count: number;
};

const inMemoryAuthStorage = new Map<string, string>();
let secureStoreUnavailable = false;

const isSecureStoreEntitlementError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('required entitlement');
};

const withSecureStoreFallback = async <T>(operation: () => Promise<T>, fallback: () => Promise<T> | T): Promise<T> => {
  if (secureStoreUnavailable) {
    return fallback();
  }

  try {
    return await operation();
  } catch (error) {
    if (!isSecureStoreEntitlementError(error)) {
      throw error;
    }

    // Unsigned simulator dev-client builds can miss keychain entitlements.
    // Keep auth functional for local test/runtime by degrading to process-local storage.
    secureStoreUnavailable = true;
    return fallback();
  }
};

// Single-entry keychain primitives. These wrap one logical read / write / delete
// of one keychain entry, transparently degrading to the process-local map when
// the keychain is unavailable. The chunking layer above composes them.
const rawGetItem = (key: string): Promise<string | null> =>
  withSecureStoreFallback(
    () => SecureStore.getItemAsync(key),
    () => inMemoryAuthStorage.get(key) ?? null
  );

const rawSetItem = (key: string, value: string): Promise<void> =>
  withSecureStoreFallback(
    async () => {
      await SecureStore.setItemAsync(key, value);
    },
    () => {
      inMemoryAuthStorage.set(key, value);
    }
  );

const rawRemoveItem = (key: string): Promise<void> =>
  withSecureStoreFallback(
    async () => {
      await SecureStore.deleteItemAsync(key);
    },
    () => {
      inMemoryAuthStorage.delete(key);
    }
  );

/** Number of UTF-8 bytes a string occupies (the unit the keychain limit is in). */
const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint < 0xdc00 && index + 1 < value.length) {
      // High surrogate followed by a low surrogate is one 4-byte code point.
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4;
        index += 1;
        continue;
      }
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

/** Splits a string into pieces each no larger than the byte budget. */
const splitByByteBudget = (value: string, budgetBytes: number): string[] => {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (currentBytes + characterBytes > budgetBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }

  return chunks;
};

const chunkKey = (key: string, index: number): string => `${key}.${index}`;

const parseChunkEnvelope = (stored: string | null): ChunkEnvelope | null => {
  if (stored === null || !stored.startsWith(CHUNK_ENVELOPE_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored.slice(CHUNK_ENVELOPE_PREFIX.length)) as Partial<ChunkEnvelope>;
    if (parsed?.__chunkedSecureStore === true && typeof parsed.count === 'number' && parsed.count > 0) {
      return { __chunkedSecureStore: true, count: parsed.count };
    }
  } catch {
    // A value that merely starts with the prefix but does not parse is treated
    // as a literal value, not an envelope.
  }
  return null;
};

const serializeChunkEnvelope = (count: number): string =>
  `${CHUNK_ENVELOPE_PREFIX}${JSON.stringify({ __chunkedSecureStore: true, count } satisfies ChunkEnvelope)}`;

/**
 * Removes the chunk entries (and only the chunk entries) described by an
 * envelope. The primary key itself is left for the caller to overwrite or
 * delete, so a write can replace an envelope in place without a transient empty
 * window.
 */
const removeChunkEntries = async (key: string, count: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await rawRemoveItem(chunkKey(key, index));
  }
};

/** Clears any leftover chunk entries from a prior oversized write under `key`. */
const clearExistingChunks = async (key: string): Promise<void> => {
  const existing = parseChunkEnvelope(await rawGetItem(key));
  if (existing) {
    await removeChunkEntries(key, existing.count);
  }
};

const chunkedAuthStorage: AuthStorageAdapter = {
  getItem: async (key) => {
    const stored = await rawGetItem(key);
    const envelope = parseChunkEnvelope(stored);
    if (!envelope) {
      return stored;
    }

    let reassembled = '';
    for (let index = 0; index < envelope.count; index += 1) {
      const part = await rawGetItem(chunkKey(key, index));
      if (part === null) {
        // A chunk went missing (e.g. a partial wipe). The stored value is no
        // longer recoverable; report it as absent rather than returning a
        // corrupt half-value.
        return null;
      }
      reassembled += part;
    }
    return reassembled;
  },

  setItem: async (key, value) => {
    // Drop any chunk entries left over from a previous larger value before
    // writing the new one, so stale chunks never linger or get reassembled.
    await clearExistingChunks(key);

    if (utf8ByteLength(value) <= CHUNK_BUDGET_BYTES) {
      // Small enough to live under its own key with no envelope.
      await rawSetItem(key, value);
      return;
    }

    const chunks = splitByByteBudget(value, CHUNK_BUDGET_BYTES);
    // Write the chunk bodies first, then the envelope last, so a read never sees
    // an envelope pointing at chunks that are not yet present.
    for (let index = 0; index < chunks.length; index += 1) {
      await rawSetItem(chunkKey(key, index), chunks[index]);
    }
    await rawSetItem(key, serializeChunkEnvelope(chunks.length));
  },

  removeItem: async (key) => {
    const envelope = parseChunkEnvelope(await rawGetItem(key));
    if (envelope) {
      await removeChunkEntries(key, envelope.count);
    }
    await rawRemoveItem(key);
  },
};

export const getAuthStorageAdapter = () => chunkedAuthStorage;

export const __resetAuthStorageAdapterForTests = () => {
  secureStoreUnavailable = false;
  inMemoryAuthStorage.clear();
};
