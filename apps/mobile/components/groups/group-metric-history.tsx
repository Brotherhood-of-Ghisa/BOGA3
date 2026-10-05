import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, FlatList, RefreshControl, View } from 'react-native';

import { ChipGroup, SegmentedControl } from '@/components/ui';
import { formatBoardDate, useGroupOnlinePages, type GroupBoardScope } from '@/src/groups';
import { getCompetitionBoard, getCompetitionHistory, getCompetitionRevisions } from '@/src/groups/api';
import { GROUP_COMPETITION_METRICS, isCompetitionMetric } from '@/src/groups/competition-contract';
import { buildCompetitionRow, describeCompetitionEvent, describeCompetitionRules, HISTORICAL_METRIC_LABELS } from '@/src/groups/competition-view-model';
import type { CompetitionBoardRowWire, CompetitionBoardWire, CompetitionExerciseWire, CompetitionHistoricalMetric,
  CompetitionHistoryWire, CompetitionRevisionWire, CompetitionRevisionsWire } from '@/src/groups/competition-wire';
import { GroupBoardHistoryItem } from './group-board-history-item';
import { GroupBoardRow } from './group-board-row';
import { GroupOfflineBanner } from './offline-banner';
import { GroupPagesFooter } from './group-pages-footer';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from './group-state-view';
import { groupScreenStyles, groupMetricTextStyles as textStyles } from './screen-styles';
import { usePullToRefresh } from './use-pull-to-refresh';

const revisionItems = (page: CompetitionRevisionsWire) => page.revisions;
const noCursor = () => null;
const noMore = () => false;
const revisionKey = (revision: CompetitionRevisionWire) => String(revision.rules_revision);
const historyItems = (page: CompetitionHistoryWire) => page.events;
const historyCursor = (page: { next_cursor: string | null }) => page.next_cursor;
const more = (page: { next_cursor: string | null }) => page.next_cursor !== null;
const scoreItems = (page: CompetitionBoardWire) => page.entries;
const scoreKey = (row: CompetitionBoardRowWire) => row.member.user_id;
const allowedMetrics = (revision: CompetitionRevisionWire | undefined): CompetitionHistoricalMetric[] =>
  revision?.representation_version === 3 ? [...new Set<CompetitionHistoricalMetric>(['weight','e1rm',revision.rules.default_metric])] : [...GROUP_COMPETITION_METRICS];

