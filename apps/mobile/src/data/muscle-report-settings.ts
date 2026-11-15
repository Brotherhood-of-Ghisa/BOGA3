// The user's muscle setup in the local database ([[muscle.report-groups]]):
// reads it resolved, and writes every change as the rows and definitions it
// produces. The first write on a legacy account also stores its Broad keys as
// combined muscles and its weekly targets as one map (the one-time migration).
import { asc, eq, isNull } from 'drizzle-orm';

import { getPersonalMuscleCounting } from '@/src/config/personal-muscles';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic } from './clock';
import {
  COMBINED_MUSCLE_KEY_PREFIX,
  isTrackedRow,
  legacyMuscleTargets,
  parseStoredCombinedMuscles,
  resolveCombinedMuscleSetup,
  type CombinedMuscle,
  type MuscleReportRow,
} from './combined-muscles';
import {
  CombinedMuscleError,
  applyBroadTemplate as applyBroadTemplateTo,
  clearCombinedMuscles as clearCombinedMusclesOf,
  deleteCombinedMuscle as deleteCombinedMuscleOf,
  renameCombinedMuscle as renameCombinedMuscleOf,
  saveCombinedMuscle as saveCombinedMuscleTo,
  setMuscleState as setMuscleStateOf,
  setMuscleTracked as setMuscleTrackedOf,
  type CombinedMuscleDraft,
  type MuscleSetupChange,
  type MuscleState,
} from './muscle-report-setup';
import { muscleGroups, userSettings } from './schema';
import { USER_SETTINGS_ID } from './user-settings';

export {
  buildSettingsMuscleSections,
  CombinedMuscleError,
  type CombinedMuscleDraft,
  type MuscleSetupChange,
  type MuscleState,
  type SettingsMuscle,
  type SettingsMuscleSection,
} from './muscle-report-setup';

type Reader = Pick<LocalDatabase, 'select'>;
type Tx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0];

const selectRows = (database: Reader): MuscleReportRow[] =>
  database
    .select({
      id: muscleGroups.id,
      displayName: muscleGroups.displayName,
      familyName: muscleGroups.familyName,
      sortOrder: muscleGroups.sortOrder,
      reportGroup: muscleGroups.reportGroup,
      tracked: muscleGroups.tracked,
    })
    .from(muscleGroups)
    .where(isNull(muscleGroups.deletedAt))
    .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
    .all();

const selectSetupSettings = (database: Reader) =>
  database.select({
    combinedMuscles: userSettings.combinedMuscles,
    muscleTargets: userSettings.muscleTargets,
    muscleTargetOverrides: userSettings.muscleTargetOverrides,
  })
    .from(userSettings)
    .where(eq(userSettings.id, USER_SETTINGS_ID))
    .get();

/** The settings row's stored definitions; null when none are stored (the legacy reading applies). */
export const selectStoredCombinedMuscles = (database: Reader): CombinedMuscle[] | null =>
  parseStoredCombinedMuscles(selectSetupSettings(database)?.combinedMuscles ?? null);

/** The stored combined-muscle definitions, null when none are stored. */
export const readCombinedMuscleDefinitions = async (): Promise<CombinedMuscle[] | null> =>
  selectStoredCombinedMuscles(await bootstrapLocalDataLayer());

/** The user's live anatomy entries with their setup columns, as stored. */
export const listMuscleReportRows = async (): Promise<MuscleReportRow[]> =>
  selectRows(await bootstrapLocalDataLayer());

/** The setup every screen shows: the definitions in effect and each row's normalised membership. */
export const readMuscleSetup = async (): Promise<MuscleSetupChange> => {
  const database = await bootstrapLocalDataLayer();
  const { definitions, rows } = resolveCombinedMuscleSetup(selectRows(database), selectStoredCombinedMuscles(database));
  return { definitions, rows };
};

/** True when a row already holds a combined key: the account was migrated, on this device or another. */
const hasCombinedKeys = (rows: readonly MuscleReportRow[]): boolean =>
  rows.some((row) => row.reportGroup?.startsWith(COMBINED_MUSCLE_KEY_PREFIX) === true);

const writeSettingsColumns = (
  tx: Tx, columns: { combinedMuscles: string; muscleTargets?: string }, now: Date,
): void => {
  const common = {
    ...columns, deletedAt: null, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx),
  };
  const existing = tx.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, USER_SETTINGS_ID)).get();
  if (existing) {
    tx.update(userSettings).set(common).where(eq(userSettings.id, USER_SETTINGS_ID)).run();
  } else {
    // As `writeBodyweightCalculationsEnabled`: a fresh row carries the profile's Sets choice.
    tx.insert(userSettings).values({ id: USER_SETTINGS_ID, ...common, createdAt: now,
      countSecondaryMuscles: getPersonalMuscleCounting().countSecondarySets }).run();
  }
};

/**
 * Writes `change(setup)`: every row whose membership or tracking differs from
 * what is stored (legacy Broad keys included), and the definitions when they
 * differ. When the definitions are first stored, a legacy per-setup target
 * map moves into the single map in the same transaction. Returns the number of
 * rows written, settings row included.
 */
