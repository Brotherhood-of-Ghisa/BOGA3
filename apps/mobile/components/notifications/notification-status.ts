import type { NotificationSnapshot } from '@/src/notifications';

// What the notification state reads as, in the words Settings home's row and
// the Notifications page's switch share.
export function notificationStatus(state: NotificationSnapshot, userId: string | null): string {
  if (!userId) return 'Sign in';
  if (!state.supported) return 'Unavailable';
  if (state.permission === 'denied') return 'Off in iOS Settings';
  if (!state.enabled) return 'Not enabled';
  if (!state.registered) return 'Not registered';
  return state.permission === 'provisional' ? 'Quiet delivery' : 'On';
}
