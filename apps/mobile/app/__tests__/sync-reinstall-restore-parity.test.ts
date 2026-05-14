/* eslint-disable import/first */

const mockBootstrapLocalDataLayer = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

// The sync bootstrap merge re-seeds the system exercise catalog after the
// merge transaction commits (see fix-sync T4). The parity test focuses on
// sync convergence parity rather than seed contents, so we no-op the seeder
// here to avoid the verification step asserting against canonical seed counts
// inside the in-memory fake data layer.
jest.mock('@/src/data/exercise-catalog-seeds', () => ({
  seedSystemExerciseCatalog: (...args: unknown[]) => mockSeedSystemExerciseCatalog(...args),
}));

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  __resetSyncEngineForTests,
  __resetSyncStateForTests,
  enqueueSyncEvents,
  fetchRemoteSyncProjectionState,
  flushSyncOutboxUntilSettled,
  getSyncDeliveryState,
  listPendingSyncEvents,
  runSyncBootstrapMerge,
  setSyncIngestTransport,
  setSyncNetworkOnline,
  type QueuedSyncEventInput,
  type SyncIngestResponse,
  type SyncIngestTransport,
} from '@/src/sync';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExercises,
  sessionExerciseTags,
  sessions,
  syncDeliveryState,
  syncOutboxEvents,
  syncRuntimeState,
} from '@/src/data/schema';
import { smokeRecords } from '@/src/data/schema/smoke';

