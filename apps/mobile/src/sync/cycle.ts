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
import { clearCycleError, markCycleError } from '@/src/sync/cycle-error-signal';
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
 * Applies one pull page's worth of entities under per-row last-write-wins and
 * returns how many rows it actually wrote. For each incoming row: insert it if
 * absent; overwrite every typed column if the incoming monotonic timestamp is
 * strictly newer than the local one; otherwise no-op (the local edit is newer
 * and stays dirty). Applied rows are stamped not dirty with the incoming
 * timestamp.
 *
 * The return value counts ONLY rows whose local state changed (insert or
 * incoming-wins); no-op LWW rows are excluded. This is what lets the convergence
 * loop tell a quiet round from a benign re-pull of rows the device already
 * holds: counting "rows the server returned" would treat a no-op echo (a row
 * the server hands back unchanged, e.g. this device's own just-pushed row, or a
 * row a second device re-stamped to an equal-or-older value) as motion and spin
 * an extra, pointless round. Counting rows actually written makes "nothing
 * changed locally" the exact convergence signal.
 *
 * Runs inside the caller's transaction so the whole page either lands or rolls
 * back together; a per-row insert failure (e.g. an FK violation) aborts the
 * whole page.
 */
export const applyPullPage = (
  tx: Transaction,
  entities: WireEntity[],
  type: EntityTableName,
): number => {
  const table = ENTITY_TABLES[type] as typeof schema.gyms;
  let changed = 0;

  for (const envelope of entities) {
    const existing = tx
      .select({ id: table.id, localUpdatedAtMs: table.localUpdatedAtMs })
      .from(table)
      .where(eq(table.id, envelope.id))
      .get() as { id: string; localUpdatedAtMs: number } | undefined;

    const values = wireToEntity(envelope, type);

    if (!existing) {
      tx.insert(table).values(values as never).run();
      changed += 1;
      continue;
    }

    if (envelope.client_updated_at_ms > existing.localUpdatedAtMs) {
      tx.update(table).set(values as never).where(eq(table.id, envelope.id)).run();
      changed += 1;
    }
    // Otherwise the local row is newer-or-equal: leave it untouched and dirty.
  }

  return changed;
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
 * The two counts a pull leg produces. They differ deliberately and must not be
 * collapsed into one:
 *
 *  - `received`: rows the server returned across the leg (every `entities`
 *    envelope, no-op LWW rows included). This is what the first-sign-in seed
 *    decision keys off — "did the server hold ANYTHING for this user" — so a
 *    resumed bootstrap that re-pulls already-local rows (cursor reset, every row
 *    a no-op) still sees a non-empty pull and does NOT re-seed over the server's
 *    data. See `bootstrapper.ts`.
 *  - `changed`: rows `applyPullPage` actually wrote (insert or incoming-wins).
 *    This is the convergence-quietness signal: a round is quiet only when both
 *    pull legs changed nothing locally. Using `received` here would count a
 *    benign no-op echo as motion and spin a pointless extra round.
 */
export interface PullLegResult {
  received: number;
  changed: number;
}

/**
 * Drains every topological layer once, applying each page and advancing that
 * layer's cursor after the page commits. Returns both the rows received and the
 * rows actually changed across all layers (see {@link PullLegResult}). When a
 * reporter is passed, emits a page event per applied page and a layer event per
 * drained layer so a first-sync caller can surface advancing progress.
 */
const runPullLeg = async (
  database: LocalDatabase,
  reporter?: PullProgressReporter,
): Promise<PullLegResult> => {
  let receivedTotal = 0;
  let changedTotal = 0;

  for (let layer = 0; layer < TOPO_LAYERS.length; layer += 1) {
    const layerTypes = TOPO_LAYERS[layer] as readonly EntityTableName[];

    for (;;) {
      const cursor = database.transaction(
        (tx) => readCursorMap(tx as Transaction)[String(layer)] ?? null,
      );
      const page = await callSyncPull(layer, cursor);

      // Apply the page and advance the cursor in one transaction: the cursor
      // only moves past rows that actually committed locally. The transaction
      // returns the count of rows actually written so a no-op page does not
      // count toward convergence motion.
      const pageChanged = database.transaction((tx) => {
        const transaction = tx as Transaction;
        let changed = 0;
        for (const type of layerTypes) {
          const forType = page.entities.filter((entity) => entity.type === type);
          if (forType.length > 0) {
            changed += applyPullPage(transaction, forType, type);
          }
        }
        writeCursorEntry(transaction, layer, page.next_cursor);
        return changed;
      });

      receivedTotal += page.entities.length;
      changedTotal += pageChanged;
      // Progress reflects rows the server delivered (received), matching what a
      // first-sync watcher expects to see advance as the snapshot streams in.
      reporter?.onPage?.(page.entities.length);

      if (!page.has_more) {
        break;
      }
    }

    reporter?.onLayerDrained?.(layer + 1);
  }

  return { received: receivedTotal, changed: changedTotal };
};

/**
 * Drains all four topological layers once, reporting per-page and per-layer
 * progress. This is the first full pull the bootstrapper runs before deciding
 * whether to seed: its return value is the total rows RECEIVED across every
 * layer (tombstones included, since a tombstone is a normal returned row). The
 * seed decision must use received — not rows-changed — so a resumed bootstrap
 * that re-pulls already-local rows (all no-ops) does not look empty and re-seed.
 */
export const runFirstFullPull = async (
  database: LocalDatabase,
  reporter?: PullProgressReporter,
): Promise<number> => (await runPullLeg(database, reporter)).received;

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
 * The single, explicit outcome of one cycle call. Every non-converged path —
 * including an unexpected throw from the bootstrapper/seed/pull/push — is
 * classified into exactly one of these, so the two surfaces that react to a
 * cycle (the first-sync gate and the scheduler/`sync-status`) derive their view
 * from the same value and can never disagree:
 *
 *  - 'converged': the cycle reached a quiet round talking to the server with a
 *    valid session. This is the only outcome that counts as real progress for
 *    the scheduler's last-success time.
 *  - 'auth-required': the server reported no signed-in user. A route signal, not
 *    an in-gate error: the gate sends the user to sign-in and shows no Retry.
 *  - 'fk-violation': a structural FK mismatch the cycle could not push past. Not
 *    retriable by a plain re-run, but still surfaced as an error + Retry in the
 *    gate so the user is never trapped behind a silent block.
 *  - 'internal': a recoverable server-internal / transport failure, OR any
 *    unexpected throw escaping the cycle body. Retriable: dirty bits and cursors
 *    are left untouched so the next tick re-runs the same state.
 */
export type SyncCycleOutcome = 'converged' | 'auth-required' | 'fk-violation' | 'internal';

/**
 * Runs one convergence cycle: pull every layer, push the dirty stream, then
 * pull again, repeating until a full round changes nothing locally in either
 * direction. There is no round cap: the loop is bounded by convergence itself
 * (and, per leg, by each RPC's own request timeout), so it keeps draining as
 * long as there is real work — a second device's live edit stream is followed,
 * not truncated, and a locally re-edited row keeps re-pushing its latest value.
 * The exit test counts rows ACTUALLY changed, not rows the server returned, so a
 * benign no-op re-pull (an echo of an already-local row) reads as quiet instead
 * of forcing a wasted extra round.
 *
 * It never throws: every outcome — convergence, the recoverable no-JWT /
 * server-internal envelopes, a structural FK violation, AND any unexpected throw
 * from the bootstrapper/seed/pull/push (a Drizzle/SQLite write failure, a seed
 * verification error, a malformed-payload `new Date(NaN)`, a missing Supabase
 * client) — is classified into a single {@link SyncCycleOutcome} and returned.
 * It also raises the matching observable signal (the auth-required flag or the
 * non-auth error code) before returning, so the gate and the scheduler read one
 * consistent view of the same cycle. On any non-converged outcome the dirty bits
 * and cursors are left untouched, so the next scheduled tick re-runs cleanly.
 */
export const runSyncCycle = async (): Promise<SyncCycleOutcome> => {
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

    // Convergence-or-bust: PULL -> PUSH -> PULL until a full round changes
    // nothing locally on either end. No round cap — the loop's only exits are a
    // quiet round (below) or a throw caught at the bottom. A quiet round means
    // both pull legs WROTE nothing (not merely "the server returned nothing" —
    // a no-op echo of an already-local row is not motion) and the push leg sent
    // nothing. Anything else is real work the next round must follow.
    for (;;) {
      const pulledBefore = await runPullLeg(database);
      const pushed = await runPushLeg(database);
      const pulledAfter = await runPullLeg(database);

      if (pulledBefore.changed === 0 && pushed === 0 && pulledAfter.changed === 0) {
        return markConverged();
      }
    }
  } catch (error) {
    return classifyThrow(error);
  }
};

