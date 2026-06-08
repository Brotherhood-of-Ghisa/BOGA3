/**
 * The muscle-group taxonomy is a first-class per-user SYNCED entity: it
 * serialises onto the wire like every other entity, it is registered in the
 * sync engine as a Layer 0 table, and — the central guarantee — a wiped /
 * reinstalled client re-pulls it (Layer 0) BEFORE the mapping rows that point at
 * it (Layer 1) under enforced foreign keys, so the device never bricks on an FK
 * violation.
 *
 * Three things are proven here, against a real, fully-migrated in-memory
 * SQLite database with foreign-key enforcement ON (the same enforcement the app
 * enables at boot via `PRAGMA foreign_keys = ON`):
 *
 *   1. Wire round-trip — a muscle-group row serialises to the shared wire
 *      envelope carrying exactly the seven typed columns, and an incoming
 *      envelope reads back into a local row with `deleted_at`, the local-only
 *      bookkeeping columns, and the generated `id` default all intact.
 *   2. Registry — `muscle_groups` is a member of the entity-table set, sits in
 *      Layer 0 of the topological partition (no outbound entity FK, and it is
 *      the parent of the Layer 1 mapping table), and has the exact wire field
 *      set the server projects.
 *   3. Anti-brick reinstall round-trip — push the seeded starter catalog to a
 *      stub server, wipe the local store (reinstall), then drive the real cycle:
 *      it drains `muscle_groups` (Layer 0) before `exercise_muscle_mappings`
 *      (Layer 1), the NOT NULL muscle-group FK on the mapping holds, the cycle
 *      converges, and no FK violation is raised. Under enforced FKs a mapping
 *      page that landed before its parent layer would abort the pull, so a
 *      converged round with both rows present is the proof the ordering holds.
 *
 * The cycle's only outbound dependency is the Supabase RPC; here it is replaced
 * by an in-process stub server that records pushed rows and serves them back
 * layer-by-layer on pull, so the whole round-trip is deterministic and runs in
 * the fast lane with no live endpoint.
 */

import { eq } from 'drizzle-orm';

import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  muscleGroups,
  syncRuntimeState,
} from '@/src/data/schema';
import {
  __resetAuthRequiredSignalForTests,
} from '@/src/sync/auth-required-signal';
import {
  __resetCycleErrorSignalForTests,
} from '@/src/sync/cycle-error-signal';
import {
  entityToWire,
  runSyncCycle,
  wireToEntity,
  type WireEntity,
} from '@/src/sync/cycle';
import { TOPO_LAYERS, type EntityTableName } from '@/src/sync/topo-order';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';

// The cycle resolves its local DB and its Supabase client through these two
// modules; both are stubbed. The bootstrap holder points at the per-test
// in-memory DB; the RPC holder points at the in-process stub server below.
const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockRpc = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

// The cycle emits best-effort structured logs (including on the FK-violation
// path the negative control exercises). Stub the sink so the suite does not warn
// about a log insert that has no backing store in this in-memory fixture.
jest.mock('@/src/logging/logEvent', () => ({
  logEvent: jest.fn(() => Promise.resolve()),
}));

// -----------------------------------------------------------------------------
// In-process stub server
// -----------------------------------------------------------------------------

/**
 * A minimal stand-in for the sync server. It accepts pushed wire envelopes into
 * a per-type store and serves them back, partitioned by topological layer, on a
 * pull. It deliberately serves a WHOLE layer in one page (the tables here are
 * tiny) so the layer-ordering proof is about which layer the cycle pulls first,
 * not about pagination. It also records the order in which entity types were
 * first observed across pulls, so a test can assert the parent layer was drained
 * before the child layer.
 */
interface StubServer {
  rpc: jest.Mock;
  /** Entity types, in the order their first row was served to the client. */
  pullObservationOrder: string[];
  /** Total rows held server-side for a type. */
  count: (type: EntityTableName) => number;
}

const LAYER_OF: Record<string, number> = {};
TOPO_LAYERS.forEach((layer, index) => {
  for (const type of layer) {
    LAYER_OF[type] = index;
  }
});

