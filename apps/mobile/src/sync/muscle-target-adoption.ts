// One-time move of a device's weekly muscle targets and count-secondary switch
// from its kv store to the synced settings row ([[muscle.weekly-targets]]).
//
// The sync cycle runs this after its first pull leg, once per account on this
// device. It asks the server for the row's values directly: a row an older app
// pulled reached this device without the columns, so the local row cannot tell
// "never uploaded" from "uploaded before this device upgraded".
//
//   - The server holds targets → copy them onto the local row (adopt) and drop
//     the kv copy.
//   - It holds none → write the device's stored kv values to the local row as
//     an edit, which this round's push uploads (first device wins), and drop
//     the kv copy. A device with no stored values uploads nothing.
//
// A failed server read leaves everything as it was; the next cycle retries.
import { Storage } from 'expo-sqlite/kv-store';

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import {
  adoptMuscleTargetSettings,
  readMuscleTargetSettings,
  writeMuscleTargetSettings,
  type StoredMuscleTargetSettings,
} from '@/src/data/user-settings';
import { logEvent } from '@/src/logging/logEvent';
import { refreshAccountLocalSyncedPreferences } from '@/src/preferences/account-local';
import { preferenceKey, readScopedPreferences } from '@/src/preferences/storage';
import {
  pickSyncedPreferences,
  storedFromSyncedPreferences,
  syncedPreferenceFields,
  syncedTargetsAdoptedKey,
} from '@/src/preferences/synced';

type ServerSettingsRow = {
  weekly_working_set_target: number | null;
  muscle_target_mode: string | null;
  muscle_target_overrides: unknown;
  count_secondary_muscles: boolean | null;
};

const hasAnyValue = (stored: StoredMuscleTargetSettings | null): stored is StoredMuscleTargetSettings =>
  stored !== null && Object.values(stored).some(value => value !== null);

const fromServerRow = (row: ServerSettingsRow | null): StoredMuscleTargetSettings | null => row && {
  weeklyWorkingSetTarget: row.weekly_working_set_target,
  muscleTargetMode: row.muscle_target_mode,
  muscleTargetOverrides: row.muscle_target_overrides === null || row.muscle_target_overrides === undefined
    ? null : JSON.stringify(row.muscle_target_overrides),
  countSecondaryMuscles: row.count_secondary_muscles,
};

/** The server's values for `userId`, or undefined when they cannot be read as that account. */
const readServerSettings = async (userId: string): Promise<StoredMuscleTargetSettings | null | undefined> => {
  const client = getRequiredSupabaseMobileClient();
  const session = (await client.auth.getSession()).data.session;
  if (session?.user.id !== userId) return undefined;
  const { data, error } = await client.schema('app_public').from('user_settings')
    .select('weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles')
    .eq('id', 'settings')
    .maybeSingle()
    .setHeader('Authorization', 'Bearer ' + session.access_token);
  if (error) throw new Error(error.message);
  return fromServerRow(data as ServerSettingsRow | null);
};

const dropKvCopy = (profile: `account:${string}`): void => {
  for (const field of syncedPreferenceFields) Storage.removeItemSync(preferenceKey(profile, field));
  Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
};

/** Returns false when the local row is missing, so the next cycle tries again. */
const adoptOrUpload = async (profile: `account:${string}`, userId: string,
  server: StoredMuscleTargetSettings | null): Promise<boolean> => {
  // Edits made before this step stayed in kv, so local values here came from a pull.
  if (hasAnyValue(await readMuscleTargetSettings(userId))) return true;
  if (hasAnyValue(server)) return adoptMuscleTargetSettings(server);
  const stored = pickSyncedPreferences(readScopedPreferences(profile).valid);
  if (Object.keys(stored).length > 0) await writeMuscleTargetSettings(storedFromSyncedPreferences(stored));
  return true;
};

const adoptOrUploadOnce = async (userId: string): Promise<void> => {
  const profile = `account:${userId}` as const;
  if (Storage.getItemSync(syncedTargetsAdoptedKey(profile)) === 'true') return;
  const server = await readServerSettings(userId);
  if (server === undefined || !await adoptOrUpload(profile, userId, server)) return;
  dropKvCopy(profile);
  await refreshAccountLocalSyncedPreferences();
};

/** Never fails the cycle: a one-off upgrade step only logs, and the next cycle retries. */
export const adoptOrUploadMuscleTargets = async (userId: string): Promise<void> => {
  try {
    await adoptOrUploadOnce(userId);
  } catch (error) {
    void logEvent({
      level: 'warn', source: 'sync', event: 'sync.muscle_targets_adoption_failed',
      message: 'Could not adopt or upload the synced muscle targets; retrying next sync.',
      context: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
  }
};
