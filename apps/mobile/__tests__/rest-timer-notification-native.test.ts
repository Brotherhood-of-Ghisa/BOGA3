import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  cancelRestTimerNotification,
  flushRestTimerNotificationQueueForTests,
  REST_TIMER_NOTIFICATION_CHANNEL_ID,
  REST_TIMER_NOTIFICATION_ID,
  scheduleRestTimerNotification,
  __resetRestTimerNotificationForTests,
} from '@/src/session-recorder/rest-timer-notification-native';
import { isNotificationPromptSuppressed } from '@/src/session-recorder/notification-prompt-suppression';

jest.unmock('@/src/session-recorder/rest-timer-notification-native');
jest.mock('@/src/session-recorder/notification-prompt-suppression', () => ({
  isNotificationPromptSuppressed: jest.fn(() => false),
}));

describe('rest-timer-notification-native adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetRestTimerNotificationForTests();
    jest.mocked(isNotificationPromptSuppressed).mockReturnValue(false);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.AUTHORIZED, allowsSound: true },
    } as unknown as Notifications.NotificationPermissionsStatus);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.AUTHORIZED },
    } as unknown as Notifications.NotificationPermissionsStatus);
    jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('mock-id');
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValue(undefined);
    jest.mocked(Notifications.setNotificationChannelAsync).mockResolvedValue(null);
  });

  afterEach(async () => {
    await flushRestTimerNotificationQueueForTests();
  });

  it('requests sound and alert permissions if permission status is undetermined', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.NOT_DETERMINED },
    } as unknown as Notifications.NotificationPermissionsStatus);

    scheduleRestTimerNotification(Date.now() + 60_000);
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('never raises the permission dialog while the prompt is suppressed, and still schedules', async () => {
    jest.mocked(isNotificationPromptSuppressed).mockReturnValue(true);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.NOT_DETERMINED },
    } as unknown as Notifications.NotificationPermissionsStatus);

    scheduleRestTimerNotification(Date.now() + 60_000);
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('skips the sound-upgrade dialog while the prompt is suppressed', async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    try {
      jest.mocked(isNotificationPromptSuppressed).mockReturnValue(true);
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
        granted: true,
        canAskAgain: true,
        status: 'granted',
        expires: 'never',
        ios: { status: Notifications.IosAuthorizationStatus.AUTHORIZED, allowsSound: false },
      } as unknown as Notifications.NotificationPermissionsStatus);

      scheduleRestTimerNotification(Date.now() + 60_000);
      await flushRestTimerNotificationQueueForTests();

      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    }
  });

  it('asks once the suppression is lifted, because a suppressed run never consumed the request', async () => {
    const undetermined = {
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.NOT_DETERMINED },
    } as unknown as Notifications.NotificationPermissionsStatus;
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(undetermined);

    jest.mocked(isNotificationPromptSuppressed).mockReturnValue(true);
    scheduleRestTimerNotification(Date.now() + 60_000);
    await flushRestTimerNotificationQueueForTests();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    jest.mocked(isNotificationPromptSuppressed).mockReturnValue(false);
    scheduleRestTimerNotification(Date.now() + 60_000);
    await flushRestTimerNotificationQueueForTests();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not request permissions again if already granted', async () => {
    scheduleRestTimerNotification(Date.now() + 60_000);
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('requests sound permission when already authorized but allowsSound is false', async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    try {
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
        granted: true,
        canAskAgain: true,
        status: 'granted',
        expires: 'never',
        ios: {
          status: Notifications.IosAuthorizationStatus.AUTHORIZED,
          allowsSound: false,
        },
      } as unknown as Notifications.NotificationPermissionsStatus);

      scheduleRestTimerNotification(Date.now() + 60_000);
      await flushRestTimerNotificationQueueForTests();

      expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    }
  });

  it('respects denial after sound upgrade request without repeated attempts', async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    try {
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
        granted: true,
        canAskAgain: true,
        status: 'granted',
        expires: 'never',
        ios: {
          status: Notifications.IosAuthorizationStatus.AUTHORIZED,
          allowsSound: false,
        },
      } as unknown as Notifications.NotificationPermissionsStatus);
      jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
        granted: true,
        canAskAgain: false,
        status: 'granted',
        expires: 'never',
        ios: {
          status: Notifications.IosAuthorizationStatus.AUTHORIZED,
          allowsSound: false,
        },
      } as unknown as Notifications.NotificationPermissionsStatus);

      scheduleRestTimerNotification(Date.now() + 60_000);
      await flushRestTimerNotificationQueueForTests();
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

      scheduleRestTimerNotification(Date.now() + 90_000);
      await flushRestTimerNotificationQueueForTests();
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    }
  });

  it('schedules notification with correct content, identifier, and trigger date', async () => {
    const targetMs = Date.now() + 90_000;
    scheduleRestTimerNotification(targetMs);
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: REST_TIMER_NOTIFICATION_ID,
      content: {
        title: 'Rest finished',
        body: 'Time for the next set.',
        sound: 'default',
        data: { kind: 'rest-timer' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(targetMs),
      },
    });
  });

  it('cancels scheduled notification when target time is not in the future', async () => {
    scheduleRestTimerNotification(Date.now() - 5_000);
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(REST_TIMER_NOTIFICATION_ID);
  });

  it('cancels notification explicitly on cancelRestTimerNotification', async () => {
    cancelRestTimerNotification();
    await flushRestTimerNotificationQueueForTests();

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(REST_TIMER_NOTIFICATION_ID);
  });

  it('configures notification channel when running on Android', async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    try {
      scheduleRestTimerNotification(Date.now() + 45_000);
      await flushRestTimerNotificationQueueForTests();

      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        REST_TIMER_NOTIFICATION_CHANNEL_ID,
        expect.objectContaining({
          name: 'Rest timer',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
          enableVibrate: true,
        }),
      );
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({
            channelId: REST_TIMER_NOTIFICATION_CHANNEL_ID,
          }),
        }),
      );
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    }
  });

  it('handles native notification errors gracefully without throwing', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('Native failure'));

    expect(() => {
      scheduleRestTimerNotification(Date.now() + 60_000);
    }).not.toThrow();

    await expect(flushRestTimerNotificationQueueForTests()).resolves.toBeUndefined();
  });
});
