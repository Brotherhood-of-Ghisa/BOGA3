// Client sync cycle: converges local SQLite state with the server by issuing
// PULL -> PUSH -> PULL until both ends are quiet for one full round.
//
// The cycle keeps no surviving in-memory state between invocations: every call
// reconstructs what it needs from SQLite (the per-row dirty bit, the per-layer
// pull cursors). Re-running from the same starting state produces the same
// final state, so an interrupted cycle is safe to retry on the next tick.
//
// Push leg: collect dirty rows in FK-safe topological order (parents before
// children), POST a batch, and on a successful ack clear the dirty bit only on
// rows that were not edited again while the request was in flight. Pull leg:
// drain each topological layer in order so a child page never lands before its
// parents are local, applying each page under last-write-wins (LWW) keyed on a
// client-monotonic timestamp.
//
// The wire envelope carries the typed entity columns under "fields"; the two
// local-only bookkeeping columns (the dirty bit and the monotonic timestamp)
// never cross the wire.

import { and, asc, eq } from 'drizzle-orm';

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { clearAuthRequired, markAuthRequired } from '@/src/sync/auth-required-signal';
import { runBootstrapper } from '@/src/sync/bootstrapper';
import { runBundleMigrations } from '@/src/data/bundle-migrations';
import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import * as schema from '@/src/data/schema';
import { syncRuntimeState } from '@/src/data/schema';
import { TOPO_LAYERS, type EntityTableName } from '@/src/sync/topo-order';

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

/** Maximum rows in a single push batch and a single pull page. */
export const BATCH_CAP = 200;

/**
 * Hard ceiling on PULL -> PUSH -> PULL rounds per cycle call. Convergence
 * normally settles in one or two rounds; this guard stops a pathological spin
 * if two devices' clock skew causes LWW to thrash back and forth.
 */
export const MAX_CYCLES_PER_CALL = 5;

const SYNC_PUSH_RPC = 'sync_push';
const SYNC_PULL_RPC = 'sync_pull';

/**
 * The Postgres schema the sync RPCs live in. PostgREST exposes them under this
 * schema, not the default `public`, so the client must select it before
 * dispatching — a plain `.rpc(...)` on the default schema cannot find the
 * function and fails with a "could not find function public.sync_*" error.
 */
const SYNC_RPC_SCHEMA = 'app_public';

// -----------------------------------------------------------------------------
// Wire types
// -----------------------------------------------------------------------------

/** A JSON-primitive value as it appears in the wire "fields" object. */
export type WireValue = string | number | boolean | null;

/** The wire "fields" payload: typed entity columns keyed by snake_case name. */
export type WireFields = Record<string, WireValue>;

/** The shared push/pull envelope (one row crossing the wire). */
export interface WireEntity {
  type: EntityTableName;
  id: string;
  client_updated_at_ms: number;
  fields: WireFields;
}

/** An opaque per-layer pull cursor; round-tripped to the server verbatim. */
export type PullCursor = {
  server_received_at: string;
  owner_user_id: string;
  type: string;
  id: string;
} | null;

/** The JSON object stored in sync_runtime_state.pull_cursor, keyed by layer. */
export type PullCursorMap = Record<string, PullCursor>;

interface PullResponse {
  entities: WireEntity[];
  next_cursor: PullCursor;
  has_more: boolean;
}

/** Structured error envelope a successful-status RPC body can carry. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

// -----------------------------------------------------------------------------
// Error classification
// -----------------------------------------------------------------------------

export type SyncErrorCode = 'AUTH_REQUIRED' | 'FK_VIOLATION' | 'INTERNAL';

export class SyncCycleError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'SyncCycleError';
    this.code = code;
  }
}

/**
 * Maps a server response into a sync error code, or null when the response is a
 * clean success. The two server RPCs surface failures differently and both
 * shapes are handled here:
 *
 *  - One RPC raises a database exception whose message string is prefixed with
 *    the token ("FK_VIOLATION: ...", "AUTH_REQUIRED: ...", "INTERNAL: ...").
 *    The Supabase client surfaces this as a transport error object whose
 *    message carries the token.
 *  - The other RPC returns a normal success body carrying
 *    { error: { code, message } } for the same conditions.
 *
 * Transport/network failures with no recognisable token collapse to INTERNAL.
 */
