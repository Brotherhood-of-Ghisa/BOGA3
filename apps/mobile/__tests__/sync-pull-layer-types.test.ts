/**
 * Pulled rows of entity types this build does not know, and the per-layer type
 * lists that let a later build receive them.
 *
 * A build applies only the types it knows on each layer and still advances the
 * layer's cursor, so it never loops on rows it cannot hold. With each cursor it
 * stores the types it applied there; a build whose list for a layer differs
 * re-pulls just that layer from the start, and last-write-wins makes the replay
 * a no-op for rows already held. A cursor stored without a list (every build
 * before the lists existed) counts as the frozen legacy list, so the release
 * that adds the lists causes no re-pull.
 *
 * Driver: the real `runSyncCycle` over an in-memory migrated database and a
 * stubbed sync RPC, plus the pure list helpers with hand-built layer tables.
 */

import { eq } from 'drizzle-orm';

import { getSignedInUserId } from '@/src/auth/session-user';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import { hasSyncHistory, stampLocalDataOwner, wipeLocalDatabaseRows } from '@/src/data/local-wipe';
import { gyms, syncRuntimeState, trainingProgrammes } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, writeCursorAndPendingMoves, type WireEntity } from '@/src/sync/cycle';
import {
  LAYER_TYPES_KEY,
  LEGACY_LAYER_TYPES,
  recordLayerTypes,
  resetLayersWithChangedTypes,
} from '@/src/sync/pull-layer-types';
import { TOPO_LAYERS } from '@/src/sync/topo-order';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) throw new Error('Test database not initialised');
    return mockBootstrapState.database;
  }),
}));

const mockRpc = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    ...jest.requireActual('./helpers/sync-cycle-mocks').syncRpcClient(mockRpc),
  })),
}));

const mockLogEvent = jest.fn((_params: { event: string; context?: Record<string, unknown> }) => Promise.resolve());

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: { event: string; context?: Record<string, unknown> }) => mockLogEvent(params),
}));

const mockedSignedInUserId = jest.mocked(getSignedInUserId);
const USER = 'user-1';

const cursor = (layer: number, id: string) => ({
  server_received_at: '2026-11-11T10:00:00.000000Z',
  owner_user_id: USER,
  type: 'stub',
  id: `layer-${layer}-${id}`,
});

