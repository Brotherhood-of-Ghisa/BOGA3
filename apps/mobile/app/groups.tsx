import { getCompetitionPodiums } from '@/src/groups/api';
import type { CompetitionPodiumsWire as GroupMetricPodiumWire } from '@/src/groups/competition-wire';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';

import {
  GroupGlancePage,
  GroupInlineError,
  GroupLeaderboardsPage,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupScreenHeader,
  GroupStateView,
  GroupStreamEventsSheet,
  GroupStreamList,
  GroupsEmptyActions,
  GroupsEmptyState,
  GroupsSignInRequired,
  GROUP_SECTIONS,
  GROUP_SECTION_LABELS,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
  type GroupsSection,
} from '@/components/groups';
import { TabOwnedPage } from '@/components/navigation/tab-owned-page';
import { coWsHref } from '@/src/navigation/routes';
import { Card, Icon, IconButton, ListRow, ScreenScroll, SwipePages, uiSpace, type SwipePageFrame } from '@/components/ui';
import { DEFAULT_HIDDEN_STREAM_EVENT_KINDS, type StreamEventKind } from '@/src/groups/competition-stream-view-model';
import { groupRankSeriesEnd, type GroupHomeMetric } from '@/src/groups/home-periods';
import { useGroupGlance } from '@/src/groups/use-group-glance';
import { isDevMode } from '@/src/utils/isDevMode';
import { useAuth } from '@/src/auth';
import {
  getLastViewedGroupId,
  groupCacheKeys,
  listMyGroups,
  resolveSelectedGroupId,
  setLastViewedGroupId,
  useGroupResource,
  useGroupStream,
  type GroupListMineResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

const toSection = (value: string | null): GroupsSection | null =>
  value === 'glance' || value === 'stream' || value === 'leaderboards' ? value : null;

/**
 * The Groups screen (groups contract): one group at a time, named by the
 * native title and picked from it, in three pages swiped between — Stream,
 * At a glance (where it opens), Leaderboards — under tabs naming them.
 * Managing groups (join, create, the group page) lives behind the header's
 * `Manage`. `?groupId=` preselects a group and `?section=` its page.
 */
export default function GroupsRoute() {
  const { isConfigured, user } = useAuth();
  // A root-stack page under the native "Groups" header, keeping the tab bar (More).
  return (
    <TabOwnedPage>
      {!isConfigured || !user ? (
        <GroupsSignInRequired isConfigured={isConfigured} />
      ) : (
        <GroupsTabContent userId={user.id} />
      )}
    </TabOwnedPage>
  );
}

function GroupsTabContent({ userId }: { userId: string }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[]; section?: string | string[] }>();
  const requestedGroupId = firstParam(params.groupId);
  const requestedSection = toSection(firstParam(params.section));
  const mine = useGroupResource<GroupListMineResult>({ userId, cacheKey: groupCacheKeys.mine, fetcher: listMyGroups });
  const groups = mine.data?.groups ?? null;

  // The selection is `last-viewed-group`, shared with Today's group card: a pick
  // on either screen moves both. Read again on focus, and after a pick.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useFocusEffect(useCallback(() => rerender(), []));
  const pickGroup = useCallback((groupId: string) => {
    setLastViewedGroupId(groupId);
    rerender();
  }, []);
  const [segment, setSegment] = useState<GroupsSection>('glance');
  // A page is read from the first time it is shown, and kept read after, so a
  // swipe back never finds it blank.
  const [visited, setVisited] = useState<readonly GroupsSection[]>(['glance']);
  const showSection = (next: GroupsSection) => {
    setSegment(next);
    if (!visited.includes(next)) setVisited([...visited, next]);
  };
  // At a glance ranks the selected metric by calendar week for this visit.
  const [metric, setMetric] = useState<GroupHomeMetric>('sets');
  const period = 'week' as const;
  // The selected week, set by the stepper or the chart: 0 is the one in progress, -1 the one before.
  const [glanceOffset, setGlanceOffset] = useState(0);
  const [hiddenEventKinds, setHiddenEventKinds] = useState<readonly StreamEventKind[]>(DEFAULT_HIDDEN_STREAM_EVENT_KINDS);
  const [eventsSheet, setEventsSheet] = useState(false);
  // A new link (Today's group title, a membership row) wins over the last
  // pick; it opens the page it names, and the Stream when it names none.
  const [followedRequest, setFollowedRequest] = useState<string | null>(null);
  if (followedRequest !== requestedGroupId) {
    setFollowedRequest(requestedGroupId);
    if (requestedGroupId) {
      setLastViewedGroupId(requestedGroupId);
      showSection(requestedSection ?? 'stream');
    }
  }
  const selectedGroupId = groups ? resolveSelectedGroupId(groups, getLastViewedGroupId()) : null;
  useEffect(() => {
    if (selectedGroupId) setLastViewedGroupId(selectedGroupId);
  }, [selectedGroupId]);

  // No group selected (My groups loading or empty): read nothing.
  const stream = useGroupStream({ userId, groupId: selectedGroupId });
  const boardsFetcher = useCallback(() => getCompetitionPodiums(selectedGroupId ?? '', false), [selectedGroupId]);
  // Cache-first, read once Leaderboards has been shown.
  const boards = useGroupResource<GroupMetricPodiumWire>({
    userId,
    cacheKey: selectedGroupId && visited.includes('leaderboards') ? groupCacheKeys.boards(selectedGroupId) : null,
    fetcher: boardsFetcher,
    evictGroupIdOnNotFound: selectedGroupId,
  });

  // Cache-first, read once At a glance has been shown: the chart's six weeks around the selection.
  const glance = useGroupGlance({
    userId,
    groupId: visited.includes('glance') ? selectedGroupId : null,
    period,
    offset: groupRankSeriesEnd(glanceOffset),
    now: new Date(),
  });

  // Lost access to the selected group: refresh My groups so the group goes
  // and the selection moves to another.
  const refreshMine = mine.refresh;
  const lostAccess = stream.lostAccess || boards.lostAccess || glance.resource.lostAccess;
  useEffect(() => {
    if (lostAccess) void refreshMine();
  }, [lostAccess, refreshMine]);

  const refreshStream = stream.refresh;
  const refreshBoards = boards.refresh;
  const refreshGlance = glance.resource.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshMine(), refreshStream(), refreshBoards(), refreshGlance()]),
    [refreshMine, refreshStream, refreshBoards, refreshGlance],
  );
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);
  // Back on a page read before: read it again, as opening it the first time does.
  const shown = useRef(new Set<GroupsSection>());
  useEffect(() => {
    const returning = shown.current.has(segment);
    shown.current.add(segment);
    if (returning && segment === 'leaderboards') void refreshBoards();
    if (returning && segment === 'glance') void refreshGlance();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only a page change reads; a new group reads by its own key.
  }, [segment]);

  const segmentResource = segment === 'leaderboards' ? boards : segment === 'glance' ? glance.resource : stream;
  const offline = mine.offline || segmentResource.offline;
  const inlineError = pickInlineError(mine.error, segmentResource.error);
  const hasGroups = groups !== null && groups.length > 0;
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;

  const groupName = groups?.find((group) => group.group_id === selectedGroupId)?.name ?? 'Groups';
  const titleBar = (
    <GroupScreenHeader
      groupName={groupName}
      groups={(groups ?? []).map((group) => ({ groupId: group.group_id, name: group.name }))}
      headerAction={segment === 'stream' && isDevMode() ? <StreamEventsButton onPress={() => setEventsSheet(true)} /> : null}
      onOpenManage={() => router.push('/group/mine')}
      onSelectGroup={pickGroup}
      selectedGroupId={selectedGroupId}
    />
  );
  // Challenges of the week, for the group in view, on every page.
  const cowsLink = hasGroups && selectedGroupId ? (
    <Card>
      <ListRow density="list" label="CoWs" onPress={() => router.push(coWsHref(selectedGroupId))} testID="groups-cows-link"
        trailing={<Icon name="chevron-right" size="sm" />} />
    </Card>
  ) : null;
  const notices = (
    <>
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={segmentResource.lastUpdatedAtMs ?? mine.lastUpdatedAtMs} /> : null}
      {inlineError && (groups !== null || segmentResource.data !== null) ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="groups-inline-error" />
      ) : null}
    </>
  );

  if (!hasGroups || !selectedGroupId) {
    return (
      <ScreenScroll refreshControl={refreshControl} testID="groups-screen">
        {titleBar}
        <View style={groupScreenStyles.header}>{notices}</View>
        {groups ? (
          <GroupsEmptyState testID="groups-empty-state">
            <GroupsEmptyActions testIDPrefix="groups-empty" />
          </GroupsEmptyState>
        ) : (
          <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRefresh} testIDPrefix="groups" />
        )}
      </ScreenScroll>
    );
  }

  const scrollPage = (frame: SwipePageFrame, testID: string, content: ReactNode) => (
    <GroupsScrollPage frame={frame} refreshControl={refreshControl} testID={testID}>
      {content}
    </GroupsScrollPage>
  );
  const renderPage: Record<GroupsSection, (frame: SwipePageFrame) => ReactNode> = {
    stream: (frame) => (
      <View style={frameStyle(frame)}>
        <GroupsStreamPage
          hiddenEventKinds={hiddenEventKinds}
          inlineError={inlineError}
          offline={offline}
          onCertificationChanged={() => void refreshAll()}
          onOpenSession={(path) => router.push(path)}
          onRefresh={onRefresh}
          pulling={pulling}
          roleForGroup={(groupId) => groups.find((group) => group.group_id === groupId)?.my_role ?? null}
          stream={stream}
          userId={userId}
        />
      </View>
    ),
    // Its stepper and metric stay put; the cards scroll under them.
    glance: (frame) => (
      <GroupGlancePage
        error={inlineError}
        held={glance.held}
        metric={metric}
        myUserId={userId}
        now={new Date()}
        offline={offline}
        offset={glanceOffset}
        onMetricChange={setMetric}
        onOffsetChange={setGlanceOffset}
        onRetry={onRefresh}
        period={period}
        refreshControl={refreshControl}
        series={glance.series}
        style={frameStyle(frame)}
      />
    ),
    leaderboards: (frame) =>
      scrollPage(
        frame,
        'groups-leaderboards-scroll',
        <GroupLeaderboardsPage
          boards={boards}
          error={inlineError}
          groupId={selectedGroupId}
          offline={offline}
          onRetry={onRefresh}
          userId={userId}
        />,
      ),
  };

  return (
    <>
      {titleBar}
      <SwipePages
        banner={
          <View style={styles.notices}>
            {cowsLink}
            {notices}
          </View>
        }
        onPageChange={(index) => showSection(GROUP_SECTIONS[index] ?? 'glance')}
        page={GROUP_SECTIONS.indexOf(segment)}
        pages={GROUP_SECTIONS.map((section) => ({
          key: section,
          label: GROUP_SECTION_LABELS[section],
          render: renderPage[section],
          tabTestID: `groups-tab-${section}`,
        }))}
        testID="groups-screen"
      />
      <GroupStreamEventsSheet
        hiddenKinds={hiddenEventKinds}
        onChange={setHiddenEventKinds}
        onDismiss={() => setEventsSheet(false)}
        visible={eventsSheet}
      />
    </>
  );
}

