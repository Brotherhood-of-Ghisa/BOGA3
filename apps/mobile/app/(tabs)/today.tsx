import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStreamMembershipItem,
  GroupStreamRecordCard,
  GroupStreamSessionCard,
  pickInlineError,
} from '@/components/groups';
import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  SessionSummaryLine,
  formatCompactDuration,
  formatDateTimeStamp,
  formatExerciseCount,
  formatLocationLabel,
  formatSetCount,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import {
  ActionButton,
  Card,
  Icon,
  ListRow,
  PageHeader,
  ScreenScroll,
  SectionHeader,
  StatePanel,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  buildStreamViewModel,
  groupsStreamPath,
  useGroupStream,
  type GroupApiError,
  type StreamItem,
} from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import {
  DEFAULT_SESSION_ENTRY_COORDINATOR,
  type PlannedSessionMaterializer,
  type SessionEntryCoordinator,
} from '@/src/session-entry';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

const RECENT_SESSION_LIMIT = 3;
const SOCIAL_ACTIVITY_LIMIT = 3;

const completedSessionAccessibilityLabel = (session: SessionListItem): string => {
  const duration = session.durationDisplay || formatCompactDuration(session.durationSec);
  const location = formatLocationLabel(session.gymName);

  return [
    `Completed session on ${formatDateTimeStamp(session.completedAt ?? session.startedAt)}`,
    duration,
    formatSetCount(session.setCount),
    formatExerciseCount(session.exerciseCount),
    location ? `at ${location}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
};

export type TodayPlanState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string; retry?: () => void }
  | {
      status: 'ready';
      title: string;
      detail: string;
      materialize: PlannedSessionMaterializer;
    };

export type TodaySocialState =
  | { status: 'auth-unavailable' }
  | { status: 'signed-out' }
  | {
      status: 'available';
      hasData: boolean;
      offline: boolean;
      error: GroupApiError | null;
      lastUpdatedAtMs: number | null;
      items: StreamItem[];
      refresh: () => Promise<void>;
    };

export type TodayScreenProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  isFocused?: boolean;
  planState?: TodayPlanState;
  sessionEntry?: Pick<SessionEntryCoordinator, 'startPlannedOrResume'>;
  socialState: TodaySocialState;
};

export function TodayScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  isFocused = true,
  planState = { status: 'unavailable' },
  sessionEntry = DEFAULT_SESSION_ENTRY_COORDINATOR,
  socialState,
}: TodayScreenProps) {
  const router = useRouter();
  const [planLaunchError, setPlanLaunchError] = useState<string | null>(null);
  const [isStartingPlan, setIsStartingPlan] = useState(false);
  const planLaunchInFlightRef = useRef(false);
  const { sessions, isLoadingSessions, loadErrorMessage, reloadSessions } = useSessionListData({
    dataClient,
    initialSessions,
    showDeletedSessions: false,
    isFocused,
  });

  const { activeSession, recentSessions } = useMemo(() => {
    const active = sessions.find(
      (session) => session.status === 'active' && session.deletedAt === null,
    );
    const recent = sessions
      .filter(
        (session) =>
          session.status === 'completed' &&
          session.deletedAt === null &&
          session.completedAt !== null,
      )
      .sort(
        (left, right) =>
          new Date(right.completedAt ?? 0).getTime() -
          new Date(left.completedAt ?? 0).getTime(),
      )
      .slice(0, RECENT_SESSION_LIMIT);

    return { activeSession: active, recentSessions: recent };
  }, [sessions]);

  const startPlan = async () => {
    if (planState.status !== 'ready' || planLaunchInFlightRef.current) {
      return;
    }

    planLaunchInFlightRef.current = true;
    setIsStartingPlan(true);
    setPlanLaunchError(null);
    try {
      const entry = await sessionEntry.startPlannedOrResume(planState.materialize);
      router.push(sessionViewHref(entry.sessionId));
    } catch {
      setPlanLaunchError("Couldn't start this planned session. Try again.");
    } finally {
      planLaunchInFlightRef.current = false;
      setIsStartingPlan(false);
    }
  };

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="today-screen">
      <PageHeader intro="Your next workout, group activity, and recent training at a glance." title="Today" />

      <View style={styles.section} testID="today-training-section">
        <SectionHeader title={activeSession ? 'Workout in progress' : 'Next workout'} />
        {activeSession ? (
          <Card style={styles.card} testID="today-active-session-card">
            <View style={styles.cardCopy}>
              {/* "Current" is the ring glyph and the words, never a colour (G3). */}
              <View style={styles.statusRow}>
                <Icon name="set-current" size="sm" testID="today-active-session-glyph" />
                <Text allowFontScaling={false} style={styles.cardTitle}>Active session</Text>
              </View>
              <SessionSummaryLine
                session={activeSession}
                testIdPrefix={`today-active-session-${activeSession.id}`}
              />
            </View>
            <ActionButton
              label="Resume workout"
              onPress={() => router.push(sessionViewHref(activeSession.id))}
              testID="today-resume-session-button"
              variant="primary"
            />
          </Card>
        ) : (
          <TodayPlanCard
            errorMessage={planLaunchError}
            isStarting={isStartingPlan}
            onOpenTrain={() => router.push('/train')}
            onStart={() => {
              void startPlan();
            }}
            planState={planState}
          />
        )}
      </View>

      <View style={styles.section} testID="today-social-section">
        <SectionHeader
          action={{ label: 'View groups', onPress: () => router.push('/groups'), testID: 'today-view-groups-button' }}
          title="Group activity"
        />
        <TodaySocialSnapshot
          onOpenGroup={(groupId) => router.push(groupsStreamPath(groupId))}
          onOpenSession={(memberId, sessionId) =>
            router.push(`/group-session/${memberId}/${sessionId}`)
          }
          onSignIn={() => router.push(SIGN_IN_ROUTE)}
          socialState={socialState}
        />
      </View>

      <View style={styles.section} testID="today-recents-section">
        <SectionHeader
          action={{ label: 'View progress', onPress: () => router.push('/progress'), testID: 'today-view-progress-button' }}
          title="Recent sessions"
        />
        {isLoadingSessions ? (
          <StatePanel fill={false} kind="loading" testID="today-recents-loading" title="Loading sessions…" />
        ) : loadErrorMessage ? (
          <Card>
            <StatePanel
              action={{
                label: 'Retry',
                onPress: () => {
                  void reloadSessions();
                },
                testID: 'today-recents-error-retry',
              }}
              body={loadErrorMessage}
              fill={false}
              kind="error"
              testID="today-recents-error"
              title="Couldn't load recent sessions"
            />
          </Card>
        ) : recentSessions.length === 0 ? (
          <Card>
            <StatePanel
              action={{ label: 'Open Train', onPress: () => router.push('/train'), testID: 'today-empty-open-train' }}
              body="Completed workouts will appear here. Start from Train when you're ready."
              fill={false}
              testID="today-recents-empty"
              title="No sessions yet"
            />
          </Card>
        ) : (
          <Card>
            {recentSessions.map((session, index) => (
              <ListRow
                accessibilityHint="Opens the completed session"
                accessibilityLabel={completedSessionAccessibilityLabel(session)}
                density="list"
                divider={index > 0}
                key={session.id}
                onPress={() => router.push(`/completed-session/${session.id}`)}
                testID={`today-recent-session-${session.id}`}
                trailing={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />}>
                <View style={styles.recentSummary}>
                  <SessionSummaryLine
                    session={session}
                    testIdPrefix={`today-recent-session-summary-${session.id}`}
                  />
                </View>
              </ListRow>
            ))}
          </Card>
        )}
      </View>
    </ScreenScroll>
  );
}

function TodayPlanCard({
  errorMessage,
  isStarting,
  onOpenTrain,
  onStart,
  planState,
}: {
  errorMessage: string | null;
  isStarting: boolean;
  onOpenTrain: () => void;
  onStart: () => void;
  planState: TodayPlanState;
}) {
  if (planState.status === 'loading') {
    return <StatePanel fill={false} kind="loading" testID="today-plan-loading" title="Loading your plan…" />;
  }

  if (planState.status === 'error') {
    return (
      <Card>
        <StatePanel
          action={{
            label: planState.retry ? 'Retry' : 'Open Train',
            onPress: planState.retry ?? onOpenTrain,
            testID: 'today-plan-error-action',
          }}
          body={planState.message}
          fill={false}
          kind="error"
          testID="today-plan-error"
          title="Couldn't load your plan"
        />
      </Card>
    );
  }

  if (planState.status === 'ready') {
    return (
      <Card style={styles.card} testID="today-planned-session-card">
        <View style={styles.cardCopy}>
          <Text allowFontScaling={false} style={styles.cardTitle}>{planState.title}</Text>
          <Text allowFontScaling={false} style={styles.cardBody}>{planState.detail}</Text>
          {errorMessage ? (
            <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.errorText} testID="today-plan-launch-error">
              {errorMessage}
            </Text>
          ) : null}
        </View>
        <ActionButton
          disabled={isStarting}
          label={isStarting ? 'Starting…' : 'Start planned workout'}
          onPress={onStart}
          testID="today-start-planned-session-button"
          variant="primary"
        />
      </Card>
    );
  }

  const unavailable = planState.status === 'unavailable';
  return (
    <Card>
      <StatePanel
        action={{ label: 'Open Train', onPress: onOpenTrain, testID: 'today-open-train-button' }}
        body={
          unavailable
            ? 'Personal planning is warming up. Empty workouts are ready now in Train.'
            : 'Nothing is scheduled. Open Train to start an empty workout or manage your plan.'
        }
        fill={false}
        testID={unavailable ? 'today-plan-unavailable' : 'today-plan-empty'}
        title={unavailable ? 'Watch this space 👀' : 'No workout planned'}
      />
    </Card>
  );
}

function TodaySocialSnapshot({
  onOpenGroup,
  onOpenSession,
  onSignIn,
  socialState,
}: {
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberId: string, sessionId: string) => void;
  onSignIn: () => void;
  socialState: TodaySocialState;
}) {
  if (socialState.status === 'auth-unavailable') {
    return (
      <Card>
        <StatePanel
          body="Groups need an account, and sign-in is not available in this build."
          fill={false}
          testID="today-social-auth-unavailable"
          title="Group activity needs an account"
        />
      </Card>
    );
  }

  if (socialState.status === 'signed-out') {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Sign in', onPress: onSignIn, testID: 'today-social-sign-in' }}
          body="Sign in to see activity from groups you've joined."
          fill={false}
          testID="today-social-signed-out"
          title="Group activity needs an account"
        />
      </Card>
    );
  }

  const inlineError = pickInlineError(socialState.error);
  // Today is a compact orientation surface, not a second copy of the full
  // Groups feed: sessions, records and membership changes only. Records are
  // read-only here; certifying happens on the Groups screen they open.
  const snapshotItems = socialState.items
    .filter((item) => item.kind === 'session' || item.kind === 'record' || item.kind === 'membership')
    .slice(0, SOCIAL_ACTIVITY_LIMIT);
  const viewModels = buildStreamViewModel(snapshotItems);

  return (
    <View style={styles.list}>
      {socialState.offline ? (
        <GroupOfflineBanner lastUpdatedAtMs={socialState.lastUpdatedAtMs} />
      ) : null}
      {inlineError && socialState.hasData ? (
        <GroupInlineError
          error={inlineError}
          onRetry={() => {
            void socialState.refresh();
          }}
          testID="today-social-inline-error"
        />
      ) : null}
      {!socialState.hasData ? (
        <GroupMissingDataState
          error={inlineError}
          offline={socialState.offline}
          onRetry={() => {
            void socialState.refresh();
          }}
          testIDPrefix="today-social"
        />
      ) : viewModels.length === 0 ? (
        <Card>
          <StatePanel
            body="Sessions, records and membership updates from groups you've joined will appear here."
            fill={false}
            testID="today-social-empty"
            title="No group activity yet"
          />
        </Card>
      ) : (
        viewModels.map((item) => {
          if (item.kind === 'session') {
            return (
              <GroupStreamSessionCard
                card={item}
                key={item.key}
                onPress={(card) => onOpenSession(card.memberUserId, card.sessionId)}
                showGroupNames
              />
            );
          }
          if (item.kind === 'record') {
            return (
              <GroupStreamRecordCard
                card={item}
                key={item.key}
                onPress={(card) => onOpenGroup(card.record.group.group_id)}
                pressHint="Opens the group"
                showGroupName
              />
            );
          }
          if (item.kind === 'membership') {
            return (
              <GroupStreamMembershipItem
                item={item}
                key={item.key}
                onPress={(membership) => onOpenGroup(membership.groupId)}
                showGroupName
              />
            );
          }
          return null;
        })
      )}
    </View>
  );
}

export default function TodayRoute() {
  const isFocused = useIsFocused();
  const { isConfigured, user } = useAuth();
  const groupStream = useGroupStream({ userId: user?.id ?? null, groupId: null });

  let socialState: TodaySocialState;
  if (!isConfigured) {
    socialState = { status: 'auth-unavailable' };
  } else if (!user) {
    socialState = { status: 'signed-out' };
  } else {
    socialState = {
      status: 'available',
      hasData: groupStream.data !== null,
      offline: groupStream.offline,
      error: groupStream.error,
      lastUpdatedAtMs: groupStream.lastUpdatedAtMs,
      items: groupStream.items,
      refresh: groupStream.refresh,
    };
  }

  return (
    <TodayScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      isFocused={isFocused}
      socialState={socialState}
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
  list: {
    gap: uiSpace.sm,
  },
  recentSummary: {
    paddingVertical: uiSpace.sm,
  },
  errorText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
});
