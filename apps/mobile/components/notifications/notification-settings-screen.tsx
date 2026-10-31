import { useRouter } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { notificationStatus } from '@/components/notifications/notification-status';
import { SubPage } from '@/components/settings/sub-page';
import { ActionButton, ActionRow, FormSection, Notice, SwitchRow, ValueRow } from '@/components/ui';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import {
  disableNotifications, enableNotifications, getNotificationSnapshot, openNotificationSettings,
  refreshNotificationStatus, saveNotificationCategories, subscribeNotificationState,
  type NotificationCategories, type NotificationSnapshot,
} from '@/src/notifications';

const CATEGORIES = [
  { key: 'activity', label: 'Activity' },
  { key: 'bests', label: 'Group exercise bests' },
  { key: 'ranks', label: 'Leaderboard changes' },
] as const;

const UNREGISTERED_MESSAGE = 'This device isn’t registered for notifications.';

const isPermitted = (state: NotificationSnapshot) => state.permission === 'granted' || state.permission === 'provisional';

// Settings → Notifications: one switch turns notifications on (asking
// permission) and off. Refused permission turns the row into `Open iOS
// Settings`, signed out into `Sign in`. The Categories show only while on, and
// a failure is one `Notice` with Retry. The server-confirmed state comes from
// `src/notifications`; the page only presents it.
export function NotificationSettingsScreen({ userId }: { userId: string | null }) {
  const state = useSyncExternalStore(subscribeNotificationState, getNotificationSnapshot);
  const available = Boolean(userId) && state.supported;
  const failedCategories = useRef<NotificationCategories | null>(null);

  useEffect(() => {
    if (available) void refreshNotificationStatus();
  }, [available]);

  const saveCategories = async (next: NotificationCategories) => {
    failedCategories.current = next;
    await saveNotificationCategories(next);
    if (!getNotificationSnapshot().error) failedCategories.current = null;
  };
  const retry = () => {
    void (failedCategories.current ? saveCategories(failedCategories.current) :
      state.enabled && isPermitted(state) && !state.registered ? enableNotifications() : refreshNotificationStatus());
  };
  const forgetFailedCategories = () => { failedCategories.current = null; };

  const on = available && state.enabled && isPermitted(state);
  const failed = available && (state.error !== null || (on && !state.registered && !state.busy));
  return (
    <SubPage testID="settings-notifications-screen">
      <FormSection title="Notifications">
        <NotificationRow onAct={forgetFailedCategories} state={state} userId={userId} />
      </FormSection>
      {failed ? (
        <Notice
          action={<ActionButton disabled={state.busy} label="Retry" onPress={retry} variant="text" />}
          icon="warning" live message={state.error ?? UNREGISTERED_MESSAGE} testID="settings-notifications-error" tone="danger" />
      ) : null}
      {on && state.preferences ? (
        <FormSection title="Categories">
          {CATEGORIES.map(({ key, label }, index) => (
            <SwitchRow
              density="list" disabled={state.busy} divider={index > 0} key={key} label={label}
              onValueChange={value => {
                const { activity, bests, ranks } = state.preferences!;
                void saveCategories({ activity, bests, ranks, [key]: value });
              }}
              testID={`settings-notifications-${key}`} value={state.preferences![key]} />
          ))}
        </FormSection>
      ) : null}
    </SubPage>
  );
}

// The one row of the Notifications section: the switch, or what replaces it.
function NotificationRow({ onAct, state, userId }: { onAct: () => void; state: NotificationSnapshot; userId: string | null }) {
  const router = useRouter();
  if (!userId) {
    return <ActionRow label="Sign in" onPress={() => router.push(SIGN_IN_ROUTE)} testID="settings-notifications-sign-in" />;
  }
  if (!state.supported) return <ValueRow label="Notifications" value="Unavailable" />;
  if (state.permission === 'denied') {
    return (
      <ActionRow
        disabled={state.busy} kind="act" label="Open iOS Settings"
        onPress={() => { onAct(); void openNotificationSettings(); }} testID="settings-notifications-open-settings" />
    );
  }
  // The switch shows the stored state, so it reads On only once permission is
  // granted and enabling is done; `busy` disables it meanwhile.
  return (
    <SwitchRow
      density="list" description={notificationStatus(state, userId)} disabled={state.busy} label="Notifications"
      onValueChange={value => { onAct(); void (value ? enableNotifications() : disableNotifications()); }}
      testID="settings-notifications-enabled" value={state.enabled && isPermitted(state)} />
  );
}
