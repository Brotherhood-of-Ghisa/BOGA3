import { useDateFormat } from '@/src/preferences/hooks';
import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, FlatList, RefreshControl, View } from 'react-native';

import { Icon, IconButton, ListRow, Sheet, uiSpace, useUiText } from '@/components/ui';
import { canManageGroup, getGroup, groupCacheKeys, useGroupOnlinePages, useGroupResource, type GroupBoardScope, type GroupGetResult } from '@/src/groups';
import { getCompetitionBoard } from '@/src/groups/api';
import { GROUP_COMPETITION_METRICS as GROUP_METRICS,isCompetitionMetric as isGroupMetric,type CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import { buildCompetitionRow as buildGroupMetricRow,COMPETITION_LABELS as GROUP_METRIC_SHORT_LABELS,competitionViewLabel } from '@/src/groups/competition-view-model';
import type { CompetitionBoardRowWire as GroupMetricBoardRowWire,CompetitionBoardWire as GroupMetricBoardWire,CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';
import { GroupBoardRow } from './group-board-row';
import { GroupBoardTitle } from './group-board-title';
import { GroupCycleButton } from './group-cycle-button';
import { GroupMetricRecordSheet } from './group-metric-record-sheet';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { useGroupScreenStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

const selectItems = (page: GroupMetricBoardWire) => page.entries;
const selectCursor = (page: GroupMetricBoardWire) => page.next_cursor;
const selectHasMore = (page: GroupMetricBoardWire) => page.next_cursor !== null;
const itemKey = (row: GroupMetricBoardRowWire) => row.member.user_id;
const SCOPE_OPTIONS = [{ value: 'all', label: 'All sets' }, { value: 'certified', label: 'Certified' }] as const;
const METRIC_OPTIONS = GROUP_METRICS.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }));

export function GroupMetricBoard({ userId, groupId, exercise: initialExercise, initialMetric, initialScope }: {
  userId: string; groupId: string; exercise: GroupMetricExerciseWire; initialMetric: string | null; initialScope: GroupBoardScope;
}) {
  const dateFormat = useDateFormat();
  const router = useRouter();
  const text = useUiText();
  const groupScreenStyles = useGroupScreenStyles();
  const allowed = GROUP_METRICS;
  const [optionsVisible, setOptionsVisible] = useState(false);
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
  const rows = useMemo(() => board.items.map(row => buildGroupMetricRow(row, scope, userId, dateFormat)), [board.items, scope, userId, dateFormat]);
  const error = pickInlineError(board.error);
  const staleCursor = board.loadMoreError?.code === 'CONFLICT' || board.loadMoreError?.code === 'VALIDATION';
  if (board.lostAccess || group.lostAccess) return <GroupLostAccessState testID="group-board-lost-access" />;
  if (board.resourceMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-exercise-missing" />;
  const rebuilding = board.firstPage?.state === 'rebuilding';
  const myRole = group.data?.group.my_role ?? null;
  const canEditRules = myRole !== null && canManageGroup(myRole) && exercise.archived_at_ms === null;
  const openFromOptions = (path: Href) => { setOptionsVisible(false); router.push(path); };
  const header = <View style={groupScreenStyles.header}>
    <Stack.Screen options={{ title: exercise.name,
      headerTitle: () => <GroupBoardTitle name={exercise.name} view={`${competitionViewLabel(metric,exercise.rules)} leaderboard`} testID="group-board-title" />,
      headerRight: () => <IconButton nativeHeader accessibilityLabel="Leaderboard options" name="more-vertical"
        onPress={() => setOptionsVisible(true)} testID="group-board-options-button" /> }} />
    {exercise.archived_at_ms !== null || board.firstPage?.state === 'archived' ? <Text allowFontScaling={false} style={text.body} testID="group-board-archived">Archived · read-only</Text> : null}
    <View style={{ flexDirection: 'row', gap: uiSpace.sm }} testID="group-board-filters">
      <GroupCycleButton accessibilityLabel="Metric" options={METRIC_OPTIONS} value={metric}
        onChange={value => selectView(value, scope)} testID="group-board-metric" />
      <GroupCycleButton accessibilityLabel="Sets" options={SCOPE_OPTIONS} value={scope}
        onChange={value => selectView(metric, value)} testID="group-board-scope" />
    </View>
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
    <Sheet dismissLabel="Dismiss leaderboard options" onDismiss={() => setOptionsVisible(false)}
      testID="group-board-options-sheet" title={exercise.name} visible={optionsVisible}>
      <ListRow label="History" leading={<Icon colorRole="inkMuted" name="list" size="md" />}
        onPress={() => openFromOptions(`/group/${groupId}/leaderboards/${exerciseId}/history?metric=${metric}&scope=${scope}`)}
        testID="group-board-history-button" trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />} />
      {canEditRules ? <ListRow label="Exercise rules" leading={<Icon colorRole="inkMuted" name="settings" size="md" />}
        onPress={() => openFromOptions(`/group/${groupId}/exercises/${exerciseId}/edit`)}
        testID="group-board-rules-button" trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />} /> : null}
    </Sheet>
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
