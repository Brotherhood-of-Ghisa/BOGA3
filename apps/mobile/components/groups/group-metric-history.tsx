import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { uiSpace } from '@/components/ui';
import { formatBoardDate, useGroupOnlinePages, type GroupBoardScope } from '@/src/groups';
import { getCompetitionBoard, getCompetitionHistory } from '@/src/groups/api';
import { GROUP_COMPETITION_METRICS, isCompetitionMetric, type CompetitionMetric } from '@/src/groups/competition-contract';
import { buildCompetitionRow, COMPETITION_LABELS, describeCompetitionEvent } from '@/src/groups/competition-view-model';
import type { CompetitionBoardRowWire, CompetitionBoardWire, CompetitionExerciseWire, CompetitionHistoryWire } from '@/src/groups/competition-wire';
import { GroupBoardHistoryItem } from './group-board-history-item';
import { GroupBoardRow } from './group-board-row';
import { GroupCycleButton } from './group-cycle-button';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { groupScreenStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

type HistoryView = 'events' | 'scores';
const historyItems = (page: CompetitionHistoryWire) => page.events;
const nextCursor = (page: { next_cursor: string | null }) => page.next_cursor;
const more = (page: { next_cursor: string | null }) => page.next_cursor !== null;
const scoreItems = (page: CompetitionBoardWire) => page.entries;
const scoreKey = (row: CompetitionBoardRowWire) => row.member.user_id;
const METRIC_OPTIONS = GROUP_COMPETITION_METRICS.map(value => ({ value, label: COMPETITION_LABELS[value] }));
const SCOPE_OPTIONS = [{ value: 'certified', label: 'Certified' }, { value: 'all', label: 'All' }] as const;
const VIEW_OPTIONS = [{ value: 'events', label: 'History' }, { value: 'scores', label: 'Scores' }] as const;

/**
 * A board's history under the comparison's current rules: one row of three
 * tap-to-cycle filters (metric, sets, history or scores), then the list.
 */
export function GroupMetricHistory({ userId, groupId, exercise, initialMetric, initialScope }: {
  userId: string; groupId: string; exercise: CompetitionExerciseWire;
  initialMetric: string | null; initialScope: GroupBoardScope;
}) {
  const router = useRouter();
  const exerciseId = exercise.group_exercise_id;
  const requestedMetric = isCompetitionMetric(initialMetric) ? initialMetric : exercise.rules.default_metric;
  const [metric, setMetric] = useState<CompetitionMetric>(requestedMetric);
  const [scope, setScope] = useState(initialScope);
  const [view, setView] = useState<HistoryView>('events');
  // Expo may reuse this route for another deep link: its requested view replaces the local one.
  const requestKey = JSON.stringify([exerciseId, initialMetric, initialScope]);
  const [shownRequestKey, setShownRequestKey] = useState(requestKey);
  if (shownRequestKey !== requestKey) {
    setShownRequestKey(requestKey);
    setMetric(requestedMetric);
    setScope(initialScope);
  }
  const select = (nextMetric: CompetitionMetric, nextScope: GroupBoardScope) => {
    setMetric(nextMetric);
    setScope(nextScope);
    router.setParams({ metric: nextMetric, scope: nextScope });
  };
  const identity = `${exerciseId}|${exercise.rules.rules_revision}|${metric}|${scope}`;
  const fetchHistory = useCallback((before: string | null) => getCompetitionHistory({ groupId, exerciseId,
    metric, certified: scope === 'certified', before }), [groupId, exerciseId, metric, scope]);
  const history = useGroupOnlinePages({ userId, groupId, viewKey: view === 'events' ? identity : null,
    fetchPage: fetchHistory, selectItems: historyItems, selectCursor: nextCursor, selectHasMore: more, itemKey: event => event.event_id });
  const fetchScores = useCallback((cursor: string | null) => getCompetitionBoard({ groupId, exerciseId,
    metric, certified: scope === 'certified', cursor }), [groupId, exerciseId, metric, scope]);
  const scores = useGroupOnlinePages({ userId, groupId, viewKey: view === 'scores' ? identity : null,
    fetchPage: fetchScores, selectItems: scoreItems, selectCursor: nextCursor, selectHasMore: more, itemKey: scoreKey });
  const resource = view === 'events' ? history : scores;
  const { pulling, onRefresh } = usePullToRefresh(resource.refresh);
  const error = pickInlineError(resource.error, resource.loadMoreError);
  if (resource.lostAccess) return <GroupLostAccessState testID="group-board-history-lost-access" />;
  if (resource.exerciseMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-history-exercise-missing" />;
  const header = <View style={groupScreenStyles.header}>
    <Stack.Screen options={{ title: exercise.name }} />
    <View style={styles.filters} testID="group-history-filters">
      <GroupCycleButton accessibilityLabel="Metric" options={METRIC_OPTIONS} value={metric}
        onChange={next => select(next, scope)} testID="group-history-metric" />
      <GroupCycleButton accessibilityLabel="Sets" options={SCOPE_OPTIONS} value={scope}
        onChange={next => select(metric, next)} testID="group-history-scope" />
      <GroupCycleButton accessibilityLabel="History or scores" options={VIEW_OPTIONS} value={view}
        onChange={setView} testID="group-history-view" />
    </View>
    {resource.offline ? <GroupOfflineBanner lastUpdatedAtMs={resource.loadedAtMs} /> : null}
    {error && resource.firstPage ? <GroupStateView title="Couldn't refresh" body={error.message} actionLabel="Refresh"
      onAction={onRefresh} testID="group-board-history-error" /> : null}
  </View>;
  const footer = <GroupPagesFooter loadingMore={resource.loadingMore} loadMoreError={resource.loadMoreError}
    onRetry={() => void resource.loadMore()} noun="history" testIDPrefix="group-board-history" />;
  const listProps = { ListHeaderComponent: header, ListFooterComponent: footer, style: groupScreenStyles.screen,
    contentContainerStyle: groupScreenStyles.cardListContent, ListHeaderComponentStyle: groupScreenStyles.cardListHeader,
    refreshControl: <RefreshControl refreshing={pulling} onRefresh={onRefresh} /> };
  if (view === 'scores') {
    const rows = scores.items.map(row => buildCompetitionRow(row, scope, userId));
    return <FlatList {...listProps} data={rows} keyExtractor={row => row.key}
      ListEmptyComponent={scores.firstPage ? <GroupStateView title={scores.firstPage.state === 'rebuilding'
        ? 'Recalculating under the new rules' : 'Score unavailable'} testID="group-history-scores-empty" />
        : <GroupMissingDataState error={error} offline={scores.offline} onRetry={onRefresh} testIDPrefix="group-history-scores" />}
      renderItem={({ item, index }) => <GroupBoardRow row={item} index={index} count={rows.length} />}
      onEndReached={() => void scores.loadMore()} testID="group-history-scores" />;
  }
  return <FlatList {...listProps} data={history.items} keyExtractor={event => event.event_id}
    ListEmptyComponent={history.firstPage ? <GroupStateView title="No history for this view yet" testID="group-board-history-empty" />
      : <GroupMissingDataState error={error} offline={history.offline} onRetry={onRefresh} testIDPrefix="group-board-history" />}
    renderItem={({ item, index }) => <GroupBoardHistoryItem index={index} count={history.items.length}
      testID={`group-board-history-item-${item.sequence}`} item={{ key: item.event_id, dateLabel: formatBoardDate(item.sort_at_ms), sentence: describeCompetitionEvent(item, userId) }} />}
    onEndReached={() => void history.loadMore()} testID="group-board-history-list" />;
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
});
