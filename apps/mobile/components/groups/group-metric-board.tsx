import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, FlatList, RefreshControl, View } from 'react-native';

import { ActionButton, SegmentedControl, uiSpace } from '@/components/ui';
import { getGroup, groupCacheKeys, useGroupOnlinePages, useGroupResource, type GroupBoardScope, type GroupGetResult } from '@/src/groups';
import { getCompetitionBoard } from '@/src/groups/api';
import { GROUP_COMPETITION_METRICS as GROUP_METRICS,isCompetitionMetric as isGroupMetric,type CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import { buildCompetitionRow as buildGroupMetricRow,describeCompetitionRules as describeGroupRules,COMPETITION_LABELS as GROUP_METRIC_SHORT_LABELS,competitionViewLabel } from '@/src/groups/competition-view-model';
import type { CompetitionBoardRowWire as GroupMetricBoardRowWire,CompetitionBoardWire as GroupMetricBoardWire,CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';
import { GroupBoardRow } from './group-board-row';
import { GroupMetricRecordSheet } from './group-metric-record-sheet';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { groupScreenStyles, groupMetricTextStyles as textStyles } from './screen-styles';
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
  const allowed = GROUP_METRICS;
  const [pickedMetric, setPickedMetric] = useState<GroupMetric | null>(isGroupMetric(initialMetric) ? initialMetric : null);
  const metric = pickedMetric && allowed.includes(pickedMetric) ? pickedMetric : initialExercise.rules.default_metric;
  const [scope, setScope] = useState(initialScope);
  const exerciseId = initialExercise.group_exercise_id;
  const fetchPage = useCallback((after: string | null) => getCompetitionBoard({ groupId, exerciseId,
    metric, certified: scope === 'certified', cursor: after }), [exerciseId, groupId, metric, scope]);
  const board = useGroupOnlinePages<GroupMetricBoardWire, GroupMetricBoardRowWire, string>({ userId, groupId,
    viewKey: `${exerciseId}|${metric}|${scope}|${initialExercise.rules.rules_revision}`, fetchPage, selectItems, selectCursor, selectHasMore, itemKey });
  const { pulling, onRefresh } = usePullToRefresh(board.refresh);
  const exercise = board.firstPage ? { ...initialExercise,rules: board.firstPage.rules,rebuilding: board.firstPage.state === 'rebuilding' } : initialExercise;
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: groupFetcher, evictGroupIdOnNotFound: groupId });
  const [selected, setSelected] = useState<GroupMetricBoardRowWire | null>(null);
  // Expo may reuse this route for another deep link. Its requested view must
  // replace the last local selection, including a page caught during rebuild.
  const requestKey = JSON.stringify([exerciseId, initialMetric, initialScope]);
  const [shownRequestKey, setShownRequestKey] = useState(requestKey);
  if (shownRequestKey !== requestKey) {
    setShownRequestKey(requestKey);
    setPickedMetric(isGroupMetric(initialMetric) ? initialMetric : null);
    setScope(initialScope);
    setSelected(null);
  }
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
      <Text allowFontScaling={false} style={[textStyles.heading, { flex: 1 }]}>{competitionViewLabel(metric,exercise.rules)}</Text>
      <ActionButton label="History" variant="text" testID="group-board-history-button" onPress={() => router.push(
        `/group/${groupId}/leaderboards/${exerciseId}/history?metric=${metric}&scope=${scope}&revision=${exercise.rules.rules_revision}`)} />
    </View>
    <Text allowFontScaling={false} style={textStyles.muted} testID="group-board-rules">{describeGroupRules(exercise)}</Text>
    {exercise.archived_at_ms !== null || board.firstPage?.state === 'archived' ? <Text allowFontScaling={false} style={textStyles.body} testID="group-board-archived">Archived · read-only</Text> : null}
    <SegmentedControl accessibilityLabel="Metric" options={allowed.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }))}
      value={metric} onChange={value => selectView(value, scope)} testIDPrefix="group-board-metric" />
    <SegmentedControl accessibilityLabel="Sets" options={SCOPE_OPTIONS} value={scope}
      onChange={value => selectView(metric, value)} testIDPrefix="group-board-scope" />
    <Text allowFontScaling={false} style={textStyles.muted}>Scores use the group’s current rules. Ineligible performances are omitted.</Text>
    {board.offline ? <GroupOfflineBanner lastUpdatedAtMs={board.loadedAtMs} /> : null}
    {error && board.firstPage ? <GroupInlineError error={error} onRetry={onRefresh} testID="group-board-inline-error" /> : null}
    {staleCursor ? <GroupStateView title="The board changed" body="Refresh to load one consistent rules revision."
      actionLabel="Refresh board" onAction={onRefresh} testID="group-board-stale-cursor" /> : null}
  </View>;
  const empty = !board.firstPage ? <GroupMissingDataState error={error} offline={board.offline} onRetry={onRefresh} testIDPrefix="group-board" />
    : rebuilding ? <GroupStateView title="Recalculating under the new rules" body="The whole board will appear together."
        actionLabel="Refresh board" onAction={onRefresh} testID="group-board-rebuilding" />
    : <GroupStateView title={scope === 'certified' ? 'No certified sets yet' : 'Score unavailable'}
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
    {liveSelected && !rebuilding ? <GroupMetricRecordSheet key={`${liveSelected.member.user_id}:${liveSelected.performance.set_id}:${metric}:${exercise.rules.rules_revision}`}
      row={liveSelected} exercise={exercise} readOnlyReason={board.firstPage?.state === 'archived' ? 'archived' : undefined} groupId={groupId} userId={userId} myRole={group.data?.group.my_role ?? null}
      onClose={() => setSelected(null)} onChanged={async () => { await Promise.all([board.refresh(), group.refresh()]); }} /> : null}
  </>;
}
