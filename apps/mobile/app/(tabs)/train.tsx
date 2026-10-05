import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StartDisc } from '@/components/train';
import {
  ActionButton,
  Card,
  ScreenScroll,
  StatePanel,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import {
  DEFAULT_SESSION_ENTRY_COORDINATOR,
  loadActiveSessionId as loadActiveSessionIdFromDatabase,
  type PlannedSessionMaterializer,
  type SessionEntryCoordinator,
  type SessionEntryResult,
} from '@/src/session-entry';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

export type TrainPlanningState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'empty'; openManager: () => void }
  | {
      status: 'ready';
      title: string;
      detail: string;
      materialize: PlannedSessionMaterializer;
      openManager: () => void;
    };

export type TrainScreenProps = {
  isFocused?: boolean;
  loadActiveSessionId?: () => Promise<string | null>;
  planningState?: TrainPlanningState;
  sessionEntry?: SessionEntryCoordinator;
};

type LaunchKind = 'empty' | 'planned';

type ActiveCheck =
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'done'; activeSessionId: string | null };

/**
 * Whether a workout is in progress, read again on every focus as one row
 * (`findActiveSessionId`), never the whole history. A focus marks the check
 * pending in the same render, so a workout abandoned since the last read is
 * never acted on.
 */
function useActiveSessionCheck(isFocused: boolean, loadActiveSessionId: () => Promise<string | null>) {
  const [check, setCheck] = useState<ActiveCheck>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const [checkedFocus, setCheckedFocus] = useState(isFocused);
  if (checkedFocus !== isFocused) {
    setCheckedFocus(isFocused);
    if (isFocused) setCheck({ status: 'checking' });
  }

  useEffect(() => {
    if (!isFocused) return;
    let current = true;
    loadActiveSessionId().then(
      (activeSessionId) => {
        if (current) setCheck({ status: 'done', activeSessionId });
      },
      (error: unknown) => {
        if (current) setCheck({ status: 'error', message: error instanceof Error ? error.message : 'Unable to read sessions' });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, isFocused, loadActiveSessionId]);

  const retry = () => {
    setCheck({ status: 'checking' });
    setAttempt((value) => value + 1);
  };
  return { check, retry };
}

/**
 * Train, the way into personal training: one large disc that starts an empty
 * workout, and no title (the tab names the page), with the planning section
 * beneath it once planning is available. While a workout is in progress Train
 * is that workout: the Train tab opens it (`mainTabDestination`), and Train
 * reached any other way opens it too. The session view blocks the back
 * gesture while the workout is in progress, so this cannot loop.
 */
export function TrainScreen({
  isFocused = true,
  loadActiveSessionId = loadActiveSessionIdFromDatabase,
  planningState = { status: 'unavailable' },
  sessionEntry = DEFAULT_SESSION_ENTRY_COORDINATOR,
}: TrainScreenProps) {
  const router = useRouter();
  const launchInFlightRef = useRef(false);
  const [launchError, setLaunchError] = useState<{
    kind: LaunchKind;
    message: string;
  } | null>(null);
  const { check, retry } = useActiveSessionCheck(isFocused, loadActiveSessionId);
  const activeSessionId = check.status === 'done' ? check.activeSessionId : null;

  useEffect(() => {
    if (isFocused && activeSessionId) {
      router.push(sessionViewHref(activeSessionId));
    }
  }, [activeSessionId, isFocused, router]);

  // Nothing on screen changes while a workout starts: the press is simply
  // ignored until the session view opens (or the start fails).
  const openRecorder = async (
    kind: LaunchKind,
    launch: () => Promise<SessionEntryResult>,
  ) => {
    if (launchInFlightRef.current) {
      return;
    }

    launchInFlightRef.current = true;
    setLaunchError(null);
    try {
      const entry = await launch();
      router.push(sessionViewHref(entry.sessionId));
    } catch {
      setLaunchError({
        kind,
        message:
          kind === 'empty'
            ? "Couldn't start. Try again."
            : "Couldn't start this plan. Try again.",
      });
    } finally {
      launchInFlightRef.current = false;
    }
  };

  const content = () => {
    if (check.status === 'error') {
      return (
        <View style={styles.stage}>
          <Card style={styles.stretch}>
            <StatePanel
              action={{
                label: 'Retry',
                onPress: retry,
                testID: 'train-session-error-retry',
              }}
              body={check.message}
              fill={false}
              kind="error"
              testID="train-session-error"
              title="Couldn't check your workouts"
            />
          </Card>
        </View>
      );
    }

    // New-session actions wait until the app knows no workout is in progress
    // (a workout in progress is being opened instead), without the disc
    // changing while they wait.
    const ready = check.status === 'done' && !activeSessionId;
    return (
      <>
        <View style={styles.stage} testID="train-start-section">
          <StartDisc
            accessibilityLabel="Start workout"
            busy={!ready}
            compact={ready && planningState.status === 'ready'}
            label="Start"
            onPress={() => {
              void openRecorder('empty', sessionEntry.startEmptyOrResume);
            }}
            testID="train-start-empty-button"
          />
          {launchError?.kind === 'empty' ? (
            <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.errorText} testID="train-empty-launch-error">
              {launchError.message}
            </Text>
          ) : null}
        </View>
        {ready ? (
          <TrainPlanning
            launchError={launchError?.kind === 'planned' ? launchError.message : null}
            onStart={(materialize) => {
              void openRecorder('planned', () =>
                sessionEntry.startPlannedOrResume(materialize),
              );
            }}
            planningState={planningState}
          />
        ) : null}
      </>
    );
  };

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="train-screen">
      {content()}
    </ScreenScroll>
  );
}

