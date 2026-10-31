import { NotificationSettingsScreen } from '@/components/notifications/notification-settings-screen';
import { useAuth } from '@/src/auth';

// A Settings sub page (`components/notifications/notification-settings-screen.tsx`).
// Keyed by account, so one account's failed save is not retried as another's.
export default function SettingsNotificationsRoute() {
  const { user } = useAuth();
  return <NotificationSettingsScreen key={user?.id ?? 'signed-out'} userId={user?.id ?? null} />;
}
