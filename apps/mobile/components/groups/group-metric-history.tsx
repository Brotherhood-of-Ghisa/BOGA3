import { useDateFormat } from '@/src/preferences/hooks';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { uiSpace } from '@/components/ui';
import { useGroupOnlinePages, type GroupBoardScope } from '@/src/groups';
import { getCompetitionRecordsHistory } from '@/src/groups/api';
import { GROUP_COMPETITION_METRICS, isCompetitionMetric, type CompetitionMetric } from '@/src/groups/competition-contract';
import { COMPETITION_LABELS, competitionViewLabel } from '@/src/groups/competition-view-model';
import type { CompetitionExerciseWire, CompetitionRecordsHistoryItemWire, CompetitionRecordsHistoryWire } from '@/src/groups/competition-wire';
import { buildRecordsLog } from '@/src/groups/records-history-view-model';
import { GroupBoardTitle } from './group-board-title';
import { GroupCycleButton } from './group-cycle-button';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupRecordsLogRow } from './group-records-log-row';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { useGroupScreenStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

const selectItems = (page: CompetitionRecordsHistoryWire) => page.items;
const selectCursor = (page: CompetitionRecordsHistoryWire) => page.next_cursor;
const selectHasMore = (page: CompetitionRecordsHistoryWire) => page.next_cursor !== null;
const itemKey = (item: CompetitionRecordsHistoryItemWire) => item.event.event_id;
const METRIC_OPTIONS = GROUP_COMPETITION_METRICS.map(value => ({ value, label: COMPETITION_LABELS[value] }));
const SCOPE_OPTIONS = [{ value: 'all', label: 'All sets' }, { value: 'certified', label: 'Certified' }] as const;

/**
 * A board's records log: one row of two tap-to-cycle filters (metric, sets),
 * then every new best (All) or new #1 (Certified), newest first, across every
 * rules revision, with a divider at each rules change.
 */
export function GroupMetricHistory({ userId, groupId, exercise, initialMetric, initialScope }: {
  userId: string; groupId: string; exercise: CompetitionExerciseWire;
  initialMetric: string | null; initialScope: GroupBoardScope;
}) {
  const groupScreenStyles = useGroupScreenStyles();
  const dateFormat = useDateFormat();
  const router = useRouter();
  const exerciseId = exercise.group_exercise_id;
  const requestedMetric = isCompetitionMetric(initialMetric) ? initialMetric : exercise.rules.default_metric;
  const [metric, setMetric] = useState<CompetitionMetric>(requestedMetric);
  const [scope, setScope] = useState(initialScope);
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
  const fetchPage = useCallback((before: string | null) => getCompetitionRecordsHistory({ groupId, exerciseId,
    metric, certified: scope === 'certified', before }), [groupId, exerciseId, metric, scope]);
  const history = useGroupOnlinePages({ userId, groupId, viewKey: `${exerciseId}|${exercise.rules.rules_revision}|${metric}|${scope}`,
    fetchPage, selectItems, selectCursor, selectHasMore, itemKey });
  const rules = history.firstPage?.exercise.rules ?? exercise.rules;
  const rows = useMemo(() => buildRecordsLog(history.items, { metric, userId, currentRevision: rules.rules_revision, dateFormat }),
    [history.items, metric, userId, rules.rules_revision, dateFormat]);
  const { pulling, onRefresh } = usePullToRefresh(history.refresh);
  const error = pickInlineError(history.error, history.loadMoreError);
  if (history.lostAccess) return <GroupLostAccessState testID="group-board-history-lost-access" />;
  if (history.resourceMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-history-exercise-missing" />;
  const header = <View style={groupScreenStyles.header}>
    <Stack.Screen options={{ title: exercise.name,
      headerTitle: () => <GroupBoardTitle name={exercise.name} view={`${competitionViewLabel(metric, rules)} history`} testID="group-history-title" /> }} />
    <View style={{ flexDirection: 'row', gap: uiSpace.sm }} testID="group-history-filters">
      <GroupCycleButton accessibilityLabel="Metric" options={METRIC_OPTIONS} value={metric}
        onChange={next => select(next, scope)} testID="group-history-metric" />
      <GroupCycleButton accessibilityLabel="Sets" options={SCOPE_OPTIONS} value={scope}
        onChange={next => select(metric, next)} testID="group-history-scope" />
    </View>
    {history.offline ? <GroupOfflineBanner lastUpdatedAtMs={history.loadedAtMs} /> : null}
    {error && history.firstPage ? <GroupStateView title="Couldn't refresh" body={error.message} actionLabel="Refresh"
      onAction={onRefresh} testID="group-board-history-error" /> : null}
  </View>;
  return <FlatList ListHeaderComponent={header} ListHeaderComponentStyle={groupScreenStyles.cardListHeader}
    ListFooterComponent={<GroupPagesFooter loadingMore={history.loadingMore} loadMoreError={history.loadMoreError}
      onRetry={() => void history.loadMore()} noun="history" testIDPrefix="group-board-history" />}
    style={groupScreenStyles.screen} contentContainerStyle={groupScreenStyles.cardListContent}
    refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
    data={rows} keyExtractor={row => row.key}
    ListEmptyComponent={history.firstPage ? <GroupStateView title={scope === 'certified' ? 'No certified #1 yet' : 'No records yet'}
      testID="group-board-history-empty" />
      : <GroupMissingDataState error={error} offline={history.offline} onRetry={onRefresh} testIDPrefix="group-board-history" />}
    renderItem={({ item }) => <GroupRecordsLogRow row={item} testID={`group-board-history-item-${item.key}`} />}
    onEndReached={() => void history.loadMore()} testID="group-board-history-list" />;
}
