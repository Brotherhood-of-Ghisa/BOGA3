import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { SegmentedControl, UiButton, UiText, uiSpace } from '@/components/ui';
import { formatBoardDate, formatBoardMemberLabel, useGroupOnlinePages, type BoardRowViewModel, type GroupBoardScope } from '@/src/groups';
import { getGroupMetricBoard, getGroupMetricHistory, getGroupMetricRevisions } from '@/src/groups/api';
import { isGroupMetric, metricsForGroupRules, type GroupMetric } from '@/src/groups/metric-contract';
import { buildGroupMetricRow, describeGroupMetricHistory, describeGroupRules, describeLegacyMetricHistory, GROUP_METRIC_SHORT_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetricBoardRowWire, GroupMetricBoardWire, GroupMetricExerciseWire, GroupMetricHistoryWire, GroupMetricRevisionWire, GroupMetricRevisionsWire } from '@/src/groups/metric-wire';
import { GroupBoardHistoryItem } from './group-board-history-item';
import { GroupBoardRow } from './group-board-row';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { groupScreenStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

type Event = GroupMetricHistoryWire['events'][number];
const revisionItems = (page: GroupMetricRevisionsWire) => page.revisions;
const noCursor = () => null;
const noMore = () => false;
const revisionKey = (revision: GroupMetricRevisionWire) => String(revision.rules.rules_revision);
const historyItems = (page: GroupMetricHistoryWire) => page.events;
const historyCursor = (page: GroupMetricHistoryWire) => page.next_cursor;
const historyMore = (page: GroupMetricHistoryWire) => page.next_cursor !== null;
const eventKey = (event: Event) => event.event_id;
const scoreItems = (page: GroupMetricBoardWire) => page.entries;
const scoreCursor = (page: GroupMetricBoardWire) => page.next_cursor;
const scoreMore = (page: GroupMetricBoardWire) => page.next_cursor !== null;
const scoreKey = (row: GroupMetricBoardRowWire) => row.member.user_id;

export function GroupMetricHistory({ userId, groupId, exercise, initialMetric, initialScope, initialRevision }: {
  userId: string; groupId: string; exercise: GroupMetricExerciseWire;
  initialMetric: string | null; initialScope: GroupBoardScope; initialRevision: number | null;
}) {
  const exerciseId = exercise.group_exercise_id;
  const fetchRevisions = useCallback(() => getGroupMetricRevisions(groupId, exerciseId), [groupId, exerciseId]);
  const revisions = useGroupOnlinePages<GroupMetricRevisionsWire, GroupMetricRevisionWire, never>({ userId, groupId,
    viewKey: exerciseId, fetchPage: fetchRevisions, selectItems: revisionItems, selectCursor: noCursor, selectHasMore: noMore, itemKey: revisionKey });
  const [pickedRevision, setPickedRevision] = useState(initialRevision ?? exercise.rules_revision);
  const revision = revisions.items.find(row => row.rules.rules_revision === pickedRevision) ?? revisions.items[0];
  const rules = revision?.rules ?? exercise;
  const allowed = metricsForGroupRules({ bodyweightCoefficient: rules.bodyweight_coefficient });
  const [pickedMetric, setPickedMetric] = useState<GroupMetric | null>(isGroupMetric(initialMetric) ? initialMetric : null);
  const metric = pickedMetric && allowed.includes(pickedMetric) ? pickedMetric : rules.default_metric;
  const [scope, setScope] = useState(initialScope);
  const [view, setView] = useState<'events' | 'scores'>('events');
  const identity = `${exerciseId}|${rules.rules_revision}|${metric}|${scope}`;
  const fetchHistory = useCallback((before: string | null) => getGroupMetricHistory({ groupId, groupExerciseId: exerciseId,
    metric, certified: scope === 'certified', revision: rules.rules_revision, before }), [groupId, exerciseId, metric, scope, rules.rules_revision]);
  const history = useGroupOnlinePages<GroupMetricHistoryWire, Event, string>({ userId, groupId,
    viewKey: revision && view === 'events' ? identity : null, fetchPage: fetchHistory,
    selectItems: historyItems, selectCursor: historyCursor, selectHasMore: historyMore, itemKey: eventKey });
  const fetchScores = useCallback((after: string | null) => getGroupMetricBoard({ groupId, groupExerciseId: exerciseId,
    metric, certified: scope === 'certified', revision: rules.rules_revision, after }), [groupId, exerciseId, metric, scope, rules.rules_revision]);
  const scores = useGroupOnlinePages<GroupMetricBoardWire, GroupMetricBoardRowWire, string>({ userId, groupId,
    viewKey: revision && !revision.legacy && view === 'scores' ? identity : null, fetchPage: fetchScores,
    selectItems: scoreItems, selectCursor: scoreCursor, selectHasMore: scoreMore, itemKey: scoreKey });
  const refreshRevisions = revisions.refresh;
  const refreshHistory = history.refresh;
  const refreshScores = scores.refresh;
  const refresh = useCallback(async () => { await refreshRevisions(); await (view === 'events' ? refreshHistory() : refreshScores()); },
    [refreshRevisions, refreshHistory, refreshScores, view]);
  const { pulling, onRefresh } = usePullToRefresh(refresh);
  const resource = view === 'events' ? history : scores;
  const offline = revisions.offline || resource.offline;
  const error = pickInlineError(revisions.error, resource.error, resource.loadMoreError);
  if (revisions.lostAccess || resource.lostAccess) return <GroupLostAccessState testID="group-board-history-lost-access" />;
  if (revisions.exerciseMissing || resource.exerciseMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-history-exercise-missing" />;
  if (!revision) return <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-board-history" />;
  const legacyRows: BoardRowViewModel[] = (revision.legacy_entries ?? []).filter(row => row.metric === metric && row.certified === (scope === 'certified'))
    .sort((a, b) => b.value_kg - a.value_kg || a.achieved_at_ms - b.achieved_at_ms || a.member_user_id.localeCompare(b.member_user_id))
    .map((row, index) => ({ key: row.member_user_id, rank: index + 1, rankLabel: String(index + 1),
      memberLabel: formatBoardMemberLabel(row.member, false, userId), isMe: row.member_user_id === userId, former: false,
      valueLabel: `${row.value_kg.toFixed(1)} kg`, detailLabel: `${row.weight_kg} kg × ${row.reps}`, dateLabel: formatBoardDate(row.achieved_at_ms),
      certification: null, accessibilityLabel: `${index + 1}, ${formatBoardMemberLabel(row.member, false, userId)}, ${row.value_kg} kg, original rules ${rules.rules_revision}` }));
  const header = <View style={groupScreenStyles.header}>
    <UiText variant="label">{exercise.name} · History</UiText>
    <View style={{ gap: uiSpace.sm }}>
      {revisions.items.map(item => <UiButton key={item.rules.rules_revision} label={`Rules ${item.rules.rules_revision}${item.legacy ? ' · original kg-only' : ''}${item.retired_at_ms !== null ? ' · retired' : ''}`}
        variant={rules.rules_revision === item.rules.rules_revision ? 'primary' : 'secondary'}
        onPress={() => setPickedRevision(item.rules.rules_revision)} testID={`group-history-revision-${item.rules.rules_revision}`} />)}
    </View>
    <UiText variant="bodyMuted">{describeGroupRules({ ...exercise, ...rules })}</UiText>
    <UiText variant="bodyMuted">{revision.legacy ? 'Original kg-only records and frozen retirement scores. Bodyweight context was not added to these certifications.'
      : 'Rules changes recalculate the comparison. They are listed separately from new performances.'}</UiText>
    <SegmentedControl accessibilityLabel="Metric" value={metric} onChange={setPickedMetric}
      options={allowed.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }))} testIDPrefix="group-history-metric" />
    <SegmentedControl accessibilityLabel="Sets" value={scope} onChange={setScope}
      options={[{ value: 'certified', label: 'Certified' }, { value: 'all', label: 'All' }]} testIDPrefix="group-history-scope" />
    <SegmentedControl accessibilityLabel="History or revision scores" value={view} onChange={setView}
      options={[{ value: 'events', label: 'History' }, { value: 'scores', label: 'Revision scores' }]} testIDPrefix="group-history-view" />
    {offline ? <GroupOfflineBanner lastUpdatedAtMs={resource.loadedAtMs ?? revisions.loadedAtMs} /> : null}
    {error ? <GroupStateView title="Couldn't refresh this revision" body={error.message} actionLabel="Refresh" onAction={onRefresh} testID="group-board-history-error" /> : null}
  </View>;
  const footer = <GroupPagesFooter loadingMore={resource.loadingMore} loadMoreError={resource.loadMoreError}
    onRetry={() => void resource.loadMore()} noun="history" testIDPrefix="group-board-history" />;
  if (view === 'scores') {
    const rows = revision.legacy ? legacyRows : scores.items.map(row => buildGroupMetricRow(row, scope, userId));
    return <FlatList data={rows} keyExtractor={row => row.key} ListHeaderComponent={header} ListFooterComponent={footer}
      ListEmptyComponent={revision.legacy || scores.firstPage
        ? <GroupStateView title={scores.firstPage?.state === 'rebuilding' ? 'Recalculating under the new rules' : 'No scores in this revision'} testID="group-history-scores-empty" />
        : <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-history-scores" />}
      renderItem={({ item, index }) => <GroupBoardRow row={item} index={index} count={rows.length} />}
      onEndReached={() => { if (!revision.legacy) void scores.loadMore(); }}
      style={groupScreenStyles.screen} contentContainerStyle={groupScreenStyles.cardListContent}
      ListHeaderComponentStyle={groupScreenStyles.cardListHeader} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
      testID="group-history-scores" />;
  }
  return <FlatList data={history.items} keyExtractor={eventKey} ListHeaderComponent={header} ListFooterComponent={footer}
    ListEmptyComponent={history.firstPage ? <GroupStateView title="No history for this view yet" testID="group-board-history-empty" />
      : <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-board-history" />}
    renderItem={({ item, index }) => <GroupBoardHistoryItem index={index} count={history.items.length}
      testID={`group-board-history-item-${item.sequence}`} item={{ key: item.event_id, dateLabel: formatBoardDate(item.sort_at_ms),
        sentence: 'legacy' in item ? describeLegacyMetricHistory(item, userId) : describeGroupMetricHistory(item, userId) }} />}
    onEndReached={() => void history.loadMore()} style={groupScreenStyles.screen} contentContainerStyle={groupScreenStyles.cardListContent}
    ListHeaderComponentStyle={groupScreenStyles.cardListHeader} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
    testID="group-board-history-list" />;
}
