/**
 * Client sync engine design reference:
 * docs/specs/tech/client-sync-engine.md
 */
import {
  applySyncIngestResponse,
  getSyncDeliveryState,
  listPendingSyncEvents,
  markSyncAttemptStarted,
  recordSyncTransportFailure,
  SYNC_BATCH_MAX_SIZE,
} from './outbox';
import { logEvent } from '@/src/logging';
import type { PendingSyncEvent } from './outbox';
import type { SyncIngestRequest, SyncIngestResponse } from './types';

export type SyncIngestTransport = {
  ingestBatch(request: SyncIngestRequest): Promise<SyncIngestResponse>;
};

export type SyncFlushResult =
  | { status: 'in_flight' }
  | { status: 'disabled' }
  | { status: 'offline' }
  | { status: 'blocked' }
  | { status: 'backoff'; nextAttemptAt: Date }
  | { status: 'idle' }
  | { status: 'success'; sentCount: number }
  | { status: 'failure_retry_scheduled'; sentCount: number; nextAttemptAt: Date }
  | { status: 'failure_blocked'; sentCount: number }
  | { status: 'transport_failure'; sentCount: number; nextAttemptAt: Date; message: string };

let syncIngestTransport: SyncIngestTransport | null = null;
let networkOnline = true;
let inFlightFlushPromise: Promise<SyncFlushResult> | null = null;

const isValidDate = (value: Date) => value instanceof Date && !Number.isNaN(value.getTime());

const ensureDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
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

const normalizeIngestResponse = (response: SyncIngestResponse, batchEvents: PendingSyncEvent[]): SyncIngestResponse => {
  if (response.status === 'SUCCESS') {
    return response;
  }

  if (!Number.isInteger(response.error_index)) {
    throw new Error('Ingest failure response error_index must be an integer');
  }

  if (response.error_index < 0 || response.error_index >= batchEvents.length) {
    throw new Error(`Ingest failure response error_index ${response.error_index} is out of range`);
  }

  if (typeof response.should_retry !== 'boolean') {
    throw new Error('Ingest failure response should_retry must be a boolean');
  }

  if (typeof response.message !== 'string' || !response.message.trim()) {
    throw new Error('Ingest failure response message must be a non-empty string');
  }

  return response;
};

const buildIngestRequest = (input: {
  deviceId: string;
  batchId: string;
  sentAt: Date;
  events: PendingSyncEvent[];
}): SyncIngestRequest => ({
  device_id: input.deviceId,
  batch_id: input.batchId,
  sent_at_ms: input.sentAt.getTime(),
  events: input.events.map((event) => ({
    event_id: event.eventId,
    sequence_in_device: event.sequenceInDevice,
    occurred_at_ms: event.occurredAt.getTime(),
    entity_type: event.entityType,
    entity_id: event.entityId,
    event_type: event.eventType,
    payload: event.payload,
    schema_version: event.schemaVersion,
    trace_id: event.traceId ?? undefined,
  })),
});

export const setSyncIngestTransport = (transport: SyncIngestTransport | null) => {
  syncIngestTransport = transport;
};

export const getSyncIngestTransport = () => syncIngestTransport;

export const setSyncNetworkOnline = (isOnline: boolean) => {
  networkOnline = isOnline;
};

export const isSyncNetworkOnline = () => networkOnline;

export const isFlushInFlight = (): boolean => inFlightFlushPromise !== null;

export const getInFlightFlushPromise = (): Promise<SyncFlushResult> | null => inFlightFlushPromise;

const runFlush = async (input: {
  transport: SyncIngestTransport;
  now: Date;
  randomSource: () => number;
}): Promise<SyncFlushResult> => {
  const deliveryState = await getSyncDeliveryState();

  if (deliveryState.retryBlocked) {
    return { status: 'blocked' };
  }

  if (deliveryState.nextAttemptAt && deliveryState.nextAttemptAt.getTime() > input.now.getTime()) {
    return { status: 'backoff', nextAttemptAt: deliveryState.nextAttemptAt };
  }

  const pendingEvents = await listPendingSyncEvents(SYNC_BATCH_MAX_SIZE);
  if (pendingEvents.length < 1) {
    return { status: 'idle' };
  }

  const batchId = createPseudoUuid('batch');
  await markSyncAttemptStarted(batchId, { now: input.now });

  const request = buildIngestRequest({
    deviceId: deliveryState.deviceId,
    batchId,
    sentAt: input.now,
    events: pendingEvents,
  });

  try {
    const response = normalizeIngestResponse(await input.transport.ingestBatch(request), pendingEvents);
    const applyResult = await applySyncIngestResponse({
      batchEvents: pendingEvents,
      response,
      now: input.now,
      randomSource: input.randomSource,
    });

    if (applyResult.status === 'success') {
      return { status: 'success', sentCount: pendingEvents.length };
    }

    if (applyResult.status === 'failure_retry_scheduled') {
      return {
        status: 'failure_retry_scheduled',
        sentCount: pendingEvents.length,
        nextAttemptAt: applyResult.nextAttemptAt,
      };
    }

    return { status: 'failure_blocked', sentCount: pendingEvents.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync transport failure';
    void logEvent({
      level: 'error',
      source: 'sync',
      event: 'sync.flush_transport_failed',
      message,
      context: {
        batchId,
        pendingEventCount: pendingEvents.length,
      },
    });
    const nextAttemptAt = await recordSyncTransportFailure({
      message,
      now: input.now,
      randomSource: input.randomSource,
    });
    return {
      status: 'transport_failure',
      sentCount: pendingEvents.length,
      nextAttemptAt,
      message,
    };
  }
};

export const flushSyncOutbox = async (
  options: {
    now?: Date;
    randomSource?: () => number;
    transport?: SyncIngestTransport | null;
    force?: boolean;
  } = {}
): Promise<SyncFlushResult> => {
  if (inFlightFlushPromise) {
    return { status: 'in_flight' };
  }

  const transport = options.transport ?? syncIngestTransport;
  if (!transport) {
    return { status: 'disabled' };
  }

  if (!networkOnline && options.force !== true) {
    return { status: 'offline' };
  }

  const now = options.now ?? new Date();
  ensureDate(now, 'now');

  const randomSource = options.randomSource ?? Math.random;

  inFlightFlushPromise = runFlush({
    transport,
    now,
    randomSource,
  }).finally(() => {
    inFlightFlushPromise = null;
  });

  return inFlightFlushPromise;
};

export const __resetSyncEngineForTests = () => {
  syncIngestTransport = null;
  networkOnline = true;
  inFlightFlushPromise = null;
};
