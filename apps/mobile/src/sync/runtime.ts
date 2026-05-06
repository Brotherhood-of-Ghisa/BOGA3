import { eq } from 'drizzle-orm';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { getAuthSnapshot, subscribeToAuthState } from '@/src/auth';
import { getSupabaseMobileClient } from '@/src/auth/supabase';
import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { syncRuntimeState } from '@/src/data/schema';

import { flushSyncOutbox, setSyncIngestTransport, type SyncFlushResult, type SyncIngestTransport } from './engine';
import { runSyncBootstrapMerge, type SyncBootstrapMergeResult } from './bootstrap';
import { clearSyncRetryState } from './outbox';
import type { SyncIngestResponse } from './types';

type RuntimeStateTx = Pick<LocalDatabase, 'insert' | 'select' | 'update'>;

const PRIMARY_RUNTIME_STATE_ID = 'primary';

export type SyncRuntimeStateSnapshot = {
  id: string;
  isEnabled: boolean;
  bootstrapUserId: string | null;
  bootstrapCompletedAt: Date | null;
  lastBootstrapError: string | null;
  updatedAt: Date;
};

export type SyncConvergenceResult = {
  status: 'converged' | 'not_converged';
  attempts: number;
  totalSentCount: number;
  lastFlushResult: SyncFlushResult;
};

export type SyncBootstrapRunResult = {
  mergeResult: SyncBootstrapMergeResult;
  convergenceResult: SyncConvergenceResult;
};

const normalizeSyncRuntimeState = (
  row: typeof syncRuntimeState.$inferSelect
): SyncRuntimeStateSnapshot => ({
  id: row.id,
  isEnabled: row.isEnabled === 1,
  bootstrapUserId: row.bootstrapUserId ?? null,
  bootstrapCompletedAt: row.bootstrapCompletedAt ?? null,
  lastBootstrapError: row.lastBootstrapError ?? null,
  updatedAt: row.updatedAt,
});

const ensureValidDate = (value: Date, label: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const ensureRuntimeStateTx = (tx: RuntimeStateTx, now: Date): SyncRuntimeStateSnapshot => {
  const existing = tx.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get();
  if (existing) {
    return normalizeSyncRuntimeState(existing);
  }

  const created: typeof syncRuntimeState.$inferInsert = {
    id: PRIMARY_RUNTIME_STATE_ID,
    isEnabled: 0,
    bootstrapUserId: null,
    bootstrapCompletedAt: null,
    lastBootstrapError: null,
    updatedAt: now,
  };

  tx.insert(syncRuntimeState).values(created).run();

  return {
    id: created.id,
    isEnabled: false,
    bootstrapUserId: null,
    bootstrapCompletedAt: null,
    lastBootstrapError: null,
    updatedAt: now,
  };
};

const readRuntimeState = async (): Promise<SyncRuntimeStateSnapshot> => {
  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => ensureRuntimeStateTx(tx, new Date()));
};

const updateRuntimeState = async (
  update: Partial<Pick<SyncRuntimeStateSnapshot, 'isEnabled' | 'bootstrapUserId' | 'bootstrapCompletedAt' | 'lastBootstrapError'>>,
  options: { now?: Date } = {}
): Promise<SyncRuntimeStateSnapshot> => {
  const now = options.now ?? new Date();
  ensureValidDate(now, 'now');

  const database = await bootstrapLocalDataLayer();
  return database.transaction((tx) => {
    ensureRuntimeStateTx(tx, now);

    tx.update(syncRuntimeState)
      .set({
        isEnabled: update.isEnabled === undefined ? undefined : update.isEnabled ? 1 : 0,
        bootstrapUserId: update.bootstrapUserId,
        bootstrapCompletedAt: update.bootstrapCompletedAt,
        lastBootstrapError: update.lastBootstrapError,
        updatedAt: now,
      })
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .run();

    const next = tx.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get();
    if (!next) {
      throw new Error('sync_runtime_state row was not found after update');
    }

    return normalizeSyncRuntimeState(next);
  });
};

const parseIngestResponse = (value: unknown): SyncIngestResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid sync ingest response payload');
  }

  const maybeFailure = value as Partial<SyncIngestResponse> & {
    error_index?: unknown;
    should_retry?: unknown;
    message?: unknown;
    error_event_id?: unknown;
  };

  if (maybeFailure.status === 'SUCCESS') {
    return {
      status: 'SUCCESS',
    };
  }

  if (maybeFailure.status !== 'FAILURE') {
    throw new Error('Invalid sync ingest response status');
  }

  if (!Number.isInteger(maybeFailure.error_index)) {
    throw new Error('Invalid sync ingest response error_index');
  }

  if (typeof maybeFailure.should_retry !== 'boolean') {
    throw new Error('Invalid sync ingest response should_retry');
  }

  if (typeof maybeFailure.message !== 'string' || !maybeFailure.message.trim()) {
    throw new Error('Invalid sync ingest response message');
  }

  return {
    status: 'FAILURE',
    error_index: Number(maybeFailure.error_index),
    should_retry: maybeFailure.should_retry,
    message: maybeFailure.message,
    error_event_id:
      typeof maybeFailure.error_event_id === 'string' && maybeFailure.error_event_id.trim()
        ? maybeFailure.error_event_id
        : undefined,
  };
};

const createSupabaseSyncIngestTransport = (client: SupabaseClient): SyncIngestTransport => ({
  async ingestBatch(request) {
    const { data, error } = await client.schema('app_public').rpc('sync_events_ingest', request);

    if (error) {
      throw new Error(error.message);
    }

    const normalized = Array.isArray(data) ? data[0] : data;
    return parseIngestResponse(normalized);
  },
});

