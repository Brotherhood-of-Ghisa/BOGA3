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
  cardListItemStyles,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { ActionButton } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { groupCacheKeys, listMyGroups, useGroupResource, type GroupListMineResult } from '@/src/groups';

/**
 * My groups (groups contract §6.3): every active membership, sorted by name,
 * as one `Card` of rows, under Join (outline) and Create (the one `accent`). A
 * row opens the group's management page.
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
  const hasActions = groups !== null && groups.length > 0;
  const hasHeader = hasActions || mine.offline || (groups !== null && inlineError !== null);

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
        <View style={[groupScreenStyles.header, hasHeader ? groupScreenStyles.cardListHeader : null]}>
          {/* With no groups the empty state carries Create / Join instead. */}
          {hasActions ? (
            <View style={groupScreenStyles.actionRow}>
              <View style={groupScreenStyles.actionRowItem}>
                <ActionButton
                  label="Join group"
                  onPress={() => router.push('/group/join')}
                  testID="group-mine-join-button"
                  variant="outline"
                />
              </View>
              <View style={groupScreenStyles.actionRowItem}>
                <ActionButton
                  label="Create group"
                  onPress={() => router.push('/group/new')}
                  testID="group-mine-create-button"
                  variant="primary"
                />
              </View>
            </View>
          ) : null}
          {mine.offline ? <GroupOfflineBanner lastUpdatedAtMs={mine.lastUpdatedAtMs} /> : null}
          {groups && inlineError ? (
            <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-mine-inline-error" />
          ) : null}
        </View>
      }
      contentContainerStyle={groupScreenStyles.cardListContent}
      data={groups ?? []}
      keyExtractor={(group) => group.group_id}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      renderItem={({ item, index }) => (
        <View style={cardListItemStyles(index, groups?.length ?? 0)}>
          <GroupSummaryRow divider={index > 0} group={item} onPress={(group) => router.push(`/group/${group.group_id}`)} />
        </View>
      )}
      style={groupScreenStyles.screen}
      testID="group-mine-list"
    />
  );
}
