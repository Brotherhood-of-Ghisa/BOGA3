import type { MuscleReportAssignment, ReportedMuscle } from './muscle-analytics';

/** One muscle of the Broad preset: the anatomy entries it merges and where an editor writes to. */
export type BroadMuscle = {
  /** Stable key stored in `muscle_groups.report_group` on every member entry. */
  key: string;
  label: string;
  family: string;
  /** The entry an editor adds a mapping to for this muscle; it is also a member. */
  anchor: string;
  entries: readonly string[];
};

/**
 * The Broad preset ([[muscle.report-groups]]): 11 muscles over catalogue entry
 * ids, each in its family, and the entries Broad leaves untracked. Detailed is
 * every entry its own muscle and needs no table. Choosing a preset writes this
 * table onto the user's rows; custom muscles are never in it.
 */
export const BROAD_MUSCLE_PRESET: { muscles: readonly BroadMuscle[]; untracked: readonly string[] } = {
  muscles: [
    { key: 'chest', label: 'Chest', family: 'Chest', anchor: 'chest', entries: ['chest', 'serratus_anterior'] },
    { key: 'front_delts', label: 'Front Delts', family: 'Shoulders', anchor: 'delts_front', entries: ['delts_front'] },
    { key: 'lateral_delts', label: 'Lateral Delts', family: 'Shoulders', anchor: 'delts_lateral', entries: ['delts_lateral'] },
    { key: 'rear_delts', label: 'Rear Delts', family: 'Shoulders', anchor: 'delts_rear', entries: ['delts_rear'] },
    {
      key: 'back', label: 'Back', family: 'Back', anchor: 'back_lats',
      entries: ['back_lats', 'back_upper', 'traps_upper', 'traps_lower'],
    },
    { key: 'biceps', label: 'Biceps', family: 'Arms', anchor: 'biceps', entries: ['biceps', 'brachialis'] },
    { key: 'triceps', label: 'Triceps', family: 'Arms', anchor: 'triceps', entries: ['triceps'] },
    { key: 'core', label: 'Core', family: 'Core', anchor: 'abs_rectus', entries: ['abs_rectus', 'abs_obliques'] },
    { key: 'quads', label: 'Quads', family: 'Legs', anchor: 'quads', entries: ['quads', 'adductors', 'hip_flexors'] },
    {
      key: 'glutes_hams', label: 'Glutes & Hams', family: 'Legs', anchor: 'glutes_max',
      entries: ['glutes_max', 'hamstrings', 'hip_abductors'],
    },
    { key: 'calves', label: 'Calves', family: 'Lower Legs', anchor: 'calves', entries: ['calves', 'tibialis_anterior'] },
  ],
  untracked: ['rotator_cuff', 'forearms_grip', 'spinal_erectors'],
};

/** A user's `muscle_groups` row as the setup reads it: `tracked` is 0/1 locally, a boolean from the agent API. */
export type MuscleReportRow = ReportedMuscle & { reportGroup: string | null; tracked: number | boolean };

/**
 * Reads the user's rows into a `MuscleReportAssignment`. A row whose
 * `reportGroup` names the Broad muscle it is a member of reports under it: the
 * muscle takes the anchor entry's id (so a muscle keeps its id when the preset
 * flips and an editor writes to it directly), the preset's label and family, and
 * sorts where its anchor sorts, else its first member. Any other row, including
 * a custom muscle or a group key this build does not know, is its own muscle.
 */
export const buildMuscleReportAssignment = (rows: readonly MuscleReportRow[]): MuscleReportAssignment => {
  const broadByKey = new Map(BROAD_MUSCLE_PRESET.muscles.map((muscle) => [muscle.key, muscle]));
  const broadOf = (row: MuscleReportRow): BroadMuscle | undefined => {
    const broad = row.reportGroup === null ? undefined : broadByKey.get(row.reportGroup);
    return broad?.entries.includes(row.id) ? broad : undefined;
  };
  const sortOrderByKey = new Map<string, number>();
  for (const row of rows) {
    const broad = broadOf(row);
    if (!broad) continue;
    if (!sortOrderByKey.has(broad.key) || row.id === broad.anchor) sortOrderByKey.set(broad.key, row.sortOrder);
  }

  return new Map(rows.map((row) => {
    const broad = broadOf(row);
    const muscle: ReportedMuscle = broad
      ? {
        id: broad.anchor, displayName: broad.label, familyName: broad.family,
        sortOrder: sortOrderByKey.get(broad.key) ?? row.sortOrder,
      }
      : { id: row.id, displayName: row.displayName, familyName: row.familyName, sortOrder: row.sortOrder };
    return [row.id, { muscle, tracked: row.tracked === true || row.tracked === 1 }];
  }));
};