const frameStyle = (frame: SwipePageFrame) => ({ width: frame.width, height: frame.height });

/** A page that scrolls on its own, pulled to refresh the screen. */
function GroupsScrollPage({ frame, refreshControl, testID, children }: {
  frame: SwipePageFrame;
  refreshControl: ReactElement<RefreshControlProps>;
  testID: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      style={frameStyle(frame)}
      testID={testID}>
      {children}
    </ScrollView>
  );
}

/** In the title bar on the Stream, in dev mode only: the event-type menu. */
function StreamEventsButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      accessibilityHint="Chooses which event types the stream draws"
      accessibilityLabel="Event types"
      name="more-vertical"
      nativeHeader
      onPress={onPress}
      testID="groups-stream-events-button"
      tone="muted"
    />
  );
}

type GroupsStreamPageProps = {
  stream: ReturnType<typeof useGroupStream>;
  userId: string;
  hiddenEventKinds: readonly StreamEventKind[];
  inlineError: ReturnType<typeof pickInlineError>;
  offline: boolean;
  pulling: boolean;
  onRefresh: () => void;
  onCertificationChanged: () => void;
  onOpenSession: (path: Href) => void;
  roleForGroup: (groupId: string) => GroupListMineResult['groups'][number]['my_role'] | null;
};

