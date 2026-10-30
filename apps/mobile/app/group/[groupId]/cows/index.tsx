import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { ActionButton, Card, FigureText, Icon, ListRow, ScreenScroll, uiRoles, uiSpace, uiText } from '@/components/ui';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from '@/components/groups/group-state-view';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { CoWPreview } from '@/components/groups/cow-preview';
import { useAuth } from '@/src/auth';
import { canManageGroup, getGroup, groupCacheKeys, useGroupOnlinePages, useGroupResource } from '@/src/groups';
import { listCoWs, listCompetitionExercises } from '@/src/groups/api';
import type { CoWDefinitionWire, CoWListWire } from '@/src/groups/cow-wire';
import { coWAccessibleDates, coWDateRange, coWMetric, coWStatus } from '@/src/groups/cow-presentation';
import { useCoWSummary } from '@/src/groups/use-cow-summary';
import { useCoWCalendar } from '@/src/groups/use-cow-calendar';
import type { GroupOnlinePagesState } from '@/src/groups/use-group-online-pages';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useDateFormat } from '@/src/preferences/hooks';
import { coWScheduleHref, coWStandingsHref } from '@/src/navigation/routes';

const items = (page: CoWListWire) => page.cows;
const cursor = (page: CoWListWire) => page.next_cursor;
const hasMore = (page: CoWListWire) => page.next_cursor !== null;
const itemKey = (cow: CoWDefinitionWire) => cow.cow_id;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Chronological browser: independent reads retain their safe loaded sections on a partial failure. */
export default function CoWsRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string; cowId?: string; metric?: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  const groupId = first(params.groupId);
  if (!groupId) return <GroupLostAccessState testID="cows-lost-access" />;
  return <CoWsContent key={`${user.id}:${groupId}`} userId={user.id} groupId={groupId} cowId={first(params.cowId)} metric={first(params.metric)} />;
}

function CoWsContent({ userId, groupId, cowId, metric }: { userId: string; groupId: string; cowId: string | null; metric: string | null }) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: groupFetcher, evictGroupIdOnNotFound: groupId });
  const catalogueFetcher = useCallback(() => listCompetitionExercises(groupId), [groupId]);
  const catalogue = useGroupResource({ userId, cacheKey: groupCacheKeys.groupExercises(groupId), fetcher: catalogueFetcher, evictGroupIdOnNotFound: groupId });
  const fetchPage = useCallback((before: string | null) => listCoWs(groupId, before), [groupId]);
  const cows = useGroupOnlinePages({ userId, groupId, viewKey: 'cows', fetchPage, selectItems: items, selectCursor: cursor, selectHasMore: hasMore, itemKey });
  const calendar = useCoWCalendar(groupId, userId);
  const summary = useCoWSummary(groupId, userId);
  const refresh = async () => { await Promise.all([group.refresh(), catalogue.refresh(), cows.refresh(), calendar.refresh(), summary.refresh()]); };
  const edge = summary.data ? JSON.stringify([summary.data.week_start, summary.data.calendar_revision, summary.data.selection, summary.data.result?.cow.cow_id]) : null;
  const previousEdge = useRef<string | null | undefined>(undefined);
  const refreshList = cows.refresh; const refreshCalendar = calendar.refresh;
  useEffect(() => {
    const changed = previousEdge.current !== undefined && previousEdge.current !== edge;
    previousEdge.current = edge;
    if (changed) void Promise.all([refreshList(), refreshCalendar()]);
  }, [edge, refreshList, refreshCalendar]);
  if (group.lostAccess || catalogue.lostAccess || cows.lostAccess || calendar.lostAccess || summary.lostAccess) return <GroupLostAccessState testID="cows-lost-access" />;
  const error = pickInlineError(group.error, catalogue.error, cows.error, calendar.error, summary.error);
  const offline = group.offline || cows.offline || summary.offline;
  const shown = summary.data?.result;
  const currentId = summary.data?.selection === 'current' ? shown?.cow.cow_id : null;
  const next = cows.items.find(cow => cow.state === 'scheduled');
  const past = cows.items.filter(cow => cow.state !== 'scheduled' && cow.state !== 'active' && cow.cow_id !== currentId);
  const name = (cow: CoWDefinitionWire) => catalogue.data?.exercises.find(exercise => exercise.group_exercise_id === cow.group_exercise_id)?.name ?? (catalogue.data ? 'Exercise unavailable' : 'CoW');
  const open = (cow: CoWDefinitionWire, selected = metric) => router.push(coWStandingsHref(groupId, cow.cow_id, coWMetric(selected, cow.metrics)));
  const preview = shown ? <CoWPreview key={`${shown.cow.cow_id}:${metric}`} result={shown} userId={userId} dateFormat={dateFormat}
    initialMetric={metric} testID="cows-preview" onOpen={selected => open(shown.cow, selected)} browseLabel="Full standings" onBrowse={selected => open(shown.cow, selected)} /> : null;
  const manager = Boolean(group.data && canManageGroup(group.data.group.my_role));
  return <ScreenScroll testID="cows-screen" refreshControl={<RefreshControl refreshing={cows.refreshing || summary.refreshing} onRefresh={() => void refresh()} />}>
    <Stack.Screen options={{ title: 'CoWs' }} />
    <Text allowFontScaling={false} style={uiText.title}>{group.data?.group.name ?? 'Group'}</Text>
    {offline ? <GroupOfflineBanner lastUpdatedAtMs={summary.lastUpdatedAtMs} /> : null}
    {error && (summary.data || cows.firstPage) ? <GroupInlineError error={error} onRetry={() => void refresh()} testID="cows-error" /> : null}
    <Text allowFontScaling={false} style={uiText.label}>This week</Text>
    {summary.data ? summary.data.selection === 'current' ? preview : <Text allowFontScaling={false} style={uiText.meta}>No CoW this week</Text>
      : <GroupMissingDataState error={pickInlineError(summary.error)} offline={summary.offline} onRetry={() => void summary.refresh()} testIDPrefix="cows-current" />}
    <CoWNextSection calendar={calendar} cows={cows} next={next} manager={manager} groupId={groupId} name={name} open={open} dateFormat={dateFormat} />
    <Text allowFontScaling={false} style={uiText.label}>Past CoWs</Text>
    {summary.data?.selection === 'previous_final' && shown && (!cowId || cowId === shown.cow.cow_id) ? preview : null}
    {cows.firstPage ? <View style={{ gap: uiSpace.sm }}>{past.map(cow => <Card key={cow.cow_id}><ListRow label={name(cow)} density="list" description={coWStatus(cow)}
      onPress={() => open(cow)} testID={`cows-past-${cow.cow_id}`} trailing={<Icon name="chevron-right" color={uiRoles.inkMuted} size="sm" />}
      meta={<Text allowFontScaling={false} style={uiText.figureSmall} accessibilityLabel={coWAccessibleDates(cow.week_start, dateFormat)}><FigureText>{coWDateRange(cow.week_start, dateFormat)}</FigureText></Text>} /></Card>)}
      {past.length === 0 ? <Text allowFontScaling={false} style={uiText.meta}>No past CoWs</Text> : null}
      {cows.hasMore ? <ActionButton label={cows.loadingMore ? 'Loading…' : 'More CoWs'} variant="outline" onPress={() => void cows.loadMore()} testID="cows-more" /> : null}
      {cows.loadMoreError ? <GroupInlineError error={cows.loadMoreError} onRetry={() => void cows.loadMore()} testID="cows-more-error" /> : null}
    </View> : null}
    {!group.data && error ? <GroupStateView title="Couldn't load CoWs" actionLabel="Retry" onAction={() => void refresh()} testID="cows-unavailable" /> : null}
  </ScreenScroll>;
}


