import { useIsFocused, useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  TodayCards,
  TodayGroupSection,
  TodayPanel,
  TodayPlanCards,
  TodayProgressCard,
  useTodayGroup,
  useTodayPlan,
  useTodayProgress,
  type TodayGroupState,
  type TodayPlanLoader,
  type TodayPlanState,
  type TodayProgressLoader,
  type TodayProgressState,
} from '@/components/today';
import { ScreenScroll, SectionHeader, StatePanel, uiSpace } from '@/components/ui';
import { groupsStreamPath } from '@/src/groups';
import { SIGN_IN_ROUTE, progressHistoryHref } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { TodayLayout } from '@/src/preferences/model';

export type TodayScreenProps = {
  isFocused?: boolean;
  // The progress read and its clock; the route uses the device's.
  loadProgress?: TodayProgressLoader;
  // The Plan page's read; the route uses the local data.
  loadPlan?: TodayPlanLoader;
  now?: () => Date;
  groupState: TodayGroupState;
  // Settings' Today layout; the route reads it from preferences.
  layout?: TodayLayout;
};

const systemNow = () => new Date();

// Today has no title (the tab names the page) and no primary action, so no
// `accent`: one scrolling page of the Progress card, the Plan page, then
// Groups; or in the Cards layout a full-height card each, Plan first,
// opening on You.
export function TodayScreen({ isFocused = true, loadProgress, loadPlan, now = systemNow, groupState, layout = 'list' }: TodayScreenProps) {
  const router = useRouter();
  const { values: { progressCountSecondary } } = useAccountLocalPreferenceState();
  const { state: planState, retry: retryPlan } = useTodayPlan({ isFocused, load: loadPlan, now });
  const planHandlers = {
    now: now(),
    onOpenMuscle: (muscleGroupId: string) =>
      router.push(progressHistoryHref({ muscleGroupId, countSecondary: progressCountSecondary }, 'workingSetCount')),
    onOpenPlan: (planId: string) => router.push(`/session-plan/${encodeURIComponent(planId)}` as Href),
    onOpenProgress: () => router.push('/progress'),
    // Sessions is where sessions are planned, and lists the plans.
    onOpenSessions: () => router.push('/sessions'),
    onRetry: () => {
      void retryPlan();
    },
  };
  const { state: progressState, retry: retryProgress, showCompared, showSession } = useTodayProgress({
    isFocused,
    load: loadProgress,
    now,
  });
  // `View groups` opens the Groups screen on the group the card shows.
  const selectedGroupId = groupState.status === 'available' ? groupState.selectedGroupId : null;
  const groupsPath = selectedGroupId ? groupsStreamPath(selectedGroupId) : '/groups';
  const progressHandlers = {
    onOpenSession: (sessionId: string) => router.push(`/completed-session/${sessionId}`),
    onOpenTrain: () => router.push('/train'),
    onRetry: () => {
      void retryProgress();
    },
    onOpenSessions: () => router.push('/sessions'),
    onShowCompared: showCompared,
    onShowSession: showSession,
  };
  const openGroupHome = (groupId: string) => router.push(`${groupsStreamPath(groupId)}&section=glance`);
  const groupHandlers = {
    nowMs: now().getTime(),
    onFindGroup: () => router.push('/group/mine'),
    // The board opens the group's home page.
    onOpenGroup: (groupId: string) => openGroupHome(groupId),
    onOpenSession: (memberId: string, sessionId: string, groupId: string) =>
      router.push(`/group-session/${memberId}/${sessionId}?groupId=${encodeURIComponent(groupId)}`),
    onSignIn: () => router.push(SIGN_IN_ROUTE),
  };

  if (layout === 'cards') {
    return (
      <TodayCards
        initialPage={1}
        pages={[
          {
            key: 'plan',
            label: 'Plan',
            content: <TodayPlanSection {...planHandlers} fill state={planState} />,
            framed: planState.status !== 'loaded',
            testID: 'today-plan-section',
          },
          {
            key: 'progress',
            label: 'You',
            content: <TodayProgressSection {...progressHandlers} fill state={progressState} />,
            framed: !progressHasCards(progressState),
            testID: 'today-progress-section',
          },
          {
            key: 'group',
            label: 'Groups',
            content: <TodayGroupSection {...groupHandlers} fill state={groupState} />,
            framed: !groupHasCards(groupState),
            testID: 'today-group-section',
          },
        ]}
        testID="today-screen"
      />
    );
  }

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="today-screen">
      <View style={styles.section} testID="today-progress-section">
        <SectionHeader title="You" />
        <TodayProgressSection {...progressHandlers} state={progressState} />
      </View>

      <View style={styles.section} testID="today-plan-section">
        <SectionHeader title="Plan" />
        <TodayPlanSection {...planHandlers} state={planState} />
      </View>

      <View style={styles.section} testID="today-group-section">
        {/* The board card names the group and owns the way to it and the switch; without one, `View groups`. */}
        <SectionHeader
          action={groupHasCards(groupState) ? undefined : { label: 'View groups', onPress: () => router.push(groupsPath), testID: 'today-view-groups-button' }}
          title="Groups"
        />
        <TodayGroupSection {...groupHandlers} state={groupState} />
      </View>
    </ScreenScroll>
  );
}