/** The Stream page: the group's newest-first stream, or why it is empty. */
function GroupsStreamPage({ stream, inlineError, offline, onRefresh, onOpenSession, ...list }: GroupsStreamPageProps) {
  let emptyState = (
    <GroupStateView
      body="Sessions and records your group members log, and people joining or leaving, show up here."
      testID="groups-stream-empty"
      title="Nothing here yet"
    />
  );
  if (stream.lostAccess) {
    emptyState = <GroupStateView testID="groups-stream-lost-access" title="You're no longer a member of this group" />;
  } else if (!stream.data) {
    emptyState = (
      <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRefresh} testIDPrefix="groups-stream" />
    );
  }
  return (
    <GroupStreamList
      {...list}
      contentContainerStyle={styles.pageContent}
      emptyState={emptyState}
      header={<View />}
      onPressSession={(card) =>
        onOpenSession(`/group-session/${card.memberUserId}/${card.sessionId}?groupId=${encodeURIComponent(card.groupId)}`)
      }
      onRefresh={onRefresh}
      showGroupNames={false}
      stream={stream}
      testID="groups-stream-list"
    />
  );
}

const styles = StyleSheet.create({
  // A page sits between the pager's gutters: no side padding of its own.
  pageContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: uiSpace.lg,
    gap: uiSpace.md,
  },
  notices: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.sm,
    gap: uiSpace.sm,
  },
});