let runtimeStarted = false;
let runtimeUnsubscribeAuth: (() => void) | null = null;
let runtimeReconcilePromise: Promise<void> | null = null;
let runtimeBootstrapPromise: Promise<SyncBootstrapRunResult | null> | null = null;

const shouldRunBootstrap = (
  runtimeState: SyncRuntimeStateSnapshot,
  session: Session | null
): session is Session => {
  if (!session?.user?.id) {
    return false;
  }

  if (!runtimeState.isEnabled) {
    return false;
  }

  if (!runtimeState.bootstrapCompletedAt) {
    return true;
  }

  return runtimeState.bootstrapUserId !== session.user.id;
};

const runBootstrapForSession = async (client: SupabaseClient, session: Session): Promise<SyncBootstrapRunResult | null> => {
  if (runtimeBootstrapPromise) {
    return runtimeBootstrapPromise;
  }

  runtimeBootstrapPromise = (async () => {
    const now = new Date();

    try {
      const mergeResult = await runSyncBootstrapMerge({
        client,
        now,
      });

      const convergenceResult = await flushSyncOutboxUntilSettled();

      if (convergenceResult.status === 'converged') {
        await updateRuntimeState(
          {
            bootstrapUserId: session.user.id,
            bootstrapCompletedAt: new Date(),
            lastBootstrapError: null,
          },
          { now: new Date() }
        );
      } else {
        const failureMessage = convergenceResult.lastFlushResult.status;
        await updateRuntimeState(
          {
            lastBootstrapError: `Bootstrap merge completed but convergence did not settle (${failureMessage}).`,
          },
          { now: new Date() }
        );
      }

      return {
        mergeResult,
        convergenceResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync bootstrap failed.';
      await updateRuntimeState(
        {
          lastBootstrapError: message,
        },
        { now: new Date() }
      );

      return null;
    } finally {
      runtimeBootstrapPromise = null;
    }
  })();

  return runtimeBootstrapPromise;
};

const reconcileRuntimeState = async () => {
  const runtimeState = await readRuntimeState();
  const authSnapshot = getAuthSnapshot();

  if (!runtimeState.isEnabled) {
    setSyncIngestTransport(null);
    return;
  }

  if (!authSnapshot.session) {
    setSyncIngestTransport(null);
    return;
  }

  const client = getSupabaseMobileClient();
  if (!client) {
    setSyncIngestTransport(null);
    return;
  }

  setSyncIngestTransport(createSupabaseSyncIngestTransport(client));

  if (shouldRunBootstrap(runtimeState, authSnapshot.session)) {
    await runBootstrapForSession(client, authSnapshot.session);
  }
};

const queueRuntimeReconcile = () => {
  if (runtimeReconcilePromise) {
    return;
  }

  runtimeReconcilePromise = reconcileRuntimeState().finally(() => {
    runtimeReconcilePromise = null;
  });
};

export const flushSyncOutboxUntilSettled = async (
  options: {
    maxAttempts?: number;
    flush?: () => Promise<SyncFlushResult>;
  } = {}
): Promise<SyncConvergenceResult> => {
  const flush = options.flush ?? (() => flushSyncOutbox());
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 20));

  let totalSentCount = 0;
  let attempts = 0;
  let lastFlushResult: SyncFlushResult = { status: 'idle' };

  while (attempts < maxAttempts) {
    attempts += 1;
    lastFlushResult = await flush();

    if (lastFlushResult.status === 'success') {
      totalSentCount += lastFlushResult.sentCount;
      continue;
    }

    if (lastFlushResult.status === 'idle') {
      return {
        status: 'converged',
        attempts,
        totalSentCount,
        lastFlushResult,
      };
    }

    return {
      status: 'not_converged',
      attempts,
      totalSentCount,
      lastFlushResult,
    };
  }

  return {
    status: 'not_converged',
    attempts,
    totalSentCount,
    lastFlushResult,
  };
};

export const getSyncRuntimeState = async (): Promise<SyncRuntimeStateSnapshot> => readRuntimeState();

export const setSyncEnabled = async (
  isEnabled: boolean,
  options: {
    now?: Date;
  } = {}
): Promise<SyncRuntimeStateSnapshot> => {
  if (isEnabled) {
    await clearSyncRetryState(options);
  }

  const nextState = await updateRuntimeState(
    {
      isEnabled,
      lastBootstrapError: null,
    },
    options
  );

  if (!isEnabled) {
    setSyncIngestTransport(null);
  }

  queueRuntimeReconcile();

  return nextState;
};

export const startSyncRuntime = () => {
  if (runtimeStarted) {
    return;
  }

  runtimeStarted = true;
  runtimeUnsubscribeAuth = subscribeToAuthState(() => {
    queueRuntimeReconcile();
  });

  queueRuntimeReconcile();
};

export const stopSyncRuntime = () => {
  runtimeStarted = false;
  runtimeUnsubscribeAuth?.();
  runtimeUnsubscribeAuth = null;
  setSyncIngestTransport(null);
};

export const __resetSyncRuntimeForTests = async () => {
  stopSyncRuntime();
  runtimeReconcilePromise = null;
  runtimeBootstrapPromise = null;

  const database = await bootstrapLocalDataLayer();
  database.transaction((tx) => {
    tx.delete(syncRuntimeState).run();
  });
};
