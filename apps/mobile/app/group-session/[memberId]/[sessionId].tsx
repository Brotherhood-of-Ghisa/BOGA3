import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl } from 'react-native';

import {
  FriendSessionContent,
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupsSignInRequired,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { ScreenScroll } from '@/components/ui/screen';
import { useAuth } from '@/src/auth';
import type { CompetitionSessionDetailWire } from '@/src/groups/competition-wire';
import {
  getCompetitionSession,
  groupCacheKeys,
  useGroupResource,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The friend's session view (groups contract §6.3, C3.8): read-only, cache
 * first. `completed-session/[sessionId].tsx` is deliberately not reused; both
 * draw their exercises with `components/session-detail/`.
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

function GroupSessionContent({ userId, groupId, memberId, sessionId }: { userId: string; groupId: string; memberId: string; sessionId: string }) {
  const fetcher = useCallback(() => getCompetitionSession(groupId,memberId,sessionId), [groupId,memberId,sessionId]);
  // NOT_FOUND deletes this entry from the cache (the hook evicts its own key).
  const detail = useGroupResource<CompetitionSessionDetailWire>({
    userId,
    cacheKey: groupCacheKeys.session(groupId,memberId,sessionId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const { pulling, onRefresh } = usePullToRefresh(detail.refresh);
  const session = detail.data?.session ?? null;
  const inlineError = pickInlineError(detail.error);

  return (
    <ScreenScroll
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      testID="group-session-screen">
      {detail.lostAccess ? (
        <UnavailableState />
      ) : (
        <>
          {detail.offline ? <GroupOfflineBanner lastUpdatedAtMs={detail.lastUpdatedAtMs} /> : null}
          {session && inlineError ? (
            <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-session-inline-error" />
          ) : null}
          {session ? (
            <FriendSessionContent session={session} />
          ) : (
            <GroupMissingDataState error={inlineError} offline={detail.offline} onRetry={onRefresh} testIDPrefix="group-session" />
          )}
        </>
      )}
    </ScreenScroll>
  );
}
