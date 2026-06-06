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

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { gyms, sessions, syncRuntimeState } from '@/src/data/schema';
// Bound to the stubbed bootstrap/supabase modules below; babel-jest hoists the
// jest.mock calls above every import so the cycle resolves the stubs.
import {
  __resetAuthRequiredSignalForTests,
  getAuthRequiredSignal,
  markAuthRequired,
} from '@/src/sync/auth-required-signal';
import { runSyncCycle, SyncCycleError, type WireEntity } from '@/src/sync/cycle';
import {
  __resetCycleErrorSignalForTests,
  getCycleErrorCode,
} from '@/src/sync/cycle-error-signal';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

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

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
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
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
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

const orphanSessionEntity = (id: string, ms: number): WireEntity => ({
  type: 'sessions',
  id,
  client_updated_at_ms: ms,
  fields: {
    gym_id: 'missing-gym',
    status: 'active',
    started_at: ms,
    completed_at: null,
    duration_sec: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const markBootstrapDone = () => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: new Date(1_700_000_000_000) },
    })
    .run();
};

const readPullCursorJson = (): Record<string, unknown> => {
  const row = database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  const raw = row?.pullCursor;
  if (!raw) {
    return {};
  }
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
};

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

    // On a fresh, never-bootstrapped store the cycle runs the first-sign-in
    // bootstrapper before its convergence loop. The bootstrapper's first full
    // pull absorbs layer-0 pull #1 (the one carrying the server row), so the
    // convergence loop opens with everything already local: one quiet round of a
    // before-pull (#2) and an after-pull (#3) confirms convergence. Layer-0 pull
    // count is therefore 3 (1 bootstrap + 2 convergence), and the guard cap (5
    // rounds) was never hit.
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

    await expect(runSyncCycle()).resolves.toBeUndefined();

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

  it('classifies and logs a pull-side local FK failure without advancing the failed layer cursor', async () => {
    fixture.close();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
    mockBootstrapState.database = database;
    markBootstrapDone();

    const failedCursor = {
      server_received_at: '2026-05-29T10:00:00.000Z',
      owner_user_id: 'u',
      type: 'sessions',
      id: 'sess-orphan',
    };
    let servedOrphan = false;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 1 && !servedOrphan) {
          servedOrphan = true;
          return {
            data: {
              entities: [orphanSessionEntity('sess-orphan', 100)],
              next_cursor: failedCursor,
              has_more: false,
            },
            error: null,
          };
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).rejects.toMatchObject({
      code: 'LOCAL_FK_VIOLATION',
    });

    expect(getCycleErrorCode()).toBe('LOCAL_FK_VIOLATION');
    expect(database.select().from(sessions).where(eq(sessions.id, 'sess-orphan')).get()).toBeUndefined();
    expect(readPullCursorJson()).not.toHaveProperty('1');
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        source: 'database',
        event: 'sync.pull_local_fk_violation',
        context: expect.objectContaining({
          layer: 1,
          entity_types: ['sessions'],
          row_count: 1,
          operation: 'pull_page_apply',
          error_code: 'LOCAL_FK_VIOLATION',
          exception_message: expect.stringMatching(/foreign key/i),
        }),
      }),
    );
  });

  it('does not let pull FK diagnostic logging replace the original sync error', async () => {
    fixture.close();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
    mockBootstrapState.database = database;
    markBootstrapDone();
    mockLogEvent.mockRejectedValueOnce(new Error('log insert failed'));

    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 1) {
          return {
            data: {
              entities: [orphanSessionEntity('sess-orphan', 100)],
              next_cursor: {
                server_received_at: '2026-05-29T10:00:00.000Z',
                owner_user_id: 'u',
                type: 'sessions',
                id: 'sess-orphan',
              },
              has_more: false,
            },
            error: null,
          };
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).rejects.toMatchObject({
      code: 'LOCAL_FK_VIOLATION',
    });
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
