import { deriveSyncProfileStatus } from '@/src/sync/profile-status';

const createRuntimeState = (overrides: Partial<Parameters<typeof deriveSyncProfileStatus>[0]['runtimeState']> = {}) => ({
  bootstrapCompletedAt: null,
  bootstrapUserId: null,
  id: 'primary',
  isEnabled: false,
  lastBootstrapError: null,
  updatedAt: new Date('2026-03-06T10:00:00.000Z'),
  ...overrides,
});

const createDeliveryState = (overrides: Partial<Parameters<typeof deriveSyncProfileStatus>[0]['deliveryState']> = {}) => ({
  consecutiveFailures: 0,
  deviceId: 'device-1',
  id: 'primary',
  lastAttemptAt: null,
  lastErrorMessage: null,
  lastSuccessAt: null,
  nextAttemptAt: null,
  nextSequenceInDevice: 1,
  retryBlocked: false,
  updatedAt: new Date('2026-03-06T10:00:00.000Z'),
  ...overrides,
});

describe('deriveSyncProfileStatus', () => {
  it('returns disabled state when sync is off', () => {
    const result = deriveSyncProfileStatus({
      deliveryState: createDeliveryState(),
      isOnline: true,
      isSignedIn: true,
      pendingCount: 0,
      runtimeState: createRuntimeState({
        isEnabled: false,
      }),
    });

    expect(result.kind).toBe('disabled');
    expect(result.statusLabel).toBe('Disabled');
    expect(result.lastSuccessfulSyncAt).toBeNull();
  });

  it('returns initial sync status before bootstrap completion', () => {
    const result = deriveSyncProfileStatus({
      deliveryState: createDeliveryState(),
      isOnline: true,
      isSignedIn: true,
      pendingCount: 0,
      runtimeState: createRuntimeState({
        isEnabled: true,
      }),
    });

    expect(result.kind).toBe('initial_sync');
    expect(result.statusLabel).toBe('Syncing initial data');
  });

  it('returns retry-scheduled state with backend message when backoff is active', () => {
    const result = deriveSyncProfileStatus({
      deliveryState: createDeliveryState({
        lastErrorMessage: 'Expected sequence_in_device 10 but received 11.',
        nextAttemptAt: new Date('2026-03-06T10:05:00.000Z'),
      }),
      isOnline: true,
      isSignedIn: true,
      now: new Date('2026-03-06T10:00:00.000Z'),
      pendingCount: 4,
      runtimeState: createRuntimeState({
        bootstrapCompletedAt: new Date('2026-03-06T09:59:00.000Z'),
        bootstrapUserId: 'user-1',
        isEnabled: true,
      }),
    });

    expect(result.kind).toBe('retry_scheduled');
    expect(result.statusLabel).toBe('Retry scheduled');
    expect(result.errorMessage).toBe('Expected sequence_in_device 10 but received 11.');
    expect(result.retryHint).toBe('Will retry automatically.');
  });

  it('returns action-required state when retry is blocked', () => {
    const result = deriveSyncProfileStatus({
      deliveryState: createDeliveryState({
        lastErrorMessage: 'Duplicate event_id with changed payload.',
        retryBlocked: true,
      }),
      isOnline: true,
      isSignedIn: true,
      pendingCount: 3,
      runtimeState: createRuntimeState({
        bootstrapCompletedAt: new Date('2026-03-06T09:59:00.000Z'),
        bootstrapUserId: 'user-1',
        isEnabled: true,
      }),
    });

    expect(result.kind).toBe('action_required');
    expect(result.statusLabel).toBe('Sync blocked');
    expect(result.errorMessage).toBe('Duplicate event_id with changed payload.');
    expect(result.retryHint).toContain('retry manually');
  });

  it('prefers blocked delivery error over generic incomplete bootstrap error', () => {
    const result = deriveSyncProfileStatus({
      deliveryState: createDeliveryState({
        lastErrorMessage: 'Projection apply failed: missing parent row.',
        retryBlocked: true,
      }),
      isOnline: true,
      isSignedIn: true,
      pendingCount: 1,
      runtimeState: createRuntimeState({
        isEnabled: true,
        lastBootstrapError: 'Bootstrap merge completed but convergence did not settle (failure_blocked).',
      }),
    });

    expect(result.kind).toBe('action_required');
    expect(result.statusLabel).toBe('Sync blocked');
    expect(result.errorMessage).toBe('Projection apply failed: missing parent row.');
  });
});
