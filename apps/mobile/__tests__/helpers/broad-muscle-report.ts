import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { BROAD_MUSCLE_PRESET, buildMuscleReportAssignment, type MuscleReportRow } from '@/src/data/muscle-report-presets';

/**
 * The catalogue's rows after choosing Broad, with muscles switched off by id: a
 * Broad muscle's anchor switches all its entries off; any other id, that entry.
 * Broad itself leaves every entry tracked.
 */
export const broadMuscleRows = (switchedOff: readonly string[] = []): MuscleReportRow[] => {
  const groupOf = new Map(BROAD_MUSCLE_PRESET.muscles.flatMap(muscle => muscle.entries.map(entry => [entry, muscle.key] as const)));
  const offEntries = new Set(BROAD_MUSCLE_PRESET.muscles.filter(muscle => switchedOff.includes(muscle.anchor))
    .flatMap(muscle => muscle.entries));
  return SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) => ({
    id, displayName, familyName, sortOrder, reportGroup: groupOf.get(id) ?? null,
    tracked: switchedOff.includes(id) || offEntries.has(id) ? 0 : 1,
  }));
};

export const broadMuscleReport = (switchedOff: readonly string[] = []) =>
  buildMuscleReportAssignment(broadMuscleRows(switchedOff));

/** Writes Broad onto the local database's `muscle_groups` rows, as the Settings choice does. */
export const chooseBroadLocally = (
  client: { prepare(sql: string): { run(...params: unknown[]): unknown } }, switchedOff: readonly string[] = [],
): void => {
  const update = client.prepare('UPDATE muscle_groups SET report_group = ?, tracked = ? WHERE id = ?');
  for (const row of broadMuscleRows(switchedOff)) update.run(row.reportGroup, row.tracked, row.id);
};
