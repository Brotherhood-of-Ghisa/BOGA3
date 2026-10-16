import { getCompetitionSession, GroupApiError } from '@/src/groups/api';
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
export const isNotificationProjection = (value: unknown): value is NotificationProjection => {
  if (!isRecord(value) || !isRecord(value.route)) return false;
  return value.v === 1 && uuid(value.bindingId) && uuid(value.recipientUserId) && typeof value.notificationId === 'string' && /^\d{1,20}$/.test(value.notificationId) &&
    typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() &&
    (value.kind === 'start' || value.kind === 'completion') && typeof value.identity === 'string' && value.identity.length > 0 && Array.from(value.identity).length <= 220 &&
    typeof value.heading === 'string' && ['Started a workout', 'Finished a workout', 'Workout achievements', 'Group exercise bests', 'Leaderboard changes'].includes(value.heading) &&
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

export const processPendingNotificationTap = async (input: {
  userId: string | null; ready: boolean; onOpen: (target: NotificationTarget) => void;
  onUnavailable: (reason: 'offline' | 'unavailable') => void;
}): Promise<void> => {
  if (!pending || !input.userId || !input.ready || processing) return;
  const envelope = pending;
  const accountRevision = getNotificationAccountRevision();
  const native = getNotificationNativeAdapter();
  const current = () => pending === envelope && accountRevision === getNotificationAccountRevision() && getNotificationAccount()?.userId === input.userId;
  const decodeCurrent = (): NotificationProjection | null => {
    try {
      const value = native.decrypt(envelope);
      const binding = native.readBinding();
      const account = getNotificationAccount();
      return isNotificationProjection(value) && value.bindingId === envelope.bindingId && value.recipientUserId === input.userId &&
        binding?.bindingId === envelope.bindingId && binding.userId === input.userId && binding.environment === native.environment &&
        account?.userId === input.userId && binding.authSessionId === account.authSessionId ? value : null;
    } catch { return null; }
  };
  const projection = decodeCurrent();
  if (!projection) { discardPendingNotificationTap(); input.onUnavailable('unavailable'); return; }
  const identity = `${envelope.bindingId}:${projection.notificationId}`;
  if (opened.has(identity)) { discardPendingNotificationTap(); return; }
  processing = true;
  try {
    await getCompetitionSession(projection.route.groupId, projection.route.memberId, projection.route.sessionId);
    // A key/account/expiry may have changed while the live authorization was in flight.
    const fresh = decodeCurrent();
    if (!current()) return;
    if (!fresh || fresh.notificationId !== projection.notificationId || fresh.route.groupId !== projection.route.groupId ||
      fresh.route.memberId !== projection.route.memberId || fresh.route.sessionId !== projection.route.sessionId) {
      discardPendingNotificationTap(); input.onUnavailable('unavailable'); return;
    }
    opened.add(identity);
    if (opened.size > 100) opened.delete(opened.values().next().value!);
    discardPendingNotificationTap();
    input.onOpen(fresh.route);
  } catch (error) {
    if (!current()) return;
    const offline = error instanceof GroupApiError && error.code === 'NETWORK';
    if (!offline) discardPendingNotificationTap();
    input.onUnavailable(offline ? 'offline' : 'unavailable');
  } finally {
    processing = false;
    if (pending && pending !== envelope) emit();
  }
};
export const __resetNotificationTapsForTests = (): void => {
  pending = null; revision = 0; processing = false; opened.clear(); listeners.clear(); unsubscribeAccount?.(); unsubscribeAccount = null;
};
