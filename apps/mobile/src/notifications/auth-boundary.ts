import type { Session } from '@supabase/supabase-js';
import { getNotificationNativeAdapter } from './native-adapter';
import { unregisterNotificationInstallation } from './api';

import { __resetNotificationAccountForTests as resetScope, getNotificationAccessToken, getNotificationAccount, publishNotificationAccount, type NotificationAccount } from './session-scope';
export { getNotificationAccount, getNotificationAccountRevision, subscribeNotificationAccount } from './session-scope';
let initialized = false;

/** JWT data only detects identity transitions; live RPCs remain the authority. */
export const notificationSessionIdentity = (session: Session | null): NotificationAccount | null => {
  if (!session) return null;
  try {
    const payload = session.access_token.split('.')[1];
    const claim = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claim.session_id === 'string' ? { userId: session.user.id, authSessionId: claim.session_id } : null;
  } catch { return null; }
};

/** Runs before auth mutation; a failed Keychain deletion must stop that mutation. */
export const setNotificationAccount = (next: NotificationAccount | null, accessToken?: string): void => {
  const native = getNotificationNativeAdapter();
  const account = getNotificationAccount();
  const oldAccessToken = getNotificationAccessToken();
  const binding = native.readBinding();
  const changed = account?.userId !== next?.userId || account?.authSessionId !== next?.authSessionId;
  const mismatched = binding && (binding.userId !== next?.userId || binding.authSessionId !== next?.authSessionId || binding.environment !== native.environment);
  if (initialized && !changed && !mismatched) { publishNotificationAccount(next, accessToken, false); return; }
  if (mismatched || (initialized && changed)) native.invalidateBinding();
  initialized = true;
  publishNotificationAccount(next, accessToken, true);
  void native.clearNotifications().catch(() => undefined);
  if (binding && mismatched) void unregisterNotificationInstallation(binding, oldAccessToken).catch(() => undefined);
};

export const __resetNotificationAccountForTests = (): void => { initialized = false; resetScope(); };
