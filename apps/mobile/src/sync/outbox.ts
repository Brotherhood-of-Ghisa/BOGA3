import { asc, eq, inArray } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { syncDeliveryState, syncOutboxEvents } from '@/src/data/schema';

import { assertSyncEntityEventType, type SyncEntityType, type SyncEventType, type SyncIngestResponse } from './types';

export const SYNC_BATCH_MAX_SIZE = 100;
export const SYNC_BACKOFF_INITIAL_DELAY_MS = 2_000;
export const SYNC_BACKOFF_MULTIPLIER = 2;
export const SYNC_BACKOFF_MAX_DELAY_MS = 2 * 60_000;
export const SYNC_BACKOFF_JITTER_RATIO = 0.25;

const PRIMARY_DELIVERY_STATE_ID = 'primary';

type DeliveryStateWriteTx = Pick<LocalDatabase, 'delete' | 'insert' | 'select' | 'update'>;

export type QueuedSyncEventInput = {
  eventId?: string;
  occurredAt?: Date;
  entityType: SyncEntityType;
  entityId: string;
  eventType: SyncEventType;
  payload: Record<string, unknown>;
  schemaVersion?: number;
  traceId?: string | null;
};

export type PendingSyncEvent = {
  eventId: string;
  sequenceInDevice: number;
  occurredAt: Date;
  entityType: SyncEntityType;
  entityId: string;
  eventType: SyncEventType;
  payload: Record<string, unknown>;
  schemaVersion: number;
  traceId: string | null;
};

export type SyncDeliveryStateSnapshot = {
  id: string;
  deviceId: string;
  nextSequenceInDevice: number;
  consecutiveFailures: number;
  retryBlocked: boolean;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
};

type ApplyResponseResult =
  | { status: 'success'; removedCount: number }
  | { status: 'failure_retry_scheduled'; removedCount: number; nextAttemptAt: Date }
  | { status: 'failure_blocked'; removedCount: number };

type RandomSource = () => number;

const nowDate = () => new Date();

const isValidDate = (value: Date) => value instanceof Date && !Number.isNaN(value.getTime());

const requireValidDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const normalizeEntityId = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('sync event entityId is required');
  }
  return normalized;
};

const createPseudoUuid = (prefix: string) => {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  const value = template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const next = char === 'x' ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
  return `${prefix}-${value}`;
};

const parsePayload = (payloadJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const mapOutboxRow = (row: typeof syncOutboxEvents.$inferSelect): PendingSyncEvent => ({
  eventId: row.eventId,
  sequenceInDevice: row.sequenceInDevice,
  occurredAt: row.occurredAt,
  entityType: row.entityType,
  entityId: row.entityId,
  eventType: row.eventType,
  payload: parsePayload(row.payloadJson),
  schemaVersion: row.schemaVersion,
  traceId: row.traceId ?? null,
});

const mapDeliveryStateRow = (row: typeof syncDeliveryState.$inferSelect): SyncDeliveryStateSnapshot => ({
  id: row.id,
  deviceId: row.deviceId,
  nextSequenceInDevice: row.nextSequenceInDevice,
  consecutiveFailures: row.consecutiveFailures,
  retryBlocked: row.retryBlocked === 1,
  nextAttemptAt: row.nextAttemptAt ?? null,
  lastAttemptAt: row.lastAttemptAt ?? null,
  lastSuccessAt: row.lastSuccessAt ?? null,
  lastErrorMessage: row.lastErrorMessage ?? null,
  updatedAt: row.updatedAt,
});

const ensureDeliveryStateTx = (tx: DeliveryStateWriteTx, now: Date): SyncDeliveryStateSnapshot => {
  const existing = tx.select().from(syncDeliveryState).where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID)).get();
  if (existing) {
    return mapDeliveryStateRow(existing);
  }

  const created: typeof syncDeliveryState.$inferInsert = {
    id: PRIMARY_DELIVERY_STATE_ID,
    deviceId: createPseudoUuid('device'),
    nextSequenceInDevice: 1,
    consecutiveFailures: 0,
    retryBlocked: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorMessage: null,
    updatedAt: now,
  };
  tx.insert(syncDeliveryState).values(created).run();
  return {
    id: created.id,
    deviceId: created.deviceId,
    nextSequenceInDevice: 1,
    consecutiveFailures: 0,
    retryBlocked: false,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorMessage: null,
    updatedAt: now,
  };
};

