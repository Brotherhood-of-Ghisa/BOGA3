/** One muscle of the Broad template: the anatomy entries it merges. */
export type BroadMuscle = {
  /** The legacy `muscle_groups.report_group` key; its combined key is `cm_<key>`. */
  key: string;
  label: string;
  family: string;
  /** The entry legacy weekly targets were keyed by for this muscle; it is also a member. */
  anchor: string;
  entries: readonly string[];
};

/**
 * The Broad template ([[muscle.report-groups]]): 11 muscles over catalogue
 * entry ids, each in its family. It seeds "Start from Broad" and reads the
 * Broad keys accounts stored before combined muscles (`combined-muscles.ts`);
 * entries in no muscle (Rotator Cuff, Forearms, Spinal Erectors, custom
 * muscles) stay their own.
 */
export const BROAD_MUSCLE_PRESET: { muscles: readonly BroadMuscle[] } = {
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
};
