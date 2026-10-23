import { getCompetitionSession, GroupApiError } from '@/src/groups/api';
import { logEvent } from '@/src/logging';
import { getNotificationNativeAdapter } from './native-adapter';
import { getNotificationAccount, getNotificationAccountRevision, subscribeNotificationAccount } from './auth-boundary';
import type { NotificationEnvelope, NotificationProjection, NotificationTarget } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const notificationEnvelope = (value: unknown): NotificationEnvelope | null => {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'bindingId,ciphertext,nonce,v' || value.v !== 1 ||
    !uuid(value.bindingId) || typeof value.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(value.nonce) || typeof value.ciphertext !== 'string' || value.ciphertext.length > 12_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)) return null;
  return { v: 1, bindingId: value.bindingId, nonce: value.nonce, ciphertext: value.ciphertext };
};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isNotificationHeading = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  if (['Started a workout', 'Finished a workout', 'Workout achievements', 'Group exercise bests', 'Leaderboard changes'].includes(value)) return true;
  const prefix = ['Started a workout at ', 'Finished a workout at '].find(item => value.startsWith(item));
  if (!prefix) return false;
  const location = value.slice(prefix.length);
  return location.length > 0 && Array.from(location).length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/.test(location);
};
export const isNotificationProjection = (value: unknown): value is NotificationProjection => {
  if (!isRecord(value) || !isRecord(value.route)) return false;
  return value.v === 1 && uuid(value.bindingId) && uuid(value.recipientUserId) && typeof value.notificationId === 'string' && /^\d{1,20}$/.test(value.notificationId) &&
    typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() &&
    (value.kind === 'start' || value.kind === 'completion') && typeof value.identity === 'string' && value.identity.length > 0 && Array.from(value.identity).length <= 220 &&
    isNotificationHeading(value.heading) &&
    Number.isSafeInteger(value.bestCount) && (value.bestCount as number) >= 0 && Number.isSafeInteger(value.rankCount) && (value.rankCount as number) >= 0 &&
    uuid(value.route.groupId) && uuid(value.route.memberId) && typeof value.route.sessionId === 'string' &&
    value.route.sessionId.length > 0 && value.route.sessionId.length <= 160 && !/[\u0000-\u001f]/.test(value.route.sessionId) &&
    Object.keys(value.route).sort().join(',') === 'groupId,memberId,sessionId';
};
let pending: NotificationEnvelope | null = null;
let revision = 0;
let processing = false;
const opened = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => { revision += 1; for (const listener of listeners) listener(); };
export const discardPendingNotificationTap = (): void => { pending = null; emit(); };
export const getPendingNotificationTapRevision = () => revision;
export const subscribePendingNotificationTap = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const receiveNotificationTap = (data: unknown): void => {
  pending = notificationEnvelope(data);
  emit();
};
let unsubscribeAccount: (() => void) | null = null;
export const watchNotificationTapAccount = (): (() => void) => {
  unsubscribeAccount?.();
  unsubscribeAccount = subscribeNotificationAccount(() => {
    opened.clear();
    if (getNotificationNativeAdapter().readBinding()?.bindingId !== pending?.bindingId) discardPendingNotificationTap();
  });
  return () => { unsubscribeAccount?.(); unsubscribeAccount = null; };
};

const logTapDecodeFailure = (
  envelope: NotificationEnvelope,
  native: ReturnType<typeof getNotificationNativeAdapter>,
  userId: string,
): void => {
  let decrypted: unknown = null;
  try { decrypted = native.decrypt(envelope); } catch { /* ignore */ }
  const binding = native.readBinding();
  const account = getNotificationAccount();
  void logEvent({
    level: 'warn',
    event: 'notifications.tap_decode_failed',
    message: 'Failed to decode or validate notification projection.',
    context: {
      envelopeBindingId: envelope.bindingId,
      hasDecryptedValue: Boolean(decrypted),
      isProjection: isNotificationProjection(decrypted),
      bindingBindingId: binding?.bindingId,
      bindingUserId: binding?.userId,
      accountUserId: account?.userId,
      inputUserId: userId,
      bindingSessionMatch: binding?.authSessionId === account?.authSessionId,
      envMatch: binding?.environment === native.environment,
      expired: isRecord(decrypted) && typeof decrypted.expiresAt === 'number' ? decrypted.expiresAt <= Date.now() : undefined,
    },
  });
};

const decodeNotificationEnvelope = (
  envelope: NotificationEnvelope,
  native: ReturnType<typeof getNotificationNativeAdapter>,
  userId: string,
): NotificationProjection | null => {
  try {
    const value = native.decrypt(envelope);
    const binding = native.readBinding();
    const account = getNotificationAccount();
    return isNotificationProjection(value) && value.bindingId === envelope.bindingId && value.recipientUserId === userId &&
      binding?.bindingId === envelope.bindingId && binding.userId === userId && binding.environment === native.environment &&
      account?.userId === userId && binding.authSessionId === account.authSessionId ? value : null;
  } catch { return null; }
};

