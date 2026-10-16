import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  IosAuthorizationStatus, DEFAULT_ACTION_IDENTIFIER, getPermissionsAsync, requestPermissionsAsync, getExpoPushTokenAsync,
  dismissAllNotificationsAsync, cancelAllScheduledNotificationsAsync, setNotificationHandler, setNotificationCategoryAsync,
  addNotificationResponseReceivedListener, addPushTokenListener, getLastNotificationResponseAsync, clearLastNotificationResponseAsync,
  type NotificationPermissionsStatus, type NotificationResponse,
} from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { getAppFlavor } from '@/src/utils/app-flavor';
import type { NotificationBinding, NotificationEnvironment, NotificationEnvelope, NotificationNativeAdapter,
  NotificationPermission, NotificationProjection, NotificationRegistrationMaterial } from './types';

export type NotificationTheme = { paper: string; surface: string; rule: string; ink: string; inkMuted: string; record: string; recordWash: string };
type NativeBridge = {
  readBinding: () => NotificationBinding | null;
  getRegistrationMaterial: (userId: string, environment: NotificationEnvironment) => NotificationRegistrationMaterial;
  activateBinding: (binding: NotificationBinding & { encryptionKey: string }) => void;
  invalidateBinding: () => void;
  decrypt: (envelope: NotificationEnvelope) => NotificationProjection | null;
  setAppliedTheme: (theme: NotificationTheme) => void;
};
const bridge = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeBridge>('BogaNotifications') : null;
const permission = (value: NotificationPermissionsStatus): NotificationPermission => {
  if (value.ios?.status === IosAuthorizationStatus.PROVISIONAL) return 'provisional';
  if (value.granted) return 'granted';
  return value.status === 'denied' ? 'denied' : 'undetermined';
};
const requiredBridge = (): NativeBridge => {
  if (!bridge) throw new Error('Native notifications are unavailable.');
  return bridge;
};
const environment = getAppFlavor();
const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
const adapter: NotificationNativeAdapter = {
  supported: Platform.OS === 'ios' && !!bridge && environment !== 'local' && typeof projectId === 'string',
  environment: environment === 'local' ? null : environment,
  projectId: typeof projectId === 'string' ? projectId : null,
  bundleId: Application.applicationId,
  getPermission: async () => permission(await getPermissionsAsync()),
  requestPermission: async () => permission(await requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } })),
  getToken: async () => {
    if (typeof projectId !== 'string') throw new Error('Notifications are unavailable.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        getExpoPushTokenAsync({ projectId }).then(value => value.data),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Notification token request timed out.')), 10_000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  },
  readBinding: () => bridge?.readBinding() ?? null,
  getRegistrationMaterial: (userId, env) => requiredBridge().getRegistrationMaterial(userId, env),
  activateBinding: value => requiredBridge().activateBinding(value),
  invalidateBinding: () => { bridge?.invalidateBinding(); },
  decrypt: value => bridge?.decrypt(value) ?? null,
  clearNotifications: async () => { await dismissAllNotificationsAsync(); await cancelAllScheduledNotificationsAsync(); },
  openSettings: () => Linking.openSettings(),
  listen: (receiveTap, tokenChanged) => {
    void setNotificationCategoryAsync('boga-workout', []).catch(() => undefined);
    setNotificationHandler({ handleNotification: async notification => {
      let valid = false;
      try { valid = !!bridge?.decrypt(notification.request.content.data as NotificationEnvelope); } catch { /* Retain generic fallback and no foreground route. */ }
      return { shouldShowBanner: valid, shouldShowList: valid, shouldPlaySound: false, shouldSetBadge: false };
    } });
    let active = true;
    const capture = (event: NotificationResponse) => {
      if (!active || event.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
      receiveTap(event.notification.request.content.data);
      void clearLastNotificationResponseAsync().catch(() => undefined);
    };
    const response = addNotificationResponseReceivedListener(capture);
    let lastNativeToken: string | null = null;
    const token = addPushTokenListener(value => {
      if (!active) return;
      const identity = JSON.stringify([value.type, value.data]);
      if (identity === lastNativeToken) return;
      lastNativeToken = identity;
      tokenChanged();
    });
    void getLastNotificationResponseAsync().then(event => {
      if (event) capture(event);
    }).catch(() => undefined);
    return () => { active = false; response.remove(); token.remove(); setNotificationHandler(null); };
  },
};
let currentAdapter = adapter;
export const getNotificationNativeAdapter = (): NotificationNativeAdapter => currentAdapter;
export const __setNotificationNativeAdapterForTests = (value: NotificationNativeAdapter): void => { currentAdapter = value; };

export const setAppliedNotificationTheme = (theme: NotificationTheme): void => { bridge?.setAppliedTheme(theme); };