const writeSetupChange = (tx: Tx, change: (setup: MuscleSetupChange) => MuscleSetupChange, now: Date): number => {
  const stored = selectRows(tx);
  const settings = selectSetupSettings(tx);
  const storedDefinitions = parseStoredCombinedMuscles(settings?.combinedMuscles ?? null);
  if (storedDefinitions === null && hasCombinedKeys(stored)) {
    // Another device migrated this account; its definitions have not arrived yet.
    throw new CombinedMuscleError('Your muscle setup is still syncing. Try again in a moment.');
  }
  const next = change(resolveCombinedMuscleSetup(stored, storedDefinitions));
  const storedById = new Map(stored.map((row) => [row.id, row]));
  let count = 0;
  for (const row of next.rows) {
    const before = storedById.get(row.id);
    const tracked = isTrackedRow(row) ? 1 : 0;
    if (!before || (before.reportGroup === row.reportGroup && Number(before.tracked) === tracked)) continue;
    tx.update(muscleGroups)
      .set({ reportGroup: row.reportGroup, tracked, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx) })
      .where(eq(muscleGroups.id, row.id))
      .run();
    count += 1;
  }
  const combinedMuscles = JSON.stringify(next.definitions);
  // Compared parsed: a pulled row holds the server's jsonb text, spaced differently.
  if (storedDefinitions === null || JSON.stringify(storedDefinitions) !== combinedMuscles) {
    const legacyTargets = settings?.muscleTargets == null ? settings?.muscleTargetOverrides ?? null : null;
    writeSettingsColumns(tx, {
      combinedMuscles,
      ...(legacyTargets === null
        ? {}
        : { muscleTargets: JSON.stringify(legacyMuscleTargets(legacyTargets, stored, storedDefinitions)) }),
    }, now);
    count += 1;
  }
  return count;
};

const applySetupChange = async (change: (setup: MuscleSetupChange) => MuscleSetupChange): Promise<number> => {
  const database = await bootstrapLocalDataLayer();
  const now = new Date();
  const changed = database.transaction((tx) => writeSetupChange(tx, change, now));
  if (changed > 0) {
    // Post-commit: the rows were dirtied above; one nudge pushes the batch soon.
    notifyLocalWrite();
    invalidateExerciseCatalogCache();
  }
  return changed;
};

/**
 * The one-time migration, which sync runs after a drained pull: an account
 * with no stored definitions but legacy Broad keys or legacy weekly targets
 * stores them now. True when it wrote, so the caller re-reads preferences.
 */
export const migrateLegacyMuscleSetup = async (): Promise<boolean> => {
  const database = await bootstrapLocalDataLayer();
  const settings = selectSetupSettings(database);
  if (settings?.combinedMuscles != null) return false;
  const rows = selectRows(database);
  // Combined keys with no definitions: another device migrated, and the pull has not brought its row yet.
  if (hasCombinedKeys(rows)) return false;
  if (!rows.some((row) => row.reportGroup !== null) && settings?.muscleTargetOverrides == null) return false;
  return (await applySetupChange((setup) => setup)) > 0;
};

/**
 * A legacy per-setup target map (as an older build kept it in kv) read as
 * the single map for the setup this device's rows spell out.
 */
export const legacyTargetsForLocalSetup = async (legacyOverrides: unknown): Promise<Record<string, number>> => {
  const database = await bootstrapLocalDataLayer();
  return legacyMuscleTargets(legacyOverrides, selectRows(database), selectStoredCombinedMuscles(database));
};

/** True while this device holds combined keys whose definitions have not been pulled yet. */
export const awaitsCombinedMuscleDefinitions = async (): Promise<boolean> => {
  const database = await bootstrapLocalDataLayer();
  return selectSetupSettings(database)?.combinedMuscles == null && hasCombinedKeys(selectRows(database));
};

/** A new combined-muscle key: the prefix and random hex, never an entry id. */
export const newCombinedMuscleKey = (): string =>
  `${COMBINED_MUSCLE_KEY_PREFIX}${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

/** Sets the listed entries Off, On on their own, or into one combined muscle of their family. */
export const setMuscleState = async (entryIds: readonly string[], state: MuscleState): Promise<void> => {
  await applySetupChange((setup) => setMuscleStateOf(setup, entryIds, state));
};

/** Off / On for the listed entries: tracking only, membership stays. */
export const setMuscleTracked = async (entryIds: readonly string[], tracked: boolean): Promise<void> => {
  await applySetupChange((setup) => setMuscleTrackedOf(setup, entryIds, tracked));
};

/** Creates a combined muscle in `family` with `memberIds`, returning its key. */
export const createCombinedMuscle = async (
  draft: Omit<CombinedMuscleDraft, 'key'> & { family: string },
): Promise<string> => {
  const key = newCombinedMuscleKey();
  await applySetupChange((setup) => saveCombinedMuscleTo(setup, { ...draft, key }));
  return key;
};

/** Saves an existing combined muscle's name and exact members. */
export const updateCombinedMuscle = async (draft: Omit<CombinedMuscleDraft, 'family'>): Promise<void> => {
  await applySetupChange((setup) => saveCombinedMuscleTo(setup, draft));
};

export const renameCombinedMuscle = async (key: string, name: string): Promise<void> => {
  await applySetupChange((setup) => renameCombinedMuscleOf(setup, key, name));
};

/** Deletes a combined muscle; its members become their own muscles. */
export const deleteCombinedMuscle = async (key: string): Promise<void> => {
  await applySetupChange((setup) => deleteCombinedMuscleOf(setup, key));
};

/** "Start from Broad": replaces every combined muscle with the Broad template's. */
export const applyBroadTemplate = async (): Promise<void> => {
  await applySetupChange(applyBroadTemplateTo);
};

/** Removes every combined muscle (the Detailed setup). */
export const clearCombinedMuscles = async (): Promise<void> => {
  await applySetupChange(clearCombinedMusclesOf);
};
