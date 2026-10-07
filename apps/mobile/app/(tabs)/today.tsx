import { useIsFocused, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  TodayGroupSection,
  TodayProgressCard,
  useTodayGroup,
  useTodayProgress,
  type TodayGroupState,
  type TodayProgressLoader,
  type TodayProgressState,
} from '@/components/today';
import { Card, ScreenScroll, SectionHeader, StatePanel, uiSpace } from '@/components/ui';
import { groupsStreamPath } from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

export type TodayScreenProps = {
  isFocused?: boolean;
  // The progress read and its clock; the route uses the device's.
  loadProgress?: TodayProgressLoader;
  now?: () => Date;
  groupState: TodayGroupState;
};

const systemNow = () => new Date();

// Today has no title (the tab names the page) and no primary action, so no
// `accent`: it opens on the Progress card, then the group activity.
export function TodayScreen({ isFocused = true, loadProgress, now = systemNow, groupState }: TodayScreenProps) {
  const router = useRouter();
  const { state: progressState, retry: retryProgress } = useTodayProgress({ isFocused, load: loadProgress, now });
  // `View groups` opens the Groups screen on the group the card shows.
  const selectedGroupId = groupState.status === 'available' ? groupState.selectedGroupId : null;
  const groupsPath = selectedGroupId ? groupsStreamPath(selectedGroupId) : '/groups';

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

      <View style={styles.section} testID="today-group-section">
        <SectionHeader
          action={{ label: 'View groups', onPress: () => router.push(groupsPath), testID: 'today-view-groups-button' }}
          title="Group activity"
        />
        <TodayGroupSection
          nowMs={now().getTime()}
          onFindGroup={() => router.push('/group/mine')}
          onOpenGroup={(groupId) => router.push(groupsStreamPath(groupId))}
          onOpenSession={(memberId, sessionId, groupId) => router.push(`/group-session/${memberId}/${sessionId}?groupId=${encodeURIComponent(groupId)}`)}
          onSignIn={() => router.push(SIGN_IN_ROUTE)}
          state={groupState}
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

export default function TodayRoute() {
  const isFocused = useIsFocused();
  const groupState = useTodayGroup();
  return <TodayScreen groupState={groupState} isFocused={isFocused} />;
}

const styles = StyleSheet.create({
  // Sections sit a step further apart than the cards inside them.
  content: {
    gap: uiSpace.xl,
  },
  section: {
    gap: uiSpace.md,
  },
});
