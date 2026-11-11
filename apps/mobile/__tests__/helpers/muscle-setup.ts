// The catalogue's muscle rows as the user's muscle setup leaves them
// ([[muscle.report-groups]]): Detailed (every entry its own muscle) or Broad
// (the template's combined muscles, with `SWITCHED_OFF` also switched off by
// the user). Pass `BROAD_COMBINED_MUSCLES` as the stored definitions with
// Broad rows.
import type { ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { broadTemplateKeyOf } from '@/src/data/combined-muscles';

export { BROAD_COMBINED_MUSCLES } from '@/src/data/combined-muscles';

/** Entries the Broad user in these tests has also switched off. */
const SWITCHED_OFF = ['rotator_cuff', 'forearms_grip', 'spinal_erectors'];

/** One entry's setup for a user who chose Broad and switched off `SWITCHED_OFF`. */
export const broadSetupOf = (entryId: string): Pick<ExerciseCatalogMuscleGroup, 'reportGroup' | 'tracked'> => ({
  reportGroup: broadTemplateKeyOf(entryId),
  tracked: SWITCHED_OFF.includes(entryId) ? 0 : 1,
});

export const detailedMuscleRows = (): ExerciseCatalogMuscleGroup[] =>
  SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) =>
    ({ id, displayName, familyName, sortOrder, reportGroup: null, tracked: 1 }));

export const broadMuscleRows = (): ExerciseCatalogMuscleGroup[] =>
  detailedMuscleRows().map((row) => ({ ...row, ...broadSetupOf(row.id) }));