type PostFetchValidation = 'valid' | 'expired' | 'unbound' | 'mismatch';

const verifyPostFetch = (
  envelope: NotificationEnvelope,
  projection: NotificationProjection,
  native: ReturnType<typeof getNotificationNativeAdapter>,
  userId: string,
): PostFetchValidation => {
  if (projection.expiresAt <= Date.now()) return 'expired';
  const binding = native.readBinding();
  const account = getNotificationAccount();
  const bindingValid = binding &&
    binding.userId === userId &&
    binding.authSessionId === account?.authSessionId &&
    binding.environment === native.environment;
  if (!bindingValid) return 'unbound';
  if (binding.bindingId === envelope.bindingId) {
    const fresh = decodeNotificationEnvelope(envelope, native, userId);
    if (!fresh || fresh.notificationId !== projection.notificationId || fresh.route.groupId !== projection.route.groupId ||
      fresh.route.memberId !== projection.route.memberId || fresh.route.sessionId !== projection.route.sessionId) {
      return 'mismatch';
    }
  }
  return 'valid';
};

const recordTapOpened = (identity: string, projection: NotificationProjection, onOpen: (target: NotificationTarget) => void): void => {
  opened.add(identity);
  if (opened.size > 100) opened.delete(opened.values().next().value!);
  discardPendingNotificationTap();
  void logEvent({
    level: 'info',
    event: 'notifications.tap_opened',
    context: { groupId: projection.route.groupId, sessionId: projection.route.sessionId, notificationId: projection.notificationId },
  });
  onOpen(projection.route);
};

const handleTapAuthError = (
  error: unknown,
  projection: NotificationProjection,
  onUnavailable: (reason: 'offline' | 'unavailable') => void,
): void => {
  const offline = error instanceof GroupApiError && error.code === 'NETWORK';
  if (!offline) discardPendingNotificationTap();
  void logEvent({
    level: offline ? 'info' : 'warn',
    event: offline ? 'notifications.tap_offline' : 'notifications.tap_auth_failed',
    message: error instanceof Error ? error.message : String(error),
    context: { code: error instanceof GroupApiError ? error.code : undefined, groupId: projection.route.groupId, sessionId: projection.route.sessionId },
  });
  onUnavailable(offline ? 'offline' : 'unavailable');
};

export const processPendingNotificationTap = async (input: {
  userId: string | null; ready: boolean; onOpen: (target: NotificationTarget) => void;
  onUnavailable: (reason: 'offline' | 'unavailable') => void;
}): Promise<void> => {
  if (!pending || !input.userId || !input.ready || processing) return;
  const envelope = pending;
  const accountRevision = getNotificationAccountRevision();
  const native = getNotificationNativeAdapter();
  const current = () => pending === envelope && accountRevision === getNotificationAccountRevision() && getNotificationAccount()?.userId === input.userId;
  const projection = decodeNotificationEnvelope(envelope, native, input.userId);
  if (!projection) {
    logTapDecodeFailure(envelope, native, input.userId);
    discardPendingNotificationTap();
    input.onUnavailable('unavailable');
    return;
  }
  const identity = `${envelope.bindingId}:${projection.notificationId}`;
  if (opened.has(identity)) { discardPendingNotificationTap(); return; }
  processing = true;
  try {
    await getCompetitionSession(projection.route.groupId, projection.route.memberId, projection.route.sessionId);
    if (!current()) return;
    const postStatus = verifyPostFetch(envelope, projection, native, input.userId);
    if (postStatus === 'expired' || postStatus === 'mismatch') {
      void logEvent({
        level: 'warn',
        event: postStatus === 'expired' ? 'notifications.tap_expired_in_flight' : 'notifications.tap_revalidation_failed',
        message: postStatus === 'expired' ? 'Notification expired during live authorization.' : 'Projection revalidation failed.',
      });
      discardPendingNotificationTap();
      input.onUnavailable('unavailable');
      return;
    }
    if (postStatus === 'unbound') {
      void logEvent({ level: 'warn', event: 'notifications.tap_binding_invalidated', message: 'Device binding invalidated during live read.' });
      discardPendingNotificationTap();
      return;
    }
    recordTapOpened(identity, projection, input.onOpen);
  } catch (error) {
    if (current()) handleTapAuthError(error, projection, input.onUnavailable);
  } finally {
    processing = false;
    if (pending && pending !== envelope) emit();
  }
};
export const __resetNotificationTapsForTests = (): void => {
  pending = null; revision = 0; processing = false; opened.clear(); listeners.clear(); unsubscribeAccount?.(); unsubscribeAccount = null;
};
