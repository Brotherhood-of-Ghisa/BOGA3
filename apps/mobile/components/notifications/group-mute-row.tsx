import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton, ListRow, Notice, SwitchRow, uiBorder, uiRoles, uiSpace } from '@/components/ui';
import {
  getGroupNotificationPreferences, NotificationApiError, setGroupNotificationMuted,
  type NotificationPreferences,
} from '@/src/notifications';

export function GroupNotificationMuteRow({ groupId, offline }: { groupId: string; offline: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const retryMuted = useRef<boolean | null>(null);
  const requests = useRef({ active: true, readGeneration: 0, mutating: false });

  const fail = useCallback((cause: unknown) => {
    const denied = cause instanceof NotificationApiError && (cause.code === 'NOT_FOUND' || cause.code === 'AUTH_REQUIRED');
    setUnavailable(denied);
    setError(denied ? 'Notifications are unavailable for this group.' : 'Couldn’t update notifications. Try again.');
  }, []);
  useEffect(() => {
    const lifetime = requests.current;
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, []);
  useEffect(() => {
    const lifetime = requests.current;
    const request = ++lifetime.readGeneration;
    const current = () => lifetime.active && request === lifetime.readGeneration && !lifetime.mutating;
    if (!offline && !lifetime.mutating) {
      void getGroupNotificationPreferences(groupId).then(value => {
        if (current()) { setPreferences(value); setUnavailable(false); setError(null); }
      }, cause => { if (current()) fail(cause); }).finally(() => {
        if (current()) setBusy(false);
      });
    }
    return () => { lifetime.readGeneration++; };
  }, [groupId, offline, readRevision, fail]);

  const mute = async (value: boolean) => {
    const lifetime = requests.current;
    if (busy || offline || lifetime.mutating) return;
    lifetime.mutating = true;
    lifetime.readGeneration++;
    retryMuted.current = value;
    setBusy(true);
    setError(null);
    try {
      const confirmed = await setGroupNotificationMuted(groupId, value);
      if (lifetime.active) { setPreferences(confirmed); retryMuted.current = null; }
    } catch (cause) { if (lifetime.active) fail(cause); }
    finally { lifetime.mutating = false; if (lifetime.active) setBusy(false); }
  };

  return (
    <View style={styles.row} testID="group-notifications">
      {preferences && !unavailable ? (
        <SwitchRow disabled={busy || offline} label="Mute notifications" onValueChange={value => { void mute(value); }}
          testID="group-notifications-muted" value={preferences.muted} />
      ) : (
        <ListRow density="list" description={unavailable ? 'Unavailable' : offline ? 'Offline' : 'Loading…'}
          divider={false} label="Notifications" testID="group-notifications-status" />
      )}
      {error && !offline ? (
        <View style={styles.feedback}>
          <Notice action={unavailable ? undefined : (
            <ActionButton disabled={busy} label="Retry" onPress={() => {
              setBusy(true);
              setError(null);
              if (retryMuted.current === null) setReadRevision(value => value + 1);
              else void mute(retryMuted.current);
            }} testID="group-notifications-retry" variant="text" />
          )} icon="warning" live message={error} testID="group-notifications-error" tone="danger" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
  feedback: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
});
