import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  GroupFilterChips,
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupStreamList,
  GroupsEmptyState,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { UiButton, UiText, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  groupCacheKeys,
  listMyGroups,
  useGroupResource,
  useGroupStream,
  type GroupListMineResult,
} from '@/src/groups';

/** The Groups tab (groups contract §6.3): the stream with All + per-group chips. */
export default function GroupsTabRoute() {
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <GroupsTabContent userId={user.id} />;
}

function GroupsTabContent({ userId }: { userId: string }) {
  const router = useRouter();
  const mine = useGroupResource<GroupListMineResult>({ userId, cacheKey: groupCacheKeys.mine, fetcher: listMyGroups });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const stream = useGroupStream({ userId, groupId: selectedGroupId });
  const groups = mine.data?.groups ?? null;

  // A group that left My groups (left, removed) drops back to All.
  useEffect(() => {
    if (selectedGroupId && groups && !groups.some((group) => group.group_id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [groups, selectedGroupId]);

  // Lost access to the selected group (C3.6.8): refresh My groups so its chip goes.
  const { lostAccess, refresh: refreshStream } = stream;
  const refreshMine = mine.refresh;
  useEffect(() => {
    if (lostAccess) void refreshMine();
  }, [lostAccess, refreshMine]);

  const refreshAll = useCallback(() => Promise.all([refreshMine(), refreshStream()]), [refreshMine, refreshStream]);
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

  const offline = mine.offline || stream.offline;
  const inlineError = pickInlineError(mine.error, stream.error);
  const hasAnyData = mine.data !== null || stream.data !== null;

  const header = (
    <View style={groupScreenStyles.header}>
      <View style={styles.titleRow}>
        <UiText style={styles.title} variant="title">
          Groups
        </UiText>
        {/* M22-T05 adds the Create group / Join group actions beside My groups. */}
        <UiButton label="My groups" onPress={() => router.push('/group/mine')} testID="groups-my-groups-button" variant="secondary" />
      </View>
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={stream.lastUpdatedAtMs ?? mine.lastUpdatedAtMs} /> : null}
      {inlineError && hasAnyData ? <GroupInlineError error={inlineError} onRetry={onRefresh} testID="groups-inline-error" /> : null}
      {groups && groups.length > 0 ? (
        <GroupFilterChips groups={groups} onChange={setSelectedGroupId} selectedGroupId={selectedGroupId} />
      ) : null}
    </View>
  );

  if (groups?.length === 0 || !hasAnyData) {
    return (
      <ScrollView
        contentContainerStyle={groupScreenStyles.content}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
        style={groupScreenStyles.screen}
        testID="groups-screen">
        {header}
        {groups?.length === 0 ? (
          // M22-T05 fills this slot with the Create group / Join group buttons.
          <GroupsEmptyState testID="groups-empty-state" />
        ) : (
          <GroupMissingDataState
            error={inlineError}
            offline={offline}
            onRetry={onRefresh}
            testIDPrefix="groups"
          />
        )}
      </ScrollView>
    );
  }

  let emptyState = (
    <GroupStateView
      body="Sessions your group members log, and people joining or leaving, show up here."
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
      onPressMembership={(item) => router.push(`/group/${item.groupId}`)}
      onPressSession={(card) => router.push(`/group-session/${card.memberUserId}/${card.sessionId}`)}
      onRefresh={onRefresh}
      pulling={pulling}
      showGroupNames={selectedGroupId === null}
      stream={stream}
      testID="groups-stream-list"
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
