/* eslint-disable import/first */
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project' } } } } }));
const mockRpc = jest.fn();
const mockBearerHeaders: string[] = [];
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({
  schema: () => ({ rpc: (...args: unknown[]) => ({
    abortSignal: () => ({ setHeader: (_key: string, value: string) => { mockBearerHeaders.push(value); return mockRpc(...args); } }),
  }) }),
}) }));
import { Storage } from 'expo-sqlite/kv-store';
import * as Notifications from 'expo-notifications';
import { fakeNotificationNative, notificationBinding, notificationSession, notificationUser } from './helpers/notification-native';
import { getNotificationNativeAdapter, __setNotificationNativeAdapterForTests } from '@/src/notifications/native-adapter';
import { __resetNotificationsForTests, disableNotifications, enableNotifications, getNotificationSnapshot,
  getGroupNotificationPreferences, refreshNotificationStatus, saveNotificationCategories, setGroupNotificationMuted,
  startNotificationLifecycle, subscribeNotificationState } from '@/src/notifications';
import { setNotificationAccount, getNotificationAccount } from '@/src/notifications/auth-boundary';

const acquireNativeToken = getNotificationNativeAdapter().getToken;
let native: ReturnType<typeof fakeNotificationNative>;
const defaults = { activity: true, bests: true, ranks: true, muted: false };
beforeEach(() => {
  native = fakeNotificationNative(); __setNotificationNativeAdapterForTests(native); __resetNotificationsForTests();
  mockRpc.mockReset(); mockBearerHeaders.length = 0;
  setNotificationAccount({ userId: notificationUser, authSessionId: notificationSession }, 'captured-token');
  mockRpc.mockImplementation(async name => ({ data: name === 'notification_register'
    ? { binding_id: notificationBinding, permission: true, opted_in: true, payload_version: 1 }
    : name === 'notification_unregister' ? { ok: true } : defaults, error: null, status: 200 }));
});