// Beneath the disc, only once planning has something to say: nothing while it
// is unavailable or loading.
function TrainPlanning({
  launchError,
  onStart,
  planningState,
}: {
  launchError: string | null;
  onStart: (materialize: PlannedSessionMaterializer) => void;
  planningState: TrainPlanningState;
}) {
  if (planningState.status === 'unavailable' || planningState.status === 'loading') {
    return null;
  }

  if (planningState.status === 'error') {
    return (
      <StatePanel
        action={
          planningState.retry
            ? { label: 'Retry', onPress: planningState.retry, testID: 'train-planning-error-retry' }
            : undefined
        }
        body={planningState.message}
        fill={false}
        kind="error"
        testID="train-planning-error"
        title="Couldn't load planning"
      />
    );
  }

  if (planningState.status === 'empty') {
    return (
      <View style={styles.planningLink} testID="train-planning-empty">
        <ActionButton
          label="Plan a workout"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="text"
        />
      </View>
    );
  }

  return (
    <View style={styles.planning} testID="train-planning-section">
      <Text allowFontScaling={false} style={styles.microLabel}>Planned</Text>
      <Card style={styles.planRow} testID="train-planned-session-card">
        <View style={styles.planCopy}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.planTitle}>{planningState.title}</Text>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.planDetail}>{planningState.detail}</Text>
        </View>
        <ActionButton
          accessibilityLabel={`Start ${planningState.title}`}
          label="Start"
          onPress={() => onStart(planningState.materialize)}
          testID="train-start-planned-button"
          variant="outline"
        />
      </Card>
      {launchError ? (
        <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.errorText} testID="train-planned-launch-error">
          {launchError}
        </Text>
      ) : null}
      <View style={styles.planningLink}>
        <ActionButton
          label="Manage planning"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="text"
        />
      </View>
    </View>
  );
}

export default function TrainRoute() {
  const isFocused = useIsFocused();
  return <TrainScreen isFocused={isFocused} />;
}

const styles = StyleSheet.create({
  // The disc centres in whatever height the planning section leaves it.
  content: {
    flexGrow: 1,
    gap: uiSpace.xl,
  },
  stage: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.lg,
  },
  stretch: {
    alignSelf: 'stretch',
  },
  planning: {
    gap: uiSpace.sm,
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
  },
  planTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  planDetail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  planningLink: {
    alignItems: 'center',
  },
  errorText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
    textAlign: 'center',
  },
});
