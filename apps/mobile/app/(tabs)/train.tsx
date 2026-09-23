import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { GroupStateView } from '@/components/groups';
import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  SessionSummaryLine,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { UiButton, UiSurface, UiText, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
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

  const activeSession = sessions.find(
    (session) => session.status === 'active' && session.deletedAt === null,
  );

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
      router.push(sessionViewHref(entry.sessionId));
    } catch {
      setLaunchError({
        kind,
        message:
          kind === 'empty'
            ? "Couldn't start a workout. Try again."
            : "Couldn't start this planned workout. Try again.",
      });
    } finally {
      launchInFlightRef.current = false;
      setLaunchKind(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      testID="train-screen">
      <View style={styles.intro}>
        <UiText accessibilityRole="header" selectable style={styles.screenTitle} variant="title">
          Train
        </UiText>
        <UiText selectable variant="bodyMuted">
          Start or resume personal training, then keep the recorder focused on the workout.
        </UiText>
      </View>

      {isLoadingSessions ? (
        <View style={styles.loading} testID="train-session-loading">
          <ActivityIndicator color={uiColors.textSecondary} />
          <UiText selectable variant="bodyMuted">
            Checking for an active workout…
          </UiText>
        </View>
      ) : loadErrorMessage ? (
        <GroupStateView
          actionLabel="Retry"
          actionTestID="train-session-error-retry"
          body={loadErrorMessage}
          onAction={() => {
            void reloadSessions();
          }}
          testID="train-session-error"
          title="Couldn't check your workouts"
        />
      ) : activeSession ? (
        <View style={styles.section} testID="train-active-section">
          <UiText accessibilityRole="header" selectable variant="title">
            Workout in progress
          </UiText>
          <UiSurface style={[styles.card, styles.activeCard]} testID="train-active-session-card">
            <View style={styles.cardCopy}>
              <UiText selectable variant="labelStrong">
                Continue your active session
              </UiText>
              <SessionSummaryLine
                session={activeSession}
                testIdPrefix={`train-active-session-${activeSession.id}`}
              />
              <UiText selectable variant="bodyMuted">
                Finish or discard this workout before starting another one.
              </UiText>
            </View>
            <UiButton
              label="Resume workout"
              onPress={() => router.push(sessionViewHref(activeSession.id))}
              testID="train-resume-session-button"
            />
          </UiSurface>
        </View>
      ) : (
        <>
          <View style={styles.section} testID="train-start-section">
            <UiText accessibilityRole="header" selectable variant="title">
              Start training
            </UiText>
            <UiSurface style={styles.card} testID="train-empty-session-card">
              <View style={styles.cardCopy}>
                <UiText selectable variant="labelStrong">
                  Empty workout
                </UiText>
                <UiText selectable variant="bodyMuted">
                  Start with a blank session and choose exercises in the recorder.
                </UiText>
                {launchError?.kind === 'empty' ? (
                  <UiText
                    accessibilityLiveRegion="polite"
                    selectable
                    style={styles.errorText}
                    testID="train-empty-launch-error"
                    variant="bodyMuted">
                    {launchError.message}
                  </UiText>
                ) : null}
              </View>
              <UiButton
                disabled={launchKind !== null}
                label={launchKind === 'empty' ? 'Starting…' : 'Start empty workout'}
                onPress={() => {
                  void openRecorder('empty', sessionEntry.startEmptyOrResume);
                }}
                testID="train-start-empty-button"
              />
            </UiSurface>
          </View>

          <View style={styles.section} testID="train-planning-section">
            <UiText accessibilityRole="header" selectable variant="title">
              Personal planning
            </UiText>
            <TrainPlanningCard
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
          </View>
        </>
      )}
    </ScrollView>
  );
}

function TrainPlanningCard({
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
  if (planningState.status === 'loading') {
    return (
      <View style={styles.loading} testID="train-planning-loading">
        <ActivityIndicator color={uiColors.textSecondary} />
        <UiText selectable variant="bodyMuted">
          Loading your plan…
        </UiText>
      </View>
    );
  }

  if (planningState.status === 'error') {
    return (
      <GroupStateView
        actionLabel={planningState.retry ? 'Retry' : undefined}
        actionTestID="train-planning-error-retry"
        body={planningState.message}
        onAction={planningState.retry}
        testID="train-planning-error"
        title="Couldn't load planning"
      />
    );
  }

  if (planningState.status === 'unavailable') {
    return (
      <GroupStateView
        body="Personal planning is warming up. Empty workouts are ready above."
        testID="train-planning-unavailable"
        title="Watch this space 👀"
      />
    );
  }

  if (planningState.status === 'empty') {
    return (
      <GroupStateView
        actionLabel="Manage planning"
        actionTestID="train-manage-planning-button"
        body="Create a personal plan, or start an empty workout above."
        onAction={planningState.openManager}
        testID="train-planning-empty"
        title="No workout planned"
      />
    );
  }

  return (
    <UiSurface style={styles.card} testID="train-planned-session-card">
      <View style={styles.cardCopy}>
        <UiText selectable variant="labelStrong">
          {planningState.title}
        </UiText>
        <UiText selectable variant="bodyMuted">
          {planningState.detail}
        </UiText>
        {launchError ? (
          <UiText
            accessibilityLiveRegion="polite"
            selectable
            style={styles.errorText}
            testID="train-planned-launch-error"
            variant="bodyMuted">
            {launchError}
          </UiText>
        ) : null}
      </View>
      <View style={styles.actionStack}>
        <UiButton
          disabled={disabled}
          label={isStarting ? 'Starting…' : 'Start planned workout'}
          onPress={() => onStart(planningState.materialize)}
          testID="train-start-planned-button"
        />
        <UiButton
          disabled={disabled}
          label="Manage planning"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="secondary"
        />
      </View>
    </UiSurface>
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
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.xl,
    paddingBottom: uiSpace.xl,
    gap: uiSpace.lg,
  },
  intro: {
    gap: uiSpace.sm,
  },
  screenTitle: {
    fontSize: uiTypography.size.xxl,
    lineHeight: 30,
  },
  section: {
    gap: uiSpace.md,
  },
  card: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  activeCard: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  cardCopy: {
    gap: uiSpace.sm,
  },
  actionStack: {
    gap: uiSpace.sm,
  },
  loading: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.sm,
    borderRadius: uiRadius.md,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
});
