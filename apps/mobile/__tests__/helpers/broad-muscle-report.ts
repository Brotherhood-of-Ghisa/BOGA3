import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { buildMuscleSetup } from '@/src/exercise-catalog/muscle-setup';
import {
  BROAD_COMBINED_MUSCLES, broadCombinedMuscleKey, broadTemplateKeyOf, buildMuscleReportAssignment, type MuscleReportRow,
} from '@/src/data/combined-muscles';
import { BROAD_MUSCLE_PRESET } from '@/src/data/muscle-report-presets';

/** A Broad template muscle's reported id (its combined key), by the template muscle's key, e.g. `back`. */
export const broadId = (broadKey: string): string => broadCombinedMuscleKey(broadKey);

/**
 * The catalogue's rows after "Start from Broad", with muscles switched off by
 * id: a Broad muscle's anchor switches all its entries off; any other id, that
 * entry. `entriesOff` switches single entries off, anchors included. Broad
 * itself leaves every entry tracked.
 */
export const broadMuscleRows = (switchedOff: readonly string[] = [], entriesOff: readonly string[] = []): MuscleReportRow[] => {
  const offEntries = new Set(BROAD_MUSCLE_PRESET.muscles.filter(muscle => switchedOff.includes(muscle.anchor))
    .flatMap(muscle => muscle.entries));
  return SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) => ({
    id, displayName, familyName, sortOrder, reportGroup: broadTemplateKeyOf(id),
    tracked: switchedOff.includes(id) || entriesOff.includes(id) || offEntries.has(id) ? 0 : 1,
  }));
};

export const broadMuscleReport = (switchedOff: readonly string[] = []) =>
  buildMuscleReportAssignment(broadMuscleRows(switchedOff), BROAD_COMBINED_MUSCLES);

/** Writes Broad onto the local database's rows and settings, as "Start from Broad" does. */
export const chooseBroadLocally = (
  client: { prepare(sql: string): { run(...params: unknown[]): unknown } }, switchedOff: readonly string[] = [],
  entriesOff: readonly string[] = [],
): void => {
  const update = client.prepare('UPDATE muscle_groups SET report_group = ?, tracked = ? WHERE id = ?');
  for (const row of broadMuscleRows(switchedOff, entriesOff)) update.run(row.reportGroup, row.tracked, row.id);
  client.prepare(`INSERT INTO user_settings (id, combined_muscles) VALUES ('settings', ?)
    ON CONFLICT(id) DO UPDATE SET combined_muscles = excluded.combined_muscles`).run(JSON.stringify(BROAD_COMBINED_MUSCLES));
};

export const broadMuscleSetup = (switchedOff: readonly string[] = [], entriesOff: readonly string[] = []) =>
  buildMuscleSetup(broadMuscleRows(switchedOff, entriesOff), BROAD_COMBINED_MUSCLES);
