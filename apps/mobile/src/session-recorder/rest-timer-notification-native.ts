import {
  AndroidImportance,
  cancelScheduledNotificationAsync,
  getPermissionsAsync,
  IosAuthorizationStatus,
  requestPermissionsAsync,
  SchedulableTriggerInputTypes,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';
import { Platform } from 'react-native';

export const REST_TIMER_NOTIFICATION_ID = 'boga-rest-timer';
export const REST_TIMER_NOTIFICATION_CHANNEL_ID = 'boga-rest-timer';

let operations = Promise.resolve();
let permissionRequested = false;
let soundUpgradeRequested = false;

async function ensureNotificationPermissionsAsync(): Promise<boolean> {
  try {
    const current = await getPermissionsAsync();
    const isGranted =
      current.granted ||
      current.ios?.status === IosAuthorizationStatus.AUTHORIZED ||
      current.ios?.status === IosAuthorizationStatus.PROVISIONAL;

    if (Platform.OS === 'ios') {
      if (isGranted && current.ios?.allowsSound !== false) {
        return true;
      }
      if (isGranted && current.ios?.allowsSound === false && !soundUpgradeRequested) {
        soundUpgradeRequested = true;
        const requested = await requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
          },
        });
        return (
          requested.granted ||
          requested.ios?.status === IosAuthorizationStatus.AUTHORIZED ||
          requested.ios?.status === IosAuthorizationStatus.PROVISIONAL
        );
      }
      if (isGranted) {
        return true;
      }
    } else if (isGranted) {
      return true;
    }

    if (current.status === 'undetermined' && !permissionRequested) {
      permissionRequested = true;
      const requested = await requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      return (
        requested.granted ||
        requested.ios?.status === IosAuthorizationStatus.AUTHORIZED ||
        requested.ios?.status === IosAuthorizationStatus.PROVISIONAL
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function scheduleRestTimerNotification(endsAtMs: number): void {
  const remainingMs = endsAtMs - Date.now();
  if (remainingMs <= 0) {
    cancelRestTimerNotification();
    return;
  }

  operations = operations
    .then(async () => {
      await ensureNotificationPermissionsAsync();

      if (Platform.OS === 'android') {
        try {
          await setNotificationChannelAsync(REST_TIMER_NOTIFICATION_CHANNEL_ID, {
            name: 'Rest timer',
            importance: AndroidImportance.HIGH,
            vibrationPattern: [0, 400],
            sound: 'default',
            enableVibrate: true,
          });
        } catch {
          // Channel creation unsupported or headless runner.
        }
      }

      await scheduleNotificationAsync({
        identifier: REST_TIMER_NOTIFICATION_ID,
        content: {
          title: 'Rest finished',
          body: 'Time for the next set.',
          sound: 'default',
          data: { kind: 'rest-timer' },
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: new Date(endsAtMs),
          ...(Platform.OS === 'android' ? { channelId: REST_TIMER_NOTIFICATION_CHANNEL_ID } : {}),
        },
      });
    })
    .catch(() => {
      // Native notifications failure must never throw or interrupt the timer store.
    });
}

export function cancelRestTimerNotification(): void {
  operations = operations
    .then(async () => {
      await cancelScheduledNotificationAsync(REST_TIMER_NOTIFICATION_ID);
    })
    .catch(() => {
      // Cancellation failure must never throw.
    });
}

export function flushRestTimerNotificationQueueForTests(): Promise<void> {
  return operations;
}

export function __resetRestTimerNotificationForTests(): void {
  operations = Promise.resolve();
  permissionRequested = false;
  soundUpgradeRequested = false;
}
