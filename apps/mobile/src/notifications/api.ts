import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { getNotificationAccessToken } from './session-scope';
import type { CompletionEntity } from './workout-events';
import type { NotificationBinding, NotificationCategories, NotificationEnvironment, NotificationPreferences,
  NotificationRegistrationMaterial } from './types';

export class NotificationApiError extends Error {
  constructor(readonly code: 'NETWORK' | 'AUTH_REQUIRED' | 'NOT_FOUND' | 'UNAVAILABLE') {
    super(code === 'NETWORK' ? 'Notifications could not be updated. Try again.' :
      code === 'NOT_FOUND' ? 'This group is no longer available.' :
        code === 'AUTH_REQUIRED' ? 'Sign in to manage notifications.' : 'Notifications are unavailable. Try again.');
    this.name = 'NotificationApiError';
  }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const call = async (name: string, args: Record<string, unknown>, accessToken?: string): Promise<unknown> => {
  const bearer = accessToken ?? getNotificationAccessToken();
  if (!bearer) throw new NotificationApiError('AUTH_REQUIRED');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    let request = getRequiredSupabaseMobileClient().schema('app_public').rpc(name, args).abortSignal(abort.signal);
    request = request.setHeader('Authorization', `Bearer ${bearer}`);
    const { data, error, status } = await request;
    if (error) {
      const token = /^(AUTH_REQUIRED|NOT_FOUND|UNAVAILABLE):/.exec(error.message)?.[1];
      throw new NotificationApiError(token as 'AUTH_REQUIRED' | 'NOT_FOUND' | 'UNAVAILABLE' || (status === 0 ? 'NETWORK' : 'UNAVAILABLE'));
    }
    return data;
  } catch (error) {
    throw error instanceof NotificationApiError ? error : new NotificationApiError('NETWORK');
  } finally { clearTimeout(timer); }
};

let installationWrites: Promise<unknown> = Promise.resolve();

// A retired account's write must settle before the current account binds this installation.
const mutateInstallation = (name: string, args: Record<string, unknown>, accessToken = getNotificationAccessToken()): Promise<unknown> => {
  if (!accessToken) return Promise.reject(new NotificationApiError('AUTH_REQUIRED'));
  const operation = installationWrites.then(() => call(name, args, accessToken));
  installationWrites = operation.catch(() => undefined);
  return operation;
};

const preferences = (value: unknown): NotificationPreferences => {
  if (!record(value) || !['activity', 'bests', 'ranks', 'muted'].every(key => typeof value[key] === 'boolean')) {
    throw new NotificationApiError('UNAVAILABLE');
  }
  return value as NotificationPreferences;
};
export const getNotificationPreferences = async (groupId: string | null = null): Promise<NotificationPreferences> =>
  preferences(await call('notification_preferences_get', { p_group_id: groupId }));
export const setNotificationCategories = async (value: NotificationCategories): Promise<NotificationPreferences> =>
  preferences(await call('notification_preferences_set', { p_activity: value.activity, p_bests: value.bests, p_ranks: value.ranks }));
export const getGroupNotificationPreferences = (groupId: string): Promise<NotificationPreferences> => getNotificationPreferences(groupId);
export const setGroupNotificationMuted = async (groupId: string, muted: boolean): Promise<NotificationPreferences> =>
  preferences(await call('notification_group_mute', { p_group_id: groupId, p_muted: muted }));

export const registerNotificationInstallation = async (input: NotificationRegistrationMaterial & {
  token: string; environment: NotificationEnvironment | 'local'; projectId: string; bundleId: string; permission: boolean; optedIn: boolean;
}): Promise<string> => {
  const value = await mutateInstallation('notification_register', {
    p_installation_id: input.installationId, p_capability: input.capability, p_encryption_key: input.encryptionKey,
    p_token: input.token, p_environment: input.environment, p_project_id: input.projectId, p_bundle_id: input.bundleId,
    p_permission: input.permission, p_opted_in: input.optedIn, p_payload_version: 1,
  });
  if (!record(value) || typeof value.binding_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.binding_id) ||
    value.permission !== input.permission || value.opted_in !== input.optedIn || value.payload_version !== 1) {
    throw new NotificationApiError('UNAVAILABLE');
  }
  return value.binding_id;
};
export const unregisterNotificationInstallation = async (binding: Pick<NotificationBinding, 'installationId' | 'bindingId'>, accessToken?: string): Promise<void> => {
  const value = await mutateInstallation('notification_unregister', { p_installation_id: binding.installationId, p_binding_id: binding.bindingId }, accessToken);
  if (!record(value) || value.ok !== true) throw new NotificationApiError('UNAVAILABLE');
};
export const confirmNotificationCompletion = async (sessionId: string, entities: CompletionEntity[], accessToken?: string): Promise<boolean> => {
  const value = await call('notification_confirm_completion', { p_session_id: sessionId, p_entities: entities }, accessToken);
  if (!record(value) || typeof value.confirmed !== 'boolean') throw new NotificationApiError('UNAVAILABLE');
  return value.confirmed;
};

export const getPendingNotificationCompletions = async (afterSessionId: string | null, accessToken?: string): Promise<{
  session_ids: string[]; next_session_id: string | null;
}> => {
  const value = await call('notification_pending_completions', { p_after_session_id: afterSessionId }, accessToken);
  const id = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 160;
  if (!record(value) || Object.keys(value).sort().join(',') !== 'next_session_id,session_ids' ||
    !Array.isArray(value.session_ids) || value.session_ids.length > 10 || !value.session_ids.every(id) ||
    new Set(value.session_ids).size !== value.session_ids.length ||
    (value.next_session_id !== null && (!id(value.next_session_id) || value.next_session_id !== value.session_ids.at(-1)))) {
    throw new NotificationApiError('UNAVAILABLE');
  }
  return value as { session_ids: string[]; next_session_id: string | null };
};
