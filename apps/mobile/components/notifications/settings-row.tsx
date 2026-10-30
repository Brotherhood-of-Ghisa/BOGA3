import { useRouter } from 'expo-router';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  ActionButton, ChoiceRow, Icon, ListRow, Notice, Sheet, SwitchRow,
  uiBorder, uiRoles, uiSpace, uiText,
} from '@/components/ui';
import {
  disableNotifications, enableNotifications, getNotificationSnapshot, openNotificationSettings,
  refreshNotificationStatus, saveNotificationCategories, subscribeNotificationState,
  type NotificationCategories, type NotificationSnapshot,
} from '@/src/notifications';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

const CATEGORIES = [
  { key: 'activity', label: 'Activity' },
  { key: 'bests', label: 'Group exercise bests' },
  { key: 'ranks', label: 'Leaderboard changes' },
] as const;

export function NotificationSettingsRow({ userId, divider = false }: { userId: string | null; divider?: boolean }) {
  const router = useRouter();
  const state = useSyncExternalStore(subscribeNotificationState, getNotificationSnapshot);
  const [visible, setVisible] = useState(false);
  const signInAfterDismiss = useRef(false);
  const retryCategories = useRef<NotificationCategories | null>(null);
  const status = notificationStatus(state, userId);
  const available = Boolean(userId) && state.supported;
  const permitted = state.permission === 'granted' || state.permission === 'provisional';
  const preferences = state.preferences;
  const saveCategories = async (next: NotificationCategories) => {
    retryCategories.current = next;
    await saveNotificationCategories(next);
    if (!getNotificationSnapshot().error) retryCategories.current = null;
  };
  const retry = () => {
    void (retryCategories.current ? saveCategories(retryCategories.current) :
      state.enabled && permitted && !state.registered ? enableNotifications() : refreshNotificationStatus());
  };
  const changeCategory = (key: keyof NotificationCategories, value: boolean) => {
    if (preferences) void saveCategories({ activity: preferences.activity, bests: preferences.bests, ranks: preferences.ranks, [key]: value });
  };

  return (
    <>
      <ChoiceRow
        accessibilityLabel={`Notifications, ${status}`}
        divider={divider}
        icon="bell"
        label="Notifications"
        onPress={() => {
          retryCategories.current = null;
          setVisible(true);
          if (available) void refreshNotificationStatus();
        }}
        testID="settings-notifications-row"
        value={status}
      />
      <Sheet dismissLabel="Dismiss notifications" onDismiss={() => setVisible(false)} onDismissed={() => {
        if (signInAfterDismiss.current) { signInAfterDismiss.current = false; router.push(SIGN_IN_ROUTE); }
      }}
        testID="settings-notifications-sheet" title="Notifications" visible={visible}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
          style={styles.scroll} testID="settings-notifications-scroll">
          <ListRow density="list" description={status} divider={false} label="Notifications"
            leading={<Icon color={uiRoles.inkMuted} name="bell" />}
            meta={available && state.enabled && permitted ? (
              <Switch accessibilityLabel="Notifications" disabled={state.busy}
                onValueChange={() => { retryCategories.current = null; void disableNotifications(); }}
                testID="settings-notifications-enabled" trackColor={{ false: uiRoles.rule, true: uiRoles.accent }} value />
            ) : undefined} />
          <View style={styles.actions}>
            {!userId ? (
              <ActionButton label="Sign in" onPress={() => { signInAfterDismiss.current = true; setVisible(false); }}
                testID="settings-notifications-sign-in" variant="primary" />
            ) : available && state.permission === 'denied' ? (
              <ActionButton disabled={state.busy} label="Open iOS Settings" onPress={() => { retryCategories.current = null; void openNotificationSettings(); }}
                testID="settings-notifications-open-settings" variant="primary" />
            ) : available && !state.enabled ? (
              <ActionButton disabled={state.busy} label="Enable notifications" onPress={() => { retryCategories.current = null; void enableNotifications(); }}
                testID="settings-notifications-enable" variant="primary" />
            ) : null}
            {available && state.enabled && permitted && !state.registered && !state.error ? (
              <ActionButton disabled={state.busy} label="Retry" onPress={retry}
                testID="settings-notifications-retry-registration" variant="outline" />
            ) : null}
            {available && state.error ? (
              <Notice action={<ActionButton disabled={state.busy} label="Retry" onPress={retry} variant="text" />}
                icon="warning" live message={state.error} testID="settings-notifications-error" tone="danger" />
            ) : null}
          </View>
          {available && preferences ? (
            <View>
              <Text accessibilityRole="header" allowFontScaling={false} style={[uiText.label, styles.heading]}>Categories</Text>
              {CATEGORIES.map(({ key, label }) => (
                <View key={key} style={styles.category}>
                  <SwitchRow disabled={state.busy} label={label} onValueChange={value => changeCategory(key, value)}
                    testID={`settings-notifications-${key}`} value={preferences[key]} />
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

function notificationStatus(state: NotificationSnapshot, userId: string | null): string {
  if (!userId) return 'Sign in';
  if (!state.supported) return 'Unavailable on this device';
  if (state.permission === 'denied') return 'Off in iOS Settings';
  if (!state.enabled) return 'Not enabled';
  if (!state.registered) return 'Not registered';
  return state.permission === 'provisional' ? 'Quiet delivery' : 'On';
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { paddingBottom: uiSpace.md },
  actions: { paddingHorizontal: uiSpace.lg, gap: uiSpace.md, paddingBottom: uiSpace.lg },
  heading: {
    paddingHorizontal: uiSpace.lg, paddingTop: uiSpace.md, paddingBottom: uiSpace.sm,
  },
  category: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
});
