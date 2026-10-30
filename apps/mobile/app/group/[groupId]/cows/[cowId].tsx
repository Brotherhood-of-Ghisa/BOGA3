import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ActionButton, Card, ScreenScroll, uiSpace } from '@/components/ui';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from '@/components/groups/group-state-view';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { CoWMetricTabs, CoWResultHeading, CoWRows } from '@/components/groups/cow-preview';
import { useAuth } from '@/src/auth';
import { getCoWResults, type GroupApiError } from '@/src/groups/api';
import { useGroupOnlinePages, type GroupOnlinePagesState } from '@/src/groups/use-group-online-pages';
import { useCoWDefinition } from '@/src/groups/use-cow-definition';
import { coWMetric, coWStatus } from '@/src/groups/cow-presentation';
import type { CoWMetric } from '@/src/groups/cow-scoring';
import type { CoWResultWire, CoWRowWire } from '@/src/groups/cow-wire';
import { useDateFormat } from '@/src/preferences/hooks';

const items = (page: CoWResultWire) => page.rankings[0].entries;
const cursor = (page: CoWResultWire) => page.rankings[0].next_cursor;
const hasMore = (page: CoWResultWire) => page.rankings[0].next_cursor !== null;
const itemKey = (row: CoWRowWire) => row.member.user_id;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Online result pages retain server places and finality; switching a metric replaces every page. */
export default function CoWStandingsRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string; cowId?: string; metric?: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  const groupId = first(params.groupId); const cowId = first(params.cowId);
  if (!groupId || !cowId) return <GroupStateView title="CoW unavailable" testID="cow-missing" />;
  return <CoWStandings key={`${user.id}:${groupId}:${cowId}:${params.metric ?? ''}`} groupId={groupId} cowId={cowId} userId={user.id} initialMetric={first(params.metric)} />;
}
function CoWStandings({ groupId, cowId, userId, initialMetric }: { groupId: string; cowId: string; userId: string; initialMetric: string | null }) {
  const router = useRouter();
  const definition = useCoWDefinition(groupId, cowId, userId);
  const cow = definition.firstPage?.cow;
  const [picked, setPicked] = useState<CoWMetric | null>(null);
  const metric = cow ? coWMetric(picked ?? initialMetric, cow.metrics) : 'e1rm';
  const fetchPage = useCallback((before: string | null) => getCoWResults(groupId, cowId, metric, before), [groupId, cowId, metric]);
  const board = useGroupOnlinePages({ userId, groupId, viewKey: cow ? `${cowId}:${cow.revision}:${metric}` : null,
    fetchPage, selectItems: items, selectCursor: cursor, selectHasMore: hasMore, itemKey });
  const refresh = async () => { await Promise.all([definition.refresh(), board.refresh()]); };
  // A completed clock window is not proof of a published final. Refresh on its edge.
  const refreshBoard = board.refresh; const refreshDefinition = definition.refresh;
  const edgeHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!cow || cow.state === 'final' || cow.state === 'unavailable') return;
    const edge = cow.state === 'scheduled' ? cow.starts_at_us / 1000 : cow.ends_at_us / 1000;
    const key = `${cow.cow_id}:${cow.state}:${edge}`;
    if (edgeHandled.current === key) return;
    const timer = setTimeout(() => { edgeHandled.current = key; void Promise.all([refreshDefinition(), refreshBoard()]); }, Math.min(Math.max(0, edge - Date.now()), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [cow, refreshBoard, refreshDefinition]);
  const error = pickInlineError(definition.error, board.error);
  if (definition.lostAccess || board.lostAccess) return <GroupLostAccessState testID="cow-lost-access" />;
  if (definition.resourceMissing || board.resourceMissing) return <GroupStateView title="CoW unavailable" testID="cow-missing" />;
  const select = (next: CoWMetric) => { setPicked(next); router.setParams({ metric: next }); };
  return <CoWStandingsBody board={board} definitionOffline={definition.offline} error={error} metric={metric} userId={userId} onSelect={select} refresh={refresh} />;
}

function CoWStandingsBody({ board, definitionOffline, error, metric, userId, onSelect, refresh }: {
  board: GroupOnlinePagesState<CoWResultWire, CoWRowWire>; definitionOffline: boolean; error: GroupApiError | null;
  metric: CoWMetric; userId: string; onSelect: (metric: CoWMetric) => void; refresh: () => Promise<void>;
}) {
  const dateFormat = useDateFormat();
  const result = board.firstPage;
  const stale = board.loadMoreError?.code === 'CONFLICT' || board.loadMoreError?.code === 'VALIDATION';
  return <ScreenScroll testID="cow-standings" refreshControl={<RefreshControl refreshing={board.refreshing} onRefresh={() => void refresh()} />}>
    <Stack.Screen options={{ title: 'CoW standings' }} />
    {board.offline || definitionOffline ? <GroupOfflineBanner lastUpdatedAtMs={board.loadedAtMs} /> : null}
    {result ? <>
      <Card><View style={{ padding: uiSpace.md, gap: uiSpace.md }}><CoWResultHeading result={result} dateFormat={dateFormat} />
        <CoWMetricTabs metrics={result.cow.metrics} metric={metric} onChange={onSelect} testID="cow-standings" /></View></Card>
      {error ? <GroupInlineError error={error} onRetry={() => void refresh()} testID="cow-standings-error" /> : null}
      {result.state === 'ready' ? <Card><View style={{ padding: uiSpace.md }}><CoWRows ranking={{ ...result.rankings[0], entries: board.items }} userId={userId} testID="cow-standings-rows" /></View></Card>
        : <GroupStateView title={result.state === 'unavailable' ? 'Group comparisons unavailable' : coWStatus(result.cow, result.state)}
            testID="cow-standings-state" actionLabel="Refresh" onAction={() => void refresh()} />}
      {stale ? <GroupStateView title="The standings changed" actionLabel="Refresh" onAction={() => void refresh()} testID="cow-standings-stale" /> : null}
      {board.hasMore && !stale ? <ActionButton label={board.loadingMore ? 'Loading…' : 'More members'} disabled={board.loadingMore} variant="outline" onPress={() => void board.loadMore()} testID="cow-standings-more" /> : null}
      {board.loadMoreError && !stale ? <GroupInlineError error={board.loadMoreError} onRetry={() => void board.loadMore()} testID="cow-standings-more-error" /> : null}
    </> : <GroupMissingDataState error={error} offline={board.offline || definitionOffline} onRetry={() => void refresh()} testIDPrefix="cow-standings" />}
  </ScreenScroll>;
}
