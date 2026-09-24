import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  SessionSummaryLine,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import {
  ActionButton,
  Card,
  Icon,
  PageHeader,
  ScreenScroll,
  SectionHeader,
  StatePanel,
  uiFonts,
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
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="train-screen">
      <PageHeader
        intro="Start or resume personal training; the session keeps the workout in one place."
        title="Train"
      />

      {isLoadingSessions ? (
        <StatePanel fill={false} kind="loading" testID="train-session-loading" title="Checking for an active workout…" />
      ) : loadErrorMessage ? (
        <Card>
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
      ) : activeSession ? (
        <View style={styles.section} testID="train-active-section">
          <SectionHeader title="Workout in progress" />
          <Card style={styles.card} testID="train-active-session-card">
            <View style={styles.cardCopy}>
              {/* "Current" is the ring glyph and the words, never a colour (G3). */}
              <View style={styles.statusRow}>
                <Icon name="set-current" size="sm" testID="train-active-session-glyph" />
                <Text style={styles.cardTitle}>Continue your active session</Text>
              </View>
              <SessionSummaryLine
                session={activeSession}
                testIdPrefix={`train-active-session-${activeSession.id}`}
              />
              <Text style={styles.cardBody}>Finish or discard this workout before starting another one.</Text>
            </View>
            <ActionButton
              label="Resume workout"
              onPress={() => router.push(sessionViewHref(activeSession.id))}
              testID="train-resume-session-button"
              variant="primary"
            />
          </Card>
        </View>
      ) : (
        <>
          <View style={styles.section} testID="train-start-section">
            <SectionHeader title="Start training" />
            <Card style={styles.card} testID="train-empty-session-card">
              <View style={styles.cardCopy}>
                <Text style={styles.cardTitle}>Empty workout</Text>
                <Text style={styles.cardBody}>Start with a blank session and add exercises as you go.</Text>
                {launchError?.kind === 'empty' ? (
                  <Text accessibilityLiveRegion="polite" style={styles.errorText} testID="train-empty-launch-error">
                    {launchError.message}
                  </Text>
                ) : null}
              </View>
              {/* One primary (T03-D1): a ready plan takes it, and the empty start steps back to outline. */}
              <ActionButton
                disabled={launchKind !== null}
                label={launchKind === 'empty' ? 'Starting…' : 'Start empty workout'}
                onPress={() => {
                  void openRecorder('empty', sessionEntry.startEmptyOrResume);
                }}
                testID="train-start-empty-button"
                variant={planningState.status === 'ready' ? 'outline' : 'primary'}
              />
            </Card>
          </View>

          <View style={styles.section} testID="train-planning-section">
            <SectionHeader title="Personal planning" />
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
    </ScreenScroll>
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
    return <StatePanel fill={false} kind="loading" testID="train-planning-loading" title="Loading your plan…" />;
  }

  if (planningState.status === 'error') {
    return (
      <Card>
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
      </Card>
    );
  }

  if (planningState.status === 'unavailable') {
    return (
      <Card>
        <StatePanel
          body="Personal planning is warming up. Empty workouts are ready above."
          fill={false}
          testID="train-planning-unavailable"
          title="Watch this space 👀"
        />
      </Card>
    );
  }

  if (planningState.status === 'empty') {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Manage planning', onPress: planningState.openManager, testID: 'train-manage-planning-button' }}
          body="Create a personal plan, or start an empty workout above."
          fill={false}
          testID="train-planning-empty"
          title="No workout planned"
        />
      </Card>
    );
  }

  return (
    <Card style={styles.card} testID="train-planned-session-card">
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{planningState.title}</Text>
        <Text style={styles.cardBody}>{planningState.detail}</Text>
        {launchError ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText} testID="train-planned-launch-error">
            {launchError}
          </Text>
        ) : null}
      </View>
      <View style={styles.actionStack}>
        <ActionButton
          disabled={disabled}
          label={isStarting ? 'Starting…' : 'Start planned workout'}
          onPress={() => onStart(planningState.materialize)}
          testID="train-start-planned-button"
          variant="primary"
        />
        <ActionButton
          disabled={disabled}
          label="Manage planning"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="outline"
        />
      </View>
    </Card>
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
  // Sections sit a step further apart than the cards inside them.
  content: {
    gap: uiSpace.xl,
  },
  section: {
    gap: uiSpace.md,
  },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  cardCopy: {
    gap: uiSpace.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  cardTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  cardBody: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  actionStack: {
    gap: uiSpace.sm,
  },
  errorText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
});
