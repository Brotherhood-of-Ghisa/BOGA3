import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import {
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupSummaryRow,
  GroupsEmptyActions,
  GroupsEmptyState,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { useAuth } from '@/src/auth';
import { UiButton } from '@/components/ui';
import { groupCacheKeys, listMyGroups, useGroupResource, type GroupListMineResult } from '@/src/groups';

/**
 * My groups (groups contract §6.3): every active membership, sorted by name,
 * with Join / Create. A row opens the group's management page.
 */
export default function MyGroupsRoute() {
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <MyGroupsContent userId={user.id} />;
}

function MyGroupsContent({ userId }: { userId: string }) {
  const router = useRouter();
  const mine = useGroupResource<GroupListMineResult>({ userId, cacheKey: groupCacheKeys.mine, fetcher: listMyGroups });
  const { pulling, onRefresh } = usePullToRefresh(mine.refresh);
  const groups = mine.data?.groups ?? null;
  const inlineError = pickInlineError(mine.error);

  return (
    <FlatList
      ListEmptyComponent={
        groups ? (
          <GroupsEmptyState testID="group-mine-empty-state">
            <GroupsEmptyActions testIDPrefix="group-mine-empty" />
          </GroupsEmptyState>
        ) : (
          <GroupMissingDataState error={inlineError} offline={mine.offline} onRetry={onRefresh} testIDPrefix="group-mine" />
        )
      }
      ListHeaderComponent={
        <View style={groupScreenStyles.header}>
          {/* With no groups the empty state carries Create / Join instead. */}
          {groups && groups.length > 0 ? (
            <View style={groupScreenStyles.actionRow}>
              <UiButton
                label="Join group"
                onPress={() => router.push('/group/join')}
                style={groupScreenStyles.actionRowItem}
                testID="group-mine-join-button"
                variant="secondary"
              />
              <UiButton
                label="Create group"
                onPress={() => router.push('/group/new')}
                style={groupScreenStyles.actionRowItem}
                testID="group-mine-create-button"
              />
            </View>
          ) : null}
          {mine.offline ? <GroupOfflineBanner lastUpdatedAtMs={mine.lastUpdatedAtMs} /> : null}
          {groups && inlineError ? (
            <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-mine-inline-error" />
          ) : null}
        </View>
      }
      contentContainerStyle={groupScreenStyles.content}
      data={groups ?? []}
      keyExtractor={(group) => group.group_id}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      renderItem={({ item }) => (
        <GroupSummaryRow group={item} onPress={(group) => router.push(`/group/${group.group_id}`)} />
      )}
      style={groupScreenStyles.screen}
      testID="group-mine-list"
    />
  );
}
