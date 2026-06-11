/* eslint-disable import/first */

/**
 * Outcome: an unauthenticated cycle is a clean no-op, not a crash and not a
 * data mutation.
 *
 * The server treats a missing JWT as a structured error envelope (an
 * AUTH_REQUIRED code), NOT a transport failure. The cycle must recognise that
 * envelope, return cleanly without throwing, leave every dirty bit set so the
 * pending edits re-push once a session exists, and mutate no local SQLite row.
 *
 * This drives the REAL cycle against a REAL endpoint with NO JWT (an anon
 * client). It requires a live endpoint (URL + anon key in the environment) and
 * runs only through its own dedicated script; the fast test lane excludes it.
 * With no endpoint configured it fails hard with a clear message rather than
 * skipping.
 *
 * The cycle's local handle is an in-memory SQLite built from the shipped
 * migration bundle; its server handle is the anon client. After the cycle:
 *   - it did not throw;
 *   - the seeded dirty row is still dirty with its original timestamp;
 *   - the row count and the pull cursor are unchanged (no mutation happened).
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAnonTestClient,
  readSyncTestEndpoint,
  type AnonTestClient,
} from './helpers/sync-test-endpoint';

// Local handle: the in-memory database. Server handle: the anon client. Both
// live on mock-prefixed holders so the hoisted factories can close over them.
// The factory bodies come from the shared sync-cycle mock helper.
const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { gyms, syncRuntimeState } from '@/src/data/schema';
import { runSyncCycle } from '@/src/sync/cycle';

// Reads the live-endpoint config; throws here (failing the suite) when the env
// is missing or incomplete, since this suite runs only when an endpoint has
// been provisioned.
const config = readSyncTestEndpoint();

describe('cycle with no JWT (AUTH_REQUIRED is a clean error envelope)', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let anon: AnonTestClient;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;

    anon = createAnonTestClient(config);
    mockClientState.client = anon.client;
  });

  afterEach(async () => {
    await anon.teardown();
    fixture.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('returns cleanly, keeps the dirty bit set, and mutates no local row', async () => {
    database
      .insert(gyms)
      .values({ id: 'gym-noauth', name: 'Offline Gym', localDirty: true, localUpdatedAtMs: 4242 })
      .run();

    const before = database.select().from(gyms).where(eq(gyms.id, 'gym-noauth')).get();
    const cursorBefore = database.select().from(syncRuntimeState).all();

    // The cycle must NOT throw on a missing JWT; it classifies the outcome as
    // 'auth-required' (the route-to-sign-in signal) and returns it.
    await expect(runSyncCycle()).resolves.toBe('auth-required');

    const after = database.select().from(gyms).where(eq(gyms.id, 'gym-noauth')).get();
    // Dirty bit and timestamp untouched — the edit will re-push once signed in.
    expect(after?.localDirty).toBe(true);
    expect(after?.localUpdatedAtMs).toBe(before?.localUpdatedAtMs);
    expect(after?.name).toBe('Offline Gym');

    // No new rows landed and the pull cursor did not advance.
    expect(database.select().from(gyms).all()).toHaveLength(1);
    const cursorAfter = database.select().from(syncRuntimeState).all();
    expect(cursorAfter).toEqual(cursorBefore);
  });
});
