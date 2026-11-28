import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text } from 'react-native';
import { ActionButton, ActionRow, Card, FigureText, IconButton, ScreenScroll, Sheet, useUiText } from '@/components/ui';
import { PageRefreshControl } from '@/components/ui/page-refresh-control';
import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { GroupInlineError, GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from '@/components/groups/group-state-view';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { GroupWriteNotice } from '@/components/groups/write-notice';
import { MeetChallenges } from '@/components/groups/meet-challenges';
import { MeetResultsExtras } from '@/components/groups/meet-results-extras';
import { usePullToRefresh } from '@/components/groups/use-pull-to-refresh';
import { useAuth } from '@/src/auth';
import { cancelMeet, isMeetNotFound, refreshMeetResults, setMeetJoined } from '@/src/groups/api';
import { openMeetMaps } from '@/src/groups/meet-location';
import { meetCaption, meetDate, meetPermissions, meetScheduleHref, meetTitle, meetWriteMessage } from '@/src/groups/meet-presentation';
import { meetResultsCaption, meetResultsRefreshMessage } from '@/src/groups/meet-results-view-model';
import { useGroupAction } from '@/src/groups/use-group-action';
import { useMeetResults } from '@/src/groups/use-meet-results';
import { useMeet, useMeetClock } from '@/src/groups/use-meets';
import { useDateFormat } from '@/src/preferences/hooks';

export default function MeetRoute() {
  const { isConfigured, user } = useAuth(); const { groupId, meetId } = useLocalSearchParams<{ groupId: string; meetId: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  if (!groupId || !meetId) return <GroupLostAccessState testID="meet-lost-access" />;
  return <MeetPage key={`${user.id}:${groupId}:${meetId}`} groupId={groupId} meetId={meetId} userId={user.id} />;
}
function MeetPage({ groupId, meetId, userId }: { groupId: string; meetId: string; userId: string }) {
  const resource = useMeet(groupId, meetId, userId); const router = useRouter(); const text = useUiText(); const format = useDateFormat();
  const now = useMeetClock(); const [options, setOptions] = useState(false); const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mustRefresh, setMustRefresh] = useState(false);
  const action = useGroupAction(async (command: 'join' | 'leave' | 'cancel') => command === 'cancel'
    ? cancelMeet(groupId, meetId, resource.data!.meet.version) : setMeetJoined(groupId, meetId, command === 'join'));
  const standings = useMeetResults(groupId, meetId, userId);
  const refreshResults = useGroupAction(() => refreshMeetResults(groupId, meetId));
  const { refresh: refreshMeet } = resource; const { refresh: refreshStandings } = standings;
  const pull = usePullToRefresh(useCallback(async () => { await Promise.all([refreshMeet(), refreshStandings()]); }, [refreshMeet, refreshStandings]));
  const refreshResultsNow = async () => {
    if (refreshResults.pending) return;
    const result = await refreshResults.run();
    setMessage(result.ok ? null : meetResultsRefreshMessage(result.error.code, refreshResults.offline));
    await Promise.all([resource.refresh(), standings.refresh()]);
  };
  const run = async (command: 'join' | 'leave' | 'cancel') => {
    if (action.pending || mustRefresh) return;
    const result = await action.run(command);
    setMessage(result.ok ? null : meetWriteMessage(result.error.code, action.offline));
    if (!result.ok && !action.offline && ['CONFLICT', 'NETWORK', 'INTERNAL'].includes(result.error.code)) setMustRefresh(true);
    await Promise.all([resource.refresh(), standings.refresh()]);
  };
  const error = pickInlineError(resource.error);
  if (isMeetNotFound(resource.error)) return <GroupStateView testID="meet-state" title="Meet unavailable" />;
  if (resource.lostAccess) return <GroupLostAccessState testID="meet-lost-access" />;
  if (!resource.data) return <GroupMissingDataState error={error} offline={resource.offline} onRetry={() => void resource.refresh()} testIDPrefix="meet" />;
  const { meet, roster, viewer } = resource.data; const permissions = meetPermissions(meet, viewer.role, now);
  const results = standings.results;
  const caption = (numeric: boolean) => results ? meetResultsCaption(results, format, numeric) : meetCaption(meet, format, now, numeric);
  return <ScreenScroll testID="meet-screen" refreshControl={<PageRefreshControl refreshing={pull.pulling} onRefresh={pull.onRefresh} />}>
    <Stack.Screen options={{ title: meetTitle(meet), headerRight: () => permissions.manager ? <IconButton nativeHeader name="more-vertical" accessibilityLabel="Meet options" onPress={() => setOptions(true)} /> : null }} />
    {resource.offline ? <GroupOfflineBanner lastUpdatedAtMs={resource.lastUpdatedAtMs} /> : null}
    {error ? <GroupInlineError testID="meet-inline-error" error={error} onRetry={() => void resource.refresh()} /> : null}
    <Card>
      <Text allowFontScaling={false} style={text.bodyStrong}>{meetTitle(meet)}</Text>
      <Text allowFontScaling={false} style={text.meta} accessibilityLabel={caption(true)} testID="meet-caption">{caption(false)}</Text>
      <Text allowFontScaling={false} style={text.body} accessibilityLabel={meetDate(meet.starts_at_ms, meet.time_zone, format, true)}><FigureText>{meetDate(meet.starts_at_ms, meet.time_zone, format)}</FigureText></Text>
      <Text allowFontScaling={false} style={text.body} accessibilityLabel={`${meetDate(meet.ends_at_ms, meet.time_zone, format, true)} · ${meet.time_zone ?? 'UTC'}`}><FigureText>{meetDate(meet.ends_at_ms, meet.time_zone, format)}</FigureText>{` · ${meet.time_zone ?? 'UTC'}`}</Text>
      <Text allowFontScaling={false} style={text.bodyStrong}>{meet.venue_name}</Text>
      {meet.address ? <Text allowFontScaling={false} style={text.body}>{meet.address}</Text> : null}
      <ActionButton label="Open in Maps" variant="text" onPress={() => { void openMeetMaps({ address: meet.address ?? meet.venue_name, latitude: meet.latitude, longitude: meet.longitude }).catch(() => setMessage("Couldn't open Maps. Try again.")); }} />
      {meet.entry_note ? <Text allowFontScaling={false} style={text.body}>{meet.entry_note}</Text> : null}
    </Card>
    {permissions.join ? <ActionButton variant="primary" label={viewer.joined ? 'Leave meet' : 'Join meet'} disabled={action.pending || mustRefresh} testID="meet-join-leave" onPress={() => viewer.joined
      ? Alert.alert('Leave meet?', 'Your sessions will no longer count toward this meet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave meet', style: 'destructive', onPress: () => void run('leave') }])
      : void run('join')} /> : null}
    {message ? <GroupWriteNotice testID="meet-write-notice" tone="error" message={message} /> : null}
    {mustRefresh ? <ActionButton label="Check status" variant="outline" disabled={resource.offline} onPress={() => { void resource.refresh().then(() => setMustRefresh(false)); }} /> : null}
    <Card><Text allowFontScaling={false} style={text.label}>Going</Text>
      {roster.map(row => <Text allowFontScaling={false} key={row.member.user_id} style={text.body}>{`${row.member.username ?? 'Member'}${row.current_member ? '' : ' · Former member'}`}</Text>)}
      {!roster.length ? <Text allowFontScaling={false} style={text.body}>No one yet</Text> : null}
    </Card>
    <MeetChallenges data={resource.data} userId={userId} onChanged={async () => { await Promise.all([resource.refresh(), standings.refresh()]); }} results={results} />
    {results ? <MeetResultsExtras results={results} userId={userId} /> : standings.offline
      ? <Text allowFontScaling={false} style={text.meta} testID="meet-results-offline">Standings need a connection.</Text>
      : standings.error ? <GroupInlineError testID="meet-results-error" error={standings.error} onRetry={() => void standings.refresh()} /> : null}
    <Sheet visible={options} onDismiss={() => setOptions(false)} title="Meet options" dismissLabel="Dismiss meet options" onDismissed={() => {
      if (!confirmCancel) return; setConfirmCancel(false);
      Alert.alert('Cancel meet?', meetTitle(meet), [{ text: 'Keep meet', style: 'cancel' }, { text: 'Cancel meet', style: 'destructive', onPress: () => void run('cancel') }]);
    }}>
      {permissions.manager ? <ActionRow label="Edit meet" onPress={() => { setOptions(false); router.push(meetScheduleHref(groupId, meetId)); }} /> : null}
      {permissions.refreshResults ? <ActionRow label="Refresh results" testID="meet-refresh-results" onPress={() => { setOptions(false); void refreshResultsNow(); }} /> : null}
      {permissions.cancel ? <ActionRow label="Cancel meet" kind="danger" onPress={() => { setConfirmCancel(true); setOptions(false); }} /> : null}
    </Sheet>
  </ScreenScroll>;
}
