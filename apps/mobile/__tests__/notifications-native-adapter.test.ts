/* eslint-disable import/first */
jest.mock('@/src/utils/app-flavor', () => ({ getAppFlavor: () => 'preview' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project' } } } } }));
import * as Notifications from 'expo-notifications';
import { notificationEnvelopeFixture, notificationProjectionFixture } from './helpers/notification-native';

const mockBridge = { readBinding: jest.fn(), getRegistrationMaterial: jest.fn(), activateBinding: jest.fn(), invalidateBinding: jest.fn(),
  decrypt: jest.fn(), setAppliedTheme: jest.fn() };
// jest-expo caches its core mock during setup; install the native boundary before loading the adapter.
const modulesCore = jest.requireMock<typeof import('expo-modules-core')>('expo-modules-core');
const nativeLookup = jest.spyOn(modulesCore, 'requireOptionalNativeModule').mockReturnValue(mockBridge);
const { getNotificationNativeAdapter } = jest.requireActual<typeof import('@/src/notifications/native-adapter')>('@/src/notifications/native-adapter');
const native = getNotificationNativeAdapter();
afterAll(() => { nativeLookup.mockRestore(); });
beforeEach(() => { jest.clearAllMocks(); mockBridge.decrypt.mockReturnValue(notificationProjectionFixture()); });
test('foreground uses the normal iOS banner without sound, and malformed crypto fails closed', async () => {
  const stop = native.listen(jest.fn(), jest.fn());
  const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls.at(-1)?.[0]!;
  const event = { request: { content: { data: notificationEnvelopeFixture } } } as unknown as Notifications.Notification;
  expect(await handler.handleNotification(event)).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false });
  expect(mockBridge.decrypt).toHaveBeenCalledWith(notificationEnvelopeFixture);
  mockBridge.decrypt.mockImplementationOnce(() => { throw new Error('invalid'); });
  expect(await handler.handleNotification(event)).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  stop();
});
test('captures the original cold response once, clears Expo response and ignores a late response after cleanup', async () => {
  const receive = jest.fn();
  const response = { actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER, notification: { request: { content: { data: notificationEnvelopeFixture } } } } as unknown as Notifications.NotificationResponse;
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce(response);
  const stop = native.listen(receive, jest.fn());
  await Promise.resolve(); await Promise.resolve();
  expect(receive).toHaveBeenCalledWith(notificationEnvelopeFixture); expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  stop();
  let finish!: (value: Notifications.NotificationResponse) => void;
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stoppedReceive = jest.fn(); const cleanup = native.listen(stoppedReceive, jest.fn()); cleanup();
  finish(response); await Promise.resolve();
  expect(stoppedReceive).not.toHaveBeenCalled();
});
test('permission normalization retains provisional status and an explicit request excludes sound and badge', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ granted: false, status: 'granted', canAskAgain: true,
    expires: 'never', ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL } } as Notifications.NotificationPermissionsStatus);
  expect(await native.getPermission()).toBe('provisional');
  await native.requestPermission();
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
});

test('unchanged native token events emitted by Expo token reads do not create a refresh loop', async () => {
  let receiveToken!: (token: Notifications.DevicePushToken) => void;
  jest.mocked(Notifications.addPushTokenListener).mockImplementationOnce(listener => {
    receiveToken = listener; return { remove: jest.fn() };
  });
  let currentToken = 'native-token';
  let reads = 0;
  jest.mocked(Notifications.getExpoPushTokenAsync).mockImplementation(async () => {
    reads += 1;
    if (reads <= 4) receiveToken({ type: 'ios', data: currentToken });
    return { type: 'expo', data: 'ExpoPushToken[installation]' };
  });
  const changed = jest.fn(() => { void native.getToken(); });
  const stop = native.listen(jest.fn(), changed);
  await native.getToken();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(reads).toBe(2);
  currentToken = 'rotated-native-token';
  receiveToken({ type: 'ios', data: currentToken });
  receiveToken({ type: 'ios', data: currentToken });
  await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(reads).toBe(3);
  stop();
  receiveToken({ type: 'ios', data: 'late-token' });
  expect(changed).toHaveBeenCalledTimes(2);
});

test('startup registers the expanded workout category without permission and preserves cleanup if registration fails', async () => {
  jest.mocked(Notifications.setNotificationCategoryAsync).mockRejectedValueOnce(new Error('Category unavailable'));
  const removeResponse = jest.fn(); const removeToken = jest.fn();
  jest.mocked(Notifications.addNotificationResponseReceivedListener).mockReturnValueOnce({ remove: removeResponse });
  jest.mocked(Notifications.addPushTokenListener).mockReturnValueOnce({ remove: removeToken });
  const receive = jest.fn();
  const stop = native.listen(receive, jest.fn());
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith('boga-workout', []);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await Promise.resolve();
  const capture = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls.at(-1)![0];
  capture({ actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { content: { data: notificationEnvelopeFixture } } } } as unknown as Notifications.NotificationResponse);
  expect(receive).toHaveBeenCalledWith(notificationEnvelopeFixture);
  stop();
  expect(removeResponse).toHaveBeenCalledTimes(1); expect(removeToken).toHaveBeenCalledTimes(1);
  expect(Notifications.setNotificationHandler).toHaveBeenLastCalledWith(null);
});


test('token acquisition bounds a stalled SDK request and ignores its late result after a clean retry', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (value: Notifications.ExpoPushToken) => void;
    jest.mocked(Notifications.getExpoPushTokenAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stalled = native.getToken();
    const rejected = expect(stalled).rejects.toThrow('Notification token request timed out.');
    await jest.advanceTimersByTimeAsync(9_999);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);

    jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValueOnce({ type: 'expo', data: 'ExpoPushToken[retry]' });
    await expect(native.getToken()).resolves.toBe('ExpoPushToken[retry]');
    expect(jest.getTimerCount()).toBe(0);
    finish({ type: 'expo', data: 'ExpoPushToken[expired]' });
    await expect(stalled).rejects.toThrow('Notification token request timed out.');
  } finally { jest.useRealTimers(); }
});

test('token acquisition preserves SDK failures and removes its deadline timer', async () => {
  jest.useFakeTimers();
  try {
    const error = new Error('APNs unavailable');
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValueOnce(error);
    await expect(native.getToken()).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
