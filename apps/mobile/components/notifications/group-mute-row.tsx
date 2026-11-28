import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { ActionButton, ListRow, Notice, SwitchRow, uiBorder, uiSpace } from '@/components/ui';
import { makeStyles } from '@/components/ui/theme-context';
import {
  getGroupNotificationPreferences, NotificationApiError, setGroupNotificationMeets, setGroupNotificationMuted,
  type NotificationPreferences,
} from '@/src/notifications';

type Setting = 'muted' | 'meets';
const WRITERS: Record<Setting, (groupId: string, value: boolean) => Promise<NotificationPreferences>> = {
  muted: setGroupNotificationMuted, meets: setGroupNotificationMeets,
};

export function GroupNotificationMuteRow({ groupId, offline }: { groupId: string; offline: boolean }) {
  const styles = useStyles();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const retryWrite = useRef<{ setting: Setting; value: boolean } | null>(null);
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

  const write = async (setting: Setting, value: boolean) => {
    const lifetime = requests.current;
    if (busy || offline || lifetime.mutating) return;
    lifetime.mutating = true;
    lifetime.readGeneration++;
    retryWrite.current = { setting, value };
    setBusy(true);
    setError(null);
    try {
      const confirmed = await WRITERS[setting](groupId, value);
      if (lifetime.active) { setPreferences(confirmed); retryWrite.current = null; }
    } catch (cause) { if (lifetime.active) fail(cause); }
    finally { lifetime.mutating = false; if (lifetime.active) setBusy(false); }
  };

  return (
    <View style={styles.row} testID="group-notifications">
      {preferences && !unavailable ? (
        <>
          <SwitchRow disabled={busy || offline} label="Mute notifications" onValueChange={value => { void write('muted', value); }}
            testID="group-notifications-muted" value={preferences.muted} />
          <SwitchRow disabled={busy || offline} label="Meets" onValueChange={value => { void write('meets', value); }}
            testID="group-notifications-meets" value={preferences.meets} />
        </>
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
              if (retryWrite.current === null) setReadRevision(value => value + 1);
              else void write(retryWrite.current.setting, retryWrite.current.value);
            }} testID="group-notifications-retry" variant="text" />
          )} icon="warning" live message={error} testID="group-notifications-error" tone="danger" />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  row: { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft },
  feedback: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
}));
