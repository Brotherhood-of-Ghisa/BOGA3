// The catalogue's muscle rows as the user's muscle setup leaves them
// ([[muscle.report-groups]]): Detailed (every entry its own muscle) or Broad
// (its table written onto the entries, with `SWITCHED_OFF` also switched off by
// the user: a preset never writes `tracked`).
import type { ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { BROAD_MUSCLE_PRESET } from '@/src/data/muscle-report-presets';

const broadGroupOf = new Map(BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) =>
  muscle.entries.map((entry) => [entry, muscle.key] as const)));

/** Entries the Broad user in these tests has also switched off. */
const SWITCHED_OFF = ['rotator_cuff', 'forearms_grip', 'spinal_erectors'];

/** One entry's setup for a user who chose Broad and switched off `SWITCHED_OFF`. */
export const broadSetupOf = (entryId: string): Pick<ExerciseCatalogMuscleGroup, 'reportGroup' | 'tracked'> => ({
  reportGroup: broadGroupOf.get(entryId) ?? null,
  tracked: SWITCHED_OFF.includes(entryId) ? 0 : 1,
});

export const detailedMuscleRows = (): ExerciseCatalogMuscleGroup[] =>
  SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) =>
    ({ id, displayName, familyName, sortOrder, reportGroup: null, tracked: 1 }));

export const broadMuscleRows = (): ExerciseCatalogMuscleGroup[] =>
  detailedMuscleRows().map((row) => ({ ...row, ...broadSetupOf(row.id) }));
