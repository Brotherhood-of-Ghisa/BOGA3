import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { notificationStatus } from '@/components/notifications/notification-status';
import { ChoiceRow } from '@/components/ui';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { getNotificationSnapshot, subscribeNotificationState } from '@/src/notifications';

// Settings home's Notifications row: the state in words, opening the Notifications page.
export function NotificationSettingsRow({ userId, divider = false }: { userId: string | null; divider?: boolean }) {
  const router = useRouter();
  const state = useSyncExternalStore(subscribeNotificationState, getNotificationSnapshot);
  const status = notificationStatus(state, userId);
  return (
    <ChoiceRow
      accessibilityLabel={`Notifications, ${status}`}
      divider={divider}
      icon="bell"
      label="Notifications"
      onPress={() => router.push(SETTINGS_SUB_PAGES.notifications)}
      testID="settings-notifications-row"
      value={status}
    />
  );
}
