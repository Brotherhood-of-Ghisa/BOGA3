import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

import {
  FriendSessionContent,
  GroupInlineError,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { useAuth } from '@/src/auth';
import {
  getGroupSessionDetail,
  groupCacheKeys,
  useGroupResource,
  type GroupSessionDetailResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The friend's session view (groups contract §6.3, C3.8): read-only, cache
 * first. `completed-session/[sessionId].tsx` is deliberately not reused; both
 * draw their exercises with `components/session-detail/`.
 */
export default function GroupSessionRoute() {
  const params = useLocalSearchParams<{ memberId?: string | string[]; sessionId?: string | string[] }>();
  const memberId = firstParam(params.memberId);
  const sessionId = firstParam(params.sessionId);
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!memberId || !sessionId) {
    return <UnavailableState />;
  }
  return <GroupSessionContent memberId={memberId} sessionId={sessionId} userId={user.id} />;
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

function GroupSessionContent({ userId, memberId, sessionId }: { userId: string; memberId: string; sessionId: string }) {
  const fetcher = useCallback(() => getGroupSessionDetail(memberId, sessionId), [memberId, sessionId]);
  // NOT_FOUND deletes this entry from the cache (the hook evicts its own key).
  const detail = useGroupResource<GroupSessionDetailResult>({
    userId,
    cacheKey: groupCacheKeys.session(memberId, sessionId),
    fetcher,
  });
  const { pulling, onRefresh } = usePullToRefresh(detail.refresh);
  const session = detail.data?.session ?? null;
  const inlineError = pickInlineError(detail.error);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      style={[groupScreenStyles.screen, styles.paper]}
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
    </ScrollView>
  );
}

// The design language's ground and gutter, as on View Session. The group state
// panels inside keep the groups screens' styling.
const styles = StyleSheet.create({
  paper: {
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
});