type ScopedSnapshot = {
  gyms: {
    id: string;
    name: string;
    originScopeId: string;
    originSourceId: string;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  sessions: {
    id: string;
    gymId: string | null;
    status: string;
    startedAtMs: number;
    completedAtMs: number | null;
    durationSec: number | null;
    deletedAtMs: number | null;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  sessionExercises: {
    id: string;
    sessionId: string;
    exerciseDefinitionId: string | null;
    orderIndex: number;
    name: string;
    machineName: string | null;
    originScopeId: string;
    originSourceId: string;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  exerciseSets: {
    id: string;
    sessionExerciseId: string;
    orderIndex: number;
    weightValue: string;
    repsValue: string;
    setType: string | null;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  exerciseDefinitions: {
    id: string;
    name: string;
    deletedAtMs: number | null;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  exerciseMuscleMappings: {
    id: string;
    exerciseDefinitionId: string;
    muscleGroupId: string;
    weight: number;
    role: 'primary' | 'secondary' | 'stabilizer' | null;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  exerciseTagDefinitions: {
    id: string;
    exerciseDefinitionId: string;
    name: string;
    normalizedName: string;
    deletedAtMs: number | null;
    createdAtMs: number;
    updatedAtMs: number;
  }[];
  sessionExerciseTags: {
    id: string;
    sessionExerciseId: string;
    exerciseTagDefinitionId: string;
    createdAtMs: number;
  }[];
};

type NonScopeSnapshot = {
  deviceId: string;
  pendingOutboxCount: number;
  smokeRecordCount: number;
};

type FixtureIds = {
  exerciseDefinitionId: string;
  gymId: string;
  sessionId: string;
  sessionExerciseId: string;
  setId: string;
  mappingRowId: string;
  mappingEntityId: string;
  tagDefinitionId: string;
  sessionExerciseTagRowId: string;
  sessionExerciseTagEntityId: string;
};

type FakeState = {
  gyms: typeof gyms.$inferSelect[];
  sessions: typeof sessions.$inferSelect[];
  sessionExercises: typeof sessionExercises.$inferSelect[];
  exerciseSets: typeof exerciseSets.$inferSelect[];
  exerciseDefinitions: typeof exerciseDefinitions.$inferSelect[];
  exerciseMuscleMappings: typeof exerciseMuscleMappings.$inferSelect[];
  exerciseTagDefinitions: typeof exerciseTagDefinitions.$inferSelect[];
  sessionExerciseTags: typeof sessionExerciseTags.$inferSelect[];
  syncOutboxEvents: typeof syncOutboxEvents.$inferSelect[];
  syncDeliveryState: typeof syncDeliveryState.$inferSelect[];
  syncRuntimeState: typeof syncRuntimeState.$inferSelect[];
  smokeRecords: typeof smokeRecords.$inferSelect[];
};

type FakeDataLayer = {
  database: {
    transaction: <T>(callback: (tx: any) => T) => T;
    select: (fields?: unknown) => any;
    insert: (table: object) => any;
    update: (table: object) => any;
    delete: (table: object) => any;
  };
  state: FakeState;
  reset: () => void;
  appendSmokeRecord: (value: string) => void;
};

jest.setTimeout(120_000);

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
};

const normalizeMs = (value: Date | null) => (value ? value.getTime() : null);

const sortById = <T extends { id: string }>(rows: T[]) => [...rows].sort((left, right) => left.id.localeCompare(right.id));

const captureScopedSnapshot = (state: FakeState): ScopedSnapshot => ({
  gyms: sortById(
    state.gyms.map((row) => ({
      id: row.id,
      name: row.name,
      originScopeId: row.originScopeId,
      originSourceId: row.originSourceId,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  sessions: sortById(
    state.sessions.map((row) => ({
      id: row.id,
      gymId: row.gymId,
      status: row.status,
      startedAtMs: row.startedAt.getTime(),
      completedAtMs: normalizeMs(row.completedAt),
      durationSec: row.durationSec,
      deletedAtMs: normalizeMs(row.deletedAt),
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  sessionExercises: sortById(
    state.sessionExercises.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      exerciseDefinitionId: row.exerciseDefinitionId,
      orderIndex: row.orderIndex,
      name: row.name,
      machineName: row.machineName,
      originScopeId: row.originScopeId,
      originSourceId: row.originSourceId,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  exerciseSets: sortById(
    state.exerciseSets.map((row) => ({
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.orderIndex,
      weightValue: row.weightValue,
      repsValue: row.repsValue,
      setType: row.setType ?? null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  exerciseDefinitions: sortById(
    state.exerciseDefinitions.map((row) => ({
      id: row.id,
      name: row.name,
      deletedAtMs: normalizeMs(row.deletedAt),
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  exerciseMuscleMappings: sortById(
    state.exerciseMuscleMappings.map((row) => ({
      id: row.id,
      exerciseDefinitionId: row.exerciseDefinitionId,
      muscleGroupId: row.muscleGroupId,
      weight: row.weight,
      role: row.role,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  exerciseTagDefinitions: sortById(
    state.exerciseTagDefinitions.map((row) => ({
      id: row.id,
      exerciseDefinitionId: row.exerciseDefinitionId,
      name: row.name,
      normalizedName: row.normalizedName,
      deletedAtMs: normalizeMs(row.deletedAt),
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }))
  ),
  sessionExerciseTags: sortById(
    state.sessionExerciseTags.map((row) => ({
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      exerciseTagDefinitionId: row.exerciseTagDefinitionId,
      createdAtMs: row.createdAt.getTime(),
    }))
  ),
});

const assertM13EntityCoverage = (snapshot: ScopedSnapshot) => {
  expect(snapshot.gyms.length).toBeGreaterThan(0);
  expect(snapshot.sessions.length).toBeGreaterThan(0);
  expect(snapshot.sessionExercises.length).toBeGreaterThan(0);
  expect(snapshot.exerciseSets.length).toBeGreaterThan(0);
  expect(snapshot.exerciseDefinitions.length).toBeGreaterThan(0);
  expect(snapshot.exerciseMuscleMappings.length).toBeGreaterThan(0);
  expect(snapshot.exerciseTagDefinitions.length).toBeGreaterThan(0);
  expect(snapshot.sessionExerciseTags.length).toBeGreaterThan(0);
};

const createFakeDataLayer = (): FakeDataLayer => {
  const state: FakeState = {
    gyms: [],
    sessions: [],
    sessionExercises: [],
    exerciseSets: [],
    exerciseDefinitions: [],
    exerciseMuscleMappings: [],
    exerciseTagDefinitions: [],
    sessionExerciseTags: [],
    syncOutboxEvents: [],
    syncDeliveryState: [],
    syncRuntimeState: [],
    smokeRecords: [],
  };

  const tableRows = new Map<object, Record<string, unknown>[]>([
    [gyms, state.gyms as Record<string, unknown>[]],
    [sessions, state.sessions as Record<string, unknown>[]],
    [sessionExercises, state.sessionExercises as Record<string, unknown>[]],
    [exerciseSets, state.exerciseSets as Record<string, unknown>[]],
    [exerciseDefinitions, state.exerciseDefinitions as Record<string, unknown>[]],
    [exerciseMuscleMappings, state.exerciseMuscleMappings as Record<string, unknown>[]],
    [exerciseTagDefinitions, state.exerciseTagDefinitions as Record<string, unknown>[]],
    [sessionExerciseTags, state.sessionExerciseTags as Record<string, unknown>[]],
    [syncOutboxEvents, state.syncOutboxEvents as Record<string, unknown>[]],
    [syncDeliveryState, state.syncDeliveryState as Record<string, unknown>[]],
    [syncRuntimeState, state.syncRuntimeState as Record<string, unknown>[]],
    [smokeRecords, state.smokeRecords as Record<string, unknown>[]],
  ]);

  const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

  const rowsFor = (table: object) => {
    const rows = tableRows.get(table);
    if (!rows) {
      throw new Error('Unknown table reference in fake data layer');
    }
    return rows;
  };

  const createSelectBuilder = (table: object) => {
    let limitCount: number | null = null;

    const api = {
      where: (_clause: unknown) => api,
      orderBy: (..._args: unknown[]) => api,
      limit: (count: number) => {
        limitCount = Math.max(0, Math.floor(count));
        return api;
      },
      all: () => {
        const source = rowsFor(table);
        const sorted = table === syncOutboxEvents
          ? [...source].sort(
              (left, right) =>
                Number((left as typeof syncOutboxEvents.$inferSelect).sequenceInDevice) -
                Number((right as typeof syncOutboxEvents.$inferSelect).sequenceInDevice)
            )
          : [...source];

        const limited = limitCount === null ? sorted : sorted.slice(0, limitCount);
        return limited.map((row) => cloneRow(row));
      },
      get: () => api.all()[0],
    };

    return api;
  };

  const insert = (table: object) => ({
    values: (input: Record<string, unknown> | Record<string, unknown>[]) => ({
      run: () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
        values.forEach((value) => {
          rows.push(cloneRow(value));
        });
      },
    }),
  });

  const update = (table: object) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (_clause: unknown) => ({
        run: () => {
          const rows = rowsFor(table);
          rows.forEach((row) => {
            Object.entries(patch).forEach(([key, value]) => {
              if (value !== undefined) {
                (row as Record<string, unknown>)[key] = value;
              }
            });
          });
        },
      }),
    }),
  });

  const del = (table: object) => {
    const run = () => {
      const rows = rowsFor(table);
      rows.length = 0;
    };

    return {
      where: (_clause: unknown) => ({ run }),
      run,
    };
  };

  const database = {
    transaction: <T>(callback: (tx: any) => T) => {
      const tx = {
        select: (_fields?: unknown) => ({
          from: (table: object) => createSelectBuilder(table),
        }),
        insert,
        update,
        delete: del,
      };

      return callback(tx);
    },
    select: (_fields?: unknown) => ({
      from: (table: object) => createSelectBuilder(table),
    }),
    insert,
    update,
    delete: del,
  };

  return {
    database,
    state,
    reset: () => {
      Object.values(state).forEach((rows) => {
        rows.length = 0;
      });
    },
    appendSmokeRecord: (value: string) => {
      const now = new Date();
      state.smokeRecords.push({
        id: state.smokeRecords.length + 1,
        value,
        createdAt: now,
        updatedAt: now,
      });
    },
  };
};

const createSupabaseClient = async (email: string, password: string): Promise<SupabaseClient> => {
  const client = createClient(requiredEnv('EXPO_PUBLIC_SUPABASE_URL'), requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const signInResult = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInResult.error || !signInResult.data.session) {
    throw new Error(`Supabase sign-in failed: ${signInResult.error?.message ?? 'unknown error'}`);
  }

  return client;
};

const createSupabaseIngestTransport = (client: SupabaseClient): SyncIngestTransport => ({
  async ingestBatch(request) {
    const { data, error } = await client.schema('app_public').rpc('sync_events_ingest', request);

    if (error) {
      throw new Error(error.message);
    }

    const normalized = Array.isArray(data) ? data[0] : data;
    if (!normalized || typeof normalized !== 'object') {
      throw new Error('Invalid sync ingest response payload');
    }

    const response = normalized as Partial<SyncIngestResponse>;
    if (response.status !== 'SUCCESS' && response.status !== 'FAILURE') {
      throw new Error('Invalid sync ingest response status');
    }

    return response as SyncIngestResponse;
  },
});

const createRunTag = () => `sync-parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const seedFixtureState = async (state: FakeState, runTag: string, now: Date): Promise<FixtureIds> => {
  const exerciseDefinitionId = `${runTag}-exdef`;
  const gymId = `${runTag}-gym`;
  const sessionId = `${runTag}-session`;
  const sessionExerciseId = `${runTag}-sx`;
  const setId = `${runTag}-set`;
  const mappingEntityId = `${exerciseDefinitionId}:pectorals`;
  const mappingRowId = `${runTag}-map-row`;
  const tagDefinitionId = `${runTag}-tag-def`;
  const sessionExerciseTagEntityId = `${sessionExerciseId}:${tagDefinitionId}`;
  const sessionExerciseTagRowId = `${runTag}-session-tag-row`;

  state.exerciseDefinitions.push({
    id: exerciseDefinitionId,
    name: `${runTag} Bench Press`,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  state.gyms.push({
    id: gymId,
    name: `${runTag} Gym`,
    originScopeId: 'private',
    originSourceId: 'local',
    createdAt: now,
    updatedAt: now,
  });

  state.sessions.push({
    id: sessionId,
    gymId,
    status: 'active',
    startedAt: new Date(now.getTime() - 45_000),
    completedAt: null,
    durationSec: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  state.sessionExercises.push({
    id: sessionExerciseId,
    sessionId,
    exerciseDefinitionId,
    orderIndex: 0,
    name: `${runTag} Bench Press`,
    machineName: 'Rack',
    originScopeId: 'private',
    originSourceId: 'local',
    createdAt: now,
    updatedAt: now,
  });

  state.exerciseSets.push({
    id: setId,
    sessionExerciseId,
    orderIndex: 0,
    repsValue: '5',
    weightValue: '100',
    setType: 'rir_2',
    createdAt: now,
    updatedAt: now,
  });

  state.exerciseMuscleMappings.push({
    id: mappingRowId,
    exerciseDefinitionId,
    muscleGroupId: 'pectorals',
    weight: 1,
    role: 'primary',
    createdAt: now,
    updatedAt: now,
  });

  state.exerciseTagDefinitions.push({
    id: tagDefinitionId,
    exerciseDefinitionId,
    name: `${runTag} Close Grip`,
    normalizedName: `${runTag} close grip`.toLowerCase(),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  state.sessionExerciseTags.push({
    id: sessionExerciseTagRowId,
    sessionExerciseId,
    exerciseTagDefinitionId: tagDefinitionId,
    createdAt: now,
  });

  const baseMs = now.getTime();
  const events: QueuedSyncEventInput[] = [
    {
      eventId: `${runTag}-event-1`,
      occurredAt: new Date(baseMs + 1),
      entityType: 'exercise_definitions',
      entityId: exerciseDefinitionId,
      eventType: 'upsert',
      payload: {
        id: exerciseDefinitionId,
        name: `${runTag} Bench Press`,
        deleted_at_ms: null,
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-2`,
      occurredAt: new Date(baseMs + 2),
      entityType: 'gyms',
      entityId: gymId,
      eventType: 'upsert',
      payload: {
        id: gymId,
        name: `${runTag} Gym`,
        origin_scope_id: 'private',
        origin_source_id: 'local',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-3`,
      occurredAt: new Date(baseMs + 3),
      entityType: 'sessions',
      entityId: sessionId,
      eventType: 'upsert',
      payload: {
        id: sessionId,
        gym_id: gymId,
        status: 'active',
        started_at_ms: baseMs - 45_000,
        completed_at_ms: null,
        duration_sec: null,
        deleted_at_ms: null,
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-4`,
      occurredAt: new Date(baseMs + 4),
      entityType: 'session_exercises',
      entityId: sessionExerciseId,
      eventType: 'upsert',
      payload: {
        id: sessionExerciseId,
        session_id: sessionId,
        exercise_definition_id: exerciseDefinitionId,
        order_index: 0,
        name: `${runTag} Bench Press`,
        machine_name: 'Rack',
        origin_scope_id: 'private',
        origin_source_id: 'local',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-5`,
      occurredAt: new Date(baseMs + 5),
      entityType: 'exercise_sets',
      entityId: setId,
      eventType: 'upsert',
      payload: {
        id: setId,
        session_exercise_id: sessionExerciseId,
        order_index: 0,
        weight_value: '100',
        reps_value: '5',
        set_type: 'rir_2',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-6`,
      occurredAt: new Date(baseMs + 6),
      entityType: 'exercise_muscle_mappings',
      entityId: mappingEntityId,
      eventType: 'attach',
      payload: {
        id: mappingEntityId,
        row_id: mappingRowId,
        exercise_definition_id: exerciseDefinitionId,
        muscle_group_id: 'pectorals',
        weight: 1,
        role: 'primary',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-7`,
      occurredAt: new Date(baseMs + 7),
      entityType: 'exercise_tag_definitions',
      entityId: tagDefinitionId,
      eventType: 'upsert',
      payload: {
        id: tagDefinitionId,
        exercise_definition_id: exerciseDefinitionId,
        name: `${runTag} Close Grip`,
        normalized_name: `${runTag} close grip`.toLowerCase(),
        deleted_at_ms: null,
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: `${runTag}-event-8`,
      occurredAt: new Date(baseMs + 8),
      entityType: 'session_exercise_tags',
      entityId: sessionExerciseTagEntityId,
      eventType: 'attach',
      payload: {
        id: sessionExerciseTagEntityId,
        row_id: sessionExerciseTagRowId,
        session_exercise_id: sessionExerciseId,
        exercise_tag_definition_id: tagDefinitionId,
        created_at_ms: baseMs,
      },
    },
  ];

  await enqueueSyncEvents(events, { now });

  return {
    exerciseDefinitionId,
    gymId,
    sessionId,
    sessionExerciseId,
    setId,
    mappingRowId,
    mappingEntityId,
    tagDefinitionId,
    sessionExerciseTagRowId,
    sessionExerciseTagEntityId,
  };
};

const captureNonScopeSnapshot = async (state: FakeState): Promise<NonScopeSnapshot> => ({
  deviceId: (await getSyncDeliveryState()).deviceId,
  pendingOutboxCount: (await listPendingSyncEvents(500)).length,
  smokeRecordCount: state.smokeRecords.length,
});

describe('sync reinstall restore-state parity (M13-T06)', () => {
  let loginEmail!: string;
  let loginPassword!: string;
  let fakeDataLayer: FakeDataLayer;

  beforeAll(() => {
    requiredEnv('EXPO_PUBLIC_SUPABASE_URL');
    requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    loginEmail = requiredEnv('SYNC_TEST_EMAIL');
    loginPassword = requiredEnv('SYNC_TEST_PASSWORD');
  });

  beforeEach(async () => {
    fakeDataLayer = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockReset();
    mockBootstrapLocalDataLayer.mockResolvedValue(fakeDataLayer.database);
    mockSeedSystemExerciseCatalog.mockReset();

    __resetSyncEngineForTests();
    await __resetSyncStateForTests();
    setSyncNetworkOnline(true);
    setSyncIngestTransport(null);
  });

  afterEach(async () => {
    __resetSyncEngineForTests();
    await __resetSyncStateForTests();
    setSyncIngestTransport(null);
    setSyncNetworkOnline(true);
  });

  it('sends fixture changes through outbox and restores identical scoped state after reinstall', async () => {
    const runTag = createRunTag();
    const now = new Date('2026-03-07T12:00:00.000Z');

    const firstClient = await createSupabaseClient(loginEmail, loginPassword);
    setSyncIngestTransport(createSupabaseIngestTransport(firstClient));

    await runSyncBootstrapMerge({
      client: firstClient,
      now,
    });

    const bootstrapConvergence = await flushSyncOutboxUntilSettled({ maxAttempts: 40 });
    expect(bootstrapConvergence.status).toBe('converged');

    const fixture = await seedFixtureState(fakeDataLayer.state, runTag, now);

    const pendingAfterWrites = await listPendingSyncEvents(500);
    expect(pendingAfterWrites.length).toBe(8);

    const preSyncScopedSnapshot = captureScopedSnapshot(fakeDataLayer.state);
    assertM13EntityCoverage(preSyncScopedSnapshot);

    const preSyncNonScopeSnapshot = await captureNonScopeSnapshot(fakeDataLayer.state);

    const firstConvergence = await flushSyncOutboxUntilSettled({ maxAttempts: 40 });
    expect(firstConvergence.status).toBe('converged');
    expect(firstConvergence.totalSentCount).toBeGreaterThan(0);
    expect((await listPendingSyncEvents(500)).length).toBe(0);

    const remoteAfterUpload = await fetchRemoteSyncProjectionState(firstClient);
    expect(remoteAfterUpload.gyms.some((row) => row.id === fixture.gymId)).toBe(true);
    expect(remoteAfterUpload.sessions.some((row) => row.id === fixture.sessionId)).toBe(true);
    expect(remoteAfterUpload.sessionExercises.some((row) => row.id === fixture.sessionExerciseId)).toBe(true);
    expect(
      remoteAfterUpload.exerciseSets.some((row) => row.id === fixture.setId && row.setType === 'rir_2')
    ).toBe(true);
    expect(remoteAfterUpload.exerciseDefinitions.some((row) => row.id === fixture.exerciseDefinitionId)).toBe(true);
    expect(remoteAfterUpload.exerciseMuscleMappings.some((row) => row.id === fixture.mappingRowId)).toBe(true);
    expect(remoteAfterUpload.exerciseTagDefinitions.some((row) => row.id === fixture.tagDefinitionId)).toBe(true);
    expect(remoteAfterUpload.sessionExerciseTags.some((row) => row.id === fixture.sessionExerciseTagRowId)).toBe(true);

    fakeDataLayer.reset();
    __resetSyncEngineForTests();
    await __resetSyncStateForTests();
    setSyncNetworkOnline(true);

    const secondClient = await createSupabaseClient(loginEmail, loginPassword);
    setSyncIngestTransport(createSupabaseIngestTransport(secondClient));

    await runSyncBootstrapMerge({
      client: secondClient,
      now: new Date(now.getTime() + 10_000),
    });

    const secondConvergence = await flushSyncOutboxUntilSettled({ maxAttempts: 40 });
    expect(secondConvergence.status).toBe('converged');

    fakeDataLayer.appendSmokeRecord(`${runTag}-excluded-smoke`);

    const postRestoreScopedSnapshot = captureScopedSnapshot(fakeDataLayer.state);
    const postRestoreNonScopeSnapshot = await captureNonScopeSnapshot(fakeDataLayer.state);

    expect(postRestoreScopedSnapshot).toEqual(preSyncScopedSnapshot);
    expect(postRestoreNonScopeSnapshot).not.toEqual(preSyncNonScopeSnapshot);
  });
});
