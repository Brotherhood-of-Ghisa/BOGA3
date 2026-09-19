import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
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
  UiButton,
  UiSurface,
  UiText,
  uiColors,
  uiRadius,
  uiSpace,
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
      await sessionEntry.startPlannedOrResume(planState.materialize);
      router.push('/session-recorder');
    } catch {
      setPlanLaunchError("Couldn't start this planned session. Try again.");
    } finally {
      planLaunchInFlightRef.current = false;
      setIsStartingPlan(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      testID="today-screen">
      <View style={styles.intro}>
        <UiText accessibilityRole="header" selectable style={styles.screenTitle} variant="title">
          Today
        </UiText>
        <UiText selectable variant="bodyMuted">
          Your next workout, group activity, and recent training at a glance.
        </UiText>
      </View>

      <View style={styles.section} testID="today-training-section">
        <UiText accessibilityRole="header" selectable variant="title">
          {activeSession ? 'Workout in progress' : 'Next workout'}
        </UiText>
        {activeSession ? (
          <UiSurface style={[styles.card, styles.activeCard]} testID="today-active-session-card">
            <View style={styles.cardCopy}>
              <UiText selectable variant="labelStrong">
                Active session
              </UiText>
              <SessionSummaryLine
                session={activeSession}
                testIdPrefix={`today-active-session-${activeSession.id}`}
              />
            </View>
            <UiButton
              label="Resume workout"
              onPress={() => router.push('/session-recorder')}
              testID="today-resume-session-button"
            />
          </UiSurface>
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
          actionLabel="View groups"
          onAction={() => router.push('/groups')}
          testID="today-view-groups-button"
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
          actionLabel="View progress"
          onAction={() => router.push('/progress')}
          testID="today-view-progress-button"
          title="Recent sessions"
        />
        {isLoadingSessions ? (
          <View style={styles.loading} testID="today-recents-loading">
            <ActivityIndicator color={uiColors.textSecondary} />
            <UiText selectable variant="bodyMuted">
              Loading sessions…
            </UiText>
          </View>
        ) : loadErrorMessage ? (
          <GroupStateView
            actionLabel="Retry"
            actionTestID="today-recents-error-retry"
            body={loadErrorMessage}
            onAction={() => {
              void reloadSessions();
            }}
            testID="today-recents-error"
            title="Couldn't load recent sessions"
          />
        ) : recentSessions.length === 0 ? (
          <GroupStateView
            body="Completed workouts will appear here. Start from Train when you're ready."
            actionLabel="Open Train"
            actionTestID="today-empty-open-train"
            onAction={() => router.push('/train')}
            testID="today-recents-empty"
            title="No sessions yet"
          />
        ) : (
          <View style={styles.list}>
            {recentSessions.map((session) => (
              <Pressable
                accessibilityHint="Opens the completed session"
                accessibilityLabel={completedSessionAccessibilityLabel(session)}
                accessibilityRole="button"
                key={session.id}
                onPress={() => router.push(`/completed-session/${session.id}`)}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
                testID={`today-recent-session-${session.id}`}>
                <UiSurface style={styles.recentCard}>
                  <View style={styles.recentSummary}>
                    <SessionSummaryLine
                      session={session}
                      testIdPrefix={`today-recent-session-summary-${session.id}`}
                    />
                  </View>
                  <UiText
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    selectable={false}
                    style={styles.chevron}
                    variant="labelStrong">
                    ›
                  </UiText>
                </UiSurface>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
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
    return (
      <View style={styles.loading} testID="today-plan-loading">
        <ActivityIndicator color={uiColors.textSecondary} />
        <UiText selectable variant="bodyMuted">
          Loading your plan…
        </UiText>
      </View>
    );
  }

  if (planState.status === 'error') {
    return (
      <GroupStateView
        actionLabel={planState.retry ? 'Retry' : 'Open Train'}
        actionTestID="today-plan-error-action"
        body={planState.message}
        onAction={planState.retry ?? onOpenTrain}
        testID="today-plan-error"
        title="Couldn't load your plan"
      />
    );
  }

  if (planState.status === 'ready') {
    return (
      <UiSurface style={styles.card} testID="today-planned-session-card">
        <View style={styles.cardCopy}>
          <UiText selectable variant="labelStrong">
            {planState.title}
          </UiText>
          <UiText selectable variant="bodyMuted">
            {planState.detail}
          </UiText>
          {errorMessage ? (
            <UiText
              accessibilityLiveRegion="polite"
              selectable
              style={styles.errorText}
              testID="today-plan-launch-error"
              variant="bodyMuted">
              {errorMessage}
            </UiText>
          ) : null}
        </View>
        <UiButton
          disabled={isStarting}
          label={isStarting ? 'Starting…' : 'Start planned workout'}
          onPress={onStart}
          testID="today-start-planned-session-button"
        />
      </UiSurface>
    );
  }

  const unavailable = planState.status === 'unavailable';
  return (
    <GroupStateView
      actionLabel="Open Train"
      actionTestID="today-open-train-button"
      body={
        unavailable
          ? 'Personal planning is warming up. Empty workouts are ready now in Train.'
          : 'Nothing is scheduled. Open Train to start an empty workout or manage your plan.'
      }
      onAction={onOpenTrain}
      testID={unavailable ? 'today-plan-unavailable' : 'today-plan-empty'}
      title={unavailable ? 'Watch this space 👀' : 'No workout planned'}
    />
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
      <GroupStateView
        body="Groups need an account, and sign-in is not available in this build."
        testID="today-social-auth-unavailable"
        title="Group activity needs an account"
      />
    );
  }

  if (socialState.status === 'signed-out') {
    return (
      <GroupStateView
        actionLabel="Sign in"
        actionTestID="today-social-sign-in"
        body="Sign in to see activity from groups you've joined."
        onAction={onSignIn}
        testID="today-social-signed-out"
        title="Group activity needs an account"
      />
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
        <GroupStateView
          body="Sessions, records and membership updates from groups you've joined will appear here."
          testID="today-social-empty"
          title="No group activity yet"
        />
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

function SectionHeader({
  actionLabel,
  onAction,
  testID,
  title,
}: {
  actionLabel: string;
  onAction: () => void;
  testID: string;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <UiText accessibilityRole="header" selectable style={styles.sectionTitle} variant="title">
        {title}
      </UiText>
      <UiButton
        label={actionLabel}
        onPress={onAction}
        style={styles.sectionAction}
        testID={testID}
        textStyle={styles.sectionActionText}
        variant="secondary"
      />
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
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.screen,
    paddingBottom: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  intro: {
    gap: uiSpace.sm,
  },
  screenTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  section: {
    gap: uiSpace.md,
  },
  sectionHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  sectionTitle: {
    flex: 1,
  },
  sectionAction: {
    minHeight: 36,
    paddingVertical: uiSpace.xs,
  },
  sectionActionText: {
    fontSize: 12,
  },
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.lg,
  },
  activeCard: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  cardCopy: {
    gap: uiSpace.sm,
  },
  list: {
    gap: uiSpace.sm,
  },
  recentCard: {
    minHeight: 62,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  recentSummary: {
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
    color: uiColors.textSecondary,
  },
  pressed: {
    opacity: 0.92,
  },
  loading: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.sm,
    borderRadius: uiRadius.md,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
});
