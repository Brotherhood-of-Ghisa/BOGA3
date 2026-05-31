/**
 * Push-in-flight race coverage: while a row's push is in flight the user edits
 * the same row again. The ack handler must NOT clear the dirty bit for a row
 * whose monotonic timestamp moved since it was serialised, so the newer edit
 * survives and re-pushes on the next cycle. A row that was not touched while in
 * flight clears cleanly.
 *
 * The cycle's only outbound dependency is the Supabase RPC, stubbed here. The
 * stub fires a callback during the (faked) push request so the concurrent edit
 * lands between batch capture and ack.
 */

import { eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests, nowMonotonic, type Transaction } from '@/src/data/clock';
import { gyms } from '@/src/data/schema';
// Bound to the stubbed bootstrap/supabase modules below; babel-jest hoists the
// jest.mock calls above every import so the cycle resolves the stubs.
import { runSyncCycle } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

const mockRpc = jest.fn();

// The cycle selects the RPC schema before dispatching: `client.schema(...).rpc(...)`.
// Both the `.schema(name).rpc(...)` path and a bare `.rpc(...)` resolve to the
// same spy so the existing call assertions are unaffected.
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

const emptyPull = { data: { entities: [], next_cursor: null, has_more: false }, error: null };
const pushOk = { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockRpc.mockReset();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

const insertDirtyGym = (id: string, ms: number): void => {
  database.insert(gyms).values({ id, name: `Gym ${id}`, localDirty: true, localUpdatedAtMs: ms }).run();
};

describe('push-in-flight race', () => {
  it('never clears the dirty bit when an edit lands between every capture and ack', async () => {
    insertDirtyGym('gym-race', 100);

    // Every push request fires a concurrent local edit before the ack is
    // processed, bumping the row's monotonic timestamp past the captured value.
    // The ack handler compares current vs captured and must therefore leave the
    // dirty bit set on every round, so the edit is never clobbered.
    let edits = 0;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return emptyPull;
      }
      edits += 1;
      const editLabel = `Edited In Flight ${edits}`;
      (database as unknown as LocalDatabase).transaction((tx) => {
        const next = nowMonotonic(tx as Transaction);
        tx.update(gyms).set({ localUpdatedAtMs: next, name: editLabel }).where(eq(gyms.id, 'gym-race')).run();
      });
      return pushOk;
    });

    await runSyncCycle();

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-race')).get();
    // The in-flight edits always out-stamp the captured value, so the dirty bit
    // survives every ack and the latest edit is preserved.
    expect(row?.localDirty).toBe(true);
    expect(row?.name).toBe(`Edited In Flight ${edits}`);
    expect(edits).toBeGreaterThan(0);
  });

  it('clears the dirty bit on the ack when the captured timestamp still matches', async () => {
    // A single in-flight edit on the FIRST push only. The ack for that batch
    // must skip the row (it moved), but the next push round re-sends the newer
    // value with no further edits, and that ack clears the bit cleanly.
    insertDirtyGym('gym-once', 100);

    let pushes = 0;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return emptyPull;
      }
      pushes += 1;
      if (pushes === 1) {
        (database as unknown as LocalDatabase).transaction((tx) => {
          const next = nowMonotonic(tx as Transaction);
          tx.update(gyms).set({ localUpdatedAtMs: next, name: 'Edited Once' }).where(eq(gyms.id, 'gym-once')).run();
        });
      }
      return pushOk;
    });

    await runSyncCycle();

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-once')).get();
    // The newer value was re-pushed on a later round whose ack matched, so the
    // row ends up clean and carrying the edited value (nothing was lost).
    expect(row?.localDirty).toBe(false);
    expect(row?.name).toBe('Edited Once');
  });

  it('clears the dirty bit for a row that was not touched in flight', async () => {
    insertDirtyGym('gym-quiet', 100);

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return emptyPull;
      }
      return pushOk;
    });

    await runSyncCycle();

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-quiet')).get();
    expect(row?.localDirty).toBe(false);
  });
});
