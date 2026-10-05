import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
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
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  isFocused?: boolean;
  planningState?: TrainPlanningState;
  sessionEntry?: SessionEntryCoordinator;
};

type LaunchKind = 'empty' | 'planned';

/**
 * Train, the way into personal training: one large disc that starts an empty
 * workout, and no title (the tab names the page), with the planning section
 * beneath it once planning is available. While a workout is in progress Train
 * is that workout: the Train tab opens it (`mainTabDestination`), and Train
 * reached any other way replaces itself with it. A started workout replaces
 * Train too, so going back from it never lands here.
 */
export function TrainScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  isFocused = true,
  planningState = { status: 'unavailable' },
  sessionEntry = DEFAULT_SESSION_ENTRY_COORDINATOR,
}: TrainScreenProps) {
  const router = useRouter();
  const launchInFlightRef = useRef(false);
  const [launchKind, setLaunchKind] = useState<LaunchKind | null>(null);
  const [launchError, setLaunchError] = useState<{
    kind: LaunchKind;
    message: string;
  } | null>(null);
  const { sessions, isLoadingSessions, loadErrorMessage, reloadSessions } = useSessionListData({
    dataClient,
    initialSessions,
    showDeletedSessions: false,
    isFocused,
  });

  const activeSessionId = sessions.find(
    (session) => session.status === 'active' && session.deletedAt === null,
  )?.id;

  useEffect(() => {
    if (isFocused && !isLoadingSessions && activeSessionId) {
      router.replace(sessionViewHref(activeSessionId));
    }
  }, [activeSessionId, isFocused, isLoadingSessions, router]);

  const openRecorder = async (
    kind: LaunchKind,
    launch: () => Promise<SessionEntryResult>,
  ) => {
    if (launchInFlightRef.current) {
      return;
    }

    launchInFlightRef.current = true;
    setLaunchKind(kind);
    setLaunchError(null);
    try {
      const entry = await launch();
      router.replace(sessionViewHref(entry.sessionId));
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
      setLaunchKind(null);
    }
  };

  const content = () => {
    if (isLoadingSessions || activeSessionId) {
      // New-session actions wait until the app knows no workout is in progress;
      // a workout in progress is being opened instead.
      return (
        <View style={styles.stage}>
          <StartDisc
            accessibilityLabel="Checking for a workout in progress"
            disabled
            label="Start"
            onPress={() => undefined}
            testID="train-session-loading"
          />
        </View>
      );
    }

    if (loadErrorMessage) {
      return (
        <View style={styles.stage}>
          <Card style={styles.stretch}>
            <StatePanel
              action={{
                label: 'Retry',
                onPress: () => {
                  void reloadSessions();
                },
                testID: 'train-session-error-retry',
              }}
              body={loadErrorMessage}
              fill={false}
              kind="error"
              testID="train-session-error"
              title="Couldn't check your workouts"
            />
          </Card>
        </View>
      );
    }

    return (
      <>
        <View style={styles.stage} testID="train-start-section">
          <StartDisc
            accessibilityLabel="Start workout"
            compact={planningState.status === 'ready'}
            disabled={launchKind !== null}
            label={launchKind === 'empty' ? 'Starting…' : 'Start'}
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
        <TrainPlanning
          disabled={launchKind !== null}
          isStarting={launchKind === 'planned'}
          launchError={launchError?.kind === 'planned' ? launchError.message : null}
          onStart={(materialize) => {
            void openRecorder('planned', () =>
              sessionEntry.startPlannedOrResume(materialize),
            );
          }}
          planningState={planningState}
        />
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
  disabled,
  isStarting,
  launchError,
  onStart,
  planningState,
}: {
  disabled: boolean;
  isStarting: boolean;
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
          disabled={disabled}
          label={isStarting ? 'Starting…' : 'Start'}
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
          disabled={disabled}
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
  return (
    <TrainScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      isFocused={isFocused}
    />
  );
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
