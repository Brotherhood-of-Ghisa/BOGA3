import { useGlobalSearchParams, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { GroupStateView } from '@/components/groups/group-state-view';
import { Sheet, uiRoles, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { logEvent } from '@/src/logging';
import { useRootRouteAccess } from '@/src/navigation/root-route-access';
import {
  discardPendingNotificationTap,
  getPendingNotificationTapRevision,
  processPendingNotificationTap,
  setAppliedNotificationTheme,
  startNotificationLifecycle,
  subscribePendingNotificationTap,
  type NotificationTarget,
} from '@/src/notifications';

// Native listeners live across protected-route changes; a tap waits for both
// the mounted navigator and the existing account/first-sync gates.
export function NotificationTapBridge() {
  const { status, user } = useAuth();
  const access = useRootRouteAccess();
  const navigator = useRootNavigationState();
  const router = useRouter();
  const pathname = usePathname();
  const { groupId } = useGlobalSearchParams<{ groupId?: string | string[] }>();
  const revision = useSyncExternalStore(subscribePendingNotificationTap, getPendingNotificationTapRevision,
    getPendingNotificationTapRevision);
  const userId = user?.id ?? null;
  const [failure, setFailure] = useState<{ userId: string | null; reason: 'offline' | 'unavailable' | null }>({ userId, reason: null });
  const [retry, setRetry] = useState(0);
  if (failure.userId !== userId) setFailure({ userId, reason: null });
  const unavailable = failure.userId === userId ? failure.reason : null;
  const ready = status === 'ready' && Boolean(userId && navigator?.key) && access === 'app';

  useEffect(() => {
    try {
      setAppliedNotificationTheme({
        paper: uiRoles.paper, surface: uiRoles.surface, rule: uiRoles.rule,
        ink: uiRoles.ink, inkMuted: uiRoles.inkMuted, record: uiRoles.record, recordWash: uiRoles.recordWash,
      });
    } catch {
      void logEvent({ level: 'warn', event: 'notifications.theme_failed', message: 'Could not share the applied notification theme.' });
    }
    return startNotificationLifecycle();
  }, []);

  const showUnavailable = useCallback((reason: 'offline' | 'unavailable' | null) => {
    setFailure(previous => previous.userId === userId ? { userId, reason } : previous);
  }, [userId]);

  const onOpen = useCallback((target: NotificationTarget) => {
    showUnavailable(null);
    const path = `/group-session/${encodeURIComponent(target.memberId)}/${encodeURIComponent(target.sessionId)}`;
    const currentGroup = Array.isArray(groupId) ? groupId[0] : groupId;
    if (pathname === path && currentGroup === target.groupId) return;
    router.push({ pathname: '/group-session/[memberId]/[sessionId]', params: target });
  }, [groupId, pathname, router, showUnavailable]);

  useEffect(() => {
    void processPendingNotificationTap({ userId, ready, onOpen, onUnavailable: showUnavailable })
      .catch((error) => {
        void logEvent({
          level: 'error',
          event: 'notifications.tap_unhandled_error',
          message: error instanceof Error ? error.message : String(error),
        });
        showUnavailable('unavailable');
      });
  }, [onOpen, ready, retry, revision, showUnavailable, userId]);

  const dismiss = () => {
    discardPendingNotificationTap();
    showUnavailable(null);
  };

  return (
    <Sheet dismissLabel="Dismiss notification" onDismiss={dismiss} testID="notification-unavailable-sheet"
      title="Notification" visible={ready && unavailable !== null}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        {unavailable === 'offline' ? (
          <GroupStateView actionLabel="Retry" actionTestID="notification-retry" body="Connect to open this workout."
            onAction={() => setRetry(value => value + 1)} testID="notification-offline" title="You're offline" />
        ) : (
          <GroupStateView body="It was deleted, or you're no longer in a group it was shared with."
            testID="notification-unavailable" title="This session is no longer available" />
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: uiSpace.lg },
  scroll: { flexShrink: 1 },
});