export const classifyRpcResult = (
  rpcError: { message?: string } | null,
  data: unknown,
): SyncErrorCode | null => {
  if (rpcError) {
    const message = rpcError.message ?? '';
    if (message.includes('AUTH_REQUIRED')) {
      return 'AUTH_REQUIRED';
    }
    if (message.includes('FK_VIOLATION')) {
      return 'FK_VIOLATION';
    }
    return 'INTERNAL';
  }

  const envelope = (data ?? null) as ErrorEnvelope | null;
  const code = envelope?.error?.code;
  if (code === 'AUTH_REQUIRED') {
    return 'AUTH_REQUIRED';
  }
  if (code === 'FK_VIOLATION') {
    return 'FK_VIOLATION';
  }
  if (code) {
    return 'INTERNAL';
  }

  return null;
};

// -----------------------------------------------------------------------------
// Per-entity field maps (the typed-column mapping, as built by the server)
// -----------------------------------------------------------------------------

/**
 * Describes one typed server column on an entity. "kind" controls the value
 * conversion between the SQLite/Drizzle row and the wire "fields" object:
 *
 *  - 'scalar': pass through (string / number / boolean / null).
 *  - 'timestamp': the Drizzle column stores epoch ms as a Date, so the row
 *    value is a Date (or null) and the wire value is an epoch-ms integer (or
 *    null).
 */
interface FieldSpec {
  /** snake_case wire / server column name. */
  wireKey: string;
  /** camelCase Drizzle property name on the row object. */
  prop: string;
  kind: 'scalar' | 'timestamp';
}

const TS = (wireKey: string, prop: string): FieldSpec => ({ wireKey, prop, kind: 'timestamp' });
const SC = (wireKey: string, prop: string): FieldSpec => ({ wireKey, prop, kind: 'scalar' });

/**
 * For each entity, the ordered list of typed columns that appear in the wire
 * "fields" object. These mirror the server's push / pull projections exactly.
 * The two local-only bookkeeping columns are deliberately absent so they never
 * cross the wire. deleted_at is a normal LWW column and is emitted like any
 * other.
 */
