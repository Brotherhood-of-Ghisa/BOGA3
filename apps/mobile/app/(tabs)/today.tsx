import type { CurrentGroupStreamItem as StreamItem } from '@/src/groups/metric-wire';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import { useIsFocused, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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
  TodayProgressCard,
  useTodayProgress,
  type TodayProgressLoader,
  type TodayProgressState,
} from '@/components/today';
import { Card, ScreenScroll, SectionHeader, StatePanel, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  buildStreamViewModel,
  groupsStreamPath,
  useGroupStream,
  type GroupApiError,
} from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

const SOCIAL_ACTIVITY_LIMIT = 3;

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
  isFocused?: boolean;
  // The progress read and its clock; the route uses the device's.
  loadProgress?: TodayProgressLoader;
  now?: () => Date;
  socialState: TodaySocialState;
};

// Today has no title and no primary action (`design-targets/today-landing.md`):
// it opens on the Progress card, then the group activity.
export function TodayScreen({ isFocused = true, loadProgress, now, socialState }: TodayScreenProps) {
  const router = useRouter();
  const { state: progressState, retry: retryProgress } = useTodayProgress({ isFocused, load: loadProgress, now });

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="today-screen">
      <View style={styles.section} testID="today-progress-section">
        <SectionHeader
          action={{ label: 'View progress', onPress: () => router.push('/progress'), testID: 'today-view-progress-button' }}
          title="Progress"
        />
        <TodayProgressSection
          onOpenSession={(sessionId) => router.push(`/completed-session/${sessionId}`)}
          onOpenSessions={() => router.push('/sessions')}
          onOpenTrain={() => router.push('/train')}
          onRetry={() => {
            void retryProgress();
          }}
          state={progressState}
        />
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
    </ScreenScroll>
  );
}

function TodayProgressSection({
  onOpenSession,
  onOpenSessions,
  onOpenTrain,
  onRetry,
  state,
}: {
  onOpenSession: (sessionId: string) => void;
  onOpenSessions: () => void;
  onOpenTrain: () => void;
  onRetry: () => void;
  state: TodayProgressState;
}) {
  if (state.status === 'loading') {
    return <StatePanel fill={false} kind="loading" testID="today-progress-loading" title="Loading your progress…" />;
  }

  if (state.status === 'error') {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Retry', onPress: onRetry, testID: 'today-progress-error-retry' }}
          body={state.message}
          fill={false}
          kind="error"
          testID="today-progress-error"
          title="Couldn't load your progress"
        />
      </Card>
    );
  }

  if (state.progress.status === 'empty') {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Open Train', onPress: onOpenTrain, testID: 'today-empty-open-train' }}
          body="Log a workout and your sessions, working sets and PRs show up here, against last month."
          fill={false}
          testID="today-progress-empty"
          title="Your week starts here"
        />
      </Card>
    );
  }

  return (
    <TodayProgressCard onOpenSession={onOpenSession} onOpenSessions={onOpenSessions} progress={state.progress} />
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
          if (item.kind === 'metric_event') return <GroupMetricStreamCard key={item.key} item={item.event} userId={null} showGroupName onPress={() => onOpenGroup(item.event.group.group_id)} pressHint="Opens the group" />;
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
    <TodayScreen isFocused={isFocused} socialState={socialState} />
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
  list: {
    gap: uiSpace.sm,
  },
});