const gymEntity = (id: string, ms: number, name: string): WireEntity => ({
  type: 'gyms',
  id,
  client_updated_at_ms: ms,
  fields: {
    name,
    latitude: null,
    longitude: null,
    coordinate_accuracy_m: null,
    coordinates_updated_at: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const programmeEntity = (id: string, ms: number): WireEntity => ({
  type: 'training_programmes',
  id,
  client_updated_at_ms: ms,
  fields: { name: 'Block A', description: null, last_modified_by: 'human', created_at: ms, updated_at: ms, deleted_at: null },
});

/** A row of a table no build knows yet: what a server-first release sends old builds. */
const unknownEntity = (id: string, ms: number): WireEntity => ({
  type: 'training_notes' as WireEntity['type'],
  id,
  client_updated_at_ms: ms,
  fields: { exercise_definition_id: 'def-1', body: 'Brace harder', deleted_at: null },
});

type Pull = { layer: number; cursor: unknown };
let pulls: Pull[] = [];
let pushedIds: string[] = [];

/**
 * A stub server holding `rows` per layer. A null cursor gets the whole layer
 * and that layer's end cursor; any other cursor is already at the end and gets
 * an empty page echoing it.
 */
const serve = (rows: Record<number, WireEntity[]>): void => {
  mockRpc.mockImplementation(async (name: string, args: { layer?: number; cursor?: unknown; entities?: WireEntity[] }) => {
    if (name === 'sync_push') {
      pushedIds.push(...(args.entities ?? []).map((entity) => entity.id));
      return { data: { ok: true, server_received_at: '2026-11-11T10:00:00.000Z' }, error: null };
    }
    if (name !== 'sync_pull') return { data: null, error: null };
    const layer = args.layer ?? 0;
    pulls.push({ layer, cursor: args.cursor ?? null });
    if (args.cursor != null) return { data: { entities: [], next_cursor: args.cursor, has_more: false }, error: null };
    return { data: { entities: rows[layer] ?? [], next_cursor: cursor(layer, 'end'), has_more: false }, error: null };
  });
};

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

const local = (): LocalDatabase => database as unknown as LocalDatabase;

const readState = (): Record<string, unknown> => {
  const raw = database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get()?.pullCursor;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as Record<string, unknown>;
};

const writeState = (state: Record<string, unknown>): void => {
  database.update(syncRuntimeState).set({ pullCursor: state as never })
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).run();
};

const markSignedInAndBootstrapped = (): void => {
  mockedSignedInUserId.mockResolvedValue(USER);
  stampLocalDataOwner(local(), USER);
  database.update(syncRuntimeState).set({ bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).run();
};

const firstPullOf = (layer: number): unknown => pulls.find((pull) => pull.layer === layer)?.cursor;
const resetEvents = () => mockLogEvent.mock.calls.map(([params]) => params).filter((p) => p.event === 'sync.pull_layers_reset');
const currentList = (layer: number): string[] => [...TOPO_LAYERS[layer]].sort();

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  pulls = [];
  pushedIds = [];
  mockRpc.mockReset();
  mockLogEvent.mockClear();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  mockedSignedInUserId.mockReset();
  mockedSignedInUserId.mockResolvedValue(null);
});

describe('layer type lists (pure)', () => {
  const withType = (layer: number, type: string) =>
    TOPO_LAYERS.map((types, index) => (index === layer ? [...types, type] : types));

  it('the legacy list is the current topology, so this release re-pulls nothing', () => {
    expect(LEGACY_LAYER_TYPES.map((types) => [...types].sort())).toEqual(TOPO_LAYERS.map((types) => [...types].sort()));
    const state = { '0': cursor(0, 'a'), '5': cursor(5, 'a') };
    expect(resetLayersWithChangedTypes(state)).toEqual([]);
    expect(state).toEqual({ '0': cursor(0, 'a'), '5': cursor(5, 'a') });
  });

  it('a new type in an existing layer resets only that layer, keeping other cursors and pending moves', () => {
    const upgraded = withType(1, 'training_notes');
    const state: Record<string, unknown> = { '0': cursor(0, 'a'), '1': cursor(1, 'a'), '3': cursor(3, 'a'), provisional_moves: [{ id: 'm' }] };
    recordLayerTypes(state, 1);

    expect(resetLayersWithChangedTypes(state, upgraded)).toEqual([1]);
    expect(state).toEqual({ '0': cursor(0, 'a'), '3': cursor(3, 'a'), provisional_moves: [{ id: 'm' }] });
    // The emptied list map is dropped, so a store whose only cursor was reset holds no stray key.
    expect(LAYER_TYPES_KEY in state).toBe(false);

    recordLayerTypes(state, 1, upgraded);
    expect((state[LAYER_TYPES_KEY] as Record<string, string[]>)['1']).toEqual([...upgraded[1]].sort());
    expect(resetLayersWithChangedTypes(state, upgraded)).toEqual([]);
  });

  it('a new layer resets nothing: it has no stored cursor and pulls from the start', () => {
    const upgraded = [...TOPO_LAYERS, ['training_notes']];
    const state: Record<string, unknown> = { '0': cursor(0, 'a'), '5': cursor(5, 'a') };
    expect(resetLayersWithChangedTypes(state, upgraded)).toEqual([]);
    expect(state).toEqual({ '0': cursor(0, 'a'), '5': cursor(5, 'a') });
  });

  it('resets a layer a newer build drained with a type this build lacks, or whose list is unreadable', () => {
    const state: Record<string, unknown> = {
      '1': cursor(1, 'a'),
      '2': cursor(2, 'a'),
      '4': cursor(4, 'a'),
      [LAYER_TYPES_KEY]: { '1': [...TOPO_LAYERS[1], 'training_notes'], '2': 'garbage', '4': currentList(4) },
    };
    expect(resetLayersWithChangedTypes(state)).toEqual([1, 2]);
    expect(state).toEqual({ '4': cursor(4, 'a'), [LAYER_TYPES_KEY]: { '4': currentList(4) } });
  });

  it('compares lists as sets, ignoring order', () => {
    const state: Record<string, unknown> = { '0': cursor(0, 'a'), [LAYER_TYPES_KEY]: { '0': [...TOPO_LAYERS[0]].reverse() } };
    expect(resetLayersWithChangedTypes(state)).toEqual([]);
  });
});

describe('sync cycle with entity types this build does not know', () => {
  it('skips an unknown type in a pulled page, applies the rest and advances the cursor', async () => {
    markSignedInAndBootstrapped();
    serve({ 0: [unknownEntity('note-1', 100), gymEntity('gym-1', 100, 'Iron Temple')] });

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get()?.name).toBe('Iron Temple');
    const state = readState();
    expect(state['0']).toEqual(cursor(0, 'end'));
    expect((state[LAYER_TYPES_KEY] as Record<string, string[]>)['0']).toEqual(currentList(0));
    // The next cycle continues from the advanced cursor: the skipped row is not re-fetched.
    pulls = [];
    await expect(runSyncCycle()).resolves.toBe('converged');
    expect(firstPullOf(0)).toEqual(cursor(0, 'end'));
  });

  it('after an upgrade re-pulls only the changed layer: the skipped rows arrive, held rows stay unchanged and clean', async () => {
    markSignedInAndBootstrapped();
    // A clean row the old build already holds, and a newer local edit not yet pushed.
    database.insert(gyms).values([
      { id: 'gym-clean', name: 'Held', localDirty: false, localUpdatedAtMs: 100 },
      { id: 'gym-dirty', name: 'Local edit', localDirty: true, localUpdatedAtMs: 300 },
    ]).run();
    // The old build drained layer 0 without knowing training_programmes, so it
    // skipped the programme and moved past it; layer 1 matches this build.
    writeState({
      '0': cursor(0, 'old'),
      '1': cursor(1, 'old'),
      [LAYER_TYPES_KEY]: { '0': TOPO_LAYERS[0].filter((type) => type !== 'training_programmes'), '1': currentList(1) },
    });
    serve({
      0: [gymEntity('gym-clean', 100, 'Server copy'), gymEntity('gym-dirty', 200, 'Server older'), programmeEntity('prog-1', 150)],
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(firstPullOf(0)).toBeNull();
    expect(firstPullOf(1)).toEqual(cursor(1, 'old'));
    expect(resetEvents()).toHaveLength(1);
    expect(resetEvents()[0].context).toEqual(expect.objectContaining({ layers: [0] }));

    const programme = database.select().from(trainingProgrammes).where(eq(trainingProgrammes.id, 'prog-1')).get();
    expect(programme).toEqual(expect.objectContaining({ name: 'Block A', localDirty: false, localUpdatedAtMs: 150 }));
    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-clean')).get()).toEqual(
      expect.objectContaining({ name: 'Held', localDirty: false, localUpdatedAtMs: 100 }),
    );
    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-dirty')).get()?.name).toBe('Local edit');
    // The replay dirtied nothing: of the replayed rows only the pre-existing local edit was pushed.
    expect(pushedIds).toContain('gym-dirty');
    expect(pushedIds).not.toContain('gym-clean');
    expect(pushedIds).not.toContain('prog-1');
    expect((readState()[LAYER_TYPES_KEY] as Record<string, string[]>)['0']).toEqual(currentList(0));

    // Once recorded, the next cycle resumes layer 0 from its new cursor.
    pulls = [];
    mockLogEvent.mockClear();
    await expect(runSyncCycle()).resolves.toBe('converged');
    expect(firstPullOf(0)).toEqual(cursor(0, 'end'));
    expect(resetEvents()).toHaveLength(0);
  });

  it('keeps a legacy cursor stored without a type list, then records the lists', async () => {
    markSignedInAndBootstrapped();
    writeState({ '0': cursor(0, 'old'), '5': cursor(5, 'old') });
    serve({});

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(firstPullOf(0)).toEqual(cursor(0, 'old'));
    expect(firstPullOf(5)).toEqual(cursor(5, 'old'));
    expect(resetEvents()).toHaveLength(0);
    expect(readState()[LAYER_TYPES_KEY]).toEqual(
      Object.fromEntries(TOPO_LAYERS.map((_types, layer) => [String(layer), currentList(layer)])),
    );
  });

  it('an unauthenticated cycle resets nothing', async () => {
    const state = { '0': cursor(0, 'old'), [LAYER_TYPES_KEY]: { '0': ['gyms'] } };
    database.insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: state as never, bootstrapCompletedAt: new Date(1_700_000_000_000) })
      .run();
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT required' } });

    await expect(runSyncCycle()).resolves.toBe('auth-required');

    expect(readState()).toEqual(state);
  });
});

describe('wipes and bootstrap reset the type lists with the cursors', () => {
  it('an account wipe drops every cursor and list, leaving no sync history', () => {
    markSignedInAndBootstrapped();
    database.transaction((tx) => writeCursorAndPendingMoves(tx as Transaction, 2, cursor(2, 'a')));
    expect((readState()[LAYER_TYPES_KEY] as Record<string, string[]>)['2']).toEqual(currentList(2));

    wipeLocalDatabaseRows(local(), { accountUserId: null });

    expect(readState()).toEqual({});
    expect(hasSyncHistory(local())).toBe(false);
  });

  it('an unfinished bootstrap re-pulls every layer from the start and records this build\'s lists', async () => {
    mockedSignedInUserId.mockResolvedValue(USER);
    stampLocalDataOwner(local(), USER);
    writeState({ '0': cursor(0, 'old'), [LAYER_TYPES_KEY]: { '0': ['gyms'] } });
    serve({ 0: [gymEntity('gym-1', 100, 'Iron Temple')] });

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(firstPullOf(0)).toBeNull();
    expect((readState()[LAYER_TYPES_KEY] as Record<string, string[]>)['0']).toEqual(currentList(0));
  });
});
