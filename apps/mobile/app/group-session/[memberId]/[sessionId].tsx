import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl } from 'react-native';

import {
  FriendSessionContent,
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupSessionHeaderTitle,
  GroupStateView,
  GroupsSignInRequired,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenScroll } from '@/components/ui/screen';
import { useAuth } from '@/src/auth';
import { groupSessionEyebrow, groupSessionTitle } from '@/src/groups/competition-session-records-view-model';
import type { CompetitionSessionDetailWire, CompetitionSessionRecordWire, CompetitionSessionRecordsWire,
  CompetitionSessionWire } from '@/src/groups/competition-wire';
import {
  getCompetitionSession,
  getCompetitionSessionRecords,
  getGroup,
  groupCacheKeys,
  useGroupOnlinePages,
  useGroupResource,
  useNetworkOnline,
  type GroupGetResult,
} from '@/src/groups';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// The records read is one online page: nothing is cached (like a full board).
const selectRecords = (page: CompetitionSessionRecordsWire) => page.records;
const noCursor = () => null;
const noMore = () => false;
const recordKey = (record: CompetitionSessionRecordWire) => record.event.event_id;

/**
 * The group session view (groups contract): a member's shared session as the
 * group sees it, read-only, cache first. The header names the group, the
 * member and the day; on my own session its one action opens the full
 * session. `completed-session/[sessionId].tsx` is deliberately not reused;
 * both draw their exercises with `components/session-detail/`.
 */
export default function GroupSessionRoute() {
  const params = useLocalSearchParams<{ memberId?: string | string[]; sessionId?: string | string[]; groupId?: string | string[] }>();
  const groupId = firstParam(params.groupId);
  const memberId = firstParam(params.memberId);
  const sessionId = firstParam(params.sessionId);
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId || !memberId || !sessionId) {
    return <UnavailableState />;
  }
  return <GroupSessionContent groupId={groupId} memberId={memberId} sessionId={sessionId} userId={user.id} />;
}

function UnavailableState() {
  return (
    <GroupStateView
      body="It was deleted, or you're no longer in a group it was shared with."
      testID="group-session-unavailable"
      title="This session is no longer available"
    />
  );
}

/** My own session's full view: the live session while it runs, else View Session. */
const fullSessionHref = (session: CompetitionSessionWire): Href =>
  session.status === 'completed' ? `/completed-session/${encodeURIComponent(session.session_id)}` as Href : sessionViewHref(session.session_id);

function GroupSessionContent({ userId, groupId, memberId, sessionId }: { userId: string; groupId: string; memberId: string; sessionId: string }) {
  const router = useRouter();
  const online = useNetworkOnline();
  const fetcher = useCallback(() => getCompetitionSession(groupId,memberId,sessionId), [groupId,memberId,sessionId]);
  // NOT_FOUND deletes this entry from the cache (the hook evicts its own key).
  const detail = useGroupResource<CompetitionSessionDetailWire>({
    userId,
    cacheKey: groupCacheKeys.session(groupId,memberId,sessionId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: groupFetcher, evictGroupIdOnNotFound: groupId });
  const fetchRecords = useCallback(() => getCompetitionSessionRecords(groupId,memberId,sessionId), [groupId,memberId,sessionId]);
  const records = useGroupOnlinePages<CompetitionSessionRecordsWire, CompetitionSessionRecordWire, null>({ userId, groupId,
    viewKey: `${memberId}|${sessionId}`, fetchPage: fetchRecords, selectItems: selectRecords, selectCursor: noCursor,
    selectHasMore: noMore, itemKey: recordKey });
  const refreshAll = useCallback(async () => { await Promise.all([detail.refresh(), records.refresh()]); }, [detail, records]);
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);
  const session = detail.data?.session ?? null;
  const inlineError = pickInlineError(detail.error);
  const groupName = group.data?.group.name ?? null;
  const isMine = session?.member.user_id === userId;

  return (
    <ScreenScroll
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      testID="group-session-screen">
      <Stack.Screen
        options={{
          headerTitle: session
            ? () => <GroupSessionHeaderTitle eyebrow={groupSessionEyebrow(groupName)} title={groupSessionTitle(session, userId)} />
            : 'Session',
          headerRight: session && isMine
            ? () => (
              <IconButton
                accessibilityLabel="View full session"
                name="arrow-up-right"
                onPress={() => router.push(fullSessionHref(session))}
                testID="group-session-full-view"
              />
            )
            : undefined,
        }}
      />
      {detail.lostAccess || records.lostAccess ? (
        <UnavailableState />
      ) : (
        <>
          {detail.offline ? <GroupOfflineBanner lastUpdatedAtMs={detail.lastUpdatedAtMs} /> : null}
          {session && inlineError ? (
            <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-session-inline-error" />
          ) : null}
          {session ? (
            <FriendSessionContent
              groupId={groupId}
              myRole={group.data?.group.my_role ?? null}
              onRecordsChanged={records.refresh}
              online={online}
              records={records.items}
              session={session}
              userId={userId}
            />
          ) : (
            <GroupMissingDataState error={inlineError} offline={detail.offline} onRetry={onRefresh} testIDPrefix="group-session" />
          )}
        </>
      )}
    </ScreenScroll>
  );
}
