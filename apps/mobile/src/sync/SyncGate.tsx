import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  Notice,
  Screen,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { PULL_LAYER_COUNT, type SyncPhase, type SyncProgress } from '@/src/sync/progress';
import { requestSync } from '@/src/sync/scheduler';
import { selectSyncGateMode } from '@/src/sync/sync-gate-decision';
import { useSyncGateState } from '@/src/sync/use-sync-gate-state';

/** Stable testIDs for the gate's surfaces, so tests and Maestro flows can target them. */
export const SYNC_GATE_TEST_IDS = {
  block: 'sync-gate-block',
  phaseLabel: 'sync-gate-phase-label',
  activityIndicator: 'sync-gate-activity-indicator',
  activityDetail: 'sync-gate-activity-detail',
  offlineMessage: 'sync-gate-offline-message',
  errorMessage: 'sync-gate-error-message',
  errorDetail: 'sync-gate-error-detail',
  retryButton: 'sync-gate-retry-button',
} as const;

const PHASE_LABELS: Record<SyncPhase, string> = {
  idle: 'Preparing…',
  pull: 'Restoring your data',
  push: 'Saving your changes',
  seed: 'Loading the exercise catalog',
  done: 'Almost ready',
};

/**
 * A short human description of the kind of failure, so the block explains what
 * went wrong without leaking internal error tokens.
 */
const ERROR_MESSAGES: Record<'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'UPDATE_REQUIRED' | 'INTERNAL', string> = {
  UPDATE_REQUIRED: 'Update BoGa to continue syncing. Your data remains on this device.',
  INTERNAL: 'We could not finish setting up your data. Check your connection and try again.',
  FK_VIOLATION: 'Something went wrong while setting up your data. Please try again.',
  LOCAL_FK_VIOLATION: 'Something went wrong while setting up your data. Please try again.',
};

/**
 * The first-sync block, the `/sync-setup` route. The root stack
 * (`components/navigation/root-stack.tsx`) makes it the only data-free route a
 * signed-in user can reach while the device has not drained its first sync cycle
 * (the persisted bootstrap flag is null), and removes it once the flag is set, so
 * the router moves on to the app. It shows "Setting up your data…" and surfaces,
 * so a stalled gate is self-explanatory:
 *   - the current phase of the first sync,
 *   - an activity indicator plus advancing counters ("layer K of N", "M items")
 *     as the liveness proof that work is happening, and
 *   - an offline message instead of an indefinite spinner when the device has no
 *     network.
 *
 * On a cycle error it shows the error and a single Retry that fires exactly one
 * cycle. A "no signed-in user" outcome is not shown here: it routes to sign-in,
 * where a retry could not help.
 */
export function SyncSetupScreen() {
  const { isConfigured, session } = useAuth();
  const snapshot = useSyncGateState();
  const mode = selectSyncGateMode({ isConfigured, session }, snapshot);

  return (
    <Screen style={styles.container} testID={SYNC_GATE_TEST_IDS.block}>
      <Card style={styles.card}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>
          {mode.kind === 'error' && mode.errorCode === 'UPDATE_REQUIRED' ? 'App update required' : 'Setting up your data…'}
        </Text>

        {mode.kind === 'error' ? (
          <GateError detail={snapshot.lastCycleErrorDetail} errorCode={mode.errorCode} />
        ) : (
          <GateProgress progress={snapshot.progress} />
        )}
      </Card>
    </Screen>
  );
}

/** The in-progress body: phase label plus an advancing activity / offline signal. */
function GateProgress({ progress }: { progress: SyncProgress }) {
  return (
    <View style={styles.body}>
      <Text allowFontScaling={false} style={styles.phaseLabel} testID={SYNC_GATE_TEST_IDS.phaseLabel}>
        {PHASE_LABELS[progress.phase]}
      </Text>

      {/* Offline is the glyph and the words, never a warning hue (G3). */}
      {progress.offline ? (
        <Notice
          icon="offline"
          live
          message="You are offline. We will keep setting up your data as soon as you are back online."
          testID={SYNC_GATE_TEST_IDS.offlineMessage}
        />
      ) : (
        <View style={styles.activityRow}>
          {/* The testID lives on a wrapping View, not the ActivityIndicator
              itself: RN's ActivityIndicator does not reliably surface its testID
              to the iOS accessibility tree Maestro queries, so an assertion on
              the indicator would never see it. A plain View wrapper is reliably
              queryable by both Maestro and React Native Testing Library. */}
          <View testID={SYNC_GATE_TEST_IDS.activityIndicator}>
            <ActivityIndicator color={uiRoles.inkMuted} size="large" />
          </View>
          <Text allowFontScaling={false} style={styles.activityDetail} testID={SYNC_GATE_TEST_IDS.activityDetail}>
            {describeActivity(progress)}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * The error body: a human message, the failure's technical detail (error code
 * plus the sanitized exception text the cycle-result log carries) so a failed
 * setup says what failed, and a single Retry that fires one cycle.
 */
function GateError({
  errorCode,
  detail,
}: {
  errorCode: 'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'UPDATE_REQUIRED' | 'INTERNAL';
  detail: string | null;
}) {
  return (
    <View style={styles.body}>
      <Text allowFontScaling={false} accessibilityRole="alert" style={styles.errorMessage} testID={SYNC_GATE_TEST_IDS.errorMessage}>
        {ERROR_MESSAGES[errorCode]}
      </Text>
      <Text allowFontScaling={false} selectable style={styles.errorDetail} testID={SYNC_GATE_TEST_IDS.errorDetail}>
        {detail ? `${errorCode}: ${detail}` : errorCode}
      </Text>
      {errorCode !== 'UPDATE_REQUIRED' ? <ActionButton
        accessibilityLabel="Retry"
        label="Retry"
        onPress={() => {
          // Fire exactly one cycle. The scheduler coalesces, so a second tap
          // while a cycle is already in flight is a harmless no-op.
          requestSync();
        }}
        testID={SYNC_GATE_TEST_IDS.retryButton}
        variant="primary"
      /> : null}
    </View>
  );
}

/**
 * Builds the advancing-liveness line from the progress counters. During the pull
 * phase the layer count has a real, fixed denominator; the running row count is
 * shown whenever any rows have been applied this run.
 */
const describeActivity = (progress: SyncProgress): string => {
  const parts: string[] = [];

  if (progress.phase === 'pull') {
    const layer = Math.min(progress.layersCompleted + 1, PULL_LAYER_COUNT);
    parts.push(`Layer ${layer} of ${PULL_LAYER_COUNT}`);
  }

  if (progress.rowsApplied > 0) {
    const noun = progress.rowsApplied === 1 ? 'item' : 'items';
    parts.push(`${progress.rowsApplied} ${noun}`);
  }

  if (parts.length === 0) {
    return 'Working…';
  }

  return parts.join(' · ');
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: uiSpace.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: uiSpace.xl,
    gap: uiSpace.xl,
  },
  heading: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
    textAlign: 'center',
  },
  body: {
    gap: uiSpace.xl,
    alignItems: 'stretch',
  },
  phaseLabel: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
    textAlign: 'center',
  },
  activityRow: {
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  // `Layer K of N · M items`: counters, so Plex Mono.
  activityDetail: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
    textAlign: 'center',
  },
  // The failure's code + sanitized exception text: diagnostic, so Plex Mono and
  // muted like the activity counters; selectable so it can be copied.
  errorDetail: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
    textAlign: 'center',
  },
  // An error, so `danger` (T05-D3), beside the one `accent` Retry.
  errorMessage: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
    textAlign: 'center',
  },
});
