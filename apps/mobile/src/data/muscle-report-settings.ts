import { asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic } from './clock';
import type { MuscleReportRow } from './muscle-report-presets';
import {
  presetRowSetup,
  type MuscleReportPreset,
  type RowSetup,
} from './muscle-report-setup';
import { muscleGroups } from './schema';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

export {
  buildSettingsMuscleSections,
  deriveMuscleReportPreset,
  presetRowSetup,
  type MuscleReportPreset,
  type SettingsMuscle,
  type SettingsMuscleSection,
} from './muscle-report-setup';

const selectRows = (database: Pick<LocalDatabase, 'select'>): MuscleReportRow[] =>
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

/** The user's live anatomy entries with their setup columns. */
export const listMuscleReportRows = async (): Promise<MuscleReportRow[]> =>
  selectRows(await bootstrapLocalDataLayer());

/** Writes `setup(id)` onto every live row it changes; unchanged rows stay clean. */
const writeRowSetups = async (setup: (row: MuscleReportRow) => RowSetup | null): Promise<void> => {
  const database = await bootstrapLocalDataLayer();
  const now = new Date();
  const changed = database.transaction((tx) => {
    let count = 0;
    for (const row of selectRows(tx)) {
      const next = setup(row);
      if (!next) continue;
      const changes = (next.reportGroup !== undefined && next.reportGroup !== row.reportGroup)
        || (next.tracked !== undefined && next.tracked !== row.tracked);
      if (!changes) continue;
      tx.update(muscleGroups)
        .set({ ...next, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx) })
        .where(eq(muscleGroups.id, row.id))
        .run();
      count += 1;
    }
    return count;
  });
  if (changed === 0) return;
  // Post-commit: the rows were dirtied above; one nudge pushes the batch soon.
  notifyLocalWrite();
  invalidateExerciseCatalogCache();
};

/** Choosing a preset writes its merge table onto every row's `reportGroup`; tracking and custom muscles stay as they are. */
export const setMuscleReportPreset = (preset: MuscleReportPreset): Promise<void> =>
  writeRowSetups((row) => presetRowSetup(preset, row.id));

/** A muscle's Track switch: every entry it covers takes the same value. */
export const setMuscleTracked = (entryIds: readonly string[], tracked: boolean): Promise<void> =>
  writeRowSetups((row) => (entryIds.includes(row.id) ? { tracked: tracked ? 1 : 0 } : null));
