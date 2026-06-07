/**
 * Whole-cycle coverage with a stubbed server:
 *
 *  - Convergence: a server that hands back one new row on the first pull and is
 *    empty thereafter drives the cycle to terminate after two PULL/PUSH/PULL
 *    rounds (one that moved a row, one quiet round confirming convergence).
 *  - AUTH_REQUIRED: a server that returns the no-JWT envelope makes the cycle
 *    return cleanly without mutating SQLite and without throwing.
 *  - FK_VIOLATION: a server that rejects a push with the structural-error token
 *    makes the cycle return the 'fk-violation' outcome (non-retriable) and raise
 *    the gate error code, while leaving dirty bits set.
 *
 * The cycle's only outbound dependency is the Supabase RPC, stubbed here.
 */

import { eq } from 'drizzle-orm';

import { __resetClockForTests } from '@/src/data/clock';
import { gyms, sessions } from '@/src/data/schema';
// Bound to the stubbed bootstrap/supabase modules below; babel-jest hoists the
// jest.mock calls above every import so the cycle resolves the stubs.
import {
  __resetAuthRequiredSignalForTests,
  getAuthRequiredSignal,
  markAuthRequired,
} from '@/src/sync/auth-required-signal';
import {
  __resetCycleErrorSignalForTests,
  getCycleErrorCode,
} from '@/src/sync/cycle-error-signal';
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

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockRpc.mockReset();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const emptyPage = { entities: [], next_cursor: null, has_more: false };
const pushOk = { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };

