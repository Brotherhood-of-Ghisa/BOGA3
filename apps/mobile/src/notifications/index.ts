import { __resetNotificationAccountForTests } from './auth-boundary';
import { __resetNotificationLifecycleForTests } from './lifecycle';
import { __resetNotificationTapsForTests } from './tap';
export type { NotificationCategories, NotificationMeetTarget, NotificationPreferences, NotificationSnapshot, NotificationTarget,
  NotificationUnavailableSubject } from './types';
export { NotificationApiError, getGroupNotificationPreferences, setGroupNotificationMeets,
  setGroupNotificationMuted } from './api';
export { getNotificationSnapshot, subscribeNotificationState, refreshNotificationStatus, enableNotifications,
  disableNotifications, saveNotificationCategories, openNotificationSettings, startNotificationLifecycle } from './lifecycle';
export { getPendingNotificationTapRevision, subscribePendingNotificationTap, discardPendingNotificationTap,
  processPendingNotificationTap } from './tap';
export { setAppliedNotificationTheme } from './native-adapter';

export const __resetNotificationsForTests = (): void => {
  __resetNotificationLifecycleForTests(); __resetNotificationAccountForTests(); __resetNotificationTapsForTests();
};
