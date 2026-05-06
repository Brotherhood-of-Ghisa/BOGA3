import { isSyncNetworkOnline } from './engine';
import { getSyncDeliveryState, listPendingSyncEvents, type SyncDeliveryStateSnapshot } from './outbox';
import { getSyncRuntimeState, type SyncRuntimeStateSnapshot } from './runtime';

const SYNC_PROFILE_PENDING_SCAN_LIMIT = 1_000;

export type SyncProfileStatusKind =
  | 'disabled'
  | 'sign_in_required'
  | 'initial_sync'
  | 'syncing'
  | 'up_to_date'
  | 'waiting_for_network'
  | 'retry_scheduled'
  | 'action_required';

export type SyncProfileStatusSnapshot = {
  isEnabled: boolean;
  kind: SyncProfileStatusKind;
  statusLabel: string;
  statusHint: string | null;
  pendingCount: number;
  pendingCountCapped: boolean;
  lastSuccessfulSyncAt: Date | null;
  nextAttemptAt: Date | null;
  errorMessage: string | null;
  retryHint: string | null;
  isOnline: boolean;
};

export const deriveSyncProfileStatus = (input: {
  runtimeState: SyncRuntimeStateSnapshot;
  deliveryState: SyncDeliveryStateSnapshot;
  pendingCount: number;
  pendingCountCapped?: boolean;
  isOnline: boolean;
  isSignedIn: boolean;
  now?: Date;
}): SyncProfileStatusSnapshot => {
  const now = input.now ?? new Date();
  const pendingCount = Math.max(0, Math.floor(input.pendingCount));
  const pendingCountCapped = Boolean(input.pendingCountCapped);
  const { runtimeState, deliveryState } = input;

  if (!runtimeState.isEnabled) {
    return {
      isEnabled: false,
      kind: 'disabled',
      statusLabel: 'Disabled',
      statusHint: 'Sync is turned off.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: null,
      isOnline: input.isOnline,
    };
  }

  if (!input.isSignedIn) {
    return {
      isEnabled: true,
      kind: 'sign_in_required',
      statusLabel: 'Sign in required',
      statusHint: 'Sign in to continue syncing to backend.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: null,
      isOnline: input.isOnline,
    };
  }

  if (deliveryState.retryBlocked) {
    return {
      isEnabled: true,
      kind: 'action_required',
      statusLabel: 'Sync blocked',
      statusHint: 'Automatic retry is stopped.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: deliveryState.lastErrorMessage ?? 'Sync blocked by a non-retryable backend response.',
      retryHint: 'Fix the issue and retry manually by toggling sync off and on.',
      isOnline: input.isOnline,
    };
  }

  if (runtimeState.lastBootstrapError && runtimeState.bootstrapCompletedAt === null) {
    return {
      isEnabled: true,
      kind: 'action_required',
      statusLabel: 'Action required',
      statusHint: 'Initial sync did not complete.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: runtimeState.lastBootstrapError,
      retryHint: 'Automatic retry is unavailable for this state. Toggle sync off and on to retry.',
      isOnline: input.isOnline,
    };
  }

  if (!input.isOnline && pendingCount > 0) {
    return {
      isEnabled: true,
      kind: 'waiting_for_network',
      statusLabel: 'Waiting for network',
      statusHint: 'Pending changes will sync when connectivity returns.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: 'Will retry automatically once online.',
      isOnline: input.isOnline,
    };
  }

  if (deliveryState.nextAttemptAt && deliveryState.nextAttemptAt.getTime() > now.getTime() && pendingCount > 0) {
    return {
      isEnabled: true,
      kind: 'retry_scheduled',
      statusLabel: 'Retry scheduled',
      statusHint: null,
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: deliveryState.nextAttemptAt,
      errorMessage: deliveryState.lastErrorMessage,
      retryHint: 'Will retry automatically.',
      isOnline: input.isOnline,
    };
  }

  if (runtimeState.bootstrapCompletedAt === null) {
    return {
      isEnabled: true,
      kind: 'initial_sync',
      statusLabel: 'Syncing initial data',
      statusHint: 'First sync is running in the background.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: null,
      isOnline: input.isOnline,
    };
  }

  if (pendingCount > 0) {
    return {
      isEnabled: true,
      kind: 'syncing',
      statusLabel: 'Syncing',
      statusHint: 'Sending queued changes in the background.',
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: null,
      isOnline: input.isOnline,
    };
  }

  if (deliveryState.lastSuccessAt) {
    return {
      isEnabled: true,
      kind: 'up_to_date',
      statusLabel: 'Up to date',
      statusHint: null,
      pendingCount,
      pendingCountCapped,
      lastSuccessfulSyncAt: deliveryState.lastSuccessAt,
      nextAttemptAt: null,
      errorMessage: null,
      retryHint: null,
      isOnline: input.isOnline,
    };
  }

  return {
    isEnabled: true,
    kind: 'up_to_date',
    statusLabel: 'Enabled',
    statusHint: 'No successful sync yet.',
    pendingCount,
    pendingCountCapped,
    lastSuccessfulSyncAt: null,
    nextAttemptAt: null,
    errorMessage: null,
    retryHint: null,
    isOnline: input.isOnline,
  };
};

export const loadSyncProfileStatus = async (input: {
  isSignedIn: boolean;
  now?: Date;
}): Promise<SyncProfileStatusSnapshot> => {
  const now = input.now ?? new Date();
  const [runtimeState, deliveryState, pendingEvents] = await Promise.all([
    getSyncRuntimeState(),
    getSyncDeliveryState(),
    listPendingSyncEvents(SYNC_PROFILE_PENDING_SCAN_LIMIT),
  ]);

  return deriveSyncProfileStatus({
    runtimeState,
    deliveryState,
    pendingCount: pendingEvents.length,
    pendingCountCapped: pendingEvents.length >= SYNC_PROFILE_PENDING_SCAN_LIMIT,
    isOnline: isSyncNetworkOnline(),
    isSignedIn: input.isSignedIn,
    now,
  });
};
