/**
 * Shared jest mock factories for the two outbound dependencies the sync cycle
 * resolves at runtime: the local data layer (`bootstrapLocalDataLayer`) and the
 * authenticated Supabase client (`getRequiredSupabaseMobileClient`).
 *
 * Several cycle tests need to point the cycle at a per-test in-memory database
 * and a per-test Supabase client (real, anon, or a hand-rolled RPC stub). Each
 * file used to repeat the same two `jest.mock(...)` factories verbatim; this
 * module is the single source of truth for both.
 *
 * Usage — `jest.mock` factories are hoisted above the file's imports, so a
 * hoisted factory cannot close over a normal import; the hoist-safe pattern is
 * to `require` this module from inside the factory (require resolves at call
 * time, after hoist). The hoist ALSO runs the `jest.mock` factory before the
 * `const mockState = ...` initialiser, so the holder must be read LAZILY: each
 * factory below takes a GETTER (`() => holder`) and dereferences it only when
 * the mocked function is actually invoked during a test, by which point the
 * holder has been assigned. Keep the holder on a `mock`-prefixed name so the
 * hoisted factory may reference it:
 *
 *     const mockBootstrapState = createBootstrapMockState();
 *     const mockClientState = createClientMockState();
 *
 *     jest.mock('@/src/data/bootstrap', () =>
 *       require('../helpers/sync-cycle-mocks').bootstrapMockFactory(() => mockBootstrapState),
 *     );
 *     jest.mock('@/src/auth/supabase', () =>
 *       require('../helpers/sync-cycle-mocks').supabaseClientMockFactory(() => mockClientState),
 *     );
 *
 * Then set `mockBootstrapState.database` / `mockClientState.client` per test.
 */

/** Mutable holder for the database the bootstrap mock should return. */
export interface BootstrapMockState<TDatabase = unknown> {
  database: TDatabase | null;
}

/** Mutable holder for the client the supabase mock should return. */
export interface ClientMockState<TClient = unknown> {
  client: TClient | null;
}

/** Creates an empty bootstrap-mock holder. */
export const createBootstrapMockState = <TDatabase = unknown>(): BootstrapMockState<TDatabase> => ({
  database: null,
});

/** Creates an empty client-mock holder. */
export const createClientMockState = <TClient = unknown>(): ClientMockState<TClient> => ({
  client: null,
});

/**
 * Returns the module shape for `jest.mock('@/src/data/bootstrap', ...)`.
 * `bootstrapLocalDataLayer` resolves to whatever database the holder points at
 * AT CALL TIME, and throws a clear error if a test forgot to set it.
 */
export const bootstrapMockFactory = <TDatabase = unknown>(
  getState: () => BootstrapMockState<TDatabase>,
) => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    const { database } = getState();
    if (!database) {
      throw new Error('Test database not initialised');
    }
    return database;
  }),
});

/**
 * Returns the module shape for `jest.mock('@/src/auth/supabase', ...)`.
 * `getRequiredSupabaseMobileClient` resolves to whatever client the holder
 * points at AT CALL TIME, and throws a clear error if a test forgot to set it.
 */
export const supabaseClientMockFactory = <TClient = unknown>(
  getState: () => ClientMockState<TClient>,
) => ({
  getRequiredSupabaseMobileClient: jest.fn(() => {
    const { client } = getState();
    if (!client) {
      throw new Error('Test supabase client not initialised');
    }
    return client;
  }),
});