const ENTITY_FIELDS: Record<EntityTableName, FieldSpec[]> = {
  gyms: [
    SC('name', 'name'),
    SC('latitude', 'latitude'),
    SC('longitude', 'longitude'),
    SC('coordinate_accuracy_m', 'coordinateAccuracyM'),
    TS('coordinates_updated_at', 'coordinatesUpdatedAt'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  exercise_definitions: [
    SC('name', 'name'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  exercise_tag_definitions: [
    SC('exercise_definition_id', 'exerciseDefinitionId'),
    SC('name', 'name'),
    SC('normalized_name', 'normalizedName'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  sessions: [
    SC('gym_id', 'gymId'),
    SC('status', 'status'),
    TS('started_at', 'startedAt'),
    TS('completed_at', 'completedAt'),
    SC('duration_sec', 'durationSec'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  exercise_muscle_mappings: [
    SC('exercise_definition_id', 'exerciseDefinitionId'),
    SC('muscle_group_id', 'muscleGroupId'),
    SC('weight', 'weight'),
    SC('role', 'role'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  session_exercises: [
    SC('session_id', 'sessionId'),
    SC('exercise_definition_id', 'exerciseDefinitionId'),
    SC('order_index', 'orderIndex'),
    SC('name', 'name'),
    SC('machine_name', 'machineName'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  exercise_sets: [
    SC('session_exercise_id', 'sessionExerciseId'),
    SC('order_index', 'orderIndex'),
    SC('weight_value', 'weightValue'),
    SC('reps_value', 'repsValue'),
    SC('set_type', 'setType'),
    TS('created_at', 'createdAt'),
    TS('updated_at', 'updatedAt'),
    TS('deleted_at', 'deletedAt'),
  ],
  session_exercise_tags: [
    SC('session_exercise_id', 'sessionExerciseId'),
    SC('exercise_tag_definition_id', 'exerciseTagDefinitionId'),
    TS('created_at', 'createdAt'),
    TS('deleted_at', 'deletedAt'),
  ],
};

/** The Drizzle table object for each entity type. */
const ENTITY_TABLES: Record<EntityTableName, (typeof schema)[keyof typeof schema]> = {
  gyms: schema.gyms,
  exercise_definitions: schema.exerciseDefinitions,
  exercise_tag_definitions: schema.exerciseTagDefinitions,
  sessions: schema.sessions,
  exercise_muscle_mappings: schema.exerciseMuscleMappings,
  session_exercises: schema.sessionExercises,
  exercise_sets: schema.exerciseSets,
  session_exercise_tags: schema.sessionExerciseTags,
};

/** Every entity type in fixed topological order (parents before children). */
const ENTITY_ORDER: EntityTableName[] = TOPO_LAYERS.flatMap(
  (layer) => layer as readonly EntityTableName[],
);

// -----------------------------------------------------------------------------
// Wire serialisation
// -----------------------------------------------------------------------------

/** A loosely-typed entity row as read from / written to Drizzle. */
type EntityRow = Record<string, unknown>;

const toWireValue = (value: unknown, kind: FieldSpec['kind']): WireValue => {
  if (value === null || value === undefined) {
    return null;
  }
  if (kind === 'timestamp') {
    // The epoch-ms column hands back a Date; emit the epoch-ms integer.
    if (value instanceof Date) {
      return value.getTime();
    }
    return typeof value === 'number' ? value : Number(value);
  }
  return value as WireValue;
};

const fromWireValue = (value: WireValue, kind: FieldSpec['kind']): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (kind === 'timestamp') {
    // The wire carries epoch ms; the epoch-ms column wants a Date.
    return new Date(typeof value === 'number' ? value : Number(value));
  }
  return value;
};

/**
 * Serialises a local entity row into the shared wire envelope. Emits every
 * typed server column under "fields" (including deleted_at, which is a normal
 * LWW column); never emits the two local-only bookkeeping columns. The wire
 * envelope's LWW key is the row's monotonic local timestamp.
 */
export const entityToWire = (row: EntityRow, type: EntityTableName): WireEntity => {
  const fields: WireFields = {};
  for (const spec of ENTITY_FIELDS[type]) {
    fields[spec.wireKey] = toWireValue(row[spec.prop], spec.kind);
  }
  return {
    type,
    id: String(row.id),
    client_updated_at_ms: Number(row.localUpdatedAtMs ?? 0),
    fields,
  };
};

/**
 * Builds the column values for inserting / updating a row from an incoming wire
 * envelope. Sets the two local bookkeeping columns to the "server holds this
 * row" state: not dirty, and stamped with the incoming monotonic timestamp.
 */
export const wireToEntity = (envelope: WireEntity, type: EntityTableName): EntityRow => {
  const values: EntityRow = {
    id: envelope.id,
    localDirty: false,
    localUpdatedAtMs: envelope.client_updated_at_ms,
  };
  for (const spec of ENTITY_FIELDS[type]) {
    values[spec.prop] = fromWireValue(envelope.fields[spec.wireKey] ?? null, spec.kind);
  }
  return values;
};

// -----------------------------------------------------------------------------
// Push batch selection
// -----------------------------------------------------------------------------

/**
 * Collects up to batchCap dirty rows, walking entity tables in topological
 * order (parents before children) so the batch never contains a child whose
 * parent is neither clean-on-server nor in the same batch. Within a table,
 * oldest-dirty rows come first (FIFO by monotonic timestamp) so the dirty queue
 * drains without starving the oldest entry. Stops as soon as the cap is hit.
 * Returns the serialised wire envelopes; an empty array means the dirty stream
 * is exhausted.
 */
export const selectPushBatch = (tx: Transaction, batchCap: number): WireEntity[] => {
  const batch: WireEntity[] = [];

  for (const type of ENTITY_ORDER) {
    if (batch.length >= batchCap) {
      break;
    }
    const remaining = batchCap - batch.length;
    const table = ENTITY_TABLES[type] as typeof schema.gyms;
    const rows = tx
      .select()
      .from(table)
      .where(eq(table.localDirty, true))
      .orderBy(asc(table.localUpdatedAtMs))
      .limit(remaining)
      .all() as EntityRow[];

    for (const row of rows) {
      batch.push(entityToWire(row, type));
    }
  }

  return batch;
};

// -----------------------------------------------------------------------------
// Pull page apply
// -----------------------------------------------------------------------------

/**
 * Applies one pull page's worth of entities under per-row last-write-wins. For
 * each incoming row: insert it if absent; overwrite every typed column if the
 * incoming monotonic timestamp is strictly newer than the local one; otherwise
 * no-op (the local edit is newer and stays dirty). Applied rows are stamped not
 * dirty with the incoming timestamp.
 *
 * Runs inside the caller's transaction so the whole page either lands or rolls
 * back together; a per-row insert failure (e.g. an FK violation) aborts the
 * whole page.
 */
export const applyPullPage = (
  tx: Transaction,
  entities: WireEntity[],
  type: EntityTableName,
): void => {
  const table = ENTITY_TABLES[type] as typeof schema.gyms;

  for (const envelope of entities) {
    const existing = tx
      .select({ id: table.id, localUpdatedAtMs: table.localUpdatedAtMs })
      .from(table)
      .where(eq(table.id, envelope.id))
      .get() as { id: string; localUpdatedAtMs: number } | undefined;

    const values = wireToEntity(envelope, type);

    if (!existing) {
      tx.insert(table).values(values as never).run();
      continue;
    }

    if (envelope.client_updated_at_ms > existing.localUpdatedAtMs) {
      tx.update(table).set(values as never).where(eq(table.id, envelope.id)).run();
    }
    // Otherwise the local row is newer-or-equal: leave it untouched and dirty.
  }
};

// -----------------------------------------------------------------------------
// Pull cursor persistence
// -----------------------------------------------------------------------------

const readCursorMap = (tx: Transaction): PullCursorMap => {
  const row = tx
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();

  const raw = row?.pullCursor;
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as PullCursorMap;
    } catch {
      return {};
    }
  }
  return raw as PullCursorMap;
};

const writeCursorEntry = (tx: Transaction, layer: number, cursor: PullCursor): void => {
  const map = readCursorMap(tx);
  map[String(layer)] = cursor;
  tx.insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: map as never })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { pullCursor: map as never },
    })
    .run();
};

// -----------------------------------------------------------------------------
// RPC plumbing
// -----------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { message?: string } | null };

/**
 * Posts a push batch. The named "entities" parameter maps the wire body
 * { entities: [...] } straight onto the RPC argument. Throws SyncCycleError on
 * any recognised failure so the caller can branch per error code.
 */
const callSyncPush = async (entities: WireEntity[]): Promise<void> => {
  const client = getRequiredSupabaseMobileClient();
  const { data, error } = (await client
    .schema(SYNC_RPC_SCHEMA)
    .rpc(SYNC_PUSH_RPC, { entities })) as RpcResult;
  const code = classifyRpcResult(error, data);
  if (code) {
    throw new SyncCycleError(code, error?.message ?? `sync push failed: ${code}`);
  }
};

/**
 * Posts one pull request for a layer/cursor. The RPC takes a single unnamed
 * argument, so the whole body is the argument value. Throws SyncCycleError on a
 * recognised failure; otherwise returns the typed page.
 */
const callSyncPull = async (layer: number, cursor: PullCursor): Promise<PullResponse> => {
  const client = getRequiredSupabaseMobileClient();
  const { data, error } = (await client.schema(SYNC_RPC_SCHEMA).rpc(SYNC_PULL_RPC, {
    layer,
    cursor,
    limit: BATCH_CAP,
  })) as RpcResult;

  const code = classifyRpcResult(error, data);
  if (code) {
    throw new SyncCycleError(code, error?.message ?? `sync pull failed: ${code}`);
  }

  const page = (data ?? {}) as Partial<PullResponse>;
  return {
    entities: page.entities ?? [],
    next_cursor: page.next_cursor ?? null,
    has_more: page.has_more ?? false,
  };
};

// -----------------------------------------------------------------------------
// Cycle legs
// -----------------------------------------------------------------------------

/**
 * Reports progress as the pull leg crosses observable boundaries. `onPage` fires
 * after each applied page with how many rows that page carried; `onLayerDrained`
 * fires once a layer has drained to `has_more = false`, with the 1-based count of
 * layers completed so far. Both are optional so the converged-state cycle can run
 * the same leg without instrumentation.
 */
export interface PullProgressReporter {
  onPage?: (rowsApplied: number) => void;
  onLayerDrained?: (layersCompleted: number) => void;
}

/**
 * Drains every topological layer once, applying each page and advancing that
 * layer's cursor after the page commits. Returns the number of entities applied
 * across all layers so the cycle can tell whether the pull leg was quiet. When a
 * reporter is passed, emits a page event per applied page and a layer event per
 * drained layer so a first-sync caller can surface advancing progress.
 */
const runPullLeg = async (
  database: LocalDatabase,
  reporter?: PullProgressReporter,
): Promise<number> => {
  let appliedTotal = 0;

  for (let layer = 0; layer < TOPO_LAYERS.length; layer += 1) {
    const layerTypes = TOPO_LAYERS[layer] as readonly EntityTableName[];

    for (;;) {
      const cursor = database.transaction(
        (tx) => readCursorMap(tx as Transaction)[String(layer)] ?? null,
      );
      const page = await callSyncPull(layer, cursor);

      // Apply the page and advance the cursor in one transaction: the cursor
      // only moves past rows that actually committed locally.
      database.transaction((tx) => {
        const transaction = tx as Transaction;
        for (const type of layerTypes) {
          const forType = page.entities.filter((entity) => entity.type === type);
          if (forType.length > 0) {
            applyPullPage(transaction, forType, type);
          }
        }
        writeCursorEntry(transaction, layer, page.next_cursor);
      });

      appliedTotal += page.entities.length;
      reporter?.onPage?.(page.entities.length);

      if (!page.has_more) {
        break;
      }
    }

    reporter?.onLayerDrained?.(layer + 1);
  }

  return appliedTotal;
};

/**
 * Drains all four topological layers once, reporting per-page and per-layer
 * progress. This is the first full pull the bootstrapper runs before deciding
 * whether to seed: its return value is the total rows applied across every layer
 * (tombstones included, since a tombstone is a normal applied row).
 */
export const runFirstFullPull = (
  database: LocalDatabase,
  reporter?: PullProgressReporter,
): Promise<number> => runPullLeg(database, reporter);

/** Stable map key for a row's identity across the in-flight push window. */
const rowKey = (type: EntityTableName, id: string): string => `${type} ${id}`;

/**
 * Drains the dirty stream: repeatedly select a batch, push it, and on the
 * success ack clear the dirty bit on each row that has not been edited again
 * since it was serialised. Returns the number of rows pushed so the cycle can
 * tell whether the push leg was quiet.
 */
const runPushLeg = async (database: LocalDatabase): Promise<number> => {
  let pushedTotal = 0;

  // Rows this drain has already sent at least once. A row stays dirty after its
  // ack when it was edited again while the request was in flight (the
  // push-in-flight race): its current timestamp no longer matches the one we
  // sent, so the ack skips it. If we re-selected such a row in the same drain we
  // would push it forever, since each push can race with another edit. Instead
  // the drain stops once a batch makes no forward progress (every row in it has
  // already been sent this drain) and the newer value re-pushes on the next
  // convergence round.
  const attempted = new Set<string>();

  for (;;) {
    // Snapshot the batch and the per-row sent timestamps in one read. The map
    // captures the monotonic timestamp at serialise time so the ack handler can
    // detect a concurrent edit that landed while the request was in flight.
    const { batch, sentAt } = database.transaction((tx) => {
      const selected = selectPushBatch(tx as Transaction, BATCH_CAP);
      const stamps = new Map<string, number>();
      for (const entity of selected) {
        stamps.set(rowKey(entity.type, entity.id), entity.client_updated_at_ms);
      }
      return { batch: selected, sentAt: stamps };
    });

    if (batch.length === 0) {
      break;
    }

    // Forward-progress guard: if no row in this batch is new to the drain, the
    // dirty stream is not shrinking (every remaining row lost its ack to a
    // concurrent edit). Stop and let the next convergence round re-push them.
    const hasNewRow = batch.some((entity) => !attempted.has(rowKey(entity.type, entity.id)));
    if (!hasNewRow) {
      break;
    }
    for (const entity of batch) {
      attempted.add(rowKey(entity.type, entity.id));
    }

    await callSyncPush(batch);

    // Clear the dirty bit one row at a time, each in its own transaction, so a
    // concurrent local edit on a different row is never clobbered and a row
    // edited again since serialise time keeps its dirty bit set.
    for (const entity of batch) {
      const expected = sentAt.get(rowKey(entity.type, entity.id));
      if (expected === undefined) {
        continue;
      }
      database.transaction((tx) => {
        const transaction = tx as Transaction;
        const table = ENTITY_TABLES[entity.type] as typeof schema.gyms;
        const current = transaction
          .select({ localUpdatedAtMs: table.localUpdatedAtMs })
          .from(table)
          .where(eq(table.id, entity.id))
          .get() as { localUpdatedAtMs: number } | undefined;

        if (current && current.localUpdatedAtMs === expected) {
          transaction
            .update(table)
            .set({ localDirty: false } as never)
            .where(and(eq(table.id, entity.id), eq(table.localUpdatedAtMs, expected)))
            .run();
        }
      });
    }

    pushedTotal += batch.length;
  }

  return pushedTotal;
};

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Runs one convergence cycle: pull every layer, push the dirty stream, then
 * pull again, repeating until a full round moves nothing in either direction
 * (or the round guard trips). Returns cleanly when converged or when a
 * recoverable error envelope (no JWT / server-internal) is seen, leaving dirty
 * bits set for a later retry. Throws only on a non-retriable structural FK
 * violation.
 */
export const runSyncCycle = async (): Promise<void> => {
  const database = await bootstrapLocalDataLayer();

  try {
    // First-sign-in bootstrap: seed the starter catalog iff the server holds
    // nothing for this user, then mark the first cycle as drained. A no-op once
    // it has completed for this device-account. Runs before the convergence
    // loop so a fresh account has its seeded rows ready to push in the same call.
    await runBootstrapper(database);

    // Apply any pending catalog-bundle migrations, then bring the applied-
    // generation marker up to the current generation. Runs after the
    // bootstrapper on every cycle — whether it seeded a fresh account or no-op'd
    // on a returning one — so a later bundle change reaches already-seeded
    // devices. Migrated rows go dirty and push in the same call below; a no-op
    // (no pending migration) only advances the marker.
    runBundleMigrations(database);

    for (let round = 0; round < MAX_CYCLES_PER_CALL; round += 1) {
      const pulledBefore = await runPullLeg(database);
      const pushed = await runPushLeg(database);
      const pulledAfter = await runPullLeg(database);

      // A round that moved no rows on either end means both sides are quiet.
      if (pulledBefore === 0 && pushed === 0 && pulledAfter === 0) {
        // A cycle that converged talked to the server with a valid session, so
        // any earlier "no signed-in user" condition is resolved. Clear the flag
        // so the route layer no longer holds the user on the sign-in screen.
        clearAuthRequired();
        return;
      }
    }
    // Reaching the round cap without a quiet round still means the cycle made
    // authenticated progress; treat it as a resolved auth condition.
    clearAuthRequired();
  } catch (error) {
    if (error instanceof SyncCycleError) {
      if (error.code === 'FK_VIOLATION') {
        // Structural bug: not retriable, surfaces to the caller. Dirty bits and
        // cursors are left untouched so nothing is silently dropped.
        throw error;
      }
      if (error.code === 'AUTH_REQUIRED') {
        // The server reports no signed-in user. This is not an exception to
        // surface — it is the route signal that the app needs a session. Raise
        // the observable flag so the route layer sends the user to sign-in, then
        // give up this cycle cleanly (dirty bits and cursors are untouched, so a
        // post-login cycle re-pushes and re-pulls the same state).
        markAuthRequired();
        return;
      }
      // A server-internal hiccup: give up this cycle cleanly. Dirty bits stay
      // set and cursors are unchanged, so the next scheduled tick starts a fresh
      // cycle that re-pushes and re-pulls the same state.
      return;
    }
    throw error;
  }
};