test('only an enable action asks permission; registration uses real wire fields and confirmed preferences', async () => {
  await refreshNotificationStatus();
  expect(native.requestPermission).not.toHaveBeenCalled(); expect(native.getToken).not.toHaveBeenCalled();
  await enableNotifications();
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('notification_register', expect.objectContaining({
    p_environment: 'preview', p_bundle_id: 'com.phano.boga3.dev', p_permission: true, p_opted_in: true, p_payload_version: 1,
  }));
  expect(getNotificationSnapshot()).toMatchObject({ enabled: true, registered: true, permission: 'granted', preferences: defaults, error: null });
});
test('denied permission offers an accurate disabled delivery state and never gets a token', async () => {
  native.requestPermission = jest.fn(async () => 'denied');
  await enableNotifications();
  expect(getNotificationSnapshot()).toMatchObject({ enabled: true, registered: false, permission: 'denied' });
  expect(native.getToken).not.toHaveBeenCalled();
});
test('registration failure stays retryable and never activates a shared key', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' }, status: 0 });
  await enableNotifications();
  expect(getNotificationSnapshot()).toMatchObject({ enabled: true, registered: false, busy: false });
  expect(getNotificationSnapshot().error).toMatch(/Try again/); expect(native.activateBinding).not.toHaveBeenCalled();
  mockRpc.mockImplementation(async name => ({ data: name === 'notification_register'
    ? { binding_id: notificationBinding, permission: true, opted_in: true, payload_version: 1 } : defaults, error: null }));
  await refreshNotificationStatus();
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  expect(getNotificationSnapshot().registered).toBe(true);
});
test('failed categories retain last confirmed choices and muted writes use membership RPC', async () => {
  await refreshNotificationStatus();
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'failed' }, status: 0 });
  await saveNotificationCategories({ activity: false, bests: false, ranks: false });
  expect(getNotificationSnapshot().preferences).toEqual(defaults);
  mockRpc.mockResolvedValueOnce({ data: { ...defaults, muted: true }, error: null });
  expect(await setGroupNotificationMuted('group', true)).toMatchObject({ muted: true });
  expect(mockRpc).toHaveBeenLastCalledWith('notification_group_mute', { p_group_id: 'group', p_muted: true });
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: hidden' }, status: 400 });
  await expect(getGroupNotificationPreferences('group')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
test('disable invalidates local binding before remote unregister and retains disabled state offline', async () => {
  await enableNotifications();
  const order: string[] = [];
  const invalidate = native.invalidateBinding;
  native.invalidateBinding = jest.fn(() => { order.push('invalidate'); invalidate(); });
  mockRpc.mockImplementation(async name => { order.push(name); return { error: { message: 'offline' }, status: 0 }; });
  await disableNotifications();
  expect(order).toEqual(['invalidate', 'notification_unregister']);
  expect(getNotificationSnapshot()).toMatchObject({ enabled: false, registered: false });
  expect(native.readBinding()).toBeNull();
});
test('account transition stops on Keychain failure and does not publish the next account', async () => {
  await enableNotifications();
  native.invalidateBinding = jest.fn(() => { throw new Error('keychain'); });
  expect(() => setNotificationAccount(null)).toThrow('keychain');
  expect(getNotificationAccount()?.userId).toBe(notificationUser);
});
test('a registration resolving after account change cannot activate the old key', async () => {
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const registering = new Promise<void>(resolve => { started = resolve; });
  mockRpc.mockImplementation(name => name === 'notification_register' ? new Promise(resolve => { finish = resolve; started(); }) : Promise.resolve({ data: defaults, error: null }));
  const enabled = enableNotifications();
  await registering;
  setNotificationAccount(null);
  finish({ data: { binding_id: notificationBinding, permission: true, opted_in: true, payload_version: 1 }, error: null });
  await enabled;
  expect(native.activateBinding).not.toHaveBeenCalled();
});
test('unsupported builds remain usable and never request native permission or registration', async () => {
  native.supported = false;
  await enableNotifications();
  expect(native.requestPermission).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  expect(Storage.getItemSync('boga-notifications-enabled:local')).toBeNull();
});

test('serializes delayed account A registration and unregister before account B binds the installation', async () => {
  const userB = '88888888-8888-4888-8888-888888888888';
  const sessionB = '99999999-9999-4999-8999-999999999999';
  const bindingB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const writes: string[] = [];
  let serverAccount: string | null = null;
  let holdNextA = false;
  let releaseA!: () => void;
  let startedA!: () => void;
  const delayedA = new Promise<void>(resolve => { startedA = resolve; });
  let readBToken!: () => void;
  const gotBToken = new Promise<void>(resolve => { readBToken = resolve; });
  native.getToken = jest.fn(async () => {
    if (getNotificationAccount()?.userId === userB) readBToken();
    return 'ExpoPushToken[shared-installation]';
  });
  mockRpc.mockImplementation((name: string) => {
    const bearer = mockBearerHeaders.at(-1);
    if (name === 'notification_register') {
      const user = bearer === 'Bearer account-b-token' ? userB : notificationUser;
      const commit = () => {
        serverAccount = user; writes.push(`register:${user}`);
        return { data: { binding_id: user === userB ? bindingB : notificationBinding,
          permission: true, opted_in: true, payload_version: 1 }, error: null };
      };
      if (holdNextA && user === notificationUser) {
        holdNextA = false;
        return new Promise(resolve => { releaseA = () => resolve(commit()); startedA(); });
      }
      return Promise.resolve(commit());
    }
    if (name === 'notification_unregister') {
      writes.push(`unregister:${bearer}`); serverAccount = null;
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    return Promise.resolve({ data: defaults, error: null });
  });
  await enableNotifications();
  holdNextA = true;
  const stop = startNotificationLifecycle();
  try {
    await delayedA;
    setNotificationAccount({ userId: userB, authSessionId: sessionB }, 'account-b-token');
    await gotBToken; await Promise.resolve();
    expect(writes).toEqual([`register:${notificationUser}`]);
    expect(mockRpc.mock.calls.filter(call => call[0] === 'notification_register')).toHaveLength(2);
    const registeredB = new Promise<void>(resolve => {
      const unsubscribe = subscribeNotificationState(() => {
        if (getNotificationSnapshot().registered && native.readBinding()?.userId === userB) { unsubscribe(); resolve(); }
      });
    });
    releaseA();
    await registeredB;
    expect(writes).toEqual([`register:${notificationUser}`, `register:${notificationUser}`, 'unregister:Bearer captured-token', `register:${userB}`]);
    expect(serverAccount).toBe(userB);
    expect(native.readBinding()).toMatchObject({ userId: userB, bindingId: bindingB, authSessionId: sessionB });
    expect(getNotificationSnapshot().registered).toBe(true);
  } finally { stop(); }
});


test('a stalled native token releases busy state, never registers late and allows a clean retry', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (value: Notifications.ExpoPushToken) => void;
    jest.mocked(Notifications.getExpoPushTokenAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    native.getToken = acquireNativeToken;
    const enabling = enableNotifications();
    await jest.advanceTimersByTimeAsync(0);
    expect(getNotificationSnapshot()).toMatchObject({ busy: true, registered: false, enabled: true, permission: 'granted' });
    await jest.advanceTimersByTimeAsync(10_000);
    await enabling;
    expect(getNotificationSnapshot()).toMatchObject({ busy: false, registered: false, enabled: true });
    expect(getNotificationSnapshot().error).toMatch(/Try again/);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(native.activateBinding).not.toHaveBeenCalled();

    const timedOutState = getNotificationSnapshot();
    finish({ type: 'expo', data: 'ExpoPushToken[expired]' });
    await jest.advanceTimersByTimeAsync(0);
    expect(getNotificationSnapshot()).toBe(timedOutState);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(native.activateBinding).not.toHaveBeenCalled();

    jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValueOnce({ type: 'expo', data: 'ExpoPushToken[retry]' });
    await refreshNotificationStatus();
    expect(getNotificationSnapshot()).toMatchObject({ busy: false, registered: true, error: null, preferences: defaults });
    expect(native.requestPermission).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls.filter(call => call[0] === 'notification_register')).toEqual([
      ['notification_register', expect.objectContaining({ p_token: 'ExpoPushToken[retry]' })],
    ]);
    expect(native.activateBinding).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