/**
 * Records a converged cycle and returns the matching outcome. A cycle that
 * converged talked to the server with a valid session, so any earlier "no
 * signed-in user" condition is resolved: clear the auth flag so the route layer
 * no longer holds the user on sign-in, and clear any prior failure code so a
 * watching gate stops showing an error.
 */
const markConverged = (): SyncCycleOutcome => {
  clearAuthRequired();
  clearCycleError();
  return 'converged';
};

/**
 * Classifies a throw escaping the cycle body into a single outcome and raises
 * the matching observable signal. A recognised {@link SyncCycleError} maps to
 * its code; ANY other throw — a Drizzle/SQLite write failure, the seed
 * verification error, a malformed-payload `new Date(NaN)`, a missing Supabase
 * client — is treated as a recoverable INTERNAL failure rather than escaping
 * unclassified. Letting such a throw escape was the bug that left the first-sync
 * gate spinning forever with no error and no Retry: the bootstrap flag was never
 * set AND no error code was ever recorded, so the gate fell through to
 * in-progress with nothing to lift it.
 */
const classifyThrow = (error: unknown): SyncCycleOutcome => {
  if (error instanceof SyncCycleError && error.code === 'AUTH_REQUIRED') {
    // The server reports no signed-in user. This is not an error to surface — it
    // is the route signal that the app needs a session. Raise the observable flag
    // so the route layer sends the user to sign-in (dirty bits and cursors are
    // untouched, so a post-login cycle re-pushes and re-pulls the same state). It
    // is a route decision, not an in-gate error, so the failure code stays clear.
    markAuthRequired();
    clearCycleError();
    return 'auth-required';
  }

  if (error instanceof SyncCycleError && error.code === 'FK_VIOLATION') {
    // Structural bug: a plain re-run will not push past it. Dirty bits and
    // cursors are left untouched so nothing is silently dropped. Record the code
    // so a watching gate shows the error and a single Retry rather than trapping
    // the user behind a silent block.
    markCycleError('FK_VIOLATION');
    return 'fk-violation';
  }

  // A recognised server-internal hiccup OR any other unexpected throw: give up
  // this cycle cleanly as a retriable INTERNAL failure. Dirty bits stay set and
  // cursors are unchanged, so the next scheduled tick starts a fresh cycle that
  // re-pushes and re-pulls the same state. Record the code so a watching gate
  // shows the error and a single Retry.
  markCycleError('INTERNAL');
  return 'internal';
};
