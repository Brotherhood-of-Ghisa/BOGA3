import { __resetNotificationAccountForTests } from './auth-boundary';
import { __resetNotificationLifecycleForTests } from './lifecycle';
import { __resetNotificationTapsForTests } from './tap';
export type { NotificationCategories, NotificationPreferences, NotificationSnapshot, NotificationTarget } from './types';
export { NotificationApiError, getGroupNotificationPreferences, setGroupNotificationMuted } from './api';
export { getNotificationSnapshot, subscribeNotificationState, refreshNotificationStatus, enableNotifications,
  disableNotifications, saveNotificationCategories, openNotificationSettings, startNotificationLifecycle } from './lifecycle';
export { getPendingNotificationTapRevision, subscribePendingNotificationTap, discardPendingNotificationTap,
  processPendingNotificationTap } from './tap';
export { setAppliedNotificationTheme } from './native-adapter';

export const __resetNotificationsForTests = (): void => {
  __resetNotificationLifecycleForTests(); __resetNotificationAccountForTests(); __resetNotificationTapsForTests();
};