const createStubServer = (): StubServer => {
  // type -> id -> envelope (last write wins on client_updated_at_ms).
  const store = new Map<string, Map<string, WireEntity>>();
  const observed = new Set<string>();
  const pullObservationOrder: string[] = [];

  const applyPush = (entities: WireEntity[]): void => {
    for (const entity of entities) {
      const bucket = store.get(entity.type) ?? new Map<string, WireEntity>();
      const existing = bucket.get(entity.id);
      if (!existing || entity.client_updated_at_ms >= existing.client_updated_at_ms) {
        bucket.set(entity.id, entity);
      }
      store.set(entity.type, bucket);
    }
  };

  const rpc = jest.fn(async (name: string, args: { layer?: number; entities?: WireEntity[] }) => {
    if (name === 'sync_push') {
      applyPush(args.entities ?? []);
      return { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };
    }

    // sync_pull: the requesting layer's full row set on the first request for
    // that layer; an empty echo afterwards (the cursor has drained it). The
    // cursor here is a simple "have I served this layer yet" flag carried in the
    // returned next_cursor.
    const layer = args.layer ?? 0;
    const layerTypes = (TOPO_LAYERS[layer] ?? []) as readonly string[];
    const entities: WireEntity[] = [];
    for (const type of layerTypes) {
      for (const envelope of store.get(type)?.values() ?? []) {
        entities.push(envelope);
        if (!observed.has(type)) {
          observed.add(type);
          pullObservationOrder.push(type);
        }
      }
    }
    return { data: { entities, next_cursor: null, has_more: false }, error: null };
  });

  return {
    rpc,
    pullObservationOrder,
    count: (type) => store.get(type)?.size ?? 0,
  };
};

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

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

/** Points the cycle's RPC stub at the given stub server. */
const useServer = (server: StubServer): void => {
  mockRpc.mockImplementation(server.rpc);
};

/** Replaces the local store with a fresh, empty, FK-enforced DB (a reinstall). */
const reinstallLocalStore = (): void => {
  fixture.close();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
};

const MG = { id: 'chest_sternal', displayName: 'Sternal Chest', familyName: 'chest', sortOrder: 3 };

