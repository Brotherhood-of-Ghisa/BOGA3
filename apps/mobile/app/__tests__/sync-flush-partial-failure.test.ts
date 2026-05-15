/* eslint-disable import/first */

// T9 Test 2 — convergence flush failure mid-batch leaves local data intact and
// the next retry replays cleanly.
//
// What this locks:
//   1. The flush engine never DELETES rows from the local projection tables.
//      It only mutates the outbox (DELETE on confirmed events) and delivery
//      state (counters, retry timer, error message). A flush failure must
//      therefore leave gyms / sessions / sessionExercises / exerciseSets etc
//      bit-for-bit unchanged.
//   2. Partial-success FAILURE (`error_index = N`) deletes exactly the first
//      N confirmed events from the outbox; events at index N onward stay
//      queued so the next retry replays them.
//   3. Retry semantics: once the backoff window passes and the next batch
//      returns SUCCESS, the remaining events are removed and local data
//      remains untouched.

const mockBootstrapLocalDataLayer = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

import {
  __resetSyncEngineForTests,
  enqueueSyncEvents,
  flushSyncOutbox,
  listPendingSyncEvents,
  setSyncIngestTransport,
  setSyncNetworkOnline,
  type QueuedSyncEventInput,
  type SyncIngestRequest,
  type SyncIngestResponse,
  type SyncIngestTransport,
} from '@/src/sync';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExercises,
  sessionExerciseTags,
  sessions,
  syncDeliveryState,
  syncOutboxEvents,
  syncRuntimeState,
} from '@/src/data/schema';

type FakeRow = Record<string, unknown>;

type FakeState = {
  gyms: FakeRow[];
  sessions: FakeRow[];
  sessionExercises: FakeRow[];
  exerciseSets: FakeRow[];
  exerciseDefinitions: FakeRow[];
  exerciseMuscleMappings: FakeRow[];
  exerciseTagDefinitions: FakeRow[];
  sessionExerciseTags: FakeRow[];
  muscleGroups: FakeRow[];
  syncOutboxEvents: FakeRow[];
  syncDeliveryState: FakeRow[];
  syncRuntimeState: FakeRow[];
};

const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

// `applySyncIngestResponse` calls
// `tx.delete(syncOutboxEvents).where(inArray(syncOutboxEvents.eventId, [...]))`.
// Drizzle's `inArray` builds an `SQL` whose `queryChunks` array carries the
// values it was constructed with. We extract the string values out of that
// chunk so the fake DB's outbox-delete can target only the confirmed prefix.
const extractInArrayValuesFromClause = (clause: unknown): string[] | null => {
  if (!clause || typeof clause !== 'object') {
    return null;
  }
  const queryChunks = (clause as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(queryChunks)) {
    return null;
  }
  for (const chunk of queryChunks) {
    if (!Array.isArray(chunk)) {
      continue;
    }
    const params = chunk
      .filter((entry): entry is { value: unknown } => Boolean(entry) && typeof entry === 'object' && 'value' in entry)
      .map((entry) => entry.value);
    if (params.length > 0 && params.every((value) => typeof value === 'string')) {
      return params as string[];
    }
  }
  return null;
};