function CoWNextSection({ calendar, cows, next, manager, groupId, name, open, dateFormat }: {
  calendar: ReturnType<typeof useCoWCalendar>; cows: GroupOnlinePagesState<CoWListWire, CoWDefinitionWire>;
  next: CoWDefinitionWire | undefined; manager: boolean; groupId: string; name: (cow: CoWDefinitionWire) => string;
  open: (cow: CoWDefinitionWire) => void; dateFormat: ExerciseDateFormat;
}) {
  const router = useRouter();
  const week = next?.week_start ?? calendar.firstPage?.next_week_start;
  const zone = next?.time_zone ?? calendar.firstPage?.time_zone;
  return <>
    <Text allowFontScaling={false} style={uiText.label}>Next week</Text>
    {week ? <Text allowFontScaling={false} style={uiText.figureSmall} accessibilityLabel={`${coWAccessibleDates(week, dateFormat)} · ${zone ?? ''}`}><FigureText>{`${coWDateRange(week, dateFormat)} · ${zone ?? ''}`}</FigureText></Text> : null}
    {cows.firstPage ? next ? <Card><ListRow label={name(next)} density="list" onPress={() => open(next)}
      description={coWStatus(next)} meta={<Text allowFontScaling={false} style={uiText.figureSmall} accessibilityLabel={coWAccessibleDates(next.week_start, dateFormat)}><FigureText>{coWDateRange(next.week_start, dateFormat)}</FigureText></Text>}
      testID="cows-next" trailing={<Icon name="chevron-right" color={uiRoles.inkMuted} size="sm" />} /></Card>
      : <Text allowFontScaling={false} style={uiText.meta}>Nothing scheduled</Text>
      : <GroupMissingDataState error={pickInlineError(cows.error)} offline={cows.offline} onRetry={() => void cows.refresh()} testIDPrefix="cows-list" />}
    {manager && cows.firstPage ? <ActionButton variant="outline" label={next ? 'Edit next CoW' : 'Schedule next CoW'}
      testID="cows-schedule" onPress={() => router.push(coWScheduleHref(groupId, next?.cow_id))} /> : null}
  </>;
}
