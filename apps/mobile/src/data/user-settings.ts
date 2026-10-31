import { eq } from 'drizzle-orm';

import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { getPersonalMuscleCounting } from '@/src/config/personal-muscles';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { readLocalDataOwner } from './local-wipe';
import { userSettings } from './schema';

export const USER_SETTINGS_ID = 'settings';

export const readBodyweightCalculationsEnabled = async (): Promise<boolean> => {
  const db = await bootstrapLocalDataLayer();
  const row = db.select({ enabled: userSettings.bodyweightCalculationsEnabled })
    .from(userSettings)
    .where(eq(userSettings.id, USER_SETTINGS_ID))
    .get();
  return row?.enabled ?? false;
};

export const writeBodyweightCalculationsEnabled = async (enabled: boolean): Promise<void> => {
  const db = await bootstrapLocalDataLayer();
  const now = new Date();
  db.transaction(tx => {
    const existing = tx.select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.id, USER_SETTINGS_ID))
      .get();
    const common = {
      bodyweightCalculationsEnabled: enabled,
      deletedAt: null,
      updatedAt: now,
      localDirty: true,
      localUpdatedAtMs: nowMonotonic(tx as Transaction),
    };
    if (existing) {
      tx.update(userSettings).set(common).where(eq(userSettings.id, USER_SETTINGS_ID)).run();
    } else {
      // A fresh row must carry this profile's known Sets choice even if
      // adoption's direct read fails before push. Volume stays unknown.
      tx.insert(userSettings).values({ id: USER_SETTINGS_ID, ...common, createdAt: now,
        countSecondaryMuscles: getPersonalMuscleCounting().countSecondarySets }).run();
    }
  });
  notifyLocalWrite();
};

/**
 * The synced weekly muscle targets and muscle-counting choices as stored on the
 * settings row ([[muscle.weekly-targets]]). Null until this device uploads or
 * adopts them; the mode is the wire value (`single` | `per_muscle`) and the
 * overrides are JSON text. Readers validate every value. `src/preferences/synced.ts`
 * declares the same shape, since it may not import this layer.
 */
export type StoredMuscleTargetSettings = {
  weeklyWorkingSetTarget: number | null;
  muscleTargetMode: string | null;
  muscleTargetOverrides: string | null;
  countSecondaryMuscles: boolean | null;
  volumePrimaryOnly?: boolean | null;
};
export type MuscleTargetSettingsWrite = {
  [K in Exclude<keyof StoredMuscleTargetSettings, 'volumePrimaryOnly'>]-?: NonNullable<StoredMuscleTargetSettings[K]>
} & { volumePrimaryOnly: boolean | null };

export type MuscleTargetSettingsSnapshot = {
  values: StoredMuscleTargetSettings;
  localDirty: boolean;
  localUpdatedAtMs: number;
};

/**
 * Null when no row exists, or when the store belongs to another account than
 * `accountUserId` (a sign-in before the cycle's ownership wipe). A null
 * account (the local-only build) reads whatever the store holds.
 */
export const readMuscleTargetSettings = async (
  accountUserId: string | null,
): Promise<StoredMuscleTargetSettings | null> => (await readMuscleTargetSettingsSnapshot(accountUserId))?.values ?? null;

/** The same owned read with the LWW metadata needed to resolve adoption races. */
export const readMuscleTargetSettingsSnapshot = async (
  accountUserId: string | null,
): Promise<MuscleTargetSettingsSnapshot | null> => {
  const db = await bootstrapLocalDataLayer();
  const owner = readLocalDataOwner(db);
  if (accountUserId !== null && owner !== null && owner !== accountUserId) return null;
  const row = db.select({
    weeklyWorkingSetTarget: userSettings.weeklyWorkingSetTarget,
    muscleTargetMode: userSettings.muscleTargetMode,
    muscleTargetOverrides: userSettings.muscleTargetOverrides,
    countSecondaryMuscles: userSettings.countSecondaryMuscles,
    volumePrimaryOnly: userSettings.volumePrimaryOnly,
    localDirty: userSettings.localDirty,
    localUpdatedAtMs: userSettings.localUpdatedAtMs,
  })
    .from(userSettings)
    .where(eq(userSettings.id, USER_SETTINGS_ID))
    .get();
  if (!row) return null;
  const { localDirty, localUpdatedAtMs, ...values } = row;
  return { values, localDirty, localUpdatedAtMs };
};

/**
 * A device edit: the values are written together and pushed as one LWW
 * row. Unlike the read, neither write checks the store's owner: like every
 * local write, one landing before the cycle's ownership wipe goes with it.
 */
export const writeMuscleTargetSettings = async (values: MuscleTargetSettingsWrite): Promise<void> => {
  const db = await bootstrapLocalDataLayer();
  const now = new Date();
  db.transaction(tx => {
    const existing = tx.select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.id, USER_SETTINGS_ID))
      .get();
    const common = {
      ...values,
      deletedAt: null,
      updatedAt: now,
      localDirty: true,
      localUpdatedAtMs: nowMonotonic(tx as Transaction),
    };
    if (existing) {
      tx.update(userSettings).set(common).where(eq(userSettings.id, USER_SETTINGS_ID)).run();
    } else {
      tx.insert(userSettings).values({ id: USER_SETTINGS_ID, ...common, createdAt: now }).run();
    }
  });
  notifyLocalWrite();
};

/**
 * Copies the server's values onto the local row without dirtying it or moving
 * its LWW stamp: the server already holds them. False when there is no local
 * row to update.
 */
export const adoptMuscleTargetSettings = async (values: StoredMuscleTargetSettings): Promise<boolean> => {
  const db = await bootstrapLocalDataLayer();
  const result = db.update(userSettings).set(values).where(eq(userSettings.id, USER_SETTINGS_ID)).run();
  return result.changes > 0;
};
