/**
 * Whole-cycle coverage with a stubbed server:
 *
 *  - Convergence: a server that hands back one new row on the first pull and is
 *    empty thereafter drives the cycle to terminate after two PULL/PUSH/PULL
 *    rounds (one that moved a row, one quiet round confirming convergence).
 *  - AUTH_REQUIRED: a server that returns the no-JWT envelope makes the cycle
 *    return cleanly without mutating SQLite and without throwing.
 *  - FK_VIOLATION: a server that rejects a push with the structural-error token
 *    makes the cycle throw (non-retriable) while leaving dirty bits set.
 *
 * The cycle's only outbound dependency is the Supabase RPC, stubbed here.
 */

import { eq } from 'drizzle-orm';

import { __resetClockForTests } from '@/src/data/clock';
import { gyms, sessions } from '@/src/data/schema';
// Bound to the stubbed bootstrap/supabase modules below; babel-jest hoists the
// jest.mock calls above every import so the cycle resolves the stubs.
import { runSyncCycle, SyncCycleError } from '@/src/sync/cycle';

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

    await runSyncCycle();

    // The single server row landed locally and clean.
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-server')).get();
    expect(row?.name).toBe('Server gym-server');
    expect(row?.localDirty).toBe(false);

    // Two rounds: round one moved a row (first pull), round two was fully quiet.
    // Each round issues 4 pulls before + 4 pulls after; the layer-0 pull count
    // is 2 rounds x 2 pull legs = 4. The guard cap (5 rounds) was never hit.
    expect(layer0Pulls).toBe(4);
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

describe('AUTH_REQUIRED handling', () => {
  it('returns cleanly with no SQLite mutation when the pull RPC reports no JWT', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async () => ({
      data: { error: { code: 'AUTH_REQUIRED', message: 'requires an authenticated JWT' } },
      error: null,
    }));

    await expect(runSyncCycle()).resolves.toBeUndefined();

    // Dirty bit untouched; nothing pulled.
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs).toBe(50);
    expect(database.select().from(sessions).all()).toHaveLength(0);
  });

  it('returns cleanly when the push RPC raises the no-JWT token', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: 'P0001', message: 'AUTH_REQUIRED: sync_push requires an authenticated user' } };
    });

    await expect(runSyncCycle()).resolves.toBeUndefined();

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
  });
});

describe('FK_VIOLATION handling', () => {
  it('throws and leaves dirty bits set when the push RPC reports an FK violation', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: 'P0001', message: 'FK_VIOLATION: parent not found' } };
    });

    await expect(runSyncCycle()).rejects.toBeInstanceOf(SyncCycleError);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
  });

  it('returns cleanly on an INTERNAL / transport error', async () => {
    database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return { data: null, error: { code: '500', message: 'network blip' } };
    });

    await expect(runSyncCycle()).resolves.toBeUndefined();

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get();
    expect(row?.localDirty).toBe(true);
  });
});
