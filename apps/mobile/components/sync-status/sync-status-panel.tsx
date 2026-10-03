import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  Icon,
  ListRow,
  StatePanel,
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { requestSync } from '@/src/sync/scheduler';
import {
  getSyncStatus,
  type SyncNetworkState,
  type SyncStatusSnapshot,
} from '@/src/sync/sync-status';

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
 * The Network row's word per state. An unknown network (NetInfo has not
 * reported yet, or no snapshot has loaded) is "Checking…": never "Offline",
 * which it may not be, and never "Online", which it may not be either.
 */
const NETWORK_LABELS: Record<SyncNetworkState, string> = {
  unknown: 'Checking…',
  online: 'Online',
  offline: 'Offline',
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
  isSignedIn?: boolean;
  preferenceError?: string | null;
  onRefreshPreferences?: () => Promise<void>;
};

/**
 * Data & Sync owns preference-storage and sync errors in its existing Error row.
 * Refresh retries preferences and, when signed in, nudges sync and reads status.
 */
export function SyncStatusPanel(props: SyncStatusPanelProps) {
  return <SyncStatusPanelContent key={props.isSignedIn === false ? 'local' : 'signed-in'} {...props} />;
}

function SyncStatusPanelContent({
  readStatus = getSyncStatus,
  onRequestSync = requestSync,
  isSignedIn = true,
  preferenceError = null,
  onRefreshPreferences,
}: SyncStatusPanelProps) {
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lifetimeRef = useRef({ active: true });
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    return () => {
      lifetime.active = false;
      if (refreshTimeoutRef.current !== null) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;
    const lifetime = lifetimeRef.current;
    if (!lifetime.active) return;
    try {
      const next = await readStatus();
      if (lifetime.active) {
        setStatus(next);
      }
    } catch {
      // A failed status read leaves the previous snapshot in place rather than
      // blanking the panel; the next refresh tick retries.
    }
  }, [isSignedIn, readStatus]);

  // Refresh on focus and poll on an interval while the screen is in view.
  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) return;
      void refresh();
      const handle = setInterval(() => {
        void refresh();
      }, STATUS_REFRESH_INTERVAL_MS);
      return () => {
        clearInterval(handle);
      };
    }, [isSignedIn, refresh])
  );

  const handleManualRefresh = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    setIsRefreshing(true);
    try {
      await onRefreshPreferences?.();
      if (!lifetime.active) return;
      if (isSignedIn) await Promise.resolve(onRequestSync());
      if (lifetime.active) await refresh();
    } finally {
      if (lifetime.active) {
        if (refreshTimeoutRef.current !== null) {
          clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = setTimeout(async () => {
          try {
            await refresh();
          } finally {
            if (lifetime.active) setIsRefreshing(false);
          }
        }, 1500);
      }
    }
  }, [isSignedIn, onRefreshPreferences, onRequestSync, refresh]);

  const errorText = [isSignedIn ? resolveErrorText(status) : null, preferenceError]
    .filter(error => error && error !== 'None').join('\n') || 'None';

  return (
    <Card testID={isSignedIn ? 'settings-sync-status-card' : 'settings-sync-signed-out-card'}>
      {isSignedIn ? <SyncStatusDetails status={status} /> :
        <StatePanel body="Sign in through Account to sync your training data." fill={false} />}

      {(isSignedIn || preferenceError) ? <ListRow
        density="list"
        divider={isSignedIn}
        meta={
          <Text
            allowFontScaling={false}
            accessibilityLiveRegion="polite"
            style={[styles.value, styles.errorValue, errorText === 'None' ? null : styles.danger]}
            testID="settings-sync-status-error">
            {errorText}
          </Text>
        }
        testID="settings-sync-status-error-row">
        <Text allowFontScaling={false} style={styles.label}>Error</Text>
      </ListRow> : null}

      {(isSignedIn || preferenceError) ? <View style={styles.actions}>
        <ActionButton
          accessibilityLabel={isRefreshing ? 'Refreshing data status…' : 'Refresh data and sync status'}
          disabled={isRefreshing}
          label={isRefreshing ? 'Refreshing…' : 'Refresh'}
          onPress={() => { void handleManualRefresh(); }}
          testID="settings-sync-status-refresh-button"
          variant="outline"
        />
      </View> : null}
    </Card>
  );
}

function SyncStatusDetails({ status }: { status: SyncStatusSnapshot | null }) {
  const networkState: SyncNetworkState = status?.networkState ?? 'unknown';
  const offline = networkState === 'offline';
  return <>
      <Text allowFontScaling={false} style={styles.cardLabel}>Sync status</Text>
      <ListRow
        density="list"
        divider={false}
        meta={
          <Text allowFontScaling={false} style={styles.value} testID="settings-sync-status-last-success">
            {formatLastSuccess(status?.lastSuccessAtMs ?? null)}
          </Text>
        }
        testID="settings-sync-status-last-success-row">
        <Text allowFontScaling={false} style={styles.label}>Last successful sync</Text>
      </ListRow>

      <ListRow
        density="list"
        meta={
          <Text allowFontScaling={false} style={styles.value} testID="settings-sync-status-dirty-count">
            {String(status?.dirtyCount ?? 0)}
          </Text>
        }
        testID="settings-sync-status-dirty-count-row">
        <Text allowFontScaling={false} style={styles.label}>Pending changes</Text>
      </ListRow>

      {/* Offline is the glyph and the word, never a warning hue (G3). */}
      <ListRow
        density="list"
        meta={
          <View style={styles.network}>
            {offline ? (
              <Icon name="offline" size="sm" testID="settings-sync-status-network-offline-glyph" />
            ) : null}
            <Text allowFontScaling={false} style={styles.value} testID="settings-sync-status-network">
              {NETWORK_LABELS[networkState]}
            </Text>
          </View>
        }
        testID="settings-sync-status-network-row">
        <Text allowFontScaling={false} style={styles.label}>Network</Text>
      </ListRow>

    </>;
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
  cardLabel: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.xs,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // Body text, not a destination's label: these rows are read, not pressed.
  label: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
    textAlign: 'right',
  },
  // A cycle error can be a sentence: it wraps within the row, right-aligned.
  errorValue: {
    flexShrink: 1,
    maxWidth: '60%',
  },
  danger: {
    color: uiRoles.danger,
  },
  network: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  actions: {
    padding: uiSpace.md,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
    alignItems: 'flex-start',
  },
});