export const calculateBackoffDelayMs = (attempt: number, randomSource: RandomSource = Math.random) => {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const unjittered = Math.min(
    SYNC_BACKOFF_MAX_DELAY_MS,
    SYNC_BACKOFF_INITIAL_DELAY_MS * Math.pow(SYNC_BACKOFF_MULTIPLIER, normalizedAttempt - 1)
  );
  const jitterFactor = 1 + (randomSource() * 2 - 1) * SYNC_BACKOFF_JITTER_RATIO;
  return Math.max(0, Math.round(unjittered * jitterFactor));
};

export const enqueueSyncEventsTx = (
  tx: DeliveryStateWriteTx,
  events: QueuedSyncEventInput[],
  options: {
    now?: Date;
  } = {}
): PendingSyncEvent[] => {
  if (events.length === 0) {
    return [];
  }

  const now = options.now ?? nowDate();
  requireValidDate(now, 'now');

  const deliveryState = ensureDeliveryStateTx(tx, now);
  let nextSequence = deliveryState.nextSequenceInDevice;

  const persisted: PendingSyncEvent[] = [];

  for (const event of events) {
    assertSyncEntityEventType(event.entityType, event.eventType);
    const entityId = normalizeEntityId(event.entityId);
    const occurredAt = event.occurredAt ?? now;
    requireValidDate(occurredAt, 'occurredAt');

    const payloadJson = JSON.stringify(event.payload ?? {});
    const eventId = event.eventId?.trim() || createPseudoUuid('event');

    tx.insert(syncOutboxEvents)
      .values({
        eventId,
        sequenceInDevice: nextSequence,
        occurredAt,
        entityType: event.entityType,
        entityId,
        eventType: event.eventType,
        payloadJson,
        schemaVersion: event.schemaVersion ?? 1,
        traceId: event.traceId ?? null,
        createdAt: now,
      })
      .run();

    persisted.push({
      eventId,
      sequenceInDevice: nextSequence,
      occurredAt,
      entityType: event.entityType,
      entityId,
      eventType: event.eventType,
      payload: event.payload ?? {},
      schemaVersion: event.schemaVersion ?? 1,
      traceId: event.traceId ?? null,
    });

    nextSequence += 1;
  }

  tx.update(syncDeliveryState)
    .set({
      nextSequenceInDevice: nextSequence,
      updatedAt: now,
    })
    .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
    .run();

  return persisted;
};

export const enqueueSyncEvents = async (
  events: QueuedSyncEventInput[],
  options: {
    now?: Date;
  } = {}
): Promise<PendingSyncEvent[]> => {
  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => enqueueSyncEventsTx(tx, events, options));
};

export const enqueueSyncEvent = async (
  event: QueuedSyncEventInput,
  options: {
    now?: Date;
  } = {}
): Promise<PendingSyncEvent[]> => enqueueSyncEvents([event], options);

export const getSyncDeliveryState = async (): Promise<SyncDeliveryStateSnapshot> => {
  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => ensureDeliveryStateTx(tx, nowDate()));
};

export const markSyncAttemptStarted = async (batchId: string, options: { now?: Date } = {}) => {
  const normalizedBatchId = batchId.trim();
  if (!normalizedBatchId) {
    throw new Error('batchId is required');
  }

  const now = options.now ?? nowDate();
  requireValidDate(now, 'now');

  const database = await bootstrapLocalDataLayer();
  database.transaction((tx) => {
    ensureDeliveryStateTx(tx, now);
    tx.update(syncDeliveryState)
      .set({
        lastAttemptAt: now,
        lastErrorMessage: null,
        updatedAt: now,
      })
      .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
      .run();
  });
};

export const listPendingSyncEvents = async (limit = SYNC_BATCH_MAX_SIZE): Promise<PendingSyncEvent[]> => {
  const database = await bootstrapLocalDataLayer();
  const rows = database
    .select()
    .from(syncOutboxEvents)
    .orderBy(asc(syncOutboxEvents.sequenceInDevice))
    .limit(Math.max(1, Math.floor(limit)))
    .all();
  return rows.map(mapOutboxRow);
};

