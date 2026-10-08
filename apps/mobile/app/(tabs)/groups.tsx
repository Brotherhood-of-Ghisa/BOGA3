import { getCompetitionPodiums } from '@/src/groups/api';
import type { CompetitionPodiumsWire as GroupMetricPodiumWire } from '@/src/groups/competition-wire';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import {
  GroupFilterChips,
  GroupInlineError,
  GroupLeaderboardsPage,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupStreamList,
  GroupsEmptyActions,
  GroupsEmptyState,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { ActionButton, PageHeader, ScreenScroll, SegmentedControl, uiSpace } from '@/components/ui';
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

type GroupsSegment = 'stream' | 'leaderboards';

const SEGMENT_OPTIONS = [
  { value: 'stream', label: 'Stream' },
  { value: 'leaderboards', label: 'Leaderboards' },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The Groups screen (groups contract): one group at a time, picked with
 * the group chips (none with a single group), showing its Stream or Leaderboards. Managing groups (join,
 * create, the group page) lives behind My groups. `?groupId=` preselects a
 * group.
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
  const requestedGroupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
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
  const [segment, setSegment] = useState<GroupsSegment>('stream');
  // A new link (Today's `View groups`, a membership row) wins over the last pick and opens its Stream.
  const [followedRequest, setFollowedRequest] = useState<string | null>(null);
  if (followedRequest !== requestedGroupId) {
    setFollowedRequest(requestedGroupId);
    if (requestedGroupId) {
      setLastViewedGroupId(requestedGroupId);
      setSegment('stream');
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

  // Lost access to the selected group: refresh My groups so its chip goes
  // and the selection moves to another group.
  const refreshMine = mine.refresh;
  const lostAccess = stream.lostAccess || boards.lostAccess;
  useEffect(() => {
    if (lostAccess) void refreshMine();
  }, [lostAccess, refreshMine]);

  const refreshStream = stream.refresh;
  const refreshBoards = boards.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshMine(), refreshStream(), refreshBoards()]),
    [refreshMine, refreshStream, refreshBoards],
  );
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

  const segmentResource = segment === 'stream' ? stream : boards;
  const offline = mine.offline || segmentResource.offline;
  const inlineError = pickInlineError(mine.error, segmentResource.error);
  const hasGroups = groups !== null && groups.length > 0;
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;

  const header = (
    <View style={groupScreenStyles.header}>
      <View style={styles.titleRow}>
        <View style={styles.title} testID="groups-title">
          <PageHeader title="Groups" />
        </View>
        <ActionButton
          label="My groups"
          onPress={() => router.push('/group/mine')}
          testID="groups-my-groups-button"
          variant="text"
        />
      </View>
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={segmentResource.lastUpdatedAtMs ?? mine.lastUpdatedAtMs} /> : null}
      {inlineError && (groups !== null || segmentResource.data !== null) ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="groups-inline-error" />
      ) : null}
      {hasGroups ? (
        <>
          {/* One group needs no picker. */}
          {groups.length > 1 ? <GroupFilterChips groups={groups} onChange={pickGroup} selectedGroupId={selectedGroupId} /> : null}
          <SegmentedControl
            accessibilityLabel="Stream or leaderboards"
            onChange={setSegment}
            options={SEGMENT_OPTIONS}
            testIDPrefix="groups-segment"
            value={segment}
          />
        </>
      ) : null}
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
      roleForGroup={(groupId) => groups.find((group) => group.group_id === groupId)?.my_role ?? null}
      showGroupNames={false}
      stream={stream}
      testID="groups-stream-list"
      userId={userId}
    />
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
  },
});
