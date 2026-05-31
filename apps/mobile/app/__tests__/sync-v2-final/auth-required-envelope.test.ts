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
 * client). It is gated on the live-endpoint env vars and skips with a clear
 * message when they are unset, so CI stays green when no endpoint is wired.
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
import {
  createAnonBranchClient,
  LIVE_BRANCH_SKIP_REASON,
  readLiveBranchConfig,
  type AnonBranchClient,
} from './helpers/live-branch';

// Local handle: the in-memory database. Server handle: the anon client. Both
// live on mock-prefixed holders so the hoisted factories can close over them.
const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockClientState: { client: unknown } = { client: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => {
    if (!mockClientState.client) {
      throw new Error('Test supabase client not initialised');
    }
    return mockClientState.client;
  }),
}));

import { gyms, syncRuntimeState } from '@/src/data/schema';
import { runSyncCycle } from '@/src/sync/cycle';

const config = readLiveBranchConfig();
// Use describe.skip when the endpoint is not configured so the run is green and
// the skip is visible in the report.
const describeLive = config ? describe : describe.skip;

if (!config) {
  console.warn(LIVE_BRANCH_SKIP_REASON);
}

describeLive('cycle with no JWT (AUTH_REQUIRED is a clean error envelope)', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let anon: AnonBranchClient;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;

    anon = createAnonBranchClient(config!);
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

    // The cycle must NOT throw on a missing JWT.
    await expect(runSyncCycle()).resolves.toBeUndefined();

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
