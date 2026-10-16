import { AppState } from 'react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { getAppFlavor } from '@/src/utils/app-flavor';
import { getNotificationAccount, getNotificationAccountRevision, subscribeNotificationAccount } from './auth-boundary';
import { getNotificationPreferences, NotificationApiError, registerNotificationInstallation,
  setNotificationCategories, unregisterNotificationInstallation } from './api';
import { getNotificationNativeAdapter } from './native-adapter';
import { receiveNotificationTap, watchNotificationTapAccount } from './tap';
import type { NotificationCategories, NotificationSnapshot } from './types';

const optInKey = () => `boga-notifications-enabled:${getAppFlavor()}`;
const initial = (): NotificationSnapshot => ({ supported: getNotificationNativeAdapter().supported, permission: 'undetermined',
  enabled: false, registered: false, busy: false, preferences: null, error: null });
let state = initial();
let refreshQueued = false;
const listeners = new Set<() => void>();
const publish = (next: Partial<NotificationSnapshot>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
export const getNotificationSnapshot = () => state;
export const subscribeNotificationState = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const message = (error: unknown): string => error instanceof NotificationApiError ? error.message : 'Notifications could not be updated. Try again.';
const permitted = () => state.permission === 'granted' || state.permission === 'provisional';
const run = async (operation: (revision: number) => Promise<void>): Promise<void> => {
  if (state.busy) return;
  const revision = getNotificationAccountRevision();
  publish({ busy: true, error: null });
  try { await operation(revision); }
  catch (error) { if (revision === getNotificationAccountRevision()) publish({ error: message(error) }); }
  finally {
    if (revision === getNotificationAccountRevision()) {
      publish({ busy: false });
      if (refreshQueued) { refreshQueued = false; void refreshNotificationStatus(); }
    }
  }
};

const register = async (revision: number): Promise<void> => {
  const native = getNotificationNativeAdapter();
  const account = getNotificationAccount();
  if (!account || !native.supported || !native.environment || !native.projectId || !native.bundleId || !state.enabled || !permitted()) return;
  const material = native.getRegistrationMaterial(account.userId, native.environment);
  const token = await native.getToken();
  if (revision !== getNotificationAccountRevision()) return;
  const bindingId = await registerNotificationInstallation({ ...material, token, environment: native.environment,
    projectId: native.projectId, bundleId: native.bundleId, permission: true, optedIn: true });
  if (revision !== getNotificationAccountRevision()) return;
  native.activateBinding({ ...account, installationId: material.installationId, bindingId, environment: native.environment, encryptionKey: material.encryptionKey });
  publish({ registered: true });
};
const stopBinding = async (): Promise<void> => {
  const native = getNotificationNativeAdapter();
  const binding = native.readBinding();
  native.invalidateBinding();
  publish({ registered: false });
  await Promise.all([native.clearNotifications(), binding ? unregisterNotificationInstallation(binding) : Promise.resolve()]);
};

export const refreshNotificationStatus = (): Promise<void> => {
  if (state.busy) { refreshQueued = true; return Promise.resolve(); }
  return run(async revision => {
    const native = getNotificationNativeAdapter();
    const enabled = Storage.getItemSync(optInKey()) === 'true';
    publish({ supported: native.supported, enabled });
    if (!getNotificationAccount()) { publish({ registered: false, preferences: null }); return; }
    if (native.supported) {
      const permission = await native.getPermission();
      if (revision !== getNotificationAccountRevision()) return;
      publish({ permission });
      if (!permitted() || !enabled) await stopBinding();
    }
    const preferences = await getNotificationPreferences();
    if (revision !== getNotificationAccountRevision()) return;
    publish({ preferences });
    await register(revision);
  });
};
export const enableNotifications = (): Promise<void> => run(async revision => {
  const native = getNotificationNativeAdapter();
  if (!getNotificationAccount()) throw new NotificationApiError('AUTH_REQUIRED');
  if (!native.supported) throw new NotificationApiError('UNAVAILABLE');
  const permission = await native.requestPermission();
  if (revision !== getNotificationAccountRevision()) return;
  Storage.setItemSync(optInKey(), 'true');
  publish({ permission, enabled: true });
  if (!permitted()) { await stopBinding(); return; }
  await register(revision);
  const preferences = await getNotificationPreferences();
  if (revision === getNotificationAccountRevision()) publish({ preferences });
});
export const disableNotifications = (): Promise<void> => run(async () => {
  // Key invalidation precedes the setting and any remote cleanup.
  const native = getNotificationNativeAdapter();
  const binding = native.readBinding();
  native.invalidateBinding();
  Storage.setItemSync(optInKey(), 'false');
  publish({ enabled: false, registered: false });
  await Promise.all([native.clearNotifications(), binding ? unregisterNotificationInstallation(binding) : Promise.resolve()]);
});
export const saveNotificationCategories = (categories: NotificationCategories): Promise<void> => run(async revision => {
  if (!getNotificationAccount()) throw new NotificationApiError('AUTH_REQUIRED');
  const preferences = await setNotificationCategories(categories);
  if (revision === getNotificationAccountRevision()) publish({ preferences });
});
export const openNotificationSettings = async (): Promise<void> => {
  try { await getNotificationNativeAdapter().openSettings(); }
  catch (error) { publish({ error: message(error) }); }
};

let stopLifecycle: (() => void) | null = null;
export const startNotificationLifecycle = (): (() => void) => {
  if (stopLifecycle) return stopLifecycle;
  const stopTaps = watchNotificationTapAccount();
  const stopAccount = subscribeNotificationAccount(() => {
    refreshQueued = false;
    publish({ ...initial(), enabled: state.enabled });
    void refreshNotificationStatus();
  });
  let stopNative: () => void = () => undefined;
  try {
    if (getNotificationNativeAdapter().supported) stopNative = getNotificationNativeAdapter().listen(receiveNotificationTap, () => void refreshNotificationStatus());
  } catch (error) { publish({ error: message(error) }); }
  const appState = AppState.addEventListener('change', next => { if (next === 'active') void refreshNotificationStatus(); });
  void refreshNotificationStatus();
  stopLifecycle = () => { stopTaps(); stopAccount(); stopNative(); appState.remove(); stopLifecycle = null; };
  return stopLifecycle;
};
export const __resetNotificationLifecycleForTests = (): void => {
  stopLifecycle?.(); state = initial(); refreshQueued = false; listeners.clear();
};
