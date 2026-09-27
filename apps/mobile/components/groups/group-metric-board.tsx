import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { ActionButton, SegmentedControl, UiText, uiSpace } from '@/components/ui';
import { getGroup, groupCacheKeys, useGroupOnlinePages, useGroupResource, type GroupBoardScope, type GroupGetResult } from '@/src/groups';
import { getGroupMetricBoard } from '@/src/groups/api';
import { isGroupMetric, metricsForGroupRules, type GroupMetric } from '@/src/groups/metric-contract';
import { buildGroupMetricRow, describeGroupRules, GROUP_METRIC_SHORT_LABELS, GROUP_METRIC_VIEW_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetricBoardRowWire, GroupMetricBoardWire, GroupMetricExerciseWire } from '@/src/groups/metric-wire';
import { GroupBoardRow } from './group-board-row';
import { GroupMetricRecordSheet } from './group-metric-record-sheet';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { groupScreenStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

const selectItems = (page: GroupMetricBoardWire) => page.entries;
const selectCursor = (page: GroupMetricBoardWire) => page.next_cursor;
const selectHasMore = (page: GroupMetricBoardWire) => page.next_cursor !== null;
const itemKey = (row: GroupMetricBoardRowWire) => row.member.user_id;
const SCOPE_OPTIONS = [{ value: 'certified', label: 'Certified' }, { value: 'all', label: 'All' }] as const;

export function GroupMetricBoard({ userId, groupId, exercise: initialExercise, initialMetric, initialScope }: {
  userId: string; groupId: string; exercise: GroupMetricExerciseWire; initialMetric: string | null; initialScope: GroupBoardScope;
}) {
  const router = useRouter();
  const allowed = metricsForGroupRules({ bodyweightCoefficient: initialExercise.bodyweight_coefficient });
  const [pickedMetric, setPickedMetric] = useState<GroupMetric | null>(isGroupMetric(initialMetric) ? initialMetric : null);
  const metric = pickedMetric && allowed.includes(pickedMetric) ? pickedMetric : initialExercise.default_metric;
  const [scope, setScope] = useState(initialScope);
  const exerciseId = initialExercise.group_exercise_id;
  const fetchPage = useCallback((after: string | null) => getGroupMetricBoard({ groupId, groupExerciseId: exerciseId,
    metric, certified: scope === 'certified', after }), [exerciseId, groupId, metric, scope]);
  const board = useGroupOnlinePages<GroupMetricBoardWire, GroupMetricBoardRowWire, string>({ userId, groupId,
    viewKey: `${exerciseId}|${metric}|${scope}|${initialExercise.rules_revision}`, fetchPage, selectItems, selectCursor, selectHasMore, itemKey });
  const { pulling, onRefresh } = usePullToRefresh(board.refresh);
  const exercise = board.firstPage?.exercise ?? initialExercise;
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: groupFetcher, evictGroupIdOnNotFound: groupId });
  const [selected, setSelected] = useState<GroupMetricBoardRowWire | null>(null);
  // Expo may reuse this route for another deep link. Its requested view must
  // replace the last local selection, including a page caught during rebuild.
  useEffect(() => {
    setPickedMetric(isGroupMetric(initialMetric) ? initialMetric : null);
    setScope(initialScope);
    setSelected(null);
  }, [exerciseId, initialMetric, initialScope]);
  const selectView = (nextMetric: GroupMetric, nextScope: GroupBoardScope) => {
    setSelected(null);
    setPickedMetric(nextMetric);
    setScope(nextScope);
    // Keep the route aligned with in-place toggles so a later link to a
    // previously requested view is still observable as a parameter change.
    router.setParams({ metric: nextMetric, scope: nextScope });
  };
  // A member's refreshed performance replaces the selected snapshot; disappeared rows cannot be certified.
  const liveSelected = selected ? board.items.find(row => row.member.user_id === selected.member.user_id) ?? null : null;
  const rows = useMemo(() => board.items.map(row => buildGroupMetricRow(row, scope, userId)), [board.items, scope, userId]);
  const error = pickInlineError(board.error);
  const staleCursor = board.loadMoreError?.code === 'CONFLICT' || board.loadMoreError?.code === 'VALIDATION';
  if (board.lostAccess || group.lostAccess) return <GroupLostAccessState testID="group-board-lost-access" />;
  if (board.exerciseMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-exercise-missing" />;
  const rebuilding = board.firstPage?.state === 'rebuilding';
  const header = <View style={groupScreenStyles.header}>
    <Stack.Screen options={{ title: exercise.name }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: uiSpace.md }}>
      <UiText style={{ flex: 1 }} variant="label">{GROUP_METRIC_VIEW_LABELS[metric]}</UiText>
      <ActionButton label="History" variant="text" testID="group-board-history-button" onPress={() => router.push(
        `/group/${groupId}/leaderboards/${exerciseId}/history?metric=${metric}&scope=${scope}&revision=${exercise.rules_revision}`)} />
    </View>
    <UiText variant="bodyMuted" testID="group-board-rules">{describeGroupRules(exercise)}</UiText>
    {exercise.archived_at_ms !== null ? <UiText testID="group-board-archived">Archived · read-only</UiText> : null}
    <SegmentedControl accessibilityLabel="Metric" options={allowed.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }))}
      value={metric} onChange={value => selectView(value, scope)} testIDPrefix="group-board-metric" />
    <SegmentedControl accessibilityLabel="Sets" options={SCOPE_OPTIONS} value={scope}
      onChange={value => selectView(metric, value)} testIDPrefix="group-board-scope" />
    {metric === 'bodyweight_reps' ? <UiText variant="bodyMuted">Confirmed unweighted reps with no assistance. Body weight may be missing.</UiText>
      : <UiText variant="bodyMuted">{exercise.bodyweight_coefficient > 0
        ? 'Strength estimates use the saved session body weight. Missing or incompatible performances are not ranked.'
        : 'Weight and 1RM use the entered external load under the group’s declared weight convention.'}</UiText>}
    {board.offline ? <GroupOfflineBanner lastUpdatedAtMs={board.loadedAtMs} /> : null}
    {error && board.firstPage ? <GroupInlineError error={error} onRetry={onRefresh} testID="group-board-inline-error" /> : null}
    {staleCursor ? <GroupStateView title="The board changed" body="Refresh to load one consistent rules revision."
      actionLabel="Refresh board" onAction={onRefresh} testID="group-board-stale-cursor" /> : null}
  </View>;
  const empty = !board.firstPage ? <GroupMissingDataState error={error} offline={board.offline} onRetry={onRefresh} testIDPrefix="group-board" />
    : rebuilding ? <GroupStateView title="Recalculating under the new rules" body="The whole board will appear together."
        actionLabel="Refresh board" onAction={onRefresh} testID="group-board-rebuilding" />
    : <GroupStateView title={scope === 'certified' ? 'No certified sets yet' : 'No eligible sets yet'}
        body={scope === 'all' ? 'Check the movement, loading method and saved body weight in the linked session.' : undefined}
        actionLabel={scope === 'certified' ? 'See all sets' : undefined} onAction={() => selectView(metric, 'all')}
        actionTestID="group-board-see-all-button" testID="group-board-empty" />;
  return <>
    <FlatList style={groupScreenStyles.screen} contentContainerStyle={groupScreenStyles.cardListContent}
      ListHeaderComponent={header} ListHeaderComponentStyle={groupScreenStyles.cardListHeader} ListEmptyComponent={empty}
      ListFooterComponent={<GroupPagesFooter loadingMore={board.loadingMore} loadMoreError={staleCursor ? null : board.loadMoreError}
        onRetry={() => void board.loadMore()} noun="rows" testIDPrefix="group-board" />}
      data={rebuilding ? [] : rows} keyExtractor={row => row.key} testID="group-board-list"
      onEndReached={() => { if (!staleCursor) void board.loadMore(); }} onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
      renderItem={({ item, index }) => <GroupBoardRow row={item} index={index} count={rows.length}
        onPress={() => setSelected(board.items.find(row => row.member.user_id === item.key) ?? null)} />} />
    {liveSelected && !rebuilding ? <GroupMetricRecordSheet key={`${liveSelected.member.user_id}:${liveSelected.set_id}:${metric}:${exercise.rules_revision}`}
      row={liveSelected} exercise={exercise} groupId={groupId} userId={userId} myRole={group.data?.group.my_role ?? null}
      onClose={() => setSelected(null)} onChanged={async () => { await Promise.all([board.refresh(), group.refresh()]); }} /> : null}
  </>;
}
