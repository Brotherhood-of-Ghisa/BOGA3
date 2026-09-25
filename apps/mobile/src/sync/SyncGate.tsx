import { Redirect, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';
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
import { SIGN_IN_ROUTE, isMaestroHarnessRoutePathname, isSignInRoutePathname } from '@/src/navigation/routes';
import { PULL_LAYER_COUNT, type SyncPhase, type SyncProgress } from '@/src/sync/progress';
import { requestSync } from '@/src/sync/scheduler';
import { selectSyncGateMode } from '@/src/sync/sync-gate-decision';
import { useSyncGateState } from '@/src/sync/use-sync-gate-state';

/**
 * The dev/test harness route is exempt from the block. It is the deterministic
 * driver tests use to flip the first-sync state on and off, so it must stay
 * reachable even while the gate is up — otherwise the very screen that would
 * lift the block can never mount behind it. The route is dev-gated and has no
 * production reachability, so exempting it never weakens the gate for real users.
 */
/** Stable testIDs for the gate's surfaces, so tests and Maestro flows can target them. */
export const SYNC_GATE_TEST_IDS = {
  block: 'sync-gate-block',
  phaseLabel: 'sync-gate-phase-label',
  activityIndicator: 'sync-gate-activity-indicator',
  activityDetail: 'sync-gate-activity-detail',
  offlineMessage: 'sync-gate-offline-message',
  errorMessage: 'sync-gate-error-message',
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
const ERROR_MESSAGES: Record<'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'INTERNAL', string> = {
  INTERNAL: 'We could not finish setting up your data. Check your connection and try again.',
  FK_VIOLATION: 'Something went wrong while setting up your data. Please try again.',
  LOCAL_FK_VIOLATION: 'Something went wrong while setting up your data. Please try again.',
};

/**
 * First-sync gate. Sits below the route-layer auth guard, so it only renders for
 * a signed-in user. While the device has not yet drained its first sync cycle
 * (the persisted bootstrap flag is null) it shows a full-screen "Setting up your
 * data…" block in place of the app's normal routes; once the flag is set it
 * renders its children untouched.
 *
 * While the block is up it surfaces, so a stalled gate is self-explanatory:
 *   - the current phase of the first sync,
 *   - an activity indicator plus advancing counters ("layer K of N", "M items")
 *     as the liveness proof that work is happening, and
 *   - an offline message instead of an indefinite spinner when the device has no
 *     network.
 *
 * On a cycle error it shows the error and a single Retry that fires exactly one
 * cycle. When the latest cycle reported "no signed-in user" it routes to the
 * sign-in screen and renders no Retry — a retry would only re-hit the same
 * outcome; the user must sign in first.
 */
export function SyncGate({ children }: PropsWithChildren) {
  const { isConfigured, session } = useAuth();
  const snapshot = useSyncGateState();
  const pathname = usePathname();
  const mode = selectSyncGateMode({ isConfigured, session }, snapshot);

  if (mode.kind === 'pass') {
    return <>{children}</>;
  }

  // The sign-in route is exempt: render it through rather than blocking or
  // redirecting onto it, so a "no signed-in user" outcome cannot trap the user
  // behind the gate (or loop the redirect) before they can sign in.
  //
  // The dev/test harness route is exempt for the same shape of reason: it is the
  // screen that flips the first-sync state, so it must render through the block
  // to be able to lift it.
  if (isSignInRoutePathname(pathname) || isMaestroHarnessRoutePathname(pathname)) {
    return <>{children}</>;
  }

  if (mode.kind === 'route-to-sign-in') {
    return <Redirect href={SIGN_IN_ROUTE} />;
  }

  return (
    <Screen style={styles.container} testID={SYNC_GATE_TEST_IDS.block}>
      <Card style={styles.card}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>
          Setting up your data…
        </Text>

        {mode.kind === 'error' ? (
          <GateError errorCode={mode.errorCode} />
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

/** The error body: a human message plus a single Retry that fires one cycle. */
function GateError({ errorCode }: { errorCode: 'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'INTERNAL' }) {
  return (
    <View style={styles.body}>
      <Text allowFontScaling={false} accessibilityRole="alert" style={styles.errorMessage} testID={SYNC_GATE_TEST_IDS.errorMessage}>
        {ERROR_MESSAGES[errorCode]}
      </Text>
      <ActionButton
        accessibilityLabel="Retry"
        label="Retry"
        onPress={() => {
          // Fire exactly one cycle. The scheduler coalesces, so a second tap
          // while a cycle is already in flight is a harmless no-op.
          requestSync();
        }}
        testID={SYNC_GATE_TEST_IDS.retryButton}
        variant="primary"
      />
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
