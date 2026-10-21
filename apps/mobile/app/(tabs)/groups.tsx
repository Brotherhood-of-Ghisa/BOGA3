import { getCompetitionPodiums } from '@/src/groups/api';
import type { CompetitionPodiumsWire as GroupMetricPodiumWire } from '@/src/groups/competition-wire';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { RefreshControl, View } from 'react-native';

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
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
  type GroupsSection,
} from '@/components/groups';
import { IconButton, ScreenScroll } from '@/components/ui';
import { DEFAULT_HIDDEN_STREAM_EVENT_KINDS, type StreamEventKind } from '@/src/groups/competition-stream-view-model';
import type { GroupHomeMetric } from '@/src/groups/home-periods';
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
 * title and picked from it, in one of three views — At a glance, Stream,
 * Leaderboards — chosen by the filter row's first pill. Managing groups
 * (join, create, the group page) lives behind My groups. `?groupId=`
 * preselects a group and `?section=` its view.
 */
export default function GroupsTabRoute() {
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <GroupsTabContent userId={user.id} />;
}

function GroupsTabContent({ userId }: { userId: string }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[]; section?: string | string[] }>();
  const requestedGroupId = firstParam(params.groupId);
  const requestedSection = toSection(firstParam(params.section));
  const mine = useGroupResource<GroupListMineResult>({ userId, cacheKey: groupCacheKeys.mine, fetcher: listMyGroups });
  const groups = mine.data?.groups ?? null;

  // The selection is `last-viewed-group`, shared with Today's group card: a pick
  // on either screen moves both. Read again on focus, and after a chip pick.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useFocusEffect(useCallback(() => rerender(), []));
  const pickGroup = useCallback((groupId: string) => {
    setLastViewedGroupId(groupId);
    rerender();
  }, []);
  const [segment, setSegment] = useState<GroupsSection>('glance');
  // At a glance ranks the selected metric by calendar week for this visit.
  const [metric, setMetric] = useState<GroupHomeMetric>('sets');
  const period = 'week' as const;
  // The stepper: 0 is the period in progress, -1 the one before.
  const [glanceOffset, setGlanceOffset] = useState(0);
  const [hiddenEventKinds, setHiddenEventKinds] = useState<readonly StreamEventKind[]>(DEFAULT_HIDDEN_STREAM_EVENT_KINDS);
  const [eventsSheet, setEventsSheet] = useState(false);
  // A new link (Today's group title, a membership row) wins over the last
  // pick; it opens the section it names, and the Stream when it names none.
  const [followedRequest, setFollowedRequest] = useState<string | null>(null);
  if (followedRequest !== requestedGroupId) {
    setFollowedRequest(requestedGroupId);
    if (requestedGroupId) {
      setLastViewedGroupId(requestedGroupId);
      setSegment(requestedSection ?? 'stream');
    }
  }
  const selectedGroupId = groups ? resolveSelectedGroupId(groups, getLastViewedGroupId()) : null;
  useEffect(() => {
    if (selectedGroupId) setLastViewedGroupId(selectedGroupId);
  }, [selectedGroupId]);

  // No group selected (My groups loading or empty): read nothing.
  const stream = useGroupStream({ userId, groupId: selectedGroupId });
  const boardsFetcher = useCallback(() => getCompetitionPodiums(selectedGroupId ?? ''), [selectedGroupId]);
  // Cache-first, read only while the Leaderboards segment is open.
  const boards = useGroupResource<GroupMetricPodiumWire>({
    userId,
    cacheKey: selectedGroupId && segment === 'leaderboards' ? groupCacheKeys.boards(selectedGroupId) : null,
    fetcher: boardsFetcher,
    evictGroupIdOnNotFound: selectedGroupId,
  });

  // Cache-first, read only while At a glance is open.
  const glance = useGroupGlance({
    userId,
    groupId: segment === 'glance' ? selectedGroupId : null,
    period,
    offset: glanceOffset,
    now: new Date(),
  });

  // Lost access to the selected group: refresh My groups so its chip goes
  // and the selection moves to another group.
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

  const segmentResource = segment === 'leaderboards' ? boards : segment === 'glance' ? glance.resource : stream;
  const offline = mine.offline || segmentResource.offline;
  const inlineError = pickInlineError(mine.error, segmentResource.error);
  const hasGroups = groups !== null && groups.length > 0;
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;

  const groupName = groups?.find((group) => group.group_id === selectedGroupId)?.name ?? 'Groups';
  const header = (
    <View style={groupScreenStyles.header}>
      <GroupScreenHeader
        filterTrailing={
          segment === 'stream' && isDevMode() ? (
            <IconButton
              accessibilityHint="Chooses which event types the stream draws"
              accessibilityLabel="Event types"
              name="more-vertical"
              onPress={() => setEventsSheet(true)}
              testID="groups-stream-events-button"
              tone="muted"
            />
          ) : undefined
        }
        groupName={groupName}
        groups={(groups ?? []).map((group) => ({ groupId: group.group_id, name: group.name }))}
        metric={metric}
        onMetricChange={setMetric}
        onOpenMyGroups={() => router.push('/group/mine')}
        onSectionChange={setSegment}
        onSelectGroup={pickGroup}
        section={segment}
        selectedGroupId={selectedGroupId}
      />
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={segmentResource.lastUpdatedAtMs ?? mine.lastUpdatedAtMs} /> : null}
      {inlineError && (groups !== null || segmentResource.data !== null) ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="groups-inline-error" />
      ) : null}
      <GroupStreamEventsSheet
        hiddenKinds={hiddenEventKinds}
        onChange={setHiddenEventKinds}
        onDismiss={() => setEventsSheet(false)}
        visible={eventsSheet}
      />
    </View>
  );

  if (!hasGroups || !selectedGroupId) {
    return (
      <ScreenScroll refreshControl={refreshControl} testID="groups-screen">
        {header}
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

  if (segment === 'glance') {
    return (
      <ScreenScroll refreshControl={refreshControl} testID="groups-screen">
        {header}
        <GroupGlancePage
          error={inlineError}
          held={glance.held}
          metric={metric}
          myUserId={userId}
          now={new Date()}
          offline={offline}
          offset={glanceOffset}
          onOffsetChange={setGlanceOffset}
          onRetry={onRefresh}
          period={period}
          series={glance.series}
        />
      </ScreenScroll>
    );
  }

  if (segment === 'leaderboards') {
    return (
      <ScreenScroll refreshControl={refreshControl} testID="groups-screen">
        {header}
        <GroupLeaderboardsPage
          boards={boards}
          error={inlineError}
          groupId={selectedGroupId}
          offline={offline}
          onRetry={onRefresh}
          userId={userId}
        />
      </ScreenScroll>
    );
  }

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
      emptyState={emptyState}
      header={header}
      onCertificationChanged={() => void refreshAll()}
      onPressSession={(card) => router.push(`/group-session/${card.memberUserId}/${card.sessionId}?groupId=${encodeURIComponent(card.groupId)}`)}
      onRefresh={onRefresh}
      pulling={pulling}
      hiddenEventKinds={hiddenEventKinds}
      roleForGroup={(groupId) => groups.find((group) => group.group_id === groupId)?.my_role ?? null}
      showGroupNames={false}
      stream={stream}
      testID="groups-stream-list"
      userId={userId}
    />
  );
}