const gymEntity = (id: string, ms: number) => ({
  type: 'gyms',
  id,
  client_updated_at_ms: ms,
  fields: {
    name: `Server ${id}`,
    latitude: null,
    longitude: null,
    coordinate_accuracy_m: null,
    coordinates_updated_at: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

describe('cycle convergence', () => {
  it('terminates after one row arrives and a later pull is empty', async () => {
    // Layer-0 pull #1 returns one gym; every subsequent pull is empty and every
    // push acks. The cycle should converge without spinning to the round guard.
    let layer0Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Pulls += 1;
          if (layer0Pulls === 1) {
            return {
              data: {
                entities: [gymEntity('gym-server', 100)],
                next_cursor: { server_received_at: '2026-05-29T10:00:00.000Z', owner_user_id: 'u', type: 'gyms', id: 'gym-server' },
                has_more: false,
              },
              error: null,
            };
          }
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    // The single server row landed locally and clean.
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-server')).get();
    expect(row?.name).toBe('Server gym-server');
    expect(row?.localDirty).toBe(false);

    // On a fresh, never-bootstrapped store the cycle runs the first-sign-in
    // bootstrapper before its convergence loop. The bootstrapper's first full
    // pull absorbs layer-0 pull #1 (the one carrying the server row), so the
    // convergence loop opens with everything already local: one quiet round of a
    // before-pull (#2) and an after-pull (#3) confirms convergence and the loop
    // exits on that first quiet round. Layer-0 pull count is therefore 3 (1
    // bootstrap + 2 convergence).
    expect(layer0Pulls).toBe(3);
  });

  it('pushes a locally dirty row and clears it on ack during convergence', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    const pushedBatches: unknown[] = [];
    mockRpc.mockImplementation(async (name: string, args: { entities?: unknown[] }) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      pushedBatches.push(args.entities);
      return pushOk;
    });

    await runSyncCycle();

    expect(pushedBatches.length).toBeGreaterThanOrEqual(1);
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(false);
  });
});

describe('convergence loop quietness and the absent round cap', () => {
  it('treats a no-op re-pull as quiet and converges without a wasted round', async () => {
    // The server hands the SAME already-applied gym back on the first
    // convergence pull (a benign echo the device already holds at an equal
    // timestamp). Quietness now counts rows actually CHANGED, not rows the server
    // returned, so that no-op reads as quiet and the loop exits on the first
    // round. The old "count rows received" heuristic would have read the no-op as
    // motion and spun a second, pointless round.
    let layer0Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Pulls += 1;
          // Same gym on the first two layer-0 pulls (bootstrap full-pull #1, then
          // convergence before-pull #2); empty thereafter. The second delivery is
          // a no-op because the row is already local at the same timestamp.
          if (layer0Pulls <= 2) {
            return {
              data: {
                entities: [gymEntity('gym-echo', 100)],
                next_cursor: { server_received_at: '2026-05-29T10:00:00.000Z', owner_user_id: 'u', type: 'gyms', id: 'gym-echo' },
                has_more: false,
              },
              error: null,
            };
          }
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-echo')).get();
    expect(row?.localDirty).toBe(false);

    // 3 layer-0 pulls: bootstrap #1 (applies the gym), convergence before-pull #2
    // (re-delivers it as a no-op → 0 changed → quiet), after-pull #3 (empty). The
    // received-counting heuristic would have read pull #2 as motion and run a
    // second round (5 layer-0 pulls).
    expect(layer0Pulls).toBe(3);
  });

  it('drains a long fresh stream and converges without a round cap truncating it', async () => {
    // The server hands back a fresh, distinct, strictly-newer row on each of the
    // first STREAM_LEN layer-0 pulls, then goes empty. Every such pull CHANGES a
    // row (a new insert), so no round is quiet until the stream stops. The old
    // 5-round cap bounded the loop to ~10 layer-0 convergence pulls and would have
    // force-returned 'converged' partway through, stranding the tail; with no cap
    // the loop follows the whole stream.
    const STREAM_LEN = 12;
    let layer0Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Pulls += 1;
          if (layer0Pulls <= STREAM_LEN) {
            const n = layer0Pulls;
            return {
              data: {
                entities: [gymEntity(`gym-churn-${n}`, 100 + n)],
                next_cursor: { server_received_at: `2026-05-29T10:00:${String(n).padStart(2, '0')}.000Z`, owner_user_id: 'u', type: 'gyms', id: `gym-churn-${n}` },
                has_more: false,
              },
              error: null,
            };
          }
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    // Every streamed row landed locally — the loop followed the full stream past
    // where the old 5-round cap would have stopped (it would have left only the
    // first 11). The bootstrapper did not seed (the first pull returned a row).
    const allGyms = database.select().from(gyms).all();
    expect(allGyms).toHaveLength(STREAM_LEN);
    expect(
      database.select().from(gyms).where(eq(gyms.id, `gym-churn-${STREAM_LEN}`)).get(),
    ).toBeDefined();
  });
});

describe('AUTH_REQUIRED handling', () => {
  it('returns cleanly with no SQLite mutation when the pull RPC reports no JWT', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async () => ({
      data: { error: { code: 'AUTH_REQUIRED', message: 'requires an authenticated JWT' } },
      error: null,
    }));

    await expect(runSyncCycle()).resolves.toBe('auth-required');

    // Dirty bit untouched; nothing pulled.
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs).toBe(50);
    expect(database.select().from(sessions).all()).toHaveLength(0);
    // The no-JWT outcome is surfaced as the route-to-sign-in signal, not an error.
    expect(getAuthRequiredSignal()).toBe(true);
  });

  it('returns cleanly when the push RPC raises the no-JWT token', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: 'P0001', message: 'AUTH_REQUIRED: sync_push requires an authenticated user' } };
    });

    await expect(runSyncCycle()).resolves.toBe('auth-required');

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
    expect(getAuthRequiredSignal()).toBe(true);
  });

  it('lowers a previously raised auth-required signal once a cycle converges with a session', async () => {
    // A prior unauthenticated cycle left the signal raised.
    markAuthRequired();
    expect(getAuthRequiredSignal()).toBe(true);

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await runSyncCycle();

    // The authenticated cycle converged, so the route layer should stop routing
    // the user to sign-in.
    expect(getAuthRequiredSignal()).toBe(false);
  });
});

describe('FK_VIOLATION handling', () => {
  it('returns the fk-violation outcome, raises the gate error code, and leaves dirty bits set', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: 'P0001', message: 'FK_VIOLATION: parent not found' } };
    });

    // The cycle no longer throws: a structural FK violation is classified into a
    // single returned outcome so the scheduler and the gate read one consistent
    // view. It still surfaces as an error + Retry in the gate via the error code.
    await expect(runSyncCycle()).resolves.toBe('fk-violation');
    expect(getCycleErrorCode()).toBe('FK_VIOLATION');

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
  });

  it('returns the internal outcome and raises the gate error code on a transport error', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: '500', message: 'network blip' } };
    });

    await expect(runSyncCycle()).resolves.toBe('internal');
    expect(getCycleErrorCode()).toBe('INTERNAL');

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
  });
});
