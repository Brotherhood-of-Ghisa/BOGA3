import { useIsFocused, useRouter, type Href } from 'expo-router';
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
import { groupsStreamPath } from '@/src/groups';
import { SIGN_IN_ROUTE, progressHistoryHref } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';

export type TodayScreenProps = {
  isFocused?: boolean;
  // The progress read and its clock; the route uses the device's.
  loadProgress?: TodayProgressLoader;
  // The Plan page's read; the route uses the local data.
  loadPlan?: TodayPlanLoader;
  now?: () => Date;
  groupState: TodayGroupState;
};

const systemNow = () => new Date();

// Today has no title (the tab names the page) and no primary action, so no
// `accent`: a full-height card each for Plan, You and Groups, swiped between,
// opening on You.
export function TodayScreen({ isFocused = true, loadProgress, loadPlan, now = systemNow, groupState }: TodayScreenProps) {
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

  return (
    <TodayCards
      initialPage={1}
      pages={[
        {
          key: 'plan',
          label: 'Plan',
          content: <TodayPlanSection {...planHandlers} state={planState} />,
          framed: planState.status !== 'loaded',
          testID: 'today-plan-section',
        },
        {
          key: 'progress',
          label: 'You',
          content: <TodayProgressSection {...progressHandlers} state={progressState} />,
          framed: !progressHasCards(progressState),
          testID: 'today-progress-section',
        },
        {
          key: 'group',
          label: 'Groups',
          content: <TodayGroupSection {...groupHandlers} state={groupState} />,
          framed: !groupHasCards(groupState),
          testID: 'today-group-section',
        },
      ]}
      testID="today-screen"
    />
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
  ...handlers
}: {
  state: TodayPlanState;
  now: Date;
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenPlan: (planId: string) => void;
  onOpenProgress: () => void;
  onOpenSessions: () => void;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return <TodayPanel kind="loading" testID="today-plan-loading" title="Loading your plan…" />;
  }
  if (state.status === 'error') {
    return (
      <TodayPanel
        action={{ label: 'Retry', onPress: onRetry, testID: 'today-plan-error-retry' }}
        body={state.message}
        kind="error"
        testID="today-plan-error"
        title="Couldn't load your plan"
      />
    );
  }
  return <TodayPlanCards {...handlers} plan={state.plan} />;
}

function TodayProgressSection({
  onOpenSession,
  onOpenSessions,
  onOpenTrain,
  onRetry,
  onShowCompared,
  onShowSession,
  state,
}: {
  onOpenSession: (sessionId: string) => void;
  onOpenSessions: () => void;
  onOpenTrain: () => void;
  onRetry: () => void;
  onShowCompared: (periodsBack: number) => void;
  onShowSession: (offset: number) => void;
  state: TodayProgressState;
}) {
  if (state.status === 'loading') {
    return <TodayPanel kind="loading" testID="today-progress-loading" title="Loading your progress…" />;
  }

  if (state.status === 'error') {
    return (
      <TodayPanel
        action={{ label: 'Retry', onPress: onRetry, testID: 'today-progress-error-retry' }}
        body={state.message}
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
        testID="today-progress-empty"
        title="Your week starts here"
      />
    );
  }

  return (
    <TodayProgressCard
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
  return <TodayScreen groupState={groupState} isFocused={isFocused} />;
}