// Ready progress draws its own two cards; the loading, error and empty panels take the page's card.
const progressHasCards = (state: TodayProgressState) => state.status === 'loaded' && state.progress.status === 'ready';

// The group's board and sessions draw their own cards; the account, no-group and missing-data panels take the page's card.
const groupHasCards = (state: TodayGroupState) =>
  state.status === 'available' &&
  state.groups !== null &&
  state.groups.length > 0 &&
  state.selectedGroupId !== null &&
  state.summary !== null;

function TodayPlanSection({
  state,
  onRetry,
  fill = false,
  ...handlers
}: {
  state: TodayPlanState;
  now: Date;
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenPlan: (planId: string) => void;
  onOpenProgress: () => void;
  onOpenSessions: () => void;
  onRetry: () => void;
  fill?: boolean;
}) {
  if (state.status === 'loading') {
    return fill ? (
      <TodayPanel fill kind="loading" testID="today-plan-loading" title="Loading your plan…" />
    ) : (
      <StatePanel fill={false} kind="loading" testID="today-plan-loading" title="Loading your plan…" />
    );
  }
  if (state.status === 'error') {
    return (
      <TodayPanel
        action={{ label: 'Retry', onPress: onRetry, testID: 'today-plan-error-retry' }}
        body={state.message}
        fill={fill}
        kind="error"
        testID="today-plan-error"
        title="Couldn't load your plan"
      />
    );
  }
  return <TodayPlanCards {...handlers} fill={fill} plan={state.plan} />;
}

function TodayProgressSection({
  onOpenSession,
  onOpenSessions,
  onOpenTrain,
  onRetry,
  onShowCompared,
  onShowSession,
  state,
  fill = false,
}: {
  onOpenSession: (sessionId: string) => void;
  onOpenSessions: () => void;
  onOpenTrain: () => void;
  onRetry: () => void;
  onShowCompared: (periodsBack: number) => void;
  onShowSession: (offset: number) => void;
  state: TodayProgressState;
  fill?: boolean;
}) {
  if (state.status === 'loading') {
    // Loading draws no card in the list layout.
    return fill ? (
      <TodayPanel fill kind="loading" testID="today-progress-loading" title="Loading your progress…" />
    ) : (
      <StatePanel fill={false} kind="loading" testID="today-progress-loading" title="Loading your progress…" />
    );
  }

  if (state.status === 'error') {
    return (
      <TodayPanel
        action={{ label: 'Retry', onPress: onRetry, testID: 'today-progress-error-retry' }}
        body={state.message}
        fill={fill}
        kind="error"
        testID="today-progress-error"
        title="Couldn't load your progress"
      />
    );
  }

  if (state.progress.status === 'empty') {
    return (
      <TodayPanel
        action={{ label: 'Open Train', onPress: onOpenTrain, testID: 'today-empty-open-train' }}
        body="Log a workout and your sessions, working sets and PRs show up here, against your last period."
        fill={fill}
        testID="today-progress-empty"
        title="Your week starts here"
      />
    );
  }

  return (
    <TodayProgressCard
      fill={fill}
      onOpenSession={onOpenSession}
      onOpenSessions={onOpenSessions}
      onShowCompared={onShowCompared}
      onShowSession={onShowSession}
      progress={state.progress}
    />
  );
}

export default function TodayRoute() {
  const isFocused = useIsFocused();
  const groupState = useTodayGroup();
  const { values } = useAccountLocalPreferenceState();
  return <TodayScreen groupState={groupState} isFocused={isFocused} layout={values.todayLayout} />;
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
