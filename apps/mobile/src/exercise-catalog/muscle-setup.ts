// The muscles a user sees ([[muscle.report-groups]], [[muscle.no-breakdown]]):
// the catalogue's anatomy entries read through the user's muscle setup, for
// the screens that list, search or edit an exercise's muscles.
import type { MuscleReportAssignment, ReportedMuscle } from '@/src/data/muscle-analytics';
import { buildMuscleReportAssignment, type MuscleReportRow } from '@/src/data/muscle-report-presets';

export type MuscleSetup = {
  /** Entry id → the muscle it reports under and whether it is tracked. */
  assignment: MuscleReportAssignment;
  /** The user's tracked muscles, by sort order then name. */
  muscles: ReportedMuscle[];
  musclesById: Record<string, ReportedMuscle>;
};

export const EMPTY_MUSCLE_SETUP: MuscleSetup = { assignment: new Map(), muscles: [], musclesById: {} };

const bySortOrderThenName = (left: ReportedMuscle, right: ReportedMuscle): number =>
  left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName);

/** Reads the user's entry rows into the muscles every editor and search shows. */
export const buildMuscleSetup = (entries: readonly MuscleReportRow[]): MuscleSetup => {
  const assignment = buildMuscleReportAssignment(entries);
  const musclesById: Record<string, ReportedMuscle> = {};
  for (const { muscle, tracked } of assignment.values()) {
    if (tracked && !musclesById[muscle.id]) musclesById[muscle.id] = muscle;
  }
  return { assignment, muscles: Object.values(musclesById).sort(bySortOrderThenName), musclesById };
};

/** True when the user does not track this entry, so its mappings are hidden ([[muscle.untracked]]). */
export const isUntrackedEntry = (assignment: MuscleReportAssignment, entryId: string): boolean =>
  assignment.get(entryId)?.tracked === false;

/** The muscle an entry reports under: its assigned muscle's id, else the entry itself. */
export const muscleIdOfEntry = (assignment: MuscleReportAssignment, entryId: string): string =>
  assignment.get(entryId)?.muscle.id ?? entryId;

/**
 * An exercise's mappings re-keyed from anatomy entry to the user's muscle,
 * without mappings to untracked entries. A muscle can appear more than once;
 * readers that count it once take its strongest role.
 */
export const reportedMappings = <M extends { muscleGroupId: string }>(
  mappings: readonly M[], assignment: MuscleReportAssignment,
): M[] => mappings.flatMap((mapping) => {
  if (isUntrackedEntry(assignment, mapping.muscleGroupId)) return [];
  const muscleGroupId = muscleIdOfEntry(assignment, mapping.muscleGroupId);
  return [muscleGroupId === mapping.muscleGroupId ? mapping : { ...mapping, muscleGroupId }];
});
