import { useGlobalSearchParams, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { GroupStateView } from '@/components/groups/group-state-view';
import { Sheet, uiSpace, useUiRoles } from '@/components/ui';
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
  type NotificationMeetTarget,
  type NotificationTarget,
  type NotificationUnavailableSubject,
} from '@/src/notifications';
import { meetHref } from '@/src/groups/meet-presentation';

// Native listeners live across protected-route changes; a tap waits for both
// the mounted navigator and the existing account/first-sync gates.
export function NotificationTapBridge() {
  const roles = useUiRoles();
  const { status, user } = useAuth();
  const access = useRootRouteAccess();
  const navigator = useRootNavigationState();
  const router = useRouter();
  const pathname = usePathname();
  const { groupId } = useGlobalSearchParams<{ groupId?: string | string[] }>();
  const revision = useSyncExternalStore(subscribePendingNotificationTap, getPendingNotificationTapRevision,
    getPendingNotificationTapRevision);
  const userId = user?.id ?? null;
  const [failure, setFailure] = useState<{ userId: string | null; reason: 'offline' | 'unavailable' | null; subject: NotificationUnavailableSubject }>({
    userId, reason: null, subject: 'session',
  });
  const [retry, setRetry] = useState(0);
  if (failure.userId !== userId) setFailure({ userId, reason: null, subject: 'session' });
  const unavailable = failure.userId === userId ? failure.reason : null;
  const ready = status === 'ready' && Boolean(userId && navigator?.key) && access === 'app';

  // Shared again on each saved appearance, so a notification is drawn in the
  // theme the app is in now.
  useEffect(() => {
    try {
      setAppliedNotificationTheme({
        paper: roles.paper, surface: roles.surface, rule: roles.rule,
        ink: roles.ink, inkMuted: roles.inkMuted, record: roles.record, recordWash: roles.recordWash,
      });
    } catch {
      void logEvent({ level: 'warn', event: 'notifications.theme_failed', message: 'Could not share the applied notification theme.' });
    }
  }, [roles]);

  useEffect(() => startNotificationLifecycle(), []);

  const showUnavailable = useCallback((reason: 'offline' | 'unavailable' | null, subject: NotificationUnavailableSubject = 'session') => {
    setFailure(previous => previous.userId === userId ? { userId, reason, subject } : previous);
  }, [userId]);

  const onOpen = useCallback((target: NotificationTarget) => {
    showUnavailable(null);
    const path = `/group-session/${encodeURIComponent(target.memberId)}/${encodeURIComponent(target.sessionId)}`;
    const currentGroup = Array.isArray(groupId) ? groupId[0] : groupId;
    if (pathname === path && currentGroup === target.groupId) return;
    router.push({ pathname: '/group-session/[memberId]/[sessionId]', params: target });
  }, [groupId, pathname, router, showUnavailable]);

  const onOpenMeet = useCallback((target: NotificationMeetTarget) => {
    showUnavailable(null);
    const href = meetHref(target.groupId, target.meetId);
    if (pathname === href) return;
    router.push(href);
  }, [pathname, router, showUnavailable]);

  useEffect(() => {
    void processPendingNotificationTap({ userId, ready, onOpen, onOpenMeet, onUnavailable: showUnavailable })
      .catch((error) => {
        void logEvent({
          level: 'error',
          event: 'notifications.tap_unhandled_error',
          message: error instanceof Error ? error.message : String(error),
        });
        showUnavailable('unavailable');
      });
  }, [onOpen, onOpenMeet, ready, retry, revision, showUnavailable, userId]);

  const dismiss = () => {
    discardPendingNotificationTap();
    showUnavailable(null);
  };

  return (
    <Sheet dismissLabel="Dismiss notification" onDismiss={dismiss} testID="notification-unavailable-sheet"
      title="Notification" visible={ready && unavailable !== null}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        {unavailable === 'offline' ? (
          <GroupStateView actionLabel="Retry" actionTestID="notification-retry"
            body={failure.subject === 'meet' ? 'Connect to open this meet.' : 'Connect to open this workout.'}
            onAction={() => setRetry(value => value + 1)} testID="notification-offline" title="You're offline" />
        ) : failure.subject === 'meet' ? (
          <GroupStateView body="You're no longer in its group, or it was removed."
            testID="notification-unavailable" title="This meet is no longer available" />
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