export function GroupMetricHistory({ userId, groupId, exercise, initialMetric, initialScope, initialRevision }: {
  userId: string; groupId: string; exercise: CompetitionExerciseWire;
  initialMetric: string | null; initialScope: GroupBoardScope; initialRevision: number | null;
}) {
  const router = useRouter();
  const exerciseId = exercise.group_exercise_id;
  const fetchRevisions = useCallback(() => getCompetitionRevisions(groupId,exerciseId),[groupId,exerciseId]);
  const revisions = useGroupOnlinePages<CompetitionRevisionsWire,CompetitionRevisionWire,never>({ userId,groupId,
    viewKey: exerciseId,fetchPage: fetchRevisions,selectItems: revisionItems,selectCursor: noCursor,selectHasMore: noMore,itemKey: revisionKey });
  const [pickedRevision,setPickedRevision] = useState(initialRevision ?? exercise.rules.rules_revision);
  const revision = revisions.items.find(row => row.rules_revision === pickedRevision) ?? revisions.items[0];
  const revisionId = revision?.rules_revision ?? exercise.rules.rules_revision;
  const allowed = allowedMetrics(revision);
  const [pickedMetric,setPickedMetric] = useState<CompetitionHistoricalMetric | null>(initialMetric && Object.hasOwn(HISTORICAL_METRIC_LABELS,initialMetric) ? initialMetric as CompetitionHistoricalMetric : null);
  const metric = pickedMetric && allowed.includes(pickedMetric) ? pickedMetric : revision?.rules.default_metric ?? exercise.rules.default_metric;
  const [scope,setScope] = useState(initialScope);
  const [view,setView] = useState<'events'|'scores'>('events');
  const requestKey = JSON.stringify([exerciseId,initialRevision,initialMetric,initialScope]);
  const [shownRequestKey,setShownRequestKey] = useState(requestKey);
  if (shownRequestKey !== requestKey) {
    setShownRequestKey(requestKey);setPickedRevision(initialRevision ?? exercise.rules.rules_revision);
    setPickedMetric(initialMetric && Object.hasOwn(HISTORICAL_METRIC_LABELS,initialMetric) ? initialMetric as CompetitionHistoricalMetric : null);setScope(initialScope);
  }
  const select = (nextMetric: CompetitionHistoricalMetric,nextScope: GroupBoardScope,nextRevision: number) => {
    setPickedMetric(nextMetric);setScope(nextScope);setPickedRevision(nextRevision);
    router.setParams({ metric: nextMetric,scope: nextScope,revision: String(nextRevision) });
  };
  const identity = `${exerciseId}|${revisionId}|${metric}|${scope}`;
  const fetchHistory = useCallback((before: string | null) => getCompetitionHistory({ groupId,exerciseId,
    metric,certified: scope === 'certified',revision: revisionId,before }),[groupId,exerciseId,metric,scope,revisionId]);
  const history = useGroupOnlinePages({ userId,groupId,viewKey: revision && view === 'events' ? identity : null,
    fetchPage: fetchHistory,selectItems: historyItems,selectCursor: historyCursor,selectHasMore: more,itemKey: event => event.event_id });
  const current = revisionId === exercise.rules.rules_revision && isCompetitionMetric(metric);
  const fetchScores = useCallback((cursor: string | null) => getCompetitionBoard({ groupId,exerciseId,
    metric: isCompetitionMetric(metric) ? metric : 'e1rm',certified: scope === 'certified',cursor }),[groupId,exerciseId,metric,scope]);
  const scores = useGroupOnlinePages({ userId,groupId,viewKey: current && view === 'scores' ? identity : null,
    fetchPage: fetchScores,selectItems: scoreItems,selectCursor: historyCursor,selectHasMore: more,itemKey: scoreKey });
  const refresh = async () => { await revisions.refresh();await (view === 'events' ? history.refresh() : scores.refresh()); };
  const { pulling,onRefresh } = usePullToRefresh(refresh);
  const resource = view === 'events' ? history : scores;
  const offline = revisions.offline || resource.offline;
  const error = pickInlineError(revisions.error,resource.error,resource.loadMoreError);
  if (revisions.lostAccess || resource.lostAccess) return <GroupLostAccessState testID="group-board-history-lost-access" />;
  if (revisions.exerciseMissing || resource.exerciseMissing) return <GroupStateView title="This exercise isn't in this group" testID="group-board-history-exercise-missing" />;
  if (!revision) return <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-board-history" />;
  const header = <View style={groupScreenStyles.header}>
    <Text allowFontScaling={false} style={textStyles.heading}>{exercise.name} · History</Text>
    <ChipGroup mode="single" accessibilityLabel="Rules revision" value={revisionId}
      options={revisions.items.map(item => ({ value: item.rules_revision,label: `Rules ${item.rules_revision}${item.retired_at_ms !== null ? ' · retired' : ''}` }))}
      onChange={next => { const r=revisions.items.find(item => item.rules_revision === next);
        if (r) select(allowedMetrics(r).includes(metric) ? metric : r.rules.default_metric,scope,next); }} testIDPrefix="group-history-revision" />
    <Text allowFontScaling={false} style={textStyles.muted}>{describeCompetitionRules({ rules: { ...revision.rules,rules_revision: revisionId } })}</Text>
    <Text allowFontScaling={false} style={textStyles.muted}>History keeps each value’s original unit. Recalculation preserves unchanged witnessed sets.</Text>
    <SegmentedControl accessibilityLabel="Metric" value={metric} onChange={next => select(next,scope,revisionId)}
      options={allowed.map(value => ({ value,label: HISTORICAL_METRIC_LABELS[value] }))} testIDPrefix="group-history-metric" />
    <SegmentedControl accessibilityLabel="Sets" value={scope} onChange={next => select(metric,next,revisionId)}
      options={[{ value: 'certified',label: 'Certified' },{ value: 'all',label: 'All' }]} testIDPrefix="group-history-scope" />
    <SegmentedControl accessibilityLabel="History or scores" value={view} onChange={setView}
      options={[{ value: 'events',label: 'History' },{ value: 'scores',label: 'Scores' }]} testIDPrefix="group-history-view" />
    {offline ? <GroupOfflineBanner lastUpdatedAtMs={resource.loadedAtMs ?? revisions.loadedAtMs} /> : null}
    {error ? <GroupStateView title="Couldn't refresh this revision" body={error.message} actionLabel="Refresh" onAction={onRefresh} testID="group-board-history-error" /> : null}
  </View>;
  const footer = <GroupPagesFooter loadingMore={resource.loadingMore} loadMoreError={resource.loadMoreError}
    onRetry={() => void resource.loadMore()} noun="history" testIDPrefix="group-board-history" />;
  if (view === 'scores') {
    const rows = current ? scores.items.map(row => buildCompetitionRow(row,scope,userId)) : [];
    return <FlatList data={rows} keyExtractor={row => row.key} ListHeaderComponent={header} ListFooterComponent={footer}
      ListEmptyComponent={!current || scores.firstPage ? <GroupStateView title={scores.firstPage?.state === 'rebuilding'
        ? 'Recalculating under the new rules' : 'Score unavailable'} testID="group-history-scores-empty" />
        : <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-history-scores" />}
      renderItem={({ item,index }) => <GroupBoardRow row={item} index={index} count={rows.length} />}
      onEndReached={() => { if (current) void scores.loadMore(); }} style={groupScreenStyles.screen}
      contentContainerStyle={groupScreenStyles.cardListContent} ListHeaderComponentStyle={groupScreenStyles.cardListHeader}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />} testID="group-history-scores" />;
  }
  return <FlatList data={history.items} keyExtractor={event => event.event_id} ListHeaderComponent={header} ListFooterComponent={footer}
    ListEmptyComponent={history.firstPage ? <GroupStateView title="No history for this view yet" testID="group-board-history-empty" />
      : <GroupMissingDataState error={error} offline={offline} onRetry={onRefresh} testIDPrefix="group-board-history" />}
    renderItem={({ item,index }) => <GroupBoardHistoryItem index={index} count={history.items.length}
      testID={`group-board-history-item-${item.sequence}`} item={{ key: item.event_id,dateLabel: formatBoardDate(item.sort_at_ms),sentence: describeCompetitionEvent(item,userId) }} />}
    onEndReached={() => void history.loadMore()} style={groupScreenStyles.screen} contentContainerStyle={groupScreenStyles.cardListContent}
    ListHeaderComponentStyle={groupScreenStyles.cardListHeader} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
    testID="group-board-history-list" />;
}