const createFakeDataLayer = () => {
  const state: FakeState = {
    gyms: [],
    sessions: [],
    sessionExercises: [],
    exerciseSets: [],
    exerciseDefinitions: [],
    exerciseMuscleMappings: [],
    exerciseTagDefinitions: [],
    sessionExerciseTags: [],
    muscleGroups: [],
    syncOutboxEvents: [],
    syncDeliveryState: [],
    syncRuntimeState: [],
  };

  const tableRows = new Map<object, FakeRow[]>([
    [gyms, state.gyms],
    [sessions, state.sessions],
    [sessionExercises, state.sessionExercises],
    [exerciseSets, state.exerciseSets],
    [exerciseDefinitions, state.exerciseDefinitions],
    [exerciseMuscleMappings, state.exerciseMuscleMappings],
    [exerciseTagDefinitions, state.exerciseTagDefinitions],
    [sessionExerciseTags, state.sessionExerciseTags],
    [muscleGroups, state.muscleGroups],
    [syncOutboxEvents, state.syncOutboxEvents],
    [syncDeliveryState, state.syncDeliveryState],
    [syncRuntimeState, state.syncRuntimeState],
  ]);

  const rowsFor = (table: object) => {
    const rows = tableRows.get(table);
    if (!rows) {
      throw new Error('Unknown table reference in fake data layer');
    }
    return rows;
  };

  const rowKey = (table: object, value: FakeRow): string | null => {
    if (table === syncOutboxEvents) {
      return `event:${String(value.eventId ?? '')}`;
    }
    const id = (value as { id?: unknown }).id;
    if (id === undefined || id === null) {
      return null;
    }
    return `id:${String(id)}`;
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
        // Order outbox by sequence_in_device ASC to mirror the production
        // query the engine relies on.
        const sorted =
          table === syncOutboxEvents
            ? [...source].sort(
                (l, r) => Number(l.sequenceInDevice ?? 0) - Number(r.sequenceInDevice ?? 0)
              )
            : [...source];
        const limited = limitCount === null ? sorted : sorted.slice(0, limitCount);
        return limited.map((row) => cloneRow(row));
      },
      get: () => {
        const rows = rowsFor(table);
        return rows.length > 0 ? cloneRow(rows[0]) : undefined;
      },
    };
    return api;
  };

  const insert = (table: object) => ({
    values: (input: FakeRow | FakeRow[]) => {
      const apply = () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
        values.forEach((value) => {
          const key = rowKey(table, value);
          if (key === null) {
            rows.push(cloneRow(value));
            return;
          }
          const existingIndex = rows.findIndex((row) => rowKey(table, row) === key);
          if (existingIndex >= 0) {
            rows[existingIndex] = cloneRow(value);
          } else {
            rows.push(cloneRow(value));
          }
        });
      };
      return {
        run: apply,
        onConflictDoUpdate: (_options: unknown) => ({
          run: apply,
        }),
      };
    },
  });

  const update = (table: object) => ({
    set: (patch: FakeRow) => ({
      where: (_clause: unknown) => ({
        run: () => {
          const rows = rowsFor(table);
          rows.forEach((row) => {
            Object.entries(patch).forEach(([key, value]) => {
              if (value !== undefined) {
                row[key] = value;
              }
            });
          });
        },
      }),
    }),
  });

  // Delete behaviour mirrors production:
  //   - `applySyncIngestResponse` calls
  //     `tx.delete(syncOutboxEvents).where(inArray(syncOutboxEvents.eventId, [...]))`
  //     We honour the `inArray` filter by reading the clause's queryChunks.
  //   - `__resetSyncStateForTests` calls naked `.delete(...).run()` on outbox
  //     and delivery state — wipes the table.
  //   - The bootstrap merge calls `.delete(table).run()` on projection tables
  //     — also wipes.
  const del = (table: object) => {
    const naked = () => {
      const rows = rowsFor(table);
      rows.length = 0;
    };
    return {
      where: (clause: unknown) => ({
        run: () => {
          const inArrayValues = extractInArrayValuesFromClause(clause);
          if (inArrayValues === null) {
            naked();
            return;
          }
          if (table === syncOutboxEvents) {
            const removeSet = new Set(inArrayValues);
            const rows = rowsFor(table);
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              const eventId = (rows[i] as { eventId?: unknown }).eventId;
              if (typeof eventId === 'string' && removeSet.has(eventId)) {
                rows.splice(i, 1);
              }
            }
            return;
          }
          // Other tables don't currently use inArray-bound deletes; treat as
          // a wipe to stay forward-compatible.
          naked();
        },
      }),
      run: naked,
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

  return { database, state };
};

