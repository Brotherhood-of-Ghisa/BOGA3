// One-time move of a device's weekly muscle targets and counting choices
// from its kv store to the synced settings row ([[muscle.weekly-targets]]).
//
// The sync cycle runs this after its first pull leg, once per account on this
// device. It asks the server for the row's values directly: a row an older app
// pulled reached this device without the columns, so the local row cannot tell
// "never uploaded" from "uploaded before this device upgraded".
//
//   - Complete server settings win over a clean stale copy; a newer dirty
//     local edit wins the normal whole-row LWW comparison.
//   - Missing values are initialized from the device's choices/defaults after
//     bootstrap, then uploaded. KV copies are dropped only after all fields
//     are held locally. Already-adopted accounts repeat this once for Volume.
//
// A failed server read leaves everything as it was; the next cycle retries.
import { Storage } from 'expo-sqlite/kv-store';

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import {
  adoptMuscleTargetSettings,
  readMuscleTargetSettingsSnapshot,
  writeMuscleTargetSettings,
  type StoredMuscleTargetSettings,
} from '@/src/data/user-settings';
import { logEvent } from '@/src/logging/logEvent';
import { drainAccountLocalSyncedWrites, refreshAccountLocalSyncedPreferences } from '@/src/preferences/account-local';
import { hasLegacyMuscleCountingProfile, preferenceKey, readScopedPreferences } from '@/src/preferences/storage';
import {
  pickSyncedPreferences,
  storedFromSyncedPreferences,
  syncedPreferencesFromStored,
  syncedPreferenceFields,
  syncedTargetsAdoptedKey,
  syncedMuscleVolumeAdoptedKey,
  hasLegacyImplicitSecondarySets,
} from '@/src/preferences/synced';

type ServerSettingsRow = {
  weekly_working_set_target: number | null;
  muscle_target_mode: string | null;
  muscle_target_overrides: unknown;
  count_secondary_muscles: boolean | null;
  volume_primary_only?: boolean | null;
  client_updated_at_ms?: number;
};

type ServerSettingsSnapshot = { values: StoredMuscleTargetSettings; revision: number };

const hasCompleteSettings = (stored: StoredMuscleTargetSettings | null): boolean =>
  Object.keys(syncedPreferencesFromStored(stored)).length === syncedPreferenceFields.length;

const fromServerRow = (row: ServerSettingsRow | null): ServerSettingsSnapshot | null => row && ({ values: {
  weeklyWorkingSetTarget: row.weekly_working_set_target,
  muscleTargetMode: row.muscle_target_mode,
  muscleTargetOverrides: row.muscle_target_overrides === null || row.muscle_target_overrides === undefined
    ? null : JSON.stringify(row.muscle_target_overrides),
  countSecondaryMuscles: row.count_secondary_muscles,
  volumePrimaryOnly: row.volume_primary_only ?? null,
}, revision: Number(row.client_updated_at_ms ?? 0) });

/** The server's values for `userId`, or undefined when they cannot be read as that account. */
const readServerSettings = async (userId: string): Promise<ServerSettingsSnapshot | null | undefined> => {
  const client = getRequiredSupabaseMobileClient();
  const session = (await client.auth.getSession()).data.session;
  if (session?.user.id !== userId) return undefined;
  const { data, error } = await client.schema('app_public').from('user_settings')
    .select('weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,volume_primary_only,client_updated_at_ms')
    .eq('id', 'settings')
    .maybeSingle()
    .setHeader('Authorization', 'Bearer ' + session.access_token);
  if (error) throw new Error(error.message);
  return fromServerRow(data as ServerSettingsRow | null);
};

const dropKvCopy = (profile: `account:${string}`): void => {
  for (const field of syncedPreferenceFields) Storage.removeItemSync(preferenceKey(profile, field));
  Storage.setItemSync(syncedTargetsAdoptedKey(profile), 'true');
  Storage.setItemSync(syncedMuscleVolumeAdoptedKey(profile), 'true');
};

/** Returns false when the local row is missing, so the next cycle tries again. */
const adoptOrUpload = async (profile: `account:${string}`, userId: string,
  server: ServerSettingsSnapshot | null): Promise<boolean> => {
  await drainAccountLocalSyncedWrites();
  const snapshot = await readMuscleTargetSettingsSnapshot(userId);
  const local = snapshot?.values ?? null;
  const remote = server?.values ?? null;
  // A direct read can advance beyond the pull. Only a newer genuine local edit
  // may override it; a clean stale copy must not be re-stamped over another device.
  const localWins = snapshot?.localDirty === true && snapshot.localUpdatedAtMs > (server?.revision ?? 0);
  if (localWins && hasCompleteSettings(local)) return true;
  if (!localWins && remote && hasCompleteSettings(remote)) return adoptMuscleTargetSettings(remote);
  // Completing preferences writes the whole row with a new clock. Wait for
  // ordinary pull to catch the rest of a newer row (such as bodyweight) first.
  if (!localWins && server && (!snapshot || server.revision > snapshot.localUpdatedAtMs)) return false;
  const base = pickSyncedPreferences(readScopedPreferences(profile).values);
  if (hasLegacyImplicitSecondarySets(remote) && !hasLegacyMuscleCountingProfile(profile)) base.progressCountSecondary = true;
  const first = syncedPreferencesFromStored(localWins ? remote : local);
  const last = syncedPreferencesFromStored(localWins ? local : remote);
  const complete = storedFromSyncedPreferences({
    ...base, ...first, ...last,
  });
  await writeMuscleTargetSettings(complete);
  return true;
};

const adoptOrUploadOnce = async (userId: string): Promise<void> => {
  const profile = `account:${userId}` as const;
  if (Storage.getItemSync(syncedTargetsAdoptedKey(profile)) === 'true'
    && Storage.getItemSync(syncedMuscleVolumeAdoptedKey(profile)) === 'true') return;
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
