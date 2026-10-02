/**
 * Multi-batch push drain (single-device base case).
 *
 * When the dirty stream exceeds the 200-row batch cap, the push leg must issue
 * SEQUENTIAL batches, clearing the dirty bit on batch N's acked rows BEFORE it
 * builds batch N+1 (contract B.6.3) — otherwise N+1 re-selects the same rows and
 * the drain either duplicates sends or never converges. The real seed catalog is
 * ~400 rows, so first-push genuinely paginates in production, yet this path is
 * only exercised by the iOS Maestro flow and the 4-row infra round-trip. Nothing
 * at jest speed drove >200 dirty rows through the real `runSyncCycle` and checked
 * the batch boundaries.
 *
 * These tests stub the server at the RPC seam, capture every push batch, and
 * assert the drain is correct: each batch ≤ cap, FIFO by monotonic timestamp, no
 * id re-sent across batches, every row drained and cleared.
 */

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { gyms, syncRuntimeState } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { BATCH_CAP, runSyncCycle, type WireEntity } from '@/src/sync/cycle';

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

/** The id list of each push batch the stub server received, in order. */
let pushBatches: string[][];

const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};
const emptyPage = { entities: [], next_cursor: null, has_more: false };

const stubServerCapturingBatches = (): void => {
  mockRpc.mockImplementation(async (name: string, args: { entities?: WireEntity[] }) => {
    if (name === 'sync_pull') {
      return { data: emptyPage, error: null };
    }
    pushBatches.push((args.entities ?? []).map((entity) => entity.id));
    return pushOk;
  });
};

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

/** Inserts `count` dirty gyms whose monotonic timestamps increase with the id. */
const insertDirtyGyms = (count: number): string[] => {
  const pad = String(count).length;
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `gym-${String(i).padStart(pad, '0')}`,
    name: `Gym ${i}`,
    localDirty: true,
    localUpdatedAtMs: 1000 + i,
  }));
  database.insert(gyms).values(rows).run();
  return rows.map((row) => row.id);
};

const allGymDirty = (): { id: string; localDirty: boolean }[] =>
  database.select({ id: gyms.id, localDirty: gyms.localDirty }).from(gyms).all();

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
  pushBatches = [];
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
  stubServerCapturingBatches();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('push leg drains a >cap dirty stream across sequential batches', () => {
  it('splits 450 dirty rows into ≤cap FIFO batches, never re-sending, all cleared', async () => {
    const ids = insertDirtyGyms(450);

    await expect(runSyncCycle()).resolves.toBe('converged');

    // 450 rows over a 200-cap drain in three sends: 200 + 200 + 50.
    expect(pushBatches.map((batch) => batch.length)).toEqual([BATCH_CAP, BATCH_CAP, 50]);
    expect(pushBatches.every((batch) => batch.length <= BATCH_CAP)).toBe(true);

    // No id appears in more than one batch — the proof that batch N's ack cleared
    // the dirty bit before batch N+1 was selected (else rows would re-send).
    const sent = pushBatches.flat();
    expect(sent).toHaveLength(450);
    expect(new Set(sent).size).toBe(450);
    expect([...sent].sort()).toEqual([...ids].sort());

    // FIFO by monotonic timestamp: the first batch is the 200 oldest-dirty rows.
    expect(pushBatches[0]).toEqual(ids.slice(0, BATCH_CAP));

    // Every row drained to clean — the dirty stream is fully exhausted.
    const rows = allGymDirty();
    expect(rows).toHaveLength(450);
    expect(rows.every((row) => row.localDirty === false)).toBe(true);
  });

  it('splits exactly cap+1 rows into a full batch then a single-row batch', async () => {
    insertDirtyGyms(BATCH_CAP + 1);

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(pushBatches.map((batch) => batch.length)).toEqual([BATCH_CAP, 1]);
    expect(allGymDirty().every((row) => row.localDirty === false)).toBe(true);
  });
});
