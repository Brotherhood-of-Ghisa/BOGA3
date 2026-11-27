import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { ActionButton, ScreenScroll, uiSpace, useUiText } from '@/components/ui';
import { PageRefreshControl } from '@/components/ui/page-refresh-control';
import { canManageGroup, getGroup, groupCacheKeys, useGroupResource } from '@/src/groups';
import { listMeets, toGroupApiError } from '@/src/groups/api';
import type { MeetListWire } from '@/src/groups/meet-wire';
import { meetScheduleHref } from '@/src/groups/meet-presentation';
import { useMeets } from '@/src/groups/use-meets';
import { MeetSummaryCard } from './meet-summary-card';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, pickInlineError } from './group-state-view';
import { GroupOfflineBanner } from './offline-banner';
import { usePullToRefresh } from './use-pull-to-refresh';

/** Cache-first current/archive browser, with a results-owned leaderboard extension slot. */
export function GroupMeetsPage({ groupId, userId, embedded = false, leaderboard }: { groupId: string; userId: string; embedded?: boolean; leaderboard?: ReactNode }) {
  const text = useUiText(); const router = useRouter();
  const meets = useMeets(groupId, userId);
  const read = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: read, evictGroupIdOnNotFound: groupId });
  const [older, setOlder] = useState<MeetListWire | null>(null);
  const [moreError, setMoreError] = useState<ReturnType<typeof toGroupApiError> | null>(null);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(meets.data);
  if (base !== meets.data) { setBase(meets.data); setOlder(null); }
  const refresh = usePullToRefresh(async () => { await Promise.all([meets.refresh(), group.refresh()]); });
  const currentBase = useRef(meets.data);
  useLayoutEffect(() => { currentBase.current = meets.data; }, [meets.data]);
  const cursor = older ? older.next_cursor : meets.data?.next_cursor;
  const more = async () => {
    if (!cursor || loading || meets.offline) return;
    const requestedBase = meets.data;
    setLoading(true); setMoreError(null);
    try { const next = await listMeets(groupId, cursor); if (currentBase.current !== requestedBase) return; setOlder(previous => ({ ...next, past: [...(previous?.past ?? []), ...next.past] })); }
    catch (error) { setMoreError(toGroupApiError(error)); }
    finally { setLoading(false); }
  };
  if (meets.lostAccess || group.lostAccess) return <GroupLostAccessState testID="meet-lost-access" />;
  const error = pickInlineError(meets.error, group.error);
  const past = [...new Map([...(meets.data?.past ?? []), ...(older?.past ?? [])].map(m => [m.meet_id, m])).values()];
  return <ScreenScroll testID="meets-screen" contentContainerStyle={embedded ? { padding: 0 } : undefined}
    refreshControl={<PageRefreshControl refreshing={refresh.pulling} onRefresh={refresh.onRefresh} />}>
    {meets.offline ? <GroupOfflineBanner lastUpdatedAtMs={meets.lastUpdatedAtMs} /> : null}
    {error && meets.data ? <GroupInlineError testID="meet-inline-error" error={error} onRetry={() => void meets.refresh()} /> : null}
    {!meets.data ? <GroupMissingDataState error={error} offline={meets.offline} onRetry={() => void meets.refresh()} testIDPrefix="meets" /> : <>
      <Text allowFontScaling={false} style={text.label}>Next meets</Text>
      {meets.data.upcoming.length ? meets.data.upcoming.map(meet => <MeetSummaryCard key={meet.meet_id} meet={meet} />) : <Text allowFontScaling={false} style={text.body}>Nothing scheduled</Text>}
      {group.data && canManageGroup(group.data.group.my_role) ? <ActionButton label="Schedule meet" variant="text" testID="meets-schedule" onPress={() => router.push(meetScheduleHref(groupId))} /> : null}
      {leaderboard}
      <Text allowFontScaling={false} style={text.label}>Past meets</Text>
      <View style={{ gap: uiSpace.sm }}>{past.map(meet => <MeetSummaryCard key={meet.meet_id} meet={meet} />)}</View>
      {!past.length ? <Text allowFontScaling={false} style={text.body}>No past meets</Text> : null}
      {cursor ? <ActionButton label={loading ? 'Loading…' : 'More meets'} variant="text" disabled={loading || meets.offline} onPress={() => void more()} /> : null}
      {moreError ? <GroupInlineError testID="meet-inline-error" error={moreError} onRetry={() => void more()} /> : null}
    </>}
  </ScreenScroll>;
}
