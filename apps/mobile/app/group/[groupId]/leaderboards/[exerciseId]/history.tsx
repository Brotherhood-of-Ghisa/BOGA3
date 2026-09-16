import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import {
  GroupBoardHistoryItem,
  GroupInlineError,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupPagesFooter,
  GroupStateView,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { UiText } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  buildHistoryItem,
  formatBoardViewLabel,
  getGroupBoardHistory,
  parseBoardMetricParam,
  parseBoardScopeParam,
  useGroupOnlinePages,
  type GroupBoardHistoryCursor,
  type GroupBoardHistoryItem as GroupBoardHistoryItemPayload,
  type GroupBoardHistoryResult,
  type GroupBoardMetric,
  type GroupBoardScope,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

type HistoryParams = {
  groupId?: string | string[];
  exerciseId?: string | string[];
  metric?: string | string[];
  scope?: string | string[];
};

/**
 * A board's lead-change history (product E1.3, P9, D12; contract §4.5) for the
 * toggles the board had open (`?metric=&scope=`): newest first, read online and
 * paged, never cached.
 */
export default function GroupBoardHistoryRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<HistoryParams>();
  const groupId = firstParam(params.groupId);
  const exerciseId = firstParam(params.exerciseId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId || !exerciseId) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupLostAccessState testID="group-board-history-lost-access" />
      </View>
    );
  }
  return (
    <GroupBoardHistoryContent
      exerciseId={exerciseId}
      groupId={groupId}
      metric={parseBoardMetricParam(params.metric)}
      scope={parseBoardScopeParam(params.scope)}
      userId={user.id}
    />
  );
}

const selectItems = (page: GroupBoardHistoryResult) => page.items;
const selectCursor = (page: GroupBoardHistoryResult) => page.next_cursor;
const selectHasMore = (page: GroupBoardHistoryResult) => page.has_more;
const itemKey = (item: GroupBoardHistoryItemPayload) => item.key;

type GroupBoardHistoryContentProps = {
  userId: string;
  groupId: string;
  exerciseId: string;
  metric: GroupBoardMetric;
  scope: GroupBoardScope;
};

function GroupBoardHistoryContent({ userId, groupId, exerciseId, metric, scope }: GroupBoardHistoryContentProps) {
  const fetchPage = useCallback(
    (before: GroupBoardHistoryCursor | null) =>
      getGroupBoardHistory({ groupId, groupExerciseId: exerciseId, metric, certified: scope === 'certified', before }),
    [groupId, exerciseId, metric, scope],
  );
  const history = useGroupOnlinePages<GroupBoardHistoryResult, GroupBoardHistoryItemPayload, GroupBoardHistoryCursor>({
    userId,
    groupId,
    viewKey: `${exerciseId}|${metric}|${scope}`,
    fetchPage,
    selectItems,
    selectCursor,
    selectHasMore,
    itemKey,
  });
  const { pulling, onRefresh } = usePullToRefresh(history.refresh);
  const items = useMemo(
    () => history.items.map((item) => ({ seq: item.seq, view: buildHistoryItem(item, userId) })),
    [history.items, userId],
  );

  if (history.lostAccess) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupLostAccessState testID="group-board-history-lost-access" />
      </View>
    );
  }
  if (history.exerciseMissing) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupStateView
          body="It may have been removed, or the link is wrong."
          testID="group-board-history-exercise-missing"
          title="This exercise isn't in this group"
        />
      </View>
    );
  }

  const inlineError = pickInlineError(history.error);
  const header = (
    <View style={groupScreenStyles.header}>
      <UiText testID="group-board-history-view" variant="subtitle">
        {formatBoardViewLabel(metric, scope)}
      </UiText>
      {history.offline ? <GroupOfflineBanner lastUpdatedAtMs={history.loadedAtMs} /> : null}
      {inlineError && history.firstPage ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-board-history-inline-error" />
      ) : null}
    </View>
  );

  return (
    <FlatList
      ListEmptyComponent={
        history.firstPage ? (
          <GroupStateView testID="group-board-history-empty" title="No lead changes yet" />
        ) : (
          <GroupMissingDataState
            error={inlineError}
            offline={history.offline}
            onRetry={onRefresh}
            testIDPrefix="group-board-history"
          />
        )
      }
      ListFooterComponent={
        <GroupPagesFooter
          loadMoreError={history.loadMoreError}
          loadingMore={history.loadingMore}
          noun="history"
          onRetry={() => void history.loadMore()}
          testIDPrefix="group-board-history"
        />
      }
      ListHeaderComponent={header}
      contentContainerStyle={groupScreenStyles.content}
      data={items}
      keyExtractor={(item) => item.view.key}
      onEndReached={() => void history.loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      renderItem={({ item }) => (
        <GroupBoardHistoryItem item={item.view} testID={`group-board-history-item-${item.seq}`} />
      )}
      style={groupScreenStyles.screen}
      testID="group-board-history-list"
    />
  );
}