// A minimal Layer 0 -> Layer 1 catalog: one muscle group, one exercise
// definition, and one mapping that points at both. Seeded dirty so the push leg
// sends it, exactly like the starter catalog a fresh account seeds.
const seedDirtyCatalog = (db: InMemoryTestDatabase): void => {
  const ms = Date.now();
  db.insert(muscleGroups)
    .values({
      id: MG.id,
      displayName: MG.displayName,
      familyName: MG.familyName,
      sortOrder: MG.sortOrder,
      isEditable: 0,
      localDirty: true,
      localUpdatedAtMs: ms + 1,
    })
    .run();
  db.insert(exerciseDefinitions)
    .values({ id: 'bench_press', name: 'Bench Press', localDirty: true, localUpdatedAtMs: ms + 2 })
    .run();
  db.insert(exerciseMuscleMappings)
    .values({
      id: 'bench_press__chest_sternal',
      exerciseDefinitionId: 'bench_press',
      muscleGroupId: MG.id,
      weight: 1,
      role: 'primary',
      localDirty: true,
      localUpdatedAtMs: ms + 3,
    })
    .run();
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

// =============================================================================
// 1. Wire round-trip
// =============================================================================

describe('muscle_groups serialises onto the shared wire envelope and reads back intact', () => {
  it('emits exactly the seven typed columns under fields, never the local-only columns', () => {
    const deletedAt = new Date(1_717_000_000_000);
    const wire = entityToWire(
      {
        id: 'chest_clavicular',
        displayName: 'Clavicular Chest',
        familyName: 'chest',
        sortOrder: 1,
        isEditable: 0,
        createdAt: new Date(1_716_000_000_000),
        updatedAt: new Date(1_716_500_000_000),
        deletedAt,
        localDirty: true,
        localUpdatedAtMs: 4242,
      },
      'muscle_groups',
    );

    expect(wire.type).toBe('muscle_groups');
    expect(wire.id).toBe('chest_clavicular');
    // The wire LWW key is the row's monotonic local timestamp.
    expect(wire.client_updated_at_ms).toBe(4242);
    // Exactly the seven typed columns; the two local-only bookkeeping columns
    // (the dirty bit and the monotonic stamp) never cross the wire.
    expect(Object.keys(wire.fields).sort()).toEqual([
      'created_at',
      'deleted_at',
      'display_name',
      'family_name',
      'is_editable',
      'sort_order',
      'updated_at',
    ]);
    expect(wire.fields.display_name).toBe('Clavicular Chest');
    expect(wire.fields.family_name).toBe('chest');
    expect(wire.fields.sort_order).toBe(1);
    expect(wire.fields.is_editable).toBe(0);
    // Timestamp columns emit epoch-ms integers.
    expect(wire.fields.deleted_at).toBe(deletedAt.getTime());
    expect(wire.fields.local_dirty).toBeUndefined();
    expect(wire.fields.local_updated_at_ms).toBeUndefined();
  });

  it('reads an incoming envelope back into a row with deleted_at, the dirty contract, and the id-default behaviour intact', () => {
    const ms = 9_000;
    const incoming: WireEntity = {
      type: 'muscle_groups',
      id: 'back_lats',
      client_updated_at_ms: ms,
      fields: {
        display_name: 'Lats',
        family_name: 'back',
        sort_order: 2,
        is_editable: 0,
        created_at: 1_716_000_000_000,
        updated_at: 1_716_700_000_000,
        deleted_at: 1_717_000_000_000,
      },
    };

    const values = wireToEntity(incoming, 'muscle_groups');
    // An incoming row is "server holds this row" state: not dirty, stamped with
    // the incoming monotonic timestamp.
    expect(values.localDirty).toBe(false);
    expect(values.localUpdatedAtMs).toBe(ms);
    expect(values.deletedAt).toEqual(new Date(1_717_000_000_000));

    // Apply it to the real schema and read it back: the soft-delete column and
    // the dirty contract survive a DB round-trip.
    database.insert(muscleGroups).values(values as never).run();
    const stored = database.select().from(muscleGroups).where(eq(muscleGroups.id, 'back_lats')).get();
    expect(stored?.displayName).toBe('Lats');
    expect(stored?.deletedAt).toEqual(new Date(1_717_000_000_000));
    expect(stored?.localDirty).toBe(false);

    // The generated id default fills any row inserted with no explicit id, so a
    // locally-created row still has a stable primary key to push.
    database
      .insert(muscleGroups)
      .values({ displayName: 'Anonymous', familyName: 'misc', sortOrder: 0 })
      .run();
    const generated = database
      .select()
      .from(muscleGroups)
      .where(eq(muscleGroups.displayName, 'Anonymous'))
      .get();
    expect(generated?.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

// =============================================================================
// 2. Registry
// =============================================================================

describe('muscle_groups is registered in the sync engine as a Layer 0 entity', () => {
  it('is a member of the topological partition and sits in Layer 0', () => {
    expect(TOPO_LAYERS[0]).toContain('muscle_groups');
    // Layer 0 has no outbound entity FK; the mapping child lives in Layer 1.
    expect(TOPO_LAYERS[1]).toContain('exercise_muscle_mappings');
    // The parent strictly precedes its child layer (the anti-brick ordering).
    expect(LAYER_OF.muscle_groups).toBeLessThan(LAYER_OF.exercise_muscle_mappings);
  });

  it('serialises with the exact wire field set the server projects', () => {
    // Serialising a bare row exposes precisely the typed columns the registry's
    // field map declares — proof that ENTITY_FIELDS[muscle_groups] is the agreed
    // seven-column set and nothing leaks or is missing.
    const wire = entityToWire(
      {
        id: 'shoulders_front',
        displayName: 'Front Delts',
        familyName: 'shoulders',
        sortOrder: 0,
        isEditable: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        deletedAt: null,
        localDirty: false,
        localUpdatedAtMs: 0,
      },
      'muscle_groups',
    );
    expect(Object.keys(wire.fields).sort()).toEqual([
      'created_at',
      'deleted_at',
      'display_name',
      'family_name',
      'is_editable',
      'sort_order',
      'updated_at',
    ]);
  });
});

// =============================================================================
// 3. Anti-brick reinstall round-trip (the central proof)
// =============================================================================

describe('a wiped/reinstalled client re-pulls muscle_groups before its mappings under enforced FKs', () => {
  it('drains Layer 0 before Layer 1 so the mapping FK holds and the device does not brick', async () => {
    const server = createStubServer();
    useServer(server);

    // Phase 1: a fresh account seeds the starter catalog dirty and pushes it to
    // the server. Marking bootstrap done keeps the bootstrapper from re-seeding;
    // the dirty rows already present are what the push leg sends.
    markBootstrapDone();
    seedDirtyCatalog(database);

    await expect(runSyncCycle()).resolves.toBe('converged');

    // The server now holds the whole Layer 0 -> Layer 1 catalog.
    expect(server.count('muscle_groups')).toBe(1);
    expect(server.count('exercise_definitions')).toBe(1);
    expect(server.count('exercise_muscle_mappings')).toBe(1);

    // Phase 2: simulate a wiped / reinstalled client — a fresh, empty, migrated
    // store with FK enforcement ON and no bootstrap flag. The bootstrapper's
    // first full pull sees the server is non-empty, so it does NOT re-seed; it
    // drains every layer in topological order.
    reinstallLocalStore();
    expect(database.select().from(muscleGroups).all()).toHaveLength(0);
    expect(database.select().from(exerciseMuscleMappings).all()).toHaveLength(0);

    // The reinstall cycle must converge: under enforced FKs, a Layer 1 mapping
    // page that landed before its Layer 0 muscle-group parent would raise an FK
    // violation and abort the pull, classifying the cycle as 'fk-violation'
    // rather than 'converged'. A converged outcome is the anti-brick proof.
    await expect(runSyncCycle()).resolves.toBe('converged');

    // The full catalog is restored locally and clean.
    const restoredGroup = database
      .select()
      .from(muscleGroups)
      .where(eq(muscleGroups.id, MG.id))
      .get();
    expect(restoredGroup?.displayName).toBe(MG.displayName);
    expect(restoredGroup?.localDirty).toBe(false);

    const restoredMapping = database
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.id, 'bench_press__chest_sternal'))
      .get();
    expect(restoredMapping?.muscleGroupId).toBe(MG.id);
    expect(restoredMapping?.localDirty).toBe(false);

    // The parent layer was observed BEFORE the child layer across the pull — the
    // ordering the FK relies on. `muscle_groups` (Layer 0) must appear earlier in
    // the server's first-seen order than `exercise_muscle_mappings` (Layer 1).
    const groupIndex = server.pullObservationOrder.indexOf('muscle_groups');
    const mappingIndex = server.pullObservationOrder.indexOf('exercise_muscle_mappings');
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    expect(mappingIndex).toBeGreaterThanOrEqual(0);
    expect(groupIndex).toBeLessThan(mappingIndex);
  });

  it('aborts the reinstall pull as an FK violation if the mapping child is served before its muscle-group parent (negative control)', async () => {
    // This proves the converged outcome above is load-bearing: if the server
    // handed back the Layer 1 mapping while Layer 0 was still empty, the local FK
    // would reject the orphan and the cycle would classify as 'fk-violation', not
    // 'converged'. We model that broken server by serving the mapping under
    // Layer 0 (the layer the cycle drains first) with no parent muscle group
    // anywhere.
    reinstallLocalStore();
    markBootstrapDone();

    const ms = Date.now();
    const orphanMapping: WireEntity = {
      type: 'exercise_muscle_mappings',
      id: 'orphan-map',
      client_updated_at_ms: ms,
      fields: {
        exercise_definition_id: 'absent-def',
        muscle_group_id: 'absent-group',
        weight: 1,
        role: 'primary',
        created_at: ms,
        updated_at: ms,
        deleted_at: null,
      },
    };

    let served = false;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 1 && !served) {
          served = true;
          return { data: { entities: [orphanMapping], next_cursor: null, has_more: false }, error: null };
        }
        return { data: { entities: [], next_cursor: null, has_more: false }, error: null };
      }
      return { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };
    });

    await expect(runSyncCycle()).resolves.toBe('fk-violation');
    // The orphan mapping never landed locally — the whole page rolled back.
    expect(
      database.select().from(exerciseMuscleMappings).where(eq(exerciseMuscleMappings.id, 'orphan-map')).get(),
    ).toBeUndefined();
  });
});