const seedFiveEvents = (now: Date): QueuedSyncEventInput[] => {
  const baseMs = now.getTime();
  return [
    {
      eventId: 'evt-1',
      occurredAt: new Date(baseMs + 1),
      entityType: 'gyms',
      entityId: 'gym-1',
      eventType: 'upsert',
      payload: { id: 'gym-1', name: 'My Gym', created_at_ms: baseMs, updated_at_ms: baseMs },
    },
    {
      eventId: 'evt-2',
      occurredAt: new Date(baseMs + 2),
      entityType: 'sessions',
      entityId: 'session-1',
      eventType: 'upsert',
      payload: {
        id: 'session-1',
        gym_id: 'gym-1',
        status: 'active',
        started_at_ms: baseMs,
        completed_at_ms: null,
        duration_sec: null,
        deleted_at_ms: null,
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: 'evt-3',
      occurredAt: new Date(baseMs + 3),
      entityType: 'session_exercises',
      entityId: 'sx-1',
      eventType: 'upsert',
      payload: {
        id: 'sx-1',
        session_id: 'session-1',
        exercise_definition_id: null,
        order_index: 0,
        name: 'Bench Press',
        machine_name: null,
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: 'evt-4',
      occurredAt: new Date(baseMs + 4),
      entityType: 'exercise_sets',
      entityId: 'set-1',
      eventType: 'upsert',
      payload: {
        id: 'set-1',
        session_exercise_id: 'sx-1',
        order_index: 0,
        weight_value: '100',
        reps_value: '5',
        set_type: 'rir_2',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
    {
      eventId: 'evt-5',
      occurredAt: new Date(baseMs + 5),
      entityType: 'exercise_sets',
      entityId: 'set-2',
      eventType: 'upsert',
      payload: {
        id: 'set-2',
        session_exercise_id: 'sx-1',
        order_index: 1,
        weight_value: '100',
        reps_value: '5',
        set_type: 'rir_2',
        created_at_ms: baseMs,
        updated_at_ms: baseMs,
      },
    },
  ];
};

const seedLocalProjectionFixtures = (state: FakeState, now: Date) => {
  state.gyms.push({
    id: 'gym-1',
    name: 'My Gym',
    createdAt: now,
    updatedAt: now,
  });
  state.sessions.push({
    id: 'session-1',
    gymId: 'gym-1',
    status: 'active',
    startedAt: now,
    completedAt: null,
    durationSec: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  state.sessionExercises.push({
    id: 'sx-1',
    sessionId: 'session-1',
    exerciseDefinitionId: null,
    orderIndex: 0,
    name: 'Bench Press',
    machineName: null,
    createdAt: now,
    updatedAt: now,
  });
  state.exerciseSets.push(
    {
      id: 'set-1',
      sessionExerciseId: 'sx-1',
      orderIndex: 0,
      weightValue: '100',
      repsValue: '5',
      setType: 'rir_2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'set-2',
      sessionExerciseId: 'sx-1',
      orderIndex: 1,
      weightValue: '100',
      repsValue: '5',
      setType: 'rir_2',
      createdAt: now,
      updatedAt: now,
    }
  );
};

const snapshotProjectionTables = (state: FakeState) => ({
  gyms: state.gyms.map(cloneRow),
  sessions: state.sessions.map(cloneRow),
  sessionExercises: state.sessionExercises.map(cloneRow),
  exerciseSets: state.exerciseSets.map(cloneRow),
  exerciseDefinitions: state.exerciseDefinitions.map(cloneRow),
  exerciseMuscleMappings: state.exerciseMuscleMappings.map(cloneRow),
  exerciseTagDefinitions: state.exerciseTagDefinitions.map(cloneRow),
  sessionExerciseTags: state.sessionExerciseTags.map(cloneRow),
  muscleGroups: state.muscleGroups.map(cloneRow),
});

describe('sync flush partial failure preserves local data and replays correctly (T9)', () => {
  beforeEach(() => {
    __resetSyncEngineForTests();
    setSyncIngestTransport(null);
    setSyncNetworkOnline(true);
    mockBootstrapLocalDataLayer.mockReset();
  });

  afterEach(() => {
    setSyncIngestTransport(null);
    setSyncNetworkOnline(true);
    __resetSyncEngineForTests();
  });

  it('preserves local projection tables across a partial-failure flush and replays the unsent suffix on the next attempt', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    const seedNow = new Date('2026-03-07T10:00:00.000Z');

    // (1) Seed local projection fixtures + (2) queue 5 outbox events.
    seedLocalProjectionFixtures(fake.state, seedNow);
    await enqueueSyncEvents(seedFiveEvents(seedNow), { now: seedNow });

    expect(fake.state.syncOutboxEvents.length).toBe(5);
    const projectionBefore = snapshotProjectionTables(fake.state);

    // (3) Mock the transport to return FAILURE error_index=3, should_retry=true.
    //     Per `applySyncIngestResponse` semantics this means events at indices
    //     0,1,2 succeeded (their `eventId`s get deleted) and events at indices
    //     3,4 stay in the outbox to be retried later.
    let transportCalls = 0;
    let firstBatchEventIds: string[] | null = null;
    const transport: SyncIngestTransport = {
      ingestBatch: async (request: SyncIngestRequest): Promise<SyncIngestResponse> => {
        transportCalls += 1;
        firstBatchEventIds = request.events.map((event) => event.event_id);
        return {
          status: 'FAILURE',
          error_index: 3,
          should_retry: true,
          message: 'simulated network failure on event 3',
        };
      },
    };
    setSyncIngestTransport(transport);

    // (4) Run the flush.
    const failureFlushNow = new Date('2026-03-07T10:00:01.000Z');
    const failureResult = await flushSyncOutbox({
      now: failureFlushNow,
      randomSource: () => 0.5,
    });

    expect(failureResult.status).toBe('failure_retry_scheduled');
    expect(transportCalls).toBe(1);
    // Sanity: the first batch covered all 5 queued events.
    expect(firstBatchEventIds).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-4', 'evt-5']);

    // (5) Outbox: events 0-2 ('evt-1', 'evt-2', 'evt-3') are gone; events 3-4
    //     ('evt-4', 'evt-5') remain queued.
    const remainingAfterFailure = await listPendingSyncEvents(500);
    expect(remainingAfterFailure.map((event) => event.eventId)).toEqual(['evt-4', 'evt-5']);

    // (6) Local projection tables: bit-for-bit unchanged. The flush engine
    //     never touches projection rows; if a future refactor accidentally
    //     coupled them this would catch it.
    const projectionAfterFailure = snapshotProjectionTables(fake.state);
    expect(projectionAfterFailure).toEqual(projectionBefore);

    // (7) Switch transport to SUCCESS and (8) flush again. We advance `now`
    //     past the scheduled `nextAttemptAt` so the engine does not return
    //     `backoff`.
    const successTransport: SyncIngestTransport = {
      ingestBatch: async (request: SyncIngestRequest): Promise<SyncIngestResponse> => {
        transportCalls += 1;
        // Sanity: the retry batch contains only the unsent suffix.
        expect(request.events.map((event) => event.event_id)).toEqual(['evt-4', 'evt-5']);
        return { status: 'SUCCESS' };
      },
    };
    setSyncIngestTransport(successTransport);

    const retryNow = new Date('2026-03-07T10:05:00.000Z');
    const retryResult = await flushSyncOutbox({
      now: retryNow,
      randomSource: () => 0.5,
    });

    // (9) Retry succeeded; events 3-4 are removed from the outbox.
    expect(retryResult.status).toBe('success');
    expect(transportCalls).toBe(2);
    const remainingAfterRetry = await listPendingSyncEvents(500);
    expect(remainingAfterRetry.length).toBe(0);

    // (10) Still no local data corruption.
    const projectionAfterRetry = snapshotProjectionTables(fake.state);
    expect(projectionAfterRetry).toEqual(projectionBefore);
  });
});
