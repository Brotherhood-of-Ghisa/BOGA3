import { useIsFocused, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  TodayCards,
  TodayGroupHeader,
  TodayGroupSection,
  TodayGroupSwitch,
  TodayPanel,
  TodayProgressCard,
  useTodayGroup,
  useTodayProgress,
  type TodayGroupState,
  type TodayProgressLoader,
  type TodayProgressState,
} from '@/components/today';
import { ScreenScroll, SectionHeader, StatePanel, uiSpace } from '@/components/ui';
import { groupsStreamPath } from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { TodayLayout } from '@/src/preferences/model';

export type TodayScreenProps = {
  isFocused?: boolean;
  // The progress read and its clock; the route uses the device's.
  loadProgress?: TodayProgressLoader;
  now?: () => Date;
  groupState: TodayGroupState;
  // Settings' Today layout; the route reads it from preferences.
  layout?: TodayLayout;
};

const systemNow = () => new Date();

// Today has no title (the tab names the page) and no primary action, so no
// `accent`: it opens on the Progress card, then the group activity — one
// scrolling page, or in the Cards layout a full-height card each.
export function TodayScreen({ isFocused = true, loadProgress, now = systemNow, groupState, layout = 'list' }: TodayScreenProps) {
  const router = useRouter();
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
    // `View group` and the board open the group's home page.
    onOpenGroup: (groupId: string) => openGroupHome(groupId),
    onOpenSession: (memberId: string, sessionId: string, groupId: string) =>
      router.push(`/group-session/${memberId}/${sessionId}?groupId=${encodeURIComponent(groupId)}`),
    onSignIn: () => router.push(SIGN_IN_ROUTE),
  };

  if (layout === 'cards') {
    const group = primaryGroup(groupState);
    return (
      <TodayCards
        pages={[
          {
            key: 'progress',
            label: 'You',
            content: <TodayProgressSection {...progressHandlers} fill state={progressState} />,
            framed: !progressHasCards(progressState),
            testID: 'today-progress-section',
          },
          {
            key: 'group',
            label: group?.name ?? 'Group activity',
            content: <TodayGroupSection {...groupHandlers} fill state={groupState} />,
            framed: !groupHasCards(groupState),
            accessory: group && groupState.status === 'available' ? (
              <TodayGroupSwitch
                groups={groupSwitchOptions(groupState)}
                onSelectGroup={groupState.selectGroup}
                selectedGroupId={group.group_id}
              />
            ) : undefined,
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

      <View style={styles.section} testID="today-group-section">
        <GroupSectionHeading onOpenHome={openGroupHome} onViewGroups={() => router.push(groupsPath)} state={groupState} />
        <TodayGroupSection {...groupHandlers} state={groupState} />
      </View>
    </ScreenScroll>
  );
}

type Available = Extract<TodayGroupState, { status: 'available' }>;

// Ready progress draws its own two cards; the loading, error and empty panels take the page's card.
const progressHasCards = (state: TodayProgressState) => state.status === 'loaded' && state.progress.status === 'ready';

// The group's board and sessions draw their own cards; the account, no-group and missing-data panels take the page's card.
const groupHasCards = (state: TodayGroupState) =>
  state.status === 'available' &&
  state.groups !== null &&
  state.groups.length > 0 &&
  state.selectedGroupId !== null &&
  state.summary !== null;

// The primary group — the one Today shows — when there is one to name.
const primaryGroup = (state: TodayGroupState) =>
  state.status === 'available' && state.groups && state.selectedGroupId !== null
    ? state.groups.find((candidate) => candidate.group_id === state.selectedGroupId)
    : undefined;

const groupSwitchOptions = (state: Available) =>
  state.groups?.map((candidate) => ({ groupId: candidate.group_id, name: candidate.name })) ?? [];

/**
 * The group section is named after the primary group — the one Today shows,
 * remembered across visits. The name opens that group's home page and the
 * switch beside it changes which group is primary; with no group to name
 * (signed out, no groups, nothing cached) the section keeps its own title.
 */
function GroupSectionHeading({
  state,
  onOpenHome,
  onViewGroups,
}: {
  state: TodayGroupState;
  onOpenHome: (groupId: string) => void;
  onViewGroups: () => void;
}) {
  const group = primaryGroup(state);
  if (state.status !== 'available' || !group || state.selectedGroupId === null) {
    return (
      <SectionHeader
        action={{ label: 'View groups', onPress: onViewGroups, testID: 'today-view-groups-button' }}
        title="Group activity"
      />
    );
  }
  return (
    <TodayGroupHeader
      groupName={group.name}
      groups={groupSwitchOptions(state)}
      onOpenHome={() => onOpenHome(group.group_id)}
      onSelectGroup={state.selectGroup}
      selectedGroupId={state.selectedGroupId}
    />
  );
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
