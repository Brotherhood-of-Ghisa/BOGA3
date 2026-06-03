import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import { requestSync } from '@/src/sync/scheduler';
import { getSyncStatus, type SyncStatusSnapshot } from '@/src/sync/sync-status';

// How often the panel re-reads the status snapshot while the Settings screen is
// focused. Refresh triggers, in order of how a user sees fresh values:
//   1. On screen focus — every time Settings comes into view (useFocusEffect).
//   2. On this interval while focused — so a cycle that finishes while the user
//      is looking at the panel updates without a manual action.
//   3. On the manual "Refresh" press — which also nudges a sync cycle.
// The interval is cleared when the screen blurs so a backgrounded panel does no
// work.
const STATUS_REFRESH_INTERVAL_MS = 5000;

/** Formats an epoch-ms timestamp as a human-readable local time, or "Never". */
const formatLastSuccess = (lastSuccessAtMs: number | null): string => {
  if (lastSuccessAtMs == null) {
    return 'Never';
  }
  return new Date(lastSuccessAtMs).toLocaleString();
};

/**
 * Reads the current sync-status snapshot from the local sources. Injectable so
 * the panel can be unit-tested against a stubbed status source.
 */
export type SyncStatusReader = () => Promise<SyncStatusSnapshot>;

type SyncStatusPanelProps = {
  /** Override the status source in tests; defaults to the real composer. */
  readStatus?: SyncStatusReader;
  /** Override the manual-sync nudge in tests; defaults to the scheduler. */
  onRequestSync?: () => void;
};

/**
 * The signed-in user's sync-status surface: last successful sync time, the
 * count of local edits waiting to be pushed, the latest error (if any), and the
 * current network state. Read-only display plus an optional manual refresh that
 * nudges a sync cycle and re-reads the snapshot.
 */
export function SyncStatusPanel({
  readStatus = getSyncStatus,
  onRequestSync = requestSync,
}: SyncStatusPanelProps) {
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await readStatus();
      if (isMountedRef.current) {
        setStatus(next);
      }
    } catch {
      // A failed status read leaves the previous snapshot in place rather than
      // blanking the panel; the next refresh tick retries.
    }
  }, [readStatus]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Refresh on focus and poll on an interval while the screen is in view.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const handle = setInterval(() => {
        void refresh();
      }, STATUS_REFRESH_INTERVAL_MS);
      return () => {
        clearInterval(handle);
      };
    }, [refresh])
  );

  const handleManualRefresh = useCallback(() => {
    onRequestSync();
    void refresh();
  }, [onRequestSync, refresh]);

  const errorText = resolveErrorText(status);
  const networkLabel = status?.networkState === 'offline' ? 'Offline' : 'Online';

  return (
    <UiSurface style={styles.card} testID="settings-sync-status-card">
      <UiText selectable variant="labelStrong">
        Sync status
      </UiText>

      <View style={styles.row} testID="settings-sync-status-last-success-row">
        <UiText selectable style={styles.fieldLabel} variant="bodyMuted">
          Last successful sync
        </UiText>
        <UiText selectable testID="settings-sync-status-last-success" variant="body">
          {formatLastSuccess(status?.lastSuccessAtMs ?? null)}
        </UiText>
      </View>

      <View style={styles.row} testID="settings-sync-status-dirty-count-row">
        <UiText selectable style={styles.fieldLabel} variant="bodyMuted">
          Pending changes
        </UiText>
        <UiText selectable testID="settings-sync-status-dirty-count" variant="body">
          {String(status?.dirtyCount ?? 0)}
        </UiText>
      </View>

      <View style={styles.row} testID="settings-sync-status-network-row">
        <UiText selectable style={styles.fieldLabel} variant="bodyMuted">
          Network
        </UiText>
        <UiText
          selectable
          style={status?.networkState === 'offline' ? styles.warningText : undefined}
          testID="settings-sync-status-network"
          variant="body">
          {networkLabel}
        </UiText>
      </View>

      <View style={styles.row} testID="settings-sync-status-error-row">
        <UiText selectable style={styles.fieldLabel} variant="bodyMuted">
          Error
        </UiText>
        <UiText
          selectable
          style={errorText === 'None' ? undefined : styles.errorText}
          testID="settings-sync-status-error"
          variant="body">
          {errorText}
        </UiText>
      </View>

      <UiButton
        accessibilityLabel="Refresh sync status and request a sync"
        label="Refresh"
        onPress={handleManualRefresh}
        testID="settings-sync-status-refresh-button"
        variant="secondary"
      />
    </UiSurface>
  );
}

/**
 * Maps the snapshot's error fields to the one line the user sees. A pending
 * sign-in is its own message (retrying will not help — the user must sign in);
 * a cycle error shows its message; otherwise the latest cycle was clean.
 */
const resolveErrorText = (status: SyncStatusSnapshot | null): string => {
  if (status == null) {
    return 'None';
  }
  if (status.authRequired) {
    return 'Sign-in required';
  }
  if (status.errorMessage != null) {
    return status.errorMessage;
  }
  return 'None';
};

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  fieldLabel: {
    flexShrink: 0,
  },
  errorText: {
    color: uiColors.actionDangerText,
    flexShrink: 1,
    textAlign: 'right',
  },
  warningText: {
    color: uiColors.textWarning,
  },
});
