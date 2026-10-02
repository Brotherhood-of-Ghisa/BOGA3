/**
 * Pull-cursor resume after an interrupted drain (single-device base case).
 *
 * The cycle persists each layer's pull cursor after every page COMMIT, so an
 * aborted drain resumes from where it stopped rather than re-downloading the
 * layer from scratch (contract B.4.4 / B.6.2). The existing cursor tests assert
 * the cursor ADVANCES on a clean drain; none proves the RESUME path — that a
 * cycle which dies mid-layer leaves the cursor parked, and the next cycle picks
 * up from exactly that cursor.
 *
 * This drives the real `runSyncCycle` against a stub that hands back page 1
 * (has_more), then errors on page 2. The first cycle returns 'internal' with the
 * page-1 row applied and the cursor parked at page 1's `next_cursor`. The second
 * cycle's first layer-0 pull must carry THAT cursor (not null) — the proof it
 * resumed instead of restarting.
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { gyms, syncRuntimeState } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

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

const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};
const emptyPage = { entities: [], next_cursor: null, has_more: false };

const CURSOR_PAGE_1 = {
  server_received_at: '2026-05-29T10:00:00.000Z',
  owner_user_id: 'u',
  type: 'gyms',
  id: 'row-a',
};
const CURSOR_PAGE_2 = {
  server_received_at: '2026-05-29T10:00:01.000Z',
  owner_user_id: 'u',
  type: 'gyms',
  id: 'row-b',
};

const gymEntity = (id: string, ms: number): WireEntity => ({
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

const markBootstrapDone = (): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: new Date(1_700_000_000_000) },
    })
    .run();
};

const readCursor0 = (): unknown => {
  const row = database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  const raw = row?.pullCursor;
  if (!raw) {
    return undefined;
  }
  const map = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return map['0'];
};

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
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

describe('a cycle interrupted mid-pull resumes from the parked cursor', () => {
  it('parks the cursor on page 1, then the next cycle pulls from it instead of restarting', async () => {
    // Every cursor the server saw on a layer-0 pull, in order.
    const layer0Cursors: unknown[] = [];
    // The page-2 request (cursor = page-1 cursor) errors the FIRST time (the
    // interruption) and succeeds the SECOND time (the resume).
    let page2Calls = 0;

    mockRpc.mockImplementation(async (name: string, args: { layer?: number; cursor?: unknown }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Cursors.push(args.cursor ?? null);
          if (args.cursor == null) {
            // Page 1: one row, more to come.
            return {
              data: { entities: [gymEntity('row-a', 100)], next_cursor: CURSOR_PAGE_1, has_more: true },
              error: null,
            };
          }
          if (JSON.stringify(args.cursor) === JSON.stringify(CURSOR_PAGE_1)) {
            page2Calls += 1;
            if (page2Calls === 1) {
              // Interruption: page 2 dies after page 1 already committed + parked.
              return { data: null, error: { code: '500', message: 'network blip' } };
            }
            // Resume: deliver page 2 and finish the layer.
            return {
              data: { entities: [gymEntity('row-b', 101)], next_cursor: CURSOR_PAGE_2, has_more: false },
              error: null,
            };
          }
          // Layer 0 fully drained: an empty page echoes the input cursor (the
          // server never rewinds it to null — contract B.4.2).
          return { data: { entities: [], next_cursor: args.cursor ?? null, has_more: false }, error: null };
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    // Cycle 1 aborts on page 2 but commits page 1 and parks the cursor there.
    await expect(runSyncCycle()).resolves.toBe('internal');
    expect(database.select().from(gyms).where(eq(gyms.id, 'row-a')).get()?.name).toBe('Server row-a');
    expect(database.select().from(gyms).where(eq(gyms.id, 'row-b')).get()).toBeUndefined();
    expect(readCursor0()).toEqual(CURSOR_PAGE_1);
    expect(layer0Cursors).toEqual([null, CURSOR_PAGE_1]);

    // Cycle 2 resumes: its FIRST layer-0 pull carries the parked page-1 cursor —
    // not null — so page 1 is never re-downloaded.
    await expect(runSyncCycle()).resolves.toBe('converged');
    expect(layer0Cursors[2]).toEqual(CURSOR_PAGE_1);

    // Both rows are now local (page 1 from cycle 1, page 2 from the resume).
    expect(database.select().from(gyms).where(eq(gyms.id, 'row-a')).get()?.name).toBe('Server row-a');
    expect(database.select().from(gyms).where(eq(gyms.id, 'row-b')).get()?.name).toBe('Server row-b');
    expect(readCursor0()).toEqual(CURSOR_PAGE_2);
  });
});
