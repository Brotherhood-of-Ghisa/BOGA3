import { asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic } from './clock';
import { BROAD_MUSCLE_PRESET, buildMuscleReportAssignment, type MuscleReportRow } from './muscle-report-presets';
import { muscleGroups } from './schema';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

export type MuscleReportPreset = 'detailed' | 'broad';

/** One muscle the settings screen lists: the entries it covers and whether any still counts. */
export type SettingsMuscle = { id: string; label: string; family: string; entryIds: string[]; tracked: boolean };

/** Muscles of one family; the header shows only above two or more ([[muscle.family-sections]]). */
export type SettingsMuscleSection = { family: string; showHeader: boolean; muscles: SettingsMuscle[] };

type RowSetup = { reportGroup: string | null; tracked: number };

const broadGroupOf = (): Map<string, string> =>
  new Map(BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries.map((entry) => [entry, muscle.key] as const)));

/** What choosing `preset` writes onto the entry `id`: Detailed clears both columns, Broad writes its table. */
export const presetRowSetup = (preset: MuscleReportPreset, id: string): RowSetup =>
  preset === 'detailed'
    ? { reportGroup: null, tracked: 1 }
    : {
      reportGroup: broadGroupOf().get(id) ?? null,
      tracked: BROAD_MUSCLE_PRESET.untracked.includes(id) ? 0 : 1,
    };

/**
 * The preset the rows' `reportGroup` columns spell out, else `custom` (another
 * device or an agent wrote something neither preset produces). Track switches
 * never change it: a preset is how entries merge, not what is switched off.
 */
export const deriveMuscleReportPreset = (rows: readonly MuscleReportRow[]): MuscleReportPreset | 'custom' => {
  if (rows.every((row) => row.reportGroup === null)) return 'detailed';
  const groupOf = broadGroupOf();
  return rows.every((row) => row.reportGroup === (groupOf.get(row.id) ?? null)) ? 'broad' : 'custom';
};

/** The user's muscles in display order, in their family sections. */
export const buildSettingsMuscleSections = (rows: readonly MuscleReportRow[]): SettingsMuscleSection[] => {
  const assignment = buildMuscleReportAssignment(rows);
  const muscles = new Map<string, SettingsMuscle & { sortOrder: number }>();
  for (const row of rows) {
    const assigned = assignment.get(row.id);
    if (!assigned) continue;
    const { muscle, tracked } = assigned;
    const existing = muscles.get(muscle.id);
    if (existing) {
      existing.entryIds.push(row.id);
      existing.tracked ||= tracked;
    } else {
      muscles.set(muscle.id, {
        id: muscle.id, label: muscle.displayName, family: muscle.familyName,
        sortOrder: muscle.sortOrder, entryIds: [row.id], tracked,
      });
    }
  }
  const sections = new Map<string, SettingsMuscle[]>();
  const ordered = [...muscles.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  for (const { sortOrder: _sortOrder, ...muscle } of ordered) {
    sections.set(muscle.family, [...(sections.get(muscle.family) ?? []), muscle]);
  }
  return [...sections].map(([family, members]) => ({ family, showHeader: members.length >= 2, muscles: members }));
};

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
      if (!next || (next.reportGroup === row.reportGroup && next.tracked === row.tracked)) continue;
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

/** Choosing a preset writes its table onto every row; custom muscles stay their own. */
export const setMuscleReportPreset = (preset: MuscleReportPreset): Promise<void> =>
  writeRowSetups((row) => presetRowSetup(preset, row.id));

/** A muscle's Track switch: every entry it covers takes the same value. */
export const setMuscleTracked = (entryIds: readonly string[], tracked: boolean): Promise<void> =>
  writeRowSetups((row) => (entryIds.includes(row.id) ? { reportGroup: row.reportGroup, tracked: tracked ? 1 : 0 } : null));