export const applySyncIngestResponse = async (input: {
  batchEvents: PendingSyncEvent[];
  response: SyncIngestResponse;
  now?: Date;
  randomSource?: RandomSource;
}): Promise<ApplyResponseResult> => {
  const now = input.now ?? nowDate();
  requireValidDate(now, 'now');

  const { batchEvents, response } = input;
  if (batchEvents.length === 0) {
    return { status: 'success', removedCount: 0 };
  }

  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => {
    const deliveryState = ensureDeliveryStateTx(tx, now);
    const deletePrefixByCount = (count: number) => {
      if (count <= 0) {
        return 0;
      }

      const eventIds = batchEvents.slice(0, count).map((event) => event.eventId);
      if (eventIds.length === 0) {
        return 0;
      }

      tx.delete(syncOutboxEvents).where(inArray(syncOutboxEvents.eventId, eventIds)).run();
      return eventIds.length;
    };

    if (response.status === 'SUCCESS') {
      const deleted = deletePrefixByCount(batchEvents.length);
      tx.update(syncDeliveryState)
        .set({
          consecutiveFailures: 0,
          retryBlocked: 0,
          nextAttemptAt: null,
          lastSuccessAt: now,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
        .run();
      return { status: 'success', removedCount: deleted };
    }

    const prefixCount = Math.max(0, Math.min(response.error_index, batchEvents.length));
    const deletedPrefixCount = deletePrefixByCount(prefixCount);
    const nextFailureCount = deliveryState.consecutiveFailures + 1;

    if (response.should_retry) {
      const delayMs = calculateBackoffDelayMs(nextFailureCount, input.randomSource);
      const nextAttemptAt = new Date(now.getTime() + delayMs);
      tx.update(syncDeliveryState)
        .set({
          consecutiveFailures: nextFailureCount,
          retryBlocked: 0,
          nextAttemptAt,
          lastErrorMessage: response.message,
          updatedAt: now,
        })
        .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
        .run();
      return {
        status: 'failure_retry_scheduled',
        removedCount: deletedPrefixCount,
        nextAttemptAt,
      };
    }

    tx.update(syncDeliveryState)
      .set({
        consecutiveFailures: nextFailureCount,
        retryBlocked: 1,
        nextAttemptAt: null,
        lastErrorMessage: response.message,
        updatedAt: now,
      })
      .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
      .run();

    return {
      status: 'failure_blocked',
      removedCount: deletedPrefixCount,
    };
  });
};

export const recordSyncTransportFailure = async (input: {
  message: string;
  now?: Date;
  randomSource?: RandomSource;
}): Promise<Date> => {
  const now = input.now ?? nowDate();
  requireValidDate(now, 'now');

  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => {
    const deliveryState = ensureDeliveryStateTx(tx, now);
    const nextFailureCount = deliveryState.consecutiveFailures + 1;
    const delayMs = calculateBackoffDelayMs(nextFailureCount, input.randomSource);
    const nextAttemptAt = new Date(now.getTime() + delayMs);

    tx.update(syncDeliveryState)
      .set({
        consecutiveFailures: nextFailureCount,
        retryBlocked: 0,
        nextAttemptAt,
        lastErrorMessage: input.message,
        updatedAt: now,
      })
      .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
      .run();

    return nextAttemptAt;
  });
};

export const clearSyncRetryState = async (options: { now?: Date } = {}) => {
  const now = options.now ?? nowDate();
  requireValidDate(now, 'now');

  const database = await bootstrapLocalDataLayer();
  database.transaction((tx) => {
    ensureDeliveryStateTx(tx, now);
    tx.update(syncDeliveryState)
      .set({
        consecutiveFailures: 0,
        retryBlocked: 0,
        nextAttemptAt: null,
        lastErrorMessage: null,
        updatedAt: now,
      })
      .where(eq(syncDeliveryState.id, PRIMARY_DELIVERY_STATE_ID))
      .run();
  });
};

export const resetSyncStreamForBootstrap = async () => {
  const database = await bootstrapLocalDataLayer();
  database.transaction((tx) => {
    tx.delete(syncOutboxEvents).run();
    tx.delete(syncDeliveryState).run();
  });
};

export const __resetSyncStateForTests = async () => {
  await resetSyncStreamForBootstrap();
};
