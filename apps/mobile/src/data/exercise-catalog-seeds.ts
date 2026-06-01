import { asc, eq, inArray } from 'drizzle-orm';

import { nowMonotonic } from './clock';
import { exerciseDefinitions, exerciseMuscleMappings, muscleGroups, syncRuntimeState } from './schema';
import type { LocalDatabase } from './bootstrap';

const SEED_RUNTIME_STATE_ID = 'primary';

/**
 * Catalog seed bundle version. Bumped whenever the canonical seed bundle in
 * this file changes (e.g. a new system exercise is added). Persisted on
 * `sync_runtime_state.applied_seed_migration_app_version` so subsequent
 * launches can detect "this device has not seen the current catalog version"
 * and re-seed. A value of `0` on that column means "never seeded".
 *
 * The column starts at a placeholder value of `1`; a follow-up may evolve the
 * semantics (e.g. derive from `app.json` version).
 */
export const SEED_CATALOG_BUNDLE_VERSION = 1;

export type MuscleGroupSeed = {
  id: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
  isEditable: 0;
};

export type SystemExerciseDefinitionSeed = {
  id: string;
  name: string;
};

// M6 seeds intentionally avoid stabilizer tagging to reduce false precision.
export type ExerciseMuscleRole = 'primary' | 'secondary';

export type SystemExerciseMuscleMappingSeed = {
  id: string;
  exerciseDefinitionId: string;
  muscleGroupId: string;
  weight: number;
  role: ExerciseMuscleRole;
};

type SystemExerciseMuscleMappingSeedInput = Omit<SystemExerciseMuscleMappingSeed, 'id'>;

export type SeedSourceReference = {
  id: string;
  title: string;
  url: string;
  type: 'study' | 'reference';
  note: string;
};

export type SeedExerciseDocumentation = {
  exerciseDefinitionId: string;
  sourceReferenceIds: string[];
  rationale: string;
};

export type GranularWeightRationale = {
  exerciseDefinitionId: string;
  muscleGroupId: string;
  weight: number;
  sourceReferenceIds: string[];
  rationale: string;
};

export type SystemExerciseCatalogSeedBundle = {
  muscleGroups: MuscleGroupSeed[];
  exerciseDefinitions: SystemExerciseDefinitionSeed[];
  mappings: SystemExerciseMuscleMappingSeed[];
  sourceReferences: SeedSourceReference[];
  exerciseDocumentation: SeedExerciseDocumentation[];
  granularWeightRationales: GranularWeightRationale[];
};

export const M6_SYSTEM_EXERCISE_SEED_POLICY_NOTE =
  'Mappings are practical logging defaults, not exhaustive anatomy claims. Use obvious prime movers and key synergists with simple non-normalized weights (1.0 / 0.5) only.';

export type SystemExerciseCatalogSeedValidationIssue = {
  code:
  | 'duplicate_muscle_group_id'
  | 'duplicate_exercise_definition_id'
  | 'duplicate_exercise_definition_name'
  | 'duplicate_mapping_pair'
  | 'invalid_mapping_weight'
  | 'invalid_mapping_role'
  | 'unknown_mapping_muscle_group_id'
  | 'unknown_mapping_exercise_definition_id'
  | 'exercise_missing_mapping'
  | 'invalid_muscle_group_is_editable'
  | 'invalid_muscle_group_sort_order'
  | 'duplicate_source_reference_id'
  | 'invalid_source_reference_url'
  | 'duplicate_exercise_documentation'
  | 'missing_exercise_documentation'
  | 'unknown_exercise_documentation_source'
  | 'undocumented_granular_weight'
  | 'duplicate_granular_weight_rationale'
  | 'unknown_granular_weight_rationale_source';
  message: string;
};

const DEFAULT_WEIGHTS = new Set([1, 0.5]);

const createMappingId = (exerciseDefinitionId: string, muscleGroupId: string) =>
  `m6_map__${exerciseDefinitionId}__${muscleGroupId}`;

const createMappingPairKey = (exerciseDefinitionId: string, muscleGroupId: string) =>
  `${exerciseDefinitionId}::${muscleGroupId}`;

const createGranularWeightKey = (exerciseDefinitionId: string, muscleGroupId: string, weight: number) =>
  `${exerciseDefinitionId}::${muscleGroupId}::${weight}`;

export const SYSTEM_MUSCLE_GROUP_SEEDS: MuscleGroupSeed[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0, isEditable: 0 },
  { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 1, isEditable: 0 },
  { id: 'delts_lateral', displayName: 'Lateral Delts', familyName: 'Shoulders', sortOrder: 2, isEditable: 0 },
  { id: 'delts_rear', displayName: 'Rear Delts', familyName: 'Shoulders', sortOrder: 3, isEditable: 0 },
  { id: 'back_lats', displayName: 'Lats', familyName: 'Back', sortOrder: 4, isEditable: 0 },
  { id: 'back_upper', displayName: 'Upper Back (Rhomboids + Mid Traps)', familyName: 'Back', sortOrder: 5, isEditable: 0,  },
  { id: 'traps_upper', displayName: 'Upper Traps', familyName: 'Back', sortOrder: 6, isEditable: 0 },
  { id: 'spinal_erectors', displayName: 'Spinal Erectors', familyName: 'Back', sortOrder: 7, isEditable: 0 },
  { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 8, isEditable: 0 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 9, isEditable: 0 },
  { id: 'forearms_grip', displayName: 'Forearms / Grip', familyName: 'Arms', sortOrder: 10, isEditable: 0 },
  { id: 'abs_rectus', displayName: 'Abs (Rectus Abdominis)', familyName: 'Core', sortOrder: 11, isEditable: 0 },
  { id: 'abs_obliques', displayName: 'Obliques', familyName: 'Core', sortOrder: 12, isEditable: 0 },
  { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 13, isEditable: 0 },
  { id: 'hamstrings', displayName: 'Hamstrings', familyName: 'Legs', sortOrder: 14, isEditable: 0 },
  { id: 'glutes_max', displayName: 'Glute Max', familyName: 'Legs', sortOrder: 15, isEditable: 0 },
  { id: 'hip_abductors', displayName: 'Hip Abductors (Glute Med/Min)', familyName: 'Legs', sortOrder: 16, isEditable: 0 },
  { id: 'adductors', displayName: 'Adductors', familyName: 'Legs', sortOrder: 17, isEditable: 0 },
  { id: 'calves', displayName: 'Calves', familyName: 'Lower Legs', sortOrder: 18, isEditable: 0 },
];

export const SYSTEM_EXERCISE_DEFINITION_SEEDS: SystemExerciseDefinitionSeed[] = [
  { id: 'sys_barbell_bench_press', name: 'Barbell Bench Press' },
  { id: 'sys_incline_dumbbell_press', name: 'Incline Dumbbell Press' },
  { id: 'sys_seated_dumbbell_overhead_press', name: 'Seated Dumbbell Overhead Press' },
  { id: 'sys_dumbbell_lateral_raise', name: 'Dumbbell Lateral Raise' },
  { id: 'sys_lat_pulldown', name: 'Lat Pulldown' },
  { id: 'sys_seated_cable_row', name: 'Seated Cable Row' },
  { id: 'sys_barbell_back_squat', name: 'Barbell Back Squat' },
  { id: 'sys_romanian_deadlift', name: 'Romanian Deadlift' },
  { id: 'sys_leg_extension', name: 'Leg Extension' },
  { id: 'sys_seated_leg_curl', name: 'Seated Leg Curl' },
  { id: 'sys_barbell_hip_thrust', name: 'Barbell Hip Thrust' },
  { id: 'sys_standing_calf_raise', name: 'Standing Calf Raise' },
  { id: 'sys_dumbbell_biceps_curl', name: 'Dumbbell Biceps Curl' },
  { id: 'sys_cable_crunch', name: 'Cable Crunch' },
  { id: 'sys_pull_up', name: 'Pull-Up' },
  { id: 'sys_push_up', name: 'Push-Up' },
  { id: 'sys_barbell_bent_over_row', name: 'Barbell Bent-Over Row' },
  { id: 'sys_leg_press', name: 'Leg Press' },
  { id: 'sys_dumbbell_fly', name: 'Dumbbell Fly' },
  { id: 'sys_conventional_deadlift', name: 'Conventional Deadlift' },
  { id: 'sys_dumbbell_bench_press', name: 'Dumbbell Bench Press' },
  { id: 'sys_dumbbell_row', name: 'Dumbbell Row' },
  { id: 'sys_close_grip_bench_press', name: 'Close-Grip Bench Press' },
  { id: 'sys_overhead_tricep_extension', name: 'Overhead Tricep Extension' },
  { id: 'sys_face_pull', name: 'Face Pull' },
  { id: 'sys_bulgarian_split_squat', name: 'Bulgarian Split Squat' },
  { id: 'sys_hammer_curl', name: 'Hammer Curl' },
  { id: 'sys_plank', name: 'Plank' },
  { id: 'sys_standing_barbell_overhead_press', name: 'Standing Barbell Overhead Press' },
  { id: 'sys_barbell_curl', name: 'Barbell Curl' },
  { id: 'sys_low_cable_one-arm_lateral_raises', name: 'Low Cable One-Arm Lateral Raises' },
  { id: 'sys_machine_lateral_raises', name: 'Machine Lateral Raises' },
  { id: 'sys_rotator_cuffs', name: 'Rotator Cuffs' },
  { id: 'sys_side-lying_dumbbell_lateral_raises', name: 'Side-Lying Dumbbell Lateral Raises' },
  { id: 'sys_alternating_dumbbell_front_raises', name: 'Alternating Dumbbell Front Raises' },
  { id: 'sys_barbell_front_raises', name: 'Barbell Front Raises' },
  { id: 'sys_cable_front_raises', name: 'Cable Front Raises' },
  { id: 'sys_cable_one-arm_front_raises', name: 'Cable One-Arm Front Raises' },
  { id: 'sys_dumbbell_front_raises', name: 'Dumbbell Front Raises' },
  { id: 'sys_one-dumbbell_front_raises', name: 'One-Dumbbell Front Raises' },
  { id: 'sys_seated_barbell_front_raises', name: 'Seated Barbell Front Raises' },
  { id: 'sys_standing_cable_internal_rotations', name: 'Standing Cable Internal Rotations' },
  { id: 'sys_arnold_presses', name: 'Arnold Presses' },
  { id: 'sys_barbell_front_presses', name: 'Barbell Front Presses' },
  { id: 'sys_machine_presses', name: 'Machine Presses' },
  { id: 'sys_one-arm_arnold_presses', name: 'One-Arm Arnold Presses' },
  { id: 'sys_standing_barbell_front_presses', name: 'Standing Barbell Front Presses' },
  { id: 'sys_alternating_dumbbell_hammer_front_raises', name: 'Alternating Dumbbell Hammer Front Raises' },
  { id: 'sys_cable_one-arm_hammer_front_raises', name: 'Cable One-Arm Hammer Front Raises' },
  { id: 'sys_dumbbell_one-arm_hammer_front_raises', name: 'Dumbbell One-Arm Hammer Front Raises' },
  { id: 'sys_bent-over_cable_lateral_raises', name: 'Bent-Over Cable Lateral Raises' },
  { id: 'sys_bent-over_dumbbell_lateral_raises', name: 'Bent-Over Dumbbell Lateral Raises' },
  { id: 'sys_dumbbell_lateral_raises', name: 'Dumbbell Lateral Raises' },
  { id: 'sys_kettlebell_lateral_raises', name: 'Kettlebell Lateral Raises' },
  { id: 'sys_lying_dumbbell_lateral_raises', name: 'Lying Dumbbell Lateral Raises' },
  { id: 'sys_reverse_high_cable_flys', name: 'Reverse High Cable Flys' },
  { id: 'sys_reverse_machine_flys', name: 'Reverse Machine Flys' },
  { id: 'sys_seated_dumbbell_lateral_raises', name: 'Seated Dumbbell Lateral Raises' },
  { id: 'sys_standing_cable_external_rotations', name: 'Standing Cable External Rotations' },
  { id: 'sys_barbell_back_presses', name: 'Barbell Back Presses' },
  { id: 'sys_dumbbell_presses', name: 'Dumbbell Presses' },
  { id: 'sys_kettlebell_bottom-up_kneeling_press', name: 'Kettlebell Bottom-Up Kneeling Press' },
  { id: 'sys_standing_dumbbell_one-arm_presses', name: 'Standing Dumbbell One-Arm Presses' },
  { id: 'sys_standing_dumbbell_presses', name: 'Standing Dumbbell Presses' },
  { id: 'sys_landmine_press', name: 'Landmine Press' },
  { id: 'sys_powell_raise', name: 'Powell Raise' },
  { id: 'sys_barbell_upright_rows', name: 'Barbell Upright Rows' },
  { id: 'sys_cable_face_pulls', name: 'Cable Face Pulls' },
  { id: 'sys_cable_upright_rows', name: 'Cable Upright Rows' },
  { id: 'sys_dumbbell_one-arm_upright_rows', name: 'Dumbbell One-Arm Upright Rows' },
  { id: 'sys_dumbbell_upright_rows', name: 'Dumbbell Upright Rows' },
  { id: 'sys_ez-bar_upright_rows', name: 'EZ-Bar Upright Rows' },
  { id: 'sys_kettlebell_upright_rows', name: 'Kettlebell Upright Rows' },
  { id: 'sys_seated_cable_face_pulls', name: 'Seated Cable Face Pulls' },
  { id: 'sys_cable_flys', name: 'Cable Flys' },
  { id: 'sys_decline_dumbbell_flys', name: 'Decline Dumbbell Flys' },
  { id: 'sys_dumbbell_flys', name: 'Dumbbell Flys' },
  { id: 'sys_high_cable_flys', name: 'High Cable Flys' },
  { id: 'sys_incline_dumbbell_flys', name: 'Incline Dumbbell Flys' },
  { id: 'sys_low_cable_flys', name: 'Low Cable Flys' },
  { id: 'sys_machine_flys', name: 'Machine Flys' },
  { id: 'sys_incline_machine_bench_presses', name: 'Incline Machine Bench Presses' },
  { id: 'sys_ball_decline_push-ups', name: 'Ball Decline Push-Ups' },
  { id: 'sys_barbell_bench_presses', name: 'Barbell Bench Presses' },
  { id: 'sys_cable_bench_presses', name: 'Cable Bench Presses' },
  { id: 'sys_decline_push-ups', name: 'Decline Push-Ups' },
  { id: 'sys_dumbbell_bench_presses', name: 'Dumbbell Bench Presses' },
  { id: 'sys_incline_barbell_bench_presses', name: 'Incline Barbell Bench Presses' },
  { id: 'sys_incline_cable_bench_presses', name: 'Incline Cable Bench Presses' },
  { id: 'sys_incline_dumbbell_bench_presses', name: 'Incline Dumbbell Bench Presses' },
  { id: 'sys_incline_smith_machine_bench_presses', name: 'Incline Smith Machine Bench Presses' },
  { id: 'sys_push-ups', name: 'Push-Ups' },
  { id: 'sys_smith_machine_bench_presses', name: 'Smith Machine Bench Presses' },
  { id: 'sys_spiderman_push-up', name: 'Spiderman Push-up' },
  { id: 'sys_wide-grip_barbell_bench_presses', name: 'Wide-Grip Barbell Bench Presses' },
  { id: 'sys_ball_incline_push-ups', name: 'Ball Incline Push-Ups' },
  { id: 'sys_decline_barbell_bench_presses', name: 'Decline Barbell Bench Presses' },
  { id: 'sys_decline_cable_bench_presses', name: 'Decline Cable Bench Presses' },
  { id: 'sys_decline_dumbbell_bench_presses', name: 'Decline Dumbbell Bench Presses' },
  { id: 'sys_incline_push-ups', name: 'Incline Push-Ups' },
  { id: 'sys_machine_bench_presses', name: 'Machine Bench Presses' },
  { id: 'sys_seated_cable_bench_presses', name: 'Seated Cable Bench Presses' },
  { id: 'sys_seated_machine_bench_presses', name: 'Seated Machine Bench Presses' },
  { id: 'sys_ball_dumbbell_pullovers', name: 'Ball Dumbbell Pullovers' },
  { id: 'sys_barbell_pullovers', name: 'Barbell Pullovers' },
  { id: 'sys_dumbbell_pullovers', name: 'Dumbbell Pullovers' },
  { id: 'sys_band_pull-apart', name: 'Band Pull-Apart' },
  { id: 'sys_incline_dumbbell_pullover', name: 'Incline Dumbbell Pullover' },
  { id: 'sys_barbell_shrugs', name: 'Barbell Shrugs' },
  { id: 'sys_dumbbell_shrugs', name: 'Dumbbell Shrugs' },
  { id: 'sys_dumbbells_reverse_fly', name: 'Dumbbells Reverse Fly' },
  { id: 'sys_machine_shrugs', name: 'Machine Shrugs' },
  { id: 'sys_trap_bar_shrugs', name: 'Trap Bar Shrugs' },
  { id: 'sys_alternating_cable_row', name: 'Alternating Cable Row' },
  { id: 'sys_barbell_rows', name: 'Barbell Rows' },
  { id: 'sys_dumbbell_rows', name: 'Dumbbell Rows' },
  { id: 'sys_incline_barbell_rows', name: 'Incline Barbell Rows' },
  { id: 'sys_incline_dumbbell_rows', name: 'Incline Dumbbell Rows' },
  { id: 'sys_lying_barbell_rows', name: 'Lying Barbell Rows' },
  { id: 'sys_lying_t-bar_rows', name: 'Lying T-Bar Rows' },
  { id: 'sys_smith_machine_rows', name: 'Smith Machine Rows' },
  { id: 'sys_t-bar_rows', name: 'T-Bar Rows' },
  { id: 'sys_wide-grip_seated_cable_rows', name: 'Wide-Grip Seated Cable Rows' },
  { id: 'sys_wide-grip_seated_machine_rows', name: 'Wide-Grip Seated Machine Rows' },
  { id: 'sys_dumbbell_renegade_rows', name: 'Dumbbell Renegade Rows' },
  { id: 'sys_kettlebell_renegade_rows', name: 'Kettlebell Renegade Rows' },
  { id: 'sys_dumbbell_one-arm_rows', name: 'Dumbbell One-Arm Rows' },
  { id: 'sys_kettlebell_one-arm_rows', name: 'Kettlebell One-Arm Rows' },
  { id: 'sys_pull-ups', name: 'Pull-Ups' },
  { id: 'sys_wide-grip_back_lat_pull-downs', name: 'Wide-Grip Back Lat Pull-Downs' },
  { id: 'sys_wide-grip_lat_pull-downs', name: 'Wide-Grip Lat Pull-Downs' },
  { id: 'sys_barbell_deadlifts', name: 'Barbell Deadlifts' },
  { id: 'sys_dumbbell_deadlifts', name: 'Dumbbell Deadlifts' },
  { id: 'sys_smith_machine_deadlifts', name: 'Smith Machine Deadlifts' },
  { id: 'sys_trap_bar_deadlifts', name: 'Trap Bar Deadlifts' },
  { id: 'sys_reverse_barbell_rows', name: 'Reverse Barbell Rows' },
  { id: 'sys_reverse_dumbbell_rows', name: 'Reverse Dumbbell Rows' },
  { id: 'sys_reverse_incline_barbell_rows', name: 'Reverse Incline Barbell Rows' },
  { id: 'sys_seated_cable_rows', name: 'Seated Cable Rows' },
  { id: 'sys_seated_machine_rows', name: 'Seated Machine Rows' },
  { id: 'sys_close-grip_chin-ups', name: 'Close-Grip Chin-Ups' },
  { id: 'sys_close-grip_lat_pull-downs', name: 'Close-Grip Lat Pull-Downs' },
  { id: 'sys_one-arm_lat_pull-downs', name: 'One-Arm Lat Pull-Downs' },
  { id: 'sys_machine_pullovers', name: 'Machine Pullovers' },
  { id: 'sys_seated_cable_pullovers', name: 'Seated Cable Pullovers' },
  { id: 'sys_lat_pull-downs', name: 'Lat Pull-Downs' },
  { id: 'sys_machine_lat_pull-downs', name: 'Machine Lat Pull-Downs' },
  { id: 'sys_straight-arm_lat_pull-downs', name: 'Straight-Arm Lat Pull-Downs' },
  { id: 'sys_chin-ups', name: 'Chin-Ups' },
  { id: 'sys_reverse_lat_pull-downs', name: 'Reverse Lat Pull-Downs' },
  { id: 'sys_reverse_machine_lat_pull-downs', name: 'Reverse Machine Lat Pull-Downs' },
  { id: 'sys_machine_back_extensions', name: 'Machine Back Extensions' },
  { id: 'sys_back_extensions', name: 'Back Extensions' },
  { id: 'sys_ball_back_extensions', name: 'Ball Back Extensions' },
  { id: 'sys_supermans', name: 'Supermans' },
  { id: 'sys_barbell_sumo_deadlifts', name: 'Barbell Sumo Deadlifts' },
  { id: 'sys_barbell_romanian_deadlifts', name: 'Barbell Romanian Deadlifts' },
  { id: 'sys_dumbbell_romanian_deadlifts', name: 'Dumbbell Romanian Deadlifts' },
  { id: 'sys_kettlebell_romanian_deadlifts', name: 'Kettlebell Romanian Deadlifts' },
  { id: 'sys_straight-leg_barbell_deadlifts', name: 'Straight-Leg Barbell Deadlifts' },
  { id: 'sys_straight-leg_dumbbell_deadlifts', name: 'Straight-Leg Dumbbell Deadlifts' },
  { id: 'sys_close-grip_barbell_bench_presses', name: 'Close-Grip Barbell Bench Presses' },
  { id: 'sys_close-grip_dumbbell_bench_presses', name: 'Close-Grip Dumbbell Bench Presses' },
  { id: 'sys_close-grip_incline_dumbbell_bench_presses', name: 'Close-Grip Incline Dumbbell Bench Presses' },
  { id: 'sys_close-grip_incline_push-ups', name: 'Close-Grip Incline Push-Ups' },
  { id: 'sys_close-grip_push-ups', name: 'Close-Grip Push-Ups' },
  { id: 'sys_machine_dips', name: 'Machine Dips' },
  { id: 'sys_parallel_bar_dips', name: 'Parallel Bar Dips' },
  { id: 'sys_hammer_push-downs', name: 'Hammer Push-Downs' },
  { id: 'sys_incline_low_cable_triceps_extensions', name: 'Incline Low Cable Triceps Extensions' },
  { id: 'sys_lying_barbell_triceps_extensions', name: 'Lying Barbell Triceps Extensions' },
  { id: 'sys_lying_dumbbell_triceps_extensions', name: 'Lying Dumbbell Triceps Extensions' },
  { id: 'sys_lying_ez-bar_triceps_extensions', name: 'Lying EZ-Bar Triceps Extensions' },
  { id: 'sys_lying_low_cable_triceps_extensions', name: 'Lying Low Cable Triceps Extensions' },
  { id: 'sys_machine_push-downs', name: 'Machine Push-Downs' },
  { id: 'sys_one-arm_hammer_push-downs', name: 'One-Arm Hammer Push-Downs' },
  { id: 'sys_push-downs', name: 'Push-Downs' },
  { id: 'sys_seated_dumbbell_one-arm_triceps_extensions', name: 'Seated Dumbbell One-Arm Triceps Extensions' },
  { id: 'sys_seated_ez-bar_triceps_extensions', name: 'Seated EZ-Bar Triceps Extensions' },
  { id: 'sys_seated_high_cable_triceps_extensions', name: 'Seated High Cable Triceps Extensions' },
  { id: 'sys_seated_one-dumbbell_triceps_extensions', name: 'Seated One-Dumbbell Triceps Extensions' },
  { id: 'sys_standing_dumbbell_one-arm_triceps_extensions', name: 'Standing Dumbbell One-Arm Triceps Extensions' },
  { id: 'sys_standing_high_cable_one-arm_triceps_extensions', name: 'Standing High Cable One-Arm Triceps Extensions' },
  { id: 'sys_standing_low_cable_hammer_triceps_extensions', name: 'Standing Low Cable Hammer Triceps Extensions' },
  { id: 'sys_standing_low_cable_triceps_extensions', name: 'Standing Low Cable Triceps Extensions' },
  { id: 'sys_standing_one-dumbbell_triceps_extensions', name: 'Standing One-Dumbbell Triceps Extensions' },
  { id: 'sys_triceps_kickbacks', name: 'Triceps Kickbacks' },
  { id: 'sys_ball_dips', name: 'Ball Dips' },
  { id: 'sys_bench_dips', name: 'Bench Dips' },
  { id: 'sys_reverse_one-arm_push-downs', name: 'Reverse One-Arm Push-Downs' },
  { id: 'sys_reverse_push-downs', name: 'Reverse Push-Downs' },
  { id: 'sys_alternating_dumbbell_curls', name: 'Alternating Dumbbell Curls' },
  { id: 'sys_alternating_dumbbell_preacher_curls', name: 'Alternating Dumbbell Preacher Curls' },
  { id: 'sys_alternating_hammer_curls', name: 'Alternating Hammer Curls' },
  { id: 'sys_alternating_hammer_preacher_curls', name: 'Alternating Hammer Preacher Curls' },
  { id: 'sys_alternating_incline_dumbbell_curls', name: 'Alternating Incline Dumbbell Curls' },
  { id: 'sys_alternating_incline_hammer_curls', name: 'Alternating Incline Hammer Curls' },
  { id: 'sys_barbell_curls', name: 'Barbell Curls' },
  { id: 'sys_barbell_preacher_curls', name: 'Barbell Preacher Curls' },
  { id: 'sys_barbell_spider_curls', name: 'Barbell Spider Curls' },
  { id: 'sys_cable_concentration_curls', name: 'Cable Concentration Curls' },
  { id: 'sys_cable_preacher_curls', name: 'Cable Preacher Curls' },
  { id: 'sys_concentration_curls', name: 'Concentration Curls' },
  { id: 'sys_dumbbell_curls', name: 'Dumbbell Curls' },
  { id: 'sys_dumbbell_preacher_curls', name: 'Dumbbell Preacher Curls' },
  { id: 'sys_dumbbell_spider_curls', name: 'Dumbbell Spider Curls' },
  { id: 'sys_ez-bar_curls', name: 'EZ-Bar Curls' },
  { id: 'sys_ez-bar_preacher_curls', name: 'EZ-Bar Preacher Curls' },
  { id: 'sys_ez-bar_spider_curls', name: 'EZ-Bar Spider Curls' },
  { id: 'sys_hammer_curls', name: 'Hammer Curls' },
  { id: 'sys_hammer_preacher_curls', name: 'Hammer Preacher Curls' },
  { id: 'sys_hammer_spider_curls', name: 'Hammer Spider Curls' },
  { id: 'sys_high_cable_curls', name: 'High Cable Curls' },
  { id: 'sys_high_cable_one-arm_curls', name: 'High Cable One-Arm Curls' },
  { id: 'sys_incline_dumbbell_curls', name: 'Incline Dumbbell Curls' },
  { id: 'sys_incline_hammer_curls', name: 'Incline Hammer Curls' },
  { id: 'sys_low_cable_curls', name: 'Low Cable Curls' },
  { id: 'sys_low_cable_hammer_curls', name: 'Low Cable Hammer Curls' },
  { id: 'sys_low_cable_one-arm_curls', name: 'Low Cable One-Arm Curls' },
  { id: 'sys_machine_one-arm_preacher_curls', name: 'Machine One-Arm Preacher Curls' },
  { id: 'sys_machine_preacher_curls', name: 'Machine Preacher Curls' },
  { id: 'sys_standing_dumbbell_one-arm_preacher_curls', name: 'Standing Dumbbell One-Arm Preacher Curls' },
  { id: 'sys_wide-grip_barbell_curls', name: 'Wide-Grip Barbell Curls' },
  { id: 'sys_wide-grip_ez-bar_curls', name: 'Wide-Grip EZ-Bar Curls' },
  { id: 'sys_alternating_dumbbell_twist_curls', name: 'Alternating Dumbbell Twist Curls' },
  { id: 'sys_alternating_incline_dumbbell_twist_curls', name: 'Alternating Incline Dumbbell Twist Curls' },
  { id: 'sys_dumbbell_twist_curls', name: 'Dumbbell Twist Curls' },
  { id: 'sys_incline_dumbbell_twist_curls', name: 'Incline Dumbbell Twist Curls' },
  { id: 'sys_dumbbell_curls_rotated', name: 'Dumbbell Curls (rotated)' },
  { id: 'sys_reverse_barbell_wrist_curls', name: 'Reverse Barbell Wrist Curls' },
  { id: 'sys_reverse_cable_wrist_curls', name: 'Reverse Cable Wrist Curls' },
  { id: 'sys_reverse_dumbbell_wrist_curls', name: 'Reverse Dumbbell Wrist Curls' },
  { id: 'sys_reverse_barbell_curls', name: 'Reverse Barbell Curls' },
  { id: 'sys_reverse_barbell_preacher_curls', name: 'Reverse Barbell Preacher Curls' },
  { id: 'sys_reverse_cable_preacher_curls', name: 'Reverse Cable Preacher Curls' },
  { id: 'sys_reverse_dumbbell_preacher_curls', name: 'Reverse Dumbbell Preacher Curls' },
  { id: 'sys_reverse_dumbbell_spider_curls', name: 'Reverse Dumbbell Spider Curls' },
  { id: 'sys_reverse_ez-bar_preacher_curls', name: 'Reverse EZ-Bar Preacher Curls' },
  { id: 'sys_dumbbell_farmers_walk', name: 'Dumbbell Farmer\'s Walk' },
  { id: 'sys_kettlebell_farmers_walk', name: 'Kettlebell Farmer\'s Walk' },
  { id: 'sys_trap_bar_farmers_walk', name: 'Trap Bar Farmer\'s Walk' },
  { id: 'sys_barbell_wrist_curls', name: 'Barbell Wrist Curls' },
  { id: 'sys_cable_wrist_curls', name: 'Cable Wrist Curls' },
  { id: 'sys_dumbbell_wrist_curls', name: 'Dumbbell Wrist Curls' },
  { id: 'sys_kettlebell_wrist_curls', name: 'Kettlebell Wrist Curls' },
  { id: 'sys_planks', name: 'Planks' },
  { id: 'sys_side_planks', name: 'Side Planks' },
  { id: 'sys_ball_dead_bugs', name: 'Ball Dead Bugs' },
  { id: 'sys_dead_bugs', name: 'Dead Bugs' },
  { id: 'sys_kneeling_cable_crunches', name: 'Kneeling Cable Crunches' },
  { id: 'sys_seated_cable_crunches', name: 'Seated Cable Crunches' },
  { id: 'sys_ball_crunches', name: 'Ball Crunches' },
  { id: 'sys_crunches', name: 'Crunches' },
  { id: 'sys_flutter_kicks', name: 'Flutter Kicks' },
  { id: 'sys_hanging_leg_raises', name: 'Hanging Leg Raises' },
  { id: 'sys_incline_leg_raises', name: 'Incline Leg Raises' },
  { id: 'sys_incline_sit-ups', name: 'Incline Sit-Ups' },
  { id: 'sys_leg_raises', name: 'Leg Raises' },
  { id: 'sys_machine_crunches', name: 'Machine Crunches' },
  { id: 'sys_machine_leg_raises', name: 'Machine Leg Raises' },
  { id: 'sys_sit-ups', name: 'Sit-Ups' },
  { id: 'sys_ab-wheel_rollouts', name: 'Ab-Wheel Rollouts' },
  { id: 'sys_barbell_rollouts', name: 'Barbell Rollouts' },
  { id: 'sys_dumbbell_rollouts', name: 'Dumbbell Rollouts' },
  { id: 'sys_ez-bar_rollouts', name: 'EZ-Bar Rollouts' },
  { id: 'sys_incline_twist_sit-ups', name: 'Incline Twist Sit-Ups' },
  { id: 'sys_twist_crunches', name: 'Twist Crunches' },
  { id: 'sys_twist_sit-ups', name: 'Twist Sit-Ups' },
  { id: 'sys_mountain_climbers', name: 'Mountain Climbers' },
  { id: 'sys_barbell_trunk_rotations', name: 'Barbell Trunk Rotations' },
  { id: 'sys_cable_side_bends', name: 'Cable Side Bends' },
  { id: 'sys_cable_trunk_rotations', name: 'Cable Trunk Rotations' },
  { id: 'sys_dumbbell_side_bends', name: 'Dumbbell Side Bends' },
  { id: 'sys_seated_cable_trunk_rotations', name: 'Seated Cable Trunk Rotations' },
  { id: 'sys_machine_trunk_rotations', name: 'Machine Trunk Rotations' },
  { id: 'sys_dumbbell_russian_twists', name: 'Dumbbell Russian Twists' },
  { id: 'sys_kettlebell_russian_twists', name: 'Kettlebell Russian Twists' },
  { id: 'sys_russian_twists', name: 'Russian Twists' },
  { id: 'sys_kettlebell_one-arm_swings', name: 'Kettlebell One-Arm Swings' },
  { id: 'sys_dumbbell_swings', name: 'Dumbbell Swings' },
  { id: 'sys_kettlebell_swings', name: 'Kettlebell Swings' },
  { id: 'sys_cable_hip_abductions', name: 'Cable Hip Abductions' },
  { id: 'sys_lying_hip_abductions', name: 'Lying Hip Abductions' },
  { id: 'sys_seated_machine_hip_abductions', name: 'Seated Machine Hip Abductions' },
  { id: 'sys_standing_machine_hip_abductions', name: 'Standing Machine Hip Abductions' },
  { id: 'sys_ball_hip_thrusts', name: 'Ball Hip Thrusts' },
  { id: 'sys_barbell_hip_thrusts', name: 'Barbell Hip Thrusts' },
  { id: 'sys_dumbbell_hip_thrusts', name: 'Dumbbell Hip Thrusts' },
  { id: 'sys_hip_thrusts', name: 'Hip Thrusts' },
  { id: 'sys_barbell_bridging', name: 'Barbell Bridging' },
  { id: 'sys_bench_barbell_bridging', name: 'Bench Barbell Bridging' },
  { id: 'sys_bench_bridging', name: 'Bench Bridging' },
  { id: 'sys_bench_reverse_flutter_kicks', name: 'Bench Reverse Flutter Kicks' },
  { id: 'sys_bent-knee_hip_extensions', name: 'Bent-Knee Hip Extensions' },
  { id: 'sys_bridging', name: 'Bridging' },
  { id: 'sys_cable_hip_extensions', name: 'Cable Hip Extensions' },
  { id: 'sys_dumbbell_bridging', name: 'Dumbbell Bridging' },
  { id: 'sys_hip_extensions', name: 'Hip Extensions' },
  { id: 'sys_machine_hip_extensions', name: 'Machine Hip Extensions' },
  { id: 'sys_single_leg_romanian_deadlift', name: 'Single Leg Romanian Deadlift' },
  { id: 'sys_barbell_lunges', name: 'Barbell Lunges' },
  { id: 'sys_dumbbell_lunges', name: 'Dumbbell Lunges' },
  { id: 'sys_kettlebell_lunges', name: 'Kettlebell Lunges' },
  { id: 'sys_burpees', name: 'Burpees' },
  { id: 'sys_cosak_squat', name: 'Cosak Squat' },
  { id: 'sys_one-dumbbell_squats', name: 'One-Dumbbell Squats' },
  { id: 'sys_barbell_front_squats', name: 'Barbell Front Squats' },
  { id: 'sys_barbell_squats', name: 'Barbell Squats' },
  { id: 'sys_bench_barbell_squats', name: 'Bench Barbell Squats' },
  { id: 'sys_bench_dumbbell_squats', name: 'Bench Dumbbell Squats' },
  { id: 'sys_dumbbell_front_squats', name: 'Dumbbell Front Squats' },
  { id: 'sys_dumbbell_goblet_squats', name: 'Dumbbell Goblet Squats' },
  { id: 'sys_dumbbell_squats', name: 'Dumbbell Squats' },
  { id: 'sys_kettlebell_goblet_squats', name: 'Kettlebell Goblet Squats' },
  { id: 'sys_smith_machine_squats', name: 'Smith Machine Squats' },
  { id: 'sys_kettlebell_pistol_squats', name: 'Kettlebell Pistol Squats' },
  { id: 'sys_pistol_squats', name: 'Pistol Squats' },
  { id: 'sys_barbell_bulgarian_split_squats', name: 'Barbell Bulgarian Split Squats' },
  { id: 'sys_bulgarian_split_squats', name: 'Bulgarian Split Squats' },
  { id: 'sys_dumbbell_bulgarian_split_squats', name: 'Dumbbell Bulgarian Split Squats' },
  { id: 'sys_machine_hack_squats', name: 'Machine Hack Squats' },
  { id: 'sys_machine_pendulum_squats', name: 'Machine Pendulum Squats' },
  { id: 'sys_star_jumps', name: 'Star Jumps' },
  { id: 'sys_cable_one-leg_leg_extensions', name: 'Cable One-Leg Leg Extensions' },
  { id: 'sys_leg_extensions', name: 'Leg Extensions' },
  { id: 'sys_one-leg_leg_extensions', name: 'One-Leg Leg Extensions' },
  { id: 'sys_reverse_nordics_assisted', name: 'Reverse Nordics (assisted)' },
  { id: 'sys_single_leg_extension_isohold', name: 'Single Leg Extension Isohold' },
  { id: 'sys_sissy_squat', name: 'Sissy Squat' },
  { id: 'sys_leg_presses', name: 'Leg Presses' },
  { id: 'sys_one-leg_leg_presses', name: 'One-Leg Leg Presses' },
  { id: 'sys_seated_leg_presses', name: 'Seated Leg Presses' },
  { id: 'sys_seated_one-leg_leg_presses', name: 'Seated One-Leg Leg Presses' },
  { id: 'sys_barbell_power_squats', name: 'Barbell Power Squats' },
  { id: 'sys_half_burpees', name: 'Half Burpees' },
  { id: 'sys_cable_adductions', name: 'Cable Adductions' },
  { id: 'sys_machine_adductions', name: 'Machine Adductions' },
  { id: 'sys_barbell_good_mornings', name: 'Barbell Good Mornings' },
  { id: 'sys_seated_barbell_good_mornings', name: 'Seated Barbell Good Mornings' },
  { id: 'sys_smith_machine_good_mornings', name: 'Smith Machine Good Mornings' },
  { id: 'sys_lying_leg_curls', name: 'Lying Leg Curls' },
  { id: 'sys_lying_one-leg_leg_curls', name: 'Lying One-Leg Leg Curls' },
  { id: 'sys_nordic_leg_curls', name: 'Nordic Leg Curls' },
  { id: 'sys_seated_leg_curls', name: 'Seated Leg Curls' },
  { id: 'sys_seated_one-leg_leg_curls', name: 'Seated One-Leg Leg Curls' },
  { id: 'sys_standing_leg_curls', name: 'Standing Leg Curls' },
  { id: 'sys_donkey_calf_raises', name: 'Donkey Calf Raises' },
  { id: 'sys_seated_barbell_calf_raises', name: 'Seated Barbell Calf Raises' },
  { id: 'sys_seated_dumbbell_calf_raises', name: 'Seated Dumbbell Calf Raises' },
  { id: 'sys_seated_machine_calf_raises', name: 'Seated Machine Calf Raises' },
  { id: 'sys_standing_barbell_calf_raises', name: 'Standing Barbell Calf Raises' },
  { id: 'sys_standing_calf_raises', name: 'Standing Calf Raises' },
  { id: 'sys_standing_dumbbell_one-leg_calf_raises', name: 'Standing Dumbbell One-Leg Calf Raises' },
  { id: 'sys_standing_machine_calf_raises', name: 'Standing Machine Calf Raises' },
  { id: 'sys_standing_one-leg_calf_raises', name: 'Standing One-Leg Calf Raises' },
  { id: 'sys_swimming', name: 'Swimming' },
  { id: 'sys_battle_ropes_alternating_waves', name: 'Battle Ropes Alternating Waves' },
  { id: 'sys_battle_ropes_double_waves', name: 'Battle Ropes Double Waves' },
  { id: 'sys_boxing', name: 'Boxing' },
  { id: 'sys_rowing', name: 'Rowing' },
  { id: 'sys_cycling', name: 'Cycling' },
  { id: 'sys_stationary_cycling', name: 'Stationary Cycling' },
  { id: 'sys_elliptical_trainer', name: 'Elliptical Trainer' },
  { id: 'sys_jumping_rope', name: 'Jumping Rope' },
  { id: 'sys_jumping_rope_double_unders', name: 'Jumping Rope Double Unders' },
  { id: 'sys_jogging', name: 'Jogging' },
  { id: 'sys_stationary_stair_climbing', name: 'Stationary Stair Climbing' },
  { id: 'sys_treadmill_jogging', name: 'Treadmill Jogging' },
  { id: 'sys_treadmill_walking', name: 'Treadmill Walking' },
  { id: 'sys_walking', name: 'Walking' },
  { id: 'sys_front_elbow_pull_stretch', name: 'Front Elbow Pull Stretch' },
  { id: 'sys_palms-in_back_arm_extension_stretch', name: 'Palms-In Back Arm Extension Stretch' },
  { id: 'sys_straight-arm_torso_rotation_stretch_at_wall', name: 'Straight-Arm Torso Rotation Stretch at Wall' },
  { id: 'sys_child_pose_stretch', name: 'Child Pose Stretch' },
  { id: 'sys_bent-arm_torso_rotation_stretch_at_wall', name: 'Bent-Arm Torso Rotation Stretch at Wall' },
  { id: 'sys_straight-arm_torso_lean_stretch_in_corner', name: 'Straight-Arm Torso Lean Stretch in Corner' },
  { id: 'sys_back_arm_pull_stretch', name: 'Back Arm Pull Stretch' },
  { id: 'sys_cross-legged_seated_head_tilt_stretch', name: 'Cross-Legged Seated Head Tilt Stretch' },
  { id: 'sys_standing_head_tilt_stretch', name: 'Standing Head Tilt Stretch' },
  { id: 'sys_dead_hang_stretch', name: 'Dead Hang Stretch' },
  { id: 'sys_side_bend_stretch_at_wall', name: 'Side Bend Stretch at Wall' },
  { id: 'sys_palms-out_upward_arm_extension_stretch', name: 'Palms-Out Upward Arm Extension Stretch' },
  { id: 'sys_back_elbow_pull_stretch', name: 'Back Elbow Pull Stretch' },
  { id: 'sys_palms-out_front_arm_extension_stretch', name: 'Palms-Out Front Arm Extension Stretch' },
  { id: 'sys_cobra_pose_stretch', name: 'Cobra Pose Stretch' },
  { id: 'sys_lying_hip_rotation_stretch', name: 'Lying Hip Rotation Stretch' },
  { id: 'sys_bent-knee_lying_leg_pull_stretch', name: 'Bent-Knee Lying Leg Pull Stretch' },
  { id: 'sys_side-lying_back_foot_pull_stretch', name: 'Side-Lying Back Foot Pull Stretch' },
  { id: 'sys_standing_back_foot_pull_stretch', name: 'Standing Back Foot Pull Stretch' },
  { id: 'sys_kneeling_lunge_stretch', name: 'Kneeling Lunge Stretch' },
  { id: 'sys_straight-leg_lying_leg_pull_stretch', name: 'Straight-Leg Lying Leg Pull Stretch' },
  { id: 'sys_standing_one-leg_leg_extension_stretch', name: 'Standing One-Leg Leg Extension Stretch' },
  { id: 'sys_standing_lunge_stretch_at_wall', name: 'Standing Lunge Stretch at Wall' },
];

const SYSTEM_EXERCISE_MUSCLE_MAPPING_INPUTS: SystemExerciseMuscleMappingSeedInput[] = [
  { exerciseDefinitionId: 'sys_barbell_bench_press', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bench_press', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bench_press', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_incline_dumbbell_press', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_press', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_press', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },

  {
    exerciseDefinitionId: 'sys_seated_dumbbell_overhead_press',
    muscleGroupId: 'delts_front',
    weight: 1,
    role: 'primary',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_overhead_press',
    muscleGroupId: 'delts_lateral',
    weight: 0.5,
    role: 'secondary',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_overhead_press',
    muscleGroupId: 'triceps',
    weight: 0.5,
    role: 'secondary',
  },

  { exerciseDefinitionId: 'sys_dumbbell_lateral_raise', muscleGroupId: 'delts_lateral', weight: 1, role: 'primary' },

  { exerciseDefinitionId: 'sys_lat_pulldown', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lat_pulldown', muscleGroupId: 'back_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lat_pulldown', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_seated_cable_row', muscleGroupId: 'back_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_row', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_row', muscleGroupId: 'delts_rear', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_row', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_barbell_back_squat', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_back_squat', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_back_squat', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_back_squat', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_romanian_deadlift', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_romanian_deadlift', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_romanian_deadlift', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_leg_extension', muscleGroupId: 'quads', weight: 1, role: 'primary' },

  { exerciseDefinitionId: 'sys_seated_leg_curl', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },

  { exerciseDefinitionId: 'sys_barbell_hip_thrust', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_hip_thrust', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_hip_thrust', muscleGroupId: 'hip_abductors', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_standing_calf_raise', muscleGroupId: 'calves', weight: 1, role: 'primary' },

  { exerciseDefinitionId: 'sys_dumbbell_biceps_curl', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_biceps_curl', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_cable_crunch', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_crunch', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_pull_up', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_pull_up', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pull_up', muscleGroupId: 'back_upper', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_push_up', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_push_up', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_push_up', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_push_up', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_barbell_bent_over_row', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bent_over_row', muscleGroupId: 'back_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bent_over_row', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bent_over_row', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bent_over_row', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_leg_press', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_leg_press', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_press', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_dumbbell_fly', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_fly', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_conventional_deadlift', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_conventional_deadlift', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_conventional_deadlift', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_conventional_deadlift', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_conventional_deadlift', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_dumbbell_bench_press', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_bench_press', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bench_press', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_dumbbell_row', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_row', muscleGroupId: 'back_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_row', muscleGroupId: 'delts_rear', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_row', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_close_grip_bench_press', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close_grip_bench_press', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close_grip_bench_press', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_overhead_tricep_extension', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_overhead_tricep_extension', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_face_pull', muscleGroupId: 'delts_rear', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_face_pull', muscleGroupId: 'back_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_face_pull', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_bulgarian_split_squat', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squat', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squat', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_hammer_curl', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hammer_curl', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_plank', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_plank', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },

  { exerciseDefinitionId: 'sys_standing_barbell_overhead_press', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_curl', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_low_cable_one-arm_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_rotator_cuffs', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_side-lying_dumbbell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_one-arm_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_one-arm_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_barbell_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_barbell_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_cable_internal_rotations', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_cable_internal_rotations', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_arnold_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_arnold_presses', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_arnold_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_front_presses', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_presses', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-arm_arnold_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-arm_arnold_presses', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-arm_arnold_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_barbell_front_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_barbell_front_presses', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_barbell_front_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_hammer_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_hammer_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_hammer_front_raises', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_one-arm_hammer_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_one-arm_hammer_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_one-arm_hammer_front_raises', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_hammer_front_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_hammer_front_raises', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_hammer_front_raises', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bent-over_cable_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bent-over_cable_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bent-over_dumbbell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bent-over_dumbbell_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_dumbbell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_dumbbell_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_high_cable_flys', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_high_cable_flys', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_machine_flys', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_machine_flys', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_dumbbell_lateral_raises', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_dumbbell_lateral_raises', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_cable_external_rotations', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_cable_external_rotations', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_back_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_back_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_bottom-up_kneeling_press', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_bottom-up_kneeling_press', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_presses', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_landmine_press', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_landmine_press', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_powell_raise', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_powell_raise', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_face_pulls', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_face_pulls', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_face_pulls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ez-bar_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_upright_rows', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_upright_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_upright_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_face_pulls', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_face_pulls', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_face_pulls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_decline_dumbbell_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_high_cable_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_low_cable_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_flys', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_machine_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_machine_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_decline_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_decline_push-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_decline_push-ups', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_decline_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_decline_push-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_decline_push-ups', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_barbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_barbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_barbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_cable_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_cable_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_cable_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_smith_machine_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_smith_machine_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_smith_machine_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_push-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_push-ups', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_spiderman_push-up', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_spiderman_push-up', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_spiderman_push-up', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_barbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_barbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_barbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_incline_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_incline_push-ups', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_decline_barbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_decline_barbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_decline_cable_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_decline_cable_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_decline_dumbbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_decline_dumbbell_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_push-ups', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_machine_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_machine_bench_presses', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dumbbell_pullovers', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_dumbbell_pullovers', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_dumbbell_pullovers', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_pullovers', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_pullovers', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_pullovers', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_pullovers', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_pullovers', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_pullovers', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_band_pull-apart', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_band_pull-apart', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_pullover', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_pullover', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_shrugs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_shrugs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbells_reverse_fly', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_shrugs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_shrugs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_cable_row', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_cable_row', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_barbell_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_barbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_barbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_barbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_barbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_barbell_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_barbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_barbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_barbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_barbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_t-bar_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_t-bar_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_t-bar_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_t-bar_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_t-bar_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_t-bar_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_t-bar_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_t-bar_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_t-bar_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_t-bar_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_renegade_rows', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_renegade_rows', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_one-arm_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_rows', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pull-ups', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_pull-ups', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_pull-ups', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_back_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_back_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_back_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_wide-grip_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_deadlifts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_deadlifts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_deadlifts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_deadlifts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_rows', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_rows', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_incline_barbell_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_incline_barbell_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_incline_barbell_rows', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_incline_barbell_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_incline_barbell_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_rows', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_machine_rows', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_machine_rows', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_machine_rows', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_machine_rows', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_machine_rows', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_chin-ups', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_chin-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_chin-ups', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_chin-ups', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_lat_pull-downs', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-arm_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-arm_lat_pull-downs', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-arm_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-arm_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_pullovers', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_pullovers', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_pullovers', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_pullovers', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_pullovers', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_pullovers', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_lat_pull-downs', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-arm_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-arm_lat_pull-downs', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_chin-ups', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_chin-ups', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_chin-ups', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_lat_pull-downs', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_machine_lat_pull-downs', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_machine_lat_pull-downs', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_machine_lat_pull-downs', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_back_extensions', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_back_extensions', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_back_extensions', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_back_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_back_extensions', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_back_extensions', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_back_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_supermans', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_supermans', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_supermans', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_sumo_deadlifts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_romanian_deadlifts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_barbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_barbell_bench_presses', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_barbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_dumbbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_dumbbell_bench_presses', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_dumbbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_dumbbell_bench_presses', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_dumbbell_bench_presses', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_dumbbell_bench_presses', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_push-ups', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_incline_push-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_close-grip_push-ups', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_push-ups', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_close-grip_push-ups', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_dips', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_dips', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_dips', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_parallel_bar_dips', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_parallel_bar_dips', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_parallel_bar_dips', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hammer_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_low_cable_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_barbell_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_dumbbell_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_ez-bar_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_low_cable_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-arm_hammer_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_dumbbell_one-arm_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_ez-bar_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_high_cable_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_one-dumbbell_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_high_cable_one-arm_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_low_cable_hammer_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_low_cable_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_one-dumbbell_triceps_extensions', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_triceps_kickbacks', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_dips', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_dips', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dips', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dips', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_dips', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dips', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_one-arm_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_one-arm_push-downs', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_push-downs', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_push-downs', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_hammer_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_hammer_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_incline_dumbbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_incline_hammer_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_spider_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_concentration_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_concentration_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_spider_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_spider_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hammer_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hammer_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hammer_spider_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_high_cable_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_high_cable_one-arm_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_hammer_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_low_cable_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_low_cable_hammer_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_low_cable_one-arm_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_one-arm_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_preacher_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_barbell_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_wide-grip_ez-bar_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_twist_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_dumbbell_twist_curls', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_alternating_incline_dumbbell_twist_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_alternating_incline_dumbbell_twist_curls', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_twist_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_twist_curls', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_twist_curls', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_dumbbell_twist_curls', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_curls_rotated', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_curls_rotated', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_cable_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_preacher_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_barbell_preacher_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_cable_preacher_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_cable_preacher_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_preacher_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_preacher_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_spider_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_dumbbell_spider_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_reverse_ez-bar_preacher_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_ez-bar_preacher_curls', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_farmers_walk', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_farmers_walk', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_trap_bar_farmers_walk', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_wrist_curls', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_planks', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_planks', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_dead_bugs', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dead_bugs', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kneeling_cable_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kneeling_cable_crunches', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_cable_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_crunches', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_crunches', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_crunches', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_crunches', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_crunches', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_flutter_kicks', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_flutter_kicks', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_flutter_kicks', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hanging_leg_raises', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hanging_leg_raises', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hanging_leg_raises', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_leg_raises', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_leg_raises', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_leg_raises', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_sit-ups', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_sit-ups', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_sit-ups', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_raises', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_leg_raises', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_raises', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_crunches', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_crunches', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_leg_raises', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_leg_raises', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_leg_raises', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_sit-ups', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_sit-ups', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_sit-ups', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ab-wheel_rollouts', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ab-wheel_rollouts', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ab-wheel_rollouts', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ab-wheel_rollouts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ab-wheel_rollouts', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_rollouts', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_rollouts', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_rollouts', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_rollouts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_rollouts', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rollouts', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_rollouts', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_rollouts', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rollouts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_rollouts', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ez-bar_rollouts', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_rollouts', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ez-bar_rollouts', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ez-bar_rollouts', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ez-bar_rollouts', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_incline_twist_sit-ups', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_twist_sit-ups', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_incline_twist_sit-ups', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_twist_crunches', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_twist_crunches', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_twist_crunches', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_twist_sit-ups', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_twist_sit-ups', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_twist_sit-ups', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_mountain_climbers', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_trunk_rotations', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_side_bends', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_trunk_rotations', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_side_bends', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_cable_trunk_rotations', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_trunk_rotations', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_trunk_rotations', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_russian_twists', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_russian_twists', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_russian_twists', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_russian_twists', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_russian_twists', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_russian_twists', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_russian_twists', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_russian_twists', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_russian_twists', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_one-arm_swings', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_swings', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'spinal_erectors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_swings', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_hip_abductions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_hip_abductions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_machine_hip_abductions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_machine_hip_abductions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_hip_thrusts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_ball_hip_thrusts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_ball_hip_thrusts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_hip_thrusts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_hip_thrusts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_hip_thrusts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_hip_thrusts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_hip_thrusts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_hip_thrusts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hip_thrusts', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hip_thrusts', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hip_thrusts', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bridging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bridging', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_bridging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_barbell_bridging', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_bridging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_bridging', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_reverse_flutter_kicks', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_reverse_flutter_kicks', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bent-knee_hip_extensions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bent-knee_hip_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bridging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bridging', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_hip_extensions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cable_hip_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bridging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_bridging', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_hip_extensions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_hip_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_hip_extensions', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_hip_extensions', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_single_leg_romanian_deadlift', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_single_leg_romanian_deadlift', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_lunges', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_lunges', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_lunges', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_lunges', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_lunges', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_lunges', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_lunges', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_lunges', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_lunges', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_burpees', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cosak_squat', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cosak_squat', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-dumbbell_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_front_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_barbell_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bench_dumbbell_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_front_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_goblet_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_goblet_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_kettlebell_pistol_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_pistol_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bulgarian_split_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bulgarian_split_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_bulgarian_split_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_bulgarian_split_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bulgarian_split_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bulgarian_split_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_bulgarian_split_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dumbbell_bulgarian_split_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_dumbbell_bulgarian_split_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_hack_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_hack_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_hack_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_hack_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_pendulum_squats', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_pendulum_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_pendulum_squats', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_machine_pendulum_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_star_jumps', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_one-leg_leg_extensions', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_leg_extensions', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-leg_leg_extensions', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_reverse_nordics_assisted', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_single_leg_extension_isohold', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_sissy_squat', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_sissy_squat', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_presses', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_leg_presses', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_presses', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_leg_presses', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-leg_leg_presses', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_one-leg_leg_presses', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-leg_leg_presses', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_one-leg_leg_presses', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_leg_presses', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_leg_presses', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_leg_presses', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_leg_presses', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_presses', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_presses', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_presses', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_presses', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'adductors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_power_squats', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_half_burpees', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cable_adductions', muscleGroupId: 'adductors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_machine_adductions', muscleGroupId: 'adductors', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_good_mornings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_barbell_good_mornings', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_barbell_good_mornings', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_barbell_good_mornings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_barbell_good_mornings', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_barbell_good_mornings', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_good_mornings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_smith_machine_good_mornings', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_smith_machine_good_mornings', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_one-leg_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_one-leg_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_nordic_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_nordic_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_one-leg_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_leg_curls', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_leg_curls', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_donkey_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_barbell_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_dumbbell_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_seated_machine_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_barbell_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_dumbbell_one-leg_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_machine_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_one-leg_calf_raises', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_swimming', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_alternating_waves', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_battle_ropes_double_waves', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'abs_rectus', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_boxing', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'quads', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_rowing', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cycling', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cycling', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cycling', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cycling', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_stationary_cycling', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_cycling', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_cycling', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_stationary_cycling', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_elliptical_trainer', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'forearms_grip', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jumping_rope_double_unders', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_jogging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jogging', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jogging', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jogging', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_jogging', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_stationary_stair_climbing', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_stair_climbing', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_stair_climbing', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_stair_climbing', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_stationary_stair_climbing', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_treadmill_jogging', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_jogging', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_jogging', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_jogging', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_jogging', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_treadmill_walking', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_walking', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_walking', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_walking', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_treadmill_walking', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_walking', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_walking', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_walking', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_walking', muscleGroupId: 'calves', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_walking', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_front_elbow_pull_stretch', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_front_elbow_pull_stretch', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_front_elbow_pull_stretch', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_front_elbow_pull_stretch', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_palms-in_back_arm_extension_stretch', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_palms-in_back_arm_extension_stretch', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_palms-in_back_arm_extension_stretch', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_rotation_stretch_at_wall', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_rotation_stretch_at_wall', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_rotation_stretch_at_wall', muscleGroupId: 'biceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_child_pose_stretch', muscleGroupId: 'delts_front', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_child_pose_stretch', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_child_pose_stretch', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_child_pose_stretch', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bent-arm_torso_rotation_stretch_at_wall', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bent-arm_torso_rotation_stretch_at_wall', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_lean_stretch_in_corner', muscleGroupId: 'chest', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_lean_stretch_in_corner', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_lean_stretch_in_corner', muscleGroupId: 'traps_upper', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-arm_torso_lean_stretch_in_corner', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_back_arm_pull_stretch', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cross-legged_seated_head_tilt_stretch', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_head_tilt_stretch', muscleGroupId: 'traps_upper', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dead_hang_stretch', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_dead_hang_stretch', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_bend_stretch_at_wall', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_side_bend_stretch_at_wall', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side_bend_stretch_at_wall', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_palms-out_upward_arm_extension_stretch', muscleGroupId: 'back_lats', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_palms-out_upward_arm_extension_stretch', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_palms-out_upward_arm_extension_stretch', muscleGroupId: 'biceps', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_back_elbow_pull_stretch', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_back_elbow_pull_stretch', muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_palms-out_front_arm_extension_stretch', muscleGroupId: 'forearms_grip', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cobra_pose_stretch', muscleGroupId: 'abs_rectus', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cobra_pose_stretch', muscleGroupId: 'abs_obliques', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_cobra_pose_stretch', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_cobra_pose_stretch', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_lying_hip_rotation_stretch', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_lying_hip_rotation_stretch', muscleGroupId: 'abs_obliques', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_bent-knee_lying_leg_pull_stretch', muscleGroupId: 'glutes_max', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_bent-knee_lying_leg_pull_stretch', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_side-lying_back_foot_pull_stretch', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_back_foot_pull_stretch', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kneeling_lunge_stretch', muscleGroupId: 'quads', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_kneeling_lunge_stretch', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_straight-leg_lying_leg_pull_stretch', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_straight-leg_lying_leg_pull_stretch', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_one-leg_leg_extension_stretch', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' },
  { exerciseDefinitionId: 'sys_standing_one-leg_leg_extension_stretch', muscleGroupId: 'calves', weight: 0.5, role: 'secondary' },
  { exerciseDefinitionId: 'sys_standing_lunge_stretch_at_wall', muscleGroupId: 'calves', weight: 1, role: 'primary' },
];

export const SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS: SystemExerciseMuscleMappingSeed[] =
  SYSTEM_EXERCISE_MUSCLE_MAPPING_INPUTS.map((mapping) => ({
    ...mapping,
    id: createMappingId(mapping.exerciseDefinitionId, mapping.muscleGroupId),
  }));

export const SYSTEM_EXERCISE_CATALOG_SOURCE_REFERENCES: SeedSourceReference[] = [
  {
    id: 'exrx-resistance-exercise-directory',
    type: 'reference',
    title: 'ExRx.net Weight Training Exercise Directory',
    url: 'https://exrx.net/Lists/Directory',
    note: 'Practical exercise anatomy reference used to sanity-check primary and common synergist muscle involvement.',
  },
  {
    id: 'schoenfeld-hypertrophy-mechanisms-2010',
    type: 'study',
    title: 'Schoenfeld (2010) The mechanisms of muscle hypertrophy and their application to resistance training',
    url: 'https://pubmed.ncbi.nlm.nih.gov/20847704/',
    note: 'High-level hypertrophy context; supports treating contribution weights as heuristic relative stimulus proxies rather than exact percentages.',
  },
  {
    id: 'vigotsky-emg-interpretation-2018',
    type: 'study',
    title: 'Vigotsky et al. (2018) Interpreting signal amplitudes in surface electromyography studies in sport and rehabilitation sciences',
    url: 'https://pubmed.ncbi.nlm.nih.gov/29383889/',
    note: 'Used to justify avoiding direct EMG-to-% stimulus normalization and keeping a simple non-normalized weighting convention.',
  },
  {
    id: 'escamilla-squat-biomechanics-2001',
    type: 'study',
    title: 'Escamilla (2001) Knee biomechanics of the dynamic squat exercise',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11394622/',
    note: 'Supports squat lower-body muscle involvement assumptions used in the initial squat mapping.',
  },
  {
    id: 'escamilla-deadlift-sumo-conventional-2002',
    type: 'study',
    title: 'Escamilla et al. (2002) A three-dimensional biomechanical analysis of sumo and conventional style deadlifts',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11991778/',
    note: 'Supports posterior-chain emphasis assumptions applied to Romanian deadlift-style hinge mappings.',
  },
  {
    id: 'contreras-hip-thrust-emg-2015',
    type: 'study',
    title: 'Contreras et al. (2015) A comparison of gluteus maximus, biceps femoris, and vastus lateralis EMG amplitude in the back squat and barbell hip thrust',
    url: 'https://pubmed.ncbi.nlm.nih.gov/25774600/',
    note: 'Supports glute-max primary emphasis and hamstring secondary emphasis in hip thrust mapping.',
  },
];

export const SYSTEM_EXERCISE_SEED_DOCUMENTATION: SeedExerciseDocumentation[] = [
  {
    exerciseDefinitionId: 'sys_barbell_bench_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench press is seeded as chest-primary with front-delt/triceps secondary contributions using the default 1.0/0.5 ladder.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale:
      'Incline dumbbell press is mapped to the same chest bucket as flat pressing to avoid false precision about chest sub-region emphasis in the initial system catalog.',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_overhead_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Overhead pressing is seeded with front delts primary and lateral delts/triceps as common secondary contributors.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_lateral_raise',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lateral raise is mapped to lateral delts only in M6 to keep the starter catalog focused on clear primary-target logging defaults.',
  },
  {
    exerciseDefinitionId: 'sys_lat_pulldown',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Pulldown is lats-primary with upper back and biceps as secondary contributors; grip support is intentionally omitted in M6 seed defaults.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_row',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable row is upper-back-primary with lats/rear delts/biceps as secondary contributors; grip support is intentionally omitted in M6 seed defaults.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_back_squat',
    sourceReferenceIds: ['exrx-resistance-exercise-directory', 'escamilla-squat-biomechanics-2001'],
    rationale:
      'Back squat starts with quads primary plus glutes/adductors/erectors secondary, while bracing musculature is intentionally omitted to reduce false precision in M6 defaults.',
  },
  {
    exerciseDefinitionId: 'sys_romanian_deadlift',
    sourceReferenceIds: ['exrx-resistance-exercise-directory', 'escamilla-deadlift-sumo-conventional-2002'],
    rationale: 'RDL is seeded as hamstrings and glute-max primary co-drivers with spinal erectors secondary; grip support is intentionally omitted in M6 defaults.',
  },
  {
    exerciseDefinitionId: 'sys_leg_extension',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Leg extension is mapped to quads only for a simple single-target machine pattern.',
  },
  {
    exerciseDefinitionId: 'sys_seated_leg_curl',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated leg curl is mapped to hamstrings only for a simple single-target machine pattern.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_hip_thrust',
    sourceReferenceIds: ['exrx-resistance-exercise-directory', 'contreras-hip-thrust-emg-2015'],
    rationale: 'Hip thrust is glute-max primary with hamstrings and hip abductors secondary using the default weight ladder.',
  },
  {
    exerciseDefinitionId: 'sys_standing_calf_raise',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing calf raise is mapped to calves only for a simple single-target machine/free-standing pattern.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_biceps_curl',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Biceps curl is biceps-primary with grip/forearm secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_crunch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable crunch is abs-primary with obliques secondary.',
  },
  {
    exerciseDefinitionId: 'sys_pull_up',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Pull-up is lats-primary with biceps and upper back secondary; bodyweight vertical pulling pattern.',
  },
  {
    exerciseDefinitionId: 'sys_push_up',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Push-up is chest-primary with triceps/front delts/abs secondary; bodyweight horizontal pushing pattern.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_bent_over_row',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-over row is lats-primary with upper back/traps/biceps/erectors secondary; free-weight horizontal pulling pattern.',
  },
  {
    exerciseDefinitionId: 'sys_leg_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Leg press is quads-primary with glutes/hamstrings secondary; machine-based compound leg pushing.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_fly',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell fly is chest-primary with front delts secondary; isolation chest movement with minimal triceps involvement.',
  },
  {
    exerciseDefinitionId: 'sys_conventional_deadlift',
    sourceReferenceIds: ['exrx-resistance-exercise-directory', 'escamilla-deadlift-sumo-conventional-2002'],
    rationale: 'Conventional deadlift is hamstrings/glutes/erectors primary with traps/forearms secondary; full posterior chain compound movement.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_bench_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell bench press follows same chest-primary pattern as barbell bench press with front delts/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_row',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell row is lats-primary with upper back/rear delts/biceps secondary; unilateral horizontal pulling pattern.',
  },
  {
    exerciseDefinitionId: 'sys_close_grip_bench_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-grip bench press is triceps-primary with chest/front delts secondary; emphasizes elbow flexion for tricep focus.',
  },
  {
    exerciseDefinitionId: 'sys_overhead_tricep_extension',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Overhead tricep extension is triceps-primary with front delts secondary; isolation movement for tricep long head.',
  },
  {
    exerciseDefinitionId: 'sys_face_pull',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Face pull is rear delts-primary with upper back/traps secondary; cable-based rear shoulder development exercise.',
  },
  {
    exerciseDefinitionId: 'sys_bulgarian_split_squat',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bulgarian split squat is quads-primary with glutes/hamstrings secondary; unilateral leg development with balance challenge.',
  },
  {
    exerciseDefinitionId: 'sys_hammer_curl',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hammer curl is biceps-primary with forearms secondary; neutral grip variation emphasizing brachialis and brachioradialis.',
  },
  {
    exerciseDefinitionId: 'sys_plank',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Plank is abs-primary with obliques secondary; isometric core stability exercise targeting anterior core musculature.',
  },

  {
    exerciseDefinitionId: 'sys_standing_barbell_overhead_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Barbell Overhead Press is mapped to delts_front.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_curl',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Curl is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_low_cable_one-arm_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Low Cable One-Arm Lateral Raises is mapped to delts_front.',
  },
  {
    exerciseDefinitionId: 'sys_machine_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Lateral Raises is mapped to delts_front.',
  },
  {
    exerciseDefinitionId: 'sys_rotator_cuffs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Rotator Cuffs is mapped to delts_front.',
  },
  {
    exerciseDefinitionId: 'sys_side-lying_dumbbell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Side-Lying Dumbbell Lateral Raises is mapped to delts_front.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_dumbbell_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Dumbbell Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_one-arm_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable One-Arm Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_one-dumbbell_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Dumbbell Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_barbell_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Barbell Front Raises is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_cable_internal_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Cable Internal Rotations is mapped to delts_front with chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_arnold_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Arnold Presses is mapped to delts_front with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_front_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Front Presses is mapped to delts_front with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Presses is mapped to delts_front with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_one-arm_arnold_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Arm Arnold Presses is mapped to delts_front with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_barbell_front_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Barbell Front Presses is mapped to delts_front with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_dumbbell_hammer_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Dumbbell Hammer Front Raises is mapped to delts_front with chest/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_one-arm_hammer_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable One-Arm Hammer Front Raises is mapped to delts_front with chest/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_one-arm_hammer_front_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell One-Arm Hammer Front Raises is mapped to delts_front with chest/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bent-over_cable_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-Over Cable Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bent-over_dumbbell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-Over Dumbbell Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_dumbbell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Dumbbell Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_high_cable_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse High Cable Flys is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_machine_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Machine Flys is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_lateral_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Dumbbell Lateral Raises is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_cable_external_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Cable External Rotations is mapped to delts_front with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_back_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Back Presses is mapped to delts_front with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Presses is mapped to delts_front with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_bottom-up_kneeling_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Bottom-Up Kneeling Press is mapped to delts_front with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Dumbbell One-Arm Presses is mapped to delts_front with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_dumbbell_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Dumbbell Presses is mapped to delts_front with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_landmine_press',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Landmine Press is mapped to delts_front, chest.',
  },
  {
    exerciseDefinitionId: 'sys_powell_raise',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Powell Raise is mapped to delts_front, traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_face_pulls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Face Pulls is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_one-arm_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell One-Arm Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ez-bar_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'EZ-Bar Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_upright_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Upright Rows is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_face_pulls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Face Pulls is mapped to delts_front, traps_upper with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_decline_dumbbell_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Decline Dumbbell Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_high_cable_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'High Cable Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_low_cable_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Low Cable Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_machine_flys',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Flys is mapped to chest.',
  },
  {
    exerciseDefinitionId: 'sys_incline_machine_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Machine Bench Presses is mapped to chest with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_decline_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Decline Push-Ups is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_decline_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Decline Push-Ups is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_barbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Barbell Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_cable_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Cable Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_smith_machine_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Smith Machine Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Push-Ups is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_smith_machine_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Smith Machine Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_spiderman_push-up',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Spiderman Push-up is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_barbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Barbell Bench Presses is mapped to chest with delts_front/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_incline_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Incline Push-Ups is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_decline_barbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Decline Barbell Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_decline_cable_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Decline Cable Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_decline_dumbbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Decline Dumbbell Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Push-Ups is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_machine_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Machine Bench Presses is mapped to chest with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_dumbbell_pullovers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Dumbbell Pullovers is mapped to chest, back_lats with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_pullovers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Pullovers is mapped to chest, back_lats with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_pullovers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Pullovers is mapped to chest, back_lats with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_band_pull-apart',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Band Pull-Apart is mapped to delts_front, traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_pullover',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Pullover is mapped to chest, back_lats.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_shrugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Shrugs is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_shrugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Shrugs is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbells_reverse_fly',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbells Reverse Fly is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_machine_shrugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Shrugs is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_trap_bar_shrugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Trap Bar Shrugs is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_cable_row',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Cable Row is mapped to traps_upper, back_lats.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_barbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Barbell Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_barbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Barbell Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_t-bar_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying T-Bar Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_smith_machine_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Smith Machine Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_t-bar_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'T-Bar Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_seated_cable_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Seated Cable Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_seated_machine_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Seated Machine Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_renegade_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Renegade Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps/abs_rectus/abs_obliques/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_renegade_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Renegade Rows is mapped to traps_upper, back_lats with delts_front/spinal_erectors/biceps/abs_rectus/abs_obliques/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_one-arm_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell One-Arm Rows is mapped to traps_upper, back_lats with delts_front/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_one-arm_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell One-Arm Rows is mapped to traps_upper, back_lats with delts_front/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_pull-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Pull-Ups is mapped to traps_upper, back_lats with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_back_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Back Lat Pull-Downs is mapped to traps_upper, back_lats with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Lat Pull-Downs is mapped to traps_upper, back_lats with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Deadlifts is mapped to traps_upper, spinal_erectors, glutes_max, quads with back_lats/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Deadlifts is mapped to traps_upper, spinal_erectors, glutes_max, quads with back_lats/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_smith_machine_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Smith Machine Deadlifts is mapped to traps_upper, spinal_erectors, glutes_max, quads with back_lats/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_trap_bar_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Trap Bar Deadlifts is mapped to traps_upper, glutes_max, quads with back_lats/spinal_erectors/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_barbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Barbell Rows is mapped to back_lats with delts_front/traps_upper/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_dumbbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Dumbbell Rows is mapped to back_lats with delts_front/traps_upper/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_incline_barbell_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Incline Barbell Rows is mapped to back_lats with delts_front/traps_upper/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Rows is mapped to back_lats with delts_front/traps_upper/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_machine_rows',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Machine Rows is mapped to back_lats with delts_front/traps_upper/spinal_erectors/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_chin-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Chin-Ups is mapped to back_lats with delts_front/traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Lat Pull-Downs is mapped to back_lats with delts_front/traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_one-arm_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Arm Lat Pull-Downs is mapped to back_lats with delts_front/traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_pullovers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Pullovers is mapped to back_lats with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_pullovers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Pullovers is mapped to back_lats with chest/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lat Pull-Downs is mapped to back_lats with traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Lat Pull-Downs is mapped to back_lats with traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_straight-arm_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Arm Lat Pull-Downs is mapped to back_lats with triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_chin-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Chin-Ups is mapped to back_lats, biceps with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Lat Pull-Downs is mapped to back_lats, biceps with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_machine_lat_pull-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Machine Lat Pull-Downs is mapped to back_lats, biceps with traps_upper secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_back_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Back Extensions is mapped to spinal_erectors.',
  },
  {
    exerciseDefinitionId: 'sys_back_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Back Extensions is mapped to spinal_erectors with glutes_max/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_back_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Back Extensions is mapped to spinal_erectors with glutes_max/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_supermans',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Supermans is mapped to spinal_erectors with glutes_max/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_sumo_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Sumo Deadlifts is mapped to spinal_erectors, glutes_max, quads with traps_upper/back_lats/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_romanian_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Romanian Deadlifts is mapped to spinal_erectors, glutes_max, hamstrings with traps_upper/back_lats/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_romanian_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Romanian Deadlifts is mapped to spinal_erectors, glutes_max, hamstrings with traps_upper/back_lats/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_romanian_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Romanian Deadlifts is mapped to spinal_erectors, glutes_max, hamstrings with traps_upper/back_lats/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_straight-leg_barbell_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Leg Barbell Deadlifts is mapped to spinal_erectors, glutes_max, hamstrings with traps_upper/back_lats/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_straight-leg_dumbbell_deadlifts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Leg Dumbbell Deadlifts is mapped to spinal_erectors, glutes_max, hamstrings with traps_upper/back_lats/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_barbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Barbell Bench Presses is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_dumbbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Dumbbell Bench Presses is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_incline_dumbbell_bench_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Incline Dumbbell Bench Presses is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_incline_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Incline Push-Ups is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_close-grip_push-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Close-Grip Push-Ups is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_dips',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Dips is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_parallel_bar_dips',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Parallel Bar Dips is mapped to chest, triceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_hammer_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hammer Push-Downs is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_incline_low_cable_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Low Cable Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_lying_barbell_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Barbell Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_lying_dumbbell_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Dumbbell Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_lying_ez-bar_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying EZ-Bar Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_lying_low_cable_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Low Cable Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_machine_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Push-Downs is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_one-arm_hammer_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Arm Hammer Push-Downs is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Push-Downs is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_one-arm_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Dumbbell One-Arm Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_seated_ez-bar_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated EZ-Bar Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_seated_high_cable_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated High Cable Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_seated_one-dumbbell_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated One-Dumbbell Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Dumbbell One-Arm Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_high_cable_one-arm_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing High Cable One-Arm Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_low_cable_hammer_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Low Cable Hammer Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_low_cable_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Low Cable Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_one-dumbbell_triceps_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing One-Dumbbell Triceps Extensions is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_triceps_kickbacks',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Triceps Kickbacks is mapped to triceps.',
  },
  {
    exerciseDefinitionId: 'sys_ball_dips',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Dips is mapped to triceps with delts_front/chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_dips',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Dips is mapped to triceps with delts_front/chest secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_one-arm_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse One-Arm Push-Downs is mapped to triceps with forearms_grip secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_push-downs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Push-Downs is mapped to triceps with forearms_grip secondary.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_dumbbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Dumbbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_dumbbell_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Dumbbell Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_hammer_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Hammer Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_hammer_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Hammer Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_incline_dumbbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Incline Dumbbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_incline_hammer_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Incline Hammer Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_spider_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Spider Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_cable_concentration_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Concentration Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_cable_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_concentration_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Concentration Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_spider_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Spider Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_ez-bar_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'EZ-Bar Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_ez-bar_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'EZ-Bar Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_ez-bar_spider_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'EZ-Bar Spider Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_hammer_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hammer Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_hammer_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hammer Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_hammer_spider_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hammer Spider Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_high_cable_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'High Cable Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_high_cable_one-arm_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'High Cable One-Arm Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_incline_hammer_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Hammer Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_low_cable_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Low Cable Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_low_cable_hammer_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Low Cable Hammer Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_low_cable_one-arm_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Low Cable One-Arm Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_machine_one-arm_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine One-Arm Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_machine_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_standing_dumbbell_one-arm_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Dumbbell One-Arm Preacher Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_barbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip Barbell Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_wide-grip_ez-bar_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Wide-Grip EZ-Bar Curls is mapped to biceps.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_dumbbell_twist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Dumbbell Twist Curls is mapped to biceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_alternating_incline_dumbbell_twist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Alternating Incline Dumbbell Twist Curls is mapped to biceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_twist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Twist Curls is mapped to biceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_dumbbell_twist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Dumbbell Twist Curls is mapped to biceps with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_curls_rotated',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Curls (rotated) is mapped to biceps with forearms_grip secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_barbell_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Barbell Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_cable_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Cable Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_dumbbell_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Dumbbell Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_barbell_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Barbell Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_barbell_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Barbell Preacher Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_cable_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Cable Preacher Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_dumbbell_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Dumbbell Preacher Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_dumbbell_spider_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Dumbbell Spider Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_ez-bar_preacher_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse EZ-Bar Preacher Curls is mapped to forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_farmers_walk',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Farmer\'s Walk is mapped to forearms_grip, glutes_max, quads, hamstrings, calves with delts_front / traps_upper / spinal_erectors / triceps / biceps / abs_rectus / abs_obliques / adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_farmers_walk',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Farmer\'s Walk is mapped to forearms_grip, glutes_max, quads, hamstrings, calves with delts_front / traps_upper / spinal_erectors / triceps / biceps / abs_rectus / abs_obliques / adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_trap_bar_farmers_walk',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Trap Bar Farmer\'s Walk is mapped to forearms_grip, glutes_max, quads, hamstrings, calves with delts_front / traps_upper / spinal_erectors / triceps / biceps / abs_rectus / abs_obliques / adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_cable_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_wrist_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Wrist Curls is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_planks',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Planks is mapped to spinal_erectors, abs_rectus, abs_obliques with delts_front/traps_upper/glutes_max/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_side_planks',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Side Planks is mapped to spinal_erectors, abs_obliques with delts_front/abs_rectus/glutes_max/quads/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_dead_bugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Dead Bugs is mapped to abs_rectus with delts_front/back_lats/spinal_erectors/abs_obliques/glutes_max/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dead_bugs',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dead Bugs is mapped to abs_rectus with delts_front/back_lats/spinal_erectors/abs_obliques/glutes_max/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kneeling_cable_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kneeling Cable Crunches is mapped to abs_rectus with abs_obliques secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Crunches is mapped to abs_rectus with abs_obliques secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ball_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Crunches is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Crunches is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_flutter_kicks',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Flutter Kicks is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_hanging_leg_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hanging Leg Raises is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_leg_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Leg Raises is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_sit-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Sit-Ups is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_leg_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Leg Raises is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Crunches is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_leg_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Leg Raises is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_sit-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Sit-Ups is mapped to abs_rectus with abs_obliques/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ab-wheel_rollouts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ab-Wheel Rollouts is mapped to abs_rectus, abs_obliques with delts_front/back_lats/spinal_erectors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_rollouts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Rollouts is mapped to abs_rectus, abs_obliques with delts_front/back_lats/spinal_erectors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_rollouts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Rollouts is mapped to abs_rectus, abs_obliques with delts_front/back_lats/spinal_erectors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_ez-bar_rollouts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'EZ-Bar Rollouts is mapped to abs_rectus, abs_obliques with delts_front/back_lats/spinal_erectors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_incline_twist_sit-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Incline Twist Sit-Ups is mapped to abs_rectus, abs_obliques with quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_twist_crunches',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Twist Crunches is mapped to abs_rectus, abs_obliques with quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_twist_sit-ups',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Twist Sit-Ups is mapped to abs_rectus, abs_obliques with quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_mountain_climbers',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Mountain Climbers is mapped to abs_rectus, abs_obliques, quads with delts_front/traps_upper/spinal_erectors/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_trunk_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Trunk Rotations is mapped to abs_obliques.',
  },
  {
    exerciseDefinitionId: 'sys_cable_side_bends',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Side Bends is mapped to abs_obliques.',
  },
  {
    exerciseDefinitionId: 'sys_cable_trunk_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Trunk Rotations is mapped to abs_obliques.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_side_bends',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Side Bends is mapped to abs_obliques.',
  },
  {
    exerciseDefinitionId: 'sys_seated_cable_trunk_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Cable Trunk Rotations is mapped to abs_obliques.',
  },
  {
    exerciseDefinitionId: 'sys_machine_trunk_rotations',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Trunk Rotations is mapped to abs_obliques with abs_rectus secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_russian_twists',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Russian Twists is mapped to abs_obliques with abs_rectus/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_russian_twists',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Russian Twists is mapped to abs_obliques with abs_rectus/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_russian_twists',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Russian Twists is mapped to abs_obliques with abs_rectus/quads secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_one-arm_swings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell One-Arm Swings is mapped to spinal_erectors, abs_obliques, glutes_max, hamstrings with delts_front/chest/traps_upper/back_lats/abs_rectus/quads/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_swings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Swings is mapped to spinal_erectors, glutes_max, hamstrings with delts_front/chest/traps_upper/back_lats/abs_rectus/abs_obliques/quads/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_swings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Swings is mapped to spinal_erectors, glutes_max, hamstrings with delts_front/chest/traps_upper/back_lats/abs_rectus/abs_obliques/quads/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_hip_abductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Hip Abductions is mapped to glutes_max.',
  },
  {
    exerciseDefinitionId: 'sys_lying_hip_abductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Hip Abductions is mapped to glutes_max.',
  },
  {
    exerciseDefinitionId: 'sys_seated_machine_hip_abductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Machine Hip Abductions is mapped to glutes_max.',
  },
  {
    exerciseDefinitionId: 'sys_standing_machine_hip_abductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Machine Hip Abductions is mapped to glutes_max.',
  },
  {
    exerciseDefinitionId: 'sys_ball_hip_thrusts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Ball Hip Thrusts is mapped to glutes_max with quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_hip_thrusts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Hip Thrusts is mapped to glutes_max with quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_hip_thrusts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Hip Thrusts is mapped to glutes_max with quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_hip_thrusts',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hip Thrusts is mapped to glutes_max with quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_bridging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Bridging is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_barbell_bridging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Barbell Bridging is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_bridging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Bridging is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_reverse_flutter_kicks',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Reverse Flutter Kicks is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bent-knee_hip_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-Knee Hip Extensions is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bridging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bridging is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_hip_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Hip Extensions is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_bridging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Bridging is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_hip_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Hip Extensions is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_hip_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Hip Extensions is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_single_leg_romanian_deadlift',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Single Leg Romanian Deadlift is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_lunges',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Lunges is mapped to glutes_max, quads with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_lunges',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Lunges is mapped to glutes_max, quads with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_lunges',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Lunges is mapped to glutes_max, quads with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_burpees',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Burpees is mapped to chest, quads, hamstrings, calves with delts_front/triceps/abs_rectus/abs_obliques/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cosak_squat',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cosak Squat is mapped to glutes_max, quads.',
  },
  {
    exerciseDefinitionId: 'sys_one-dumbbell_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Dumbbell Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_front_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Front Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_barbell_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Barbell Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bench_dumbbell_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bench Dumbbell Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_front_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Front Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_goblet_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Goblet Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_goblet_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Goblet Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_smith_machine_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Smith Machine Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_kettlebell_pistol_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kettlebell Pistol Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_pistol_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Pistol Squats is mapped to glutes_max, quads with spinal_erectors/abs_rectus/abs_obliques/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_bulgarian_split_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Bulgarian Split Squats is mapped to glutes_max, quads with adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bulgarian_split_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bulgarian Split Squats is mapped to glutes_max, quads with adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_dumbbell_bulgarian_split_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dumbbell Bulgarian Split Squats is mapped to glutes_max, quads with adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_hack_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Hack Squats is mapped to glutes_max, quads with adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_machine_pendulum_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Pendulum Squats is mapped to glutes_max, quads with adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_star_jumps',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Star Jumps is mapped to glutes_max, quads, hamstrings, calves with delts_front/chest/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_one-leg_leg_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable One-Leg Leg Extensions is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_leg_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Leg Extensions is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_one-leg_leg_extensions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Leg Leg Extensions is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_reverse_nordics_assisted',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Reverse Nordics (assisted) is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_single_leg_extension_isohold',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Single Leg Extension Isohold is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_sissy_squat',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Sissy Squat is mapped to quads with glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_leg_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Leg Presses is mapped to quads with glutes_max/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_one-leg_leg_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'One-Leg Leg Presses is mapped to quads with glutes_max/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_leg_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Leg Presses is mapped to quads with glutes_max/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_one-leg_leg_presses',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated One-Leg Leg Presses is mapped to quads with glutes_max/adductors/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_power_squats',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Power Squats is mapped to quads, adductors with spinal_erectors/abs_rectus/abs_obliques/glutes_max/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_half_burpees',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Half Burpees is mapped to quads, hamstrings, calves with delts_front/chest/triceps/abs_rectus/abs_obliques/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cable_adductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cable Adductions is mapped to adductors.',
  },
  {
    exerciseDefinitionId: 'sys_machine_adductions',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Machine Adductions is mapped to adductors.',
  },
  {
    exerciseDefinitionId: 'sys_barbell_good_mornings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Barbell Good Mornings is mapped to hamstrings with spinal_erectors/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_barbell_good_mornings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Barbell Good Mornings is mapped to hamstrings with spinal_erectors/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_smith_machine_good_mornings',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Smith Machine Good Mornings is mapped to hamstrings with spinal_erectors/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_one-leg_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying One-Leg Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_nordic_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Nordic Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_seated_one-leg_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated One-Leg Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_leg_curls',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Leg Curls is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_donkey_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Donkey Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_seated_barbell_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Barbell Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_seated_dumbbell_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Dumbbell Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_seated_machine_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Seated Machine Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_standing_barbell_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Barbell Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_standing_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_standing_dumbbell_one-leg_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Dumbbell One-Leg Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_standing_machine_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Machine Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_standing_one-leg_calf_raises',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing One-Leg Calf Raises is mapped to calves.',
  },
  {
    exerciseDefinitionId: 'sys_swimming',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Swimming is mapped to delts_front, chest, back_lats, triceps, biceps, glutes_max, quads, hamstrings, calves with traps_upper/spinal_erectors/abs_rectus/abs_obliques/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_battle_ropes_alternating_waves',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Battle Ropes Alternating Waves is mapped to delts_front, traps_upper, back_lats, triceps, biceps, forearms_grip with chest/spinal_erectors/abs_rectus/abs_obliques/glutes_max/quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_battle_ropes_double_waves',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Battle Ropes Double Waves is mapped to delts_front, traps_upper, back_lats, triceps, biceps, forearms_grip with chest/spinal_erectors/abs_rectus/abs_obliques/glutes_max/quads/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_boxing',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Boxing is mapped to delts_front, triceps, biceps with chest/traps_upper/back_lats/spinal_erectors/abs_rectus/abs_obliques/glutes_max/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_rowing',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Rowing is mapped to back_lats, hamstrings with delts_front/traps_upper/spinal_erectors/biceps/glutes_max/quads/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_cycling',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cycling is mapped to glutes_max, quads with hamstrings/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_stationary_cycling',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Stationary Cycling is mapped to glutes_max, quads with hamstrings/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_elliptical_trainer',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Elliptical Trainer is mapped to glutes_max, quads, hamstrings with delts_front/chest/traps_upper/back_lats/spinal_erectors/triceps/biceps/calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_jumping_rope',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Jumping Rope is mapped to glutes_max, quads, hamstrings, calves with delts_front/biceps/forearms_grip/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_jumping_rope_double_unders',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Jumping Rope Double Unders is mapped to glutes_max, quads, hamstrings, calves with delts_front/biceps/forearms_grip/adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_jogging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Jogging is mapped to glutes_max, quads, hamstrings, calves with adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_stationary_stair_climbing',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Stationary Stair Climbing is mapped to glutes_max, quads, hamstrings, calves with adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_treadmill_jogging',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Treadmill Jogging is mapped to glutes_max, quads, hamstrings, calves with adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_treadmill_walking',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Treadmill Walking is mapped to glutes_max, quads, hamstrings, calves with adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_walking',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Walking is mapped to glutes_max, quads, hamstrings, calves with adductors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_front_elbow_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Front Elbow Pull Stretch is mapped to delts_front with traps_upper/back_lats/triceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_palms-in_back_arm_extension_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Palms-In Back Arm Extension Stretch is mapped to delts_front, chest, biceps.',
  },
  {
    exerciseDefinitionId: 'sys_straight-arm_torso_rotation_stretch_at_wall',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Arm Torso Rotation Stretch at Wall is mapped to delts_front, chest, biceps.',
  },
  {
    exerciseDefinitionId: 'sys_child_pose_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Child Pose Stretch is mapped to delts_front, back_lats with chest/spinal_erectors secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bent-arm_torso_rotation_stretch_at_wall',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-Arm Torso Rotation Stretch at Wall is mapped to chest with delts_front secondary.',
  },
  {
    exerciseDefinitionId: 'sys_straight-arm_torso_lean_stretch_in_corner',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Arm Torso Lean Stretch in Corner is mapped to chest with delts_front/traps_upper/biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_back_arm_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Back Arm Pull Stretch is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_cross-legged_seated_head_tilt_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cross-Legged Seated Head Tilt Stretch is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_standing_head_tilt_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Head Tilt Stretch is mapped to traps_upper.',
  },
  {
    exerciseDefinitionId: 'sys_dead_hang_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Dead Hang Stretch is mapped to back_lats with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_side_bend_stretch_at_wall',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Side Bend Stretch at Wall is mapped to back_lats with abs_obliques/glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_palms-out_upward_arm_extension_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Palms-Out Upward Arm Extension Stretch is mapped to back_lats, forearms_grip with biceps secondary.',
  },
  {
    exerciseDefinitionId: 'sys_back_elbow_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Back Elbow Pull Stretch is mapped to triceps with back_lats secondary.',
  },
  {
    exerciseDefinitionId: 'sys_palms-out_front_arm_extension_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Palms-Out Front Arm Extension Stretch is mapped to forearms_grip.',
  },
  {
    exerciseDefinitionId: 'sys_cobra_pose_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Cobra Pose Stretch is mapped to abs_rectus, abs_obliques with glutes_max/hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_lying_hip_rotation_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Lying Hip Rotation Stretch is mapped to glutes_max with abs_obliques secondary.',
  },
  {
    exerciseDefinitionId: 'sys_bent-knee_lying_leg_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Bent-Knee Lying Leg Pull Stretch is mapped to glutes_max with hamstrings secondary.',
  },
  {
    exerciseDefinitionId: 'sys_side-lying_back_foot_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Side-Lying Back Foot Pull Stretch is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_standing_back_foot_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Back Foot Pull Stretch is mapped to quads.',
  },
  {
    exerciseDefinitionId: 'sys_kneeling_lunge_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Kneeling Lunge Stretch is mapped to quads with glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_straight-leg_lying_leg_pull_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Straight-Leg Lying Leg Pull Stretch is mapped to hamstrings with glutes_max secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_one-leg_leg_extension_stretch',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing One-Leg Leg Extension Stretch is mapped to hamstrings with calves secondary.',
  },
  {
    exerciseDefinitionId: 'sys_standing_lunge_stretch_at_wall',
    sourceReferenceIds: ['exrx-resistance-exercise-directory'],
    rationale: 'Standing Lunge Stretch at Wall is mapped to calves.',
  },
];

export const SYSTEM_EXERCISE_GRANULAR_WEIGHT_RATIONALES: GranularWeightRationale[] = [];

export const SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE: SystemExerciseCatalogSeedBundle = {
  muscleGroups: SYSTEM_MUSCLE_GROUP_SEEDS,
  exerciseDefinitions: SYSTEM_EXERCISE_DEFINITION_SEEDS,
  mappings: SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  sourceReferences: SYSTEM_EXERCISE_CATALOG_SOURCE_REFERENCES,
  exerciseDocumentation: SYSTEM_EXERCISE_SEED_DOCUMENTATION,
  granularWeightRationales: SYSTEM_EXERCISE_GRANULAR_WEIGHT_RATIONALES,
};

export type SystemExerciseCatalogSeedSummary = {
  muscleGroupCount: number;
  exerciseCount: number;
  mappingCount: number;
  defaultWeightPolicy: 'non-normalized (default ladder: 1.0 primary / 0.5 secondary)';
  familyCounts: { familyName: string; count: number }[];
  exerciseSummaries: {
    id: string;
    name: string;
    mappingCount: number;
    primaryMuscleIds: string[];
  }[];
  sourceReferences: Pick<SeedSourceReference, 'id' | 'title' | 'url' | 'type'>[];
};

const buildSeedSummary = (bundle: SystemExerciseCatalogSeedBundle): SystemExerciseCatalogSeedSummary => {
  const familyCounts = new Map<string, number>();

  for (const muscleGroup of bundle.muscleGroups) {
    familyCounts.set(muscleGroup.familyName, (familyCounts.get(muscleGroup.familyName) ?? 0) + 1);
  }

  const mappingsByExerciseId = new Map<string, SystemExerciseMuscleMappingSeed[]>();

  for (const mapping of bundle.mappings) {
    const existing = mappingsByExerciseId.get(mapping.exerciseDefinitionId);
    if (existing) {
      existing.push(mapping);
      continue;
    }

    mappingsByExerciseId.set(mapping.exerciseDefinitionId, [mapping]);
  }

  return {
    muscleGroupCount: bundle.muscleGroups.length,
    exerciseCount: bundle.exerciseDefinitions.length,
    mappingCount: bundle.mappings.length,
    defaultWeightPolicy: 'non-normalized (default ladder: 1.0 primary / 0.5 secondary)',
    familyCounts: [...familyCounts.entries()]
      .map(([familyName, count]) => ({ familyName, count }))
      .sort((a, b) => a.familyName.localeCompare(b.familyName)),
    exerciseSummaries: bundle.exerciseDefinitions.map((exercise) => {
      const mappings = mappingsByExerciseId.get(exercise.id) ?? [];

      return {
        id: exercise.id,
        name: exercise.name,
        mappingCount: mappings.length,
        primaryMuscleIds: mappings.filter((mapping) => mapping.role === 'primary').map((mapping) => mapping.muscleGroupId),
      };
    }),
    sourceReferences: bundle.sourceReferences.map(({ id, title, url, type }) => ({ id, title, url, type })),
  };
};

export const getSystemExerciseCatalogSeedSummary = (): SystemExerciseCatalogSeedSummary =>
  buildSeedSummary(SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE);

export const validateSystemExerciseCatalogSeeds = (
  bundle: SystemExerciseCatalogSeedBundle = SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE
): SystemExerciseCatalogSeedValidationIssue[] => {
  const issues: SystemExerciseCatalogSeedValidationIssue[] = [];

  const muscleIds = new Set<string>();
  for (const muscleGroup of bundle.muscleGroups) {
    if (muscleIds.has(muscleGroup.id)) {
      issues.push({
        code: 'duplicate_muscle_group_id',
        message: `Duplicate muscle group id: ${muscleGroup.id}`,
      });
    }
    muscleIds.add(muscleGroup.id);

    if (muscleGroup.isEditable !== 0) {
      issues.push({
        code: 'invalid_muscle_group_is_editable',
        message: `Muscle group ${muscleGroup.id} must be non-editable (isEditable=0) in M6 seeds`,
      });
    }

    if (!Number.isInteger(muscleGroup.sortOrder) || muscleGroup.sortOrder < 0) {
      issues.push({
        code: 'invalid_muscle_group_sort_order',
        message: `Muscle group ${muscleGroup.id} has invalid sortOrder ${muscleGroup.sortOrder}`,
      });
    }
  }

  const exerciseIds = new Set<string>();
  const exerciseNames = new Set<string>();
  for (const exercise of bundle.exerciseDefinitions) {
    if (exerciseIds.has(exercise.id)) {
      issues.push({
        code: 'duplicate_exercise_definition_id',
        message: `Duplicate exercise definition id: ${exercise.id}`,
      });
    }
    exerciseIds.add(exercise.id);

    const normalizedName = exercise.name.trim().toLowerCase();
    if (exerciseNames.has(normalizedName)) {
      issues.push({
        code: 'duplicate_exercise_definition_name',
        message: `Duplicate exercise definition name (case-insensitive): ${exercise.name}`,
      });
    }
    exerciseNames.add(normalizedName);
  }

  const sourceReferenceIds = new Set<string>();
  for (const source of bundle.sourceReferences) {
    if (sourceReferenceIds.has(source.id)) {
      issues.push({
        code: 'duplicate_source_reference_id',
        message: `Duplicate source reference id: ${source.id}`,
      });
    }
    sourceReferenceIds.add(source.id);

    if (!source.url.startsWith('http://') && !source.url.startsWith('https://')) {
      issues.push({
        code: 'invalid_source_reference_url',
        message: `Source reference ${source.id} must have an absolute http(s) URL`,
      });
    }
  }

  const exerciseDocumentationById = new Map<string, SeedExerciseDocumentation>();
  for (const documentation of bundle.exerciseDocumentation) {
    if (exerciseDocumentationById.has(documentation.exerciseDefinitionId)) {
      issues.push({
        code: 'duplicate_exercise_documentation',
        message: `Duplicate exercise documentation entry for ${documentation.exerciseDefinitionId}`,
      });
    }
    exerciseDocumentationById.set(documentation.exerciseDefinitionId, documentation);

    for (const sourceReferenceId of documentation.sourceReferenceIds) {
      if (!sourceReferenceIds.has(sourceReferenceId)) {
        issues.push({
          code: 'unknown_exercise_documentation_source',
          message: `Exercise documentation for ${documentation.exerciseDefinitionId} references unknown source ${sourceReferenceId}`,
        });
      }
    }
  }

  for (const exercise of bundle.exerciseDefinitions) {
    if (!exerciseDocumentationById.has(exercise.id)) {
      issues.push({
        code: 'missing_exercise_documentation',
        message: `Missing exercise documentation for ${exercise.id}`,
      });
    }
  }

  const granularWeightRationaleKeys = new Set<string>();
  for (const rationale of bundle.granularWeightRationales) {
    const key = createGranularWeightKey(rationale.exerciseDefinitionId, rationale.muscleGroupId, rationale.weight);
    if (granularWeightRationaleKeys.has(key)) {
      issues.push({
        code: 'duplicate_granular_weight_rationale',
        message: `Duplicate granular weight rationale for ${key}`,
      });
    }
    granularWeightRationaleKeys.add(key);

    for (const sourceReferenceId of rationale.sourceReferenceIds) {
      if (!sourceReferenceIds.has(sourceReferenceId)) {
        issues.push({
          code: 'unknown_granular_weight_rationale_source',
          message: `Granular weight rationale for ${key} references unknown source ${sourceReferenceId}`,
        });
      }
    }
  }

  const mappingPairs = new Set<string>();
  const mappedExerciseIds = new Set<string>();

  for (const mapping of bundle.mappings) {
    const pairKey = createMappingPairKey(mapping.exerciseDefinitionId, mapping.muscleGroupId);
    if (mappingPairs.has(pairKey)) {
      issues.push({
        code: 'duplicate_mapping_pair',
        message: `Duplicate mapping pair: ${pairKey}`,
      });
    }
    mappingPairs.add(pairKey);

    if (!exerciseIds.has(mapping.exerciseDefinitionId)) {
      issues.push({
        code: 'unknown_mapping_exercise_definition_id',
        message: `Mapping references unknown exerciseDefinitionId: ${mapping.exerciseDefinitionId}`,
      });
    } else {
      mappedExerciseIds.add(mapping.exerciseDefinitionId);
    }

    if (!muscleIds.has(mapping.muscleGroupId)) {
      issues.push({
        code: 'unknown_mapping_muscle_group_id',
        message: `Mapping references unknown muscleGroupId: ${mapping.muscleGroupId}`,
      });
    }

    if (!Number.isFinite(mapping.weight) || mapping.weight <= 0) {
      issues.push({
        code: 'invalid_mapping_weight',
        message: `Mapping ${pairKey} has invalid weight ${mapping.weight}`,
      });
    }

    if (!['primary', 'secondary'].includes(mapping.role)) {
      issues.push({
        code: 'invalid_mapping_role',
        message: `Mapping ${pairKey} has invalid role ${mapping.role}; M6 seeds allow only primary|secondary`,
      });
    }

    if (!DEFAULT_WEIGHTS.has(mapping.weight)) {
      const granularKey = createGranularWeightKey(mapping.exerciseDefinitionId, mapping.muscleGroupId, mapping.weight);
      if (!granularWeightRationaleKeys.has(granularKey)) {
        issues.push({
          code: 'undocumented_granular_weight',
          message: `Mapping ${pairKey} uses non-default weight ${mapping.weight} without a granular rationale`,
        });
      }
    }
  }

  for (const exercise of bundle.exerciseDefinitions) {
    if (!mappedExerciseIds.has(exercise.id)) {
      issues.push({
        code: 'exercise_missing_mapping',
        message: `Exercise ${exercise.id} has no muscle mappings`,
      });
    }
  }

  return issues;
};

export const assertValidSystemExerciseCatalogSeeds = (
  bundle: SystemExerciseCatalogSeedBundle = SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE
) => {
  const issues = validateSystemExerciseCatalogSeeds(bundle);

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    `Invalid M6 system exercise catalog seeds (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues
      .map((issue) => issue.message)
      .join(' | ')}`
  );
};

export type SystemExerciseCatalogSeedVerifyResult = {
  muscleGroupCount: number;
  exerciseCount: number;
  mappingCount: number;
  exercisesMissingMappings: string[];
};

export const verifySeededSystemExerciseCatalog = (database: LocalDatabase): SystemExerciseCatalogSeedVerifyResult => {
  const seedExerciseIds = SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id);
  const seedMuscleIds = SYSTEM_MUSCLE_GROUP_SEEDS.map((muscleGroup) => muscleGroup.id);

  const seededMuscleRows = database
    .select({ id: muscleGroups.id })
    .from(muscleGroups)
    .where(inArray(muscleGroups.id, seedMuscleIds))
    .all();

  const seededExerciseRows = database
    .select({ id: exerciseDefinitions.id })
    .from(exerciseDefinitions)
    .where(inArray(exerciseDefinitions.id, seedExerciseIds))
    .all();

  const seededMappingRows = database
    .select({
      exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
      muscleGroupId: exerciseMuscleMappings.muscleGroupId,
    })
    .from(exerciseMuscleMappings)
    .where(inArray(exerciseMuscleMappings.exerciseDefinitionId, seedExerciseIds))
    .all();

  const mappedExerciseIds = new Set(seededMappingRows.map((row) => row.exerciseDefinitionId));
  const exercisesMissingMappings = seedExerciseIds.filter((exerciseId) => !mappedExerciseIds.has(exerciseId));

  return {
    muscleGroupCount: seededMuscleRows.length,
    exerciseCount: seededExerciseRows.length,
    mappingCount: seededMappingRows.length,
    exercisesMissingMappings,
  };
};

/**
 * Reads the singleton `appliedSeedMigrationAppVersion` marker from
 * `sync_runtime_state`.
 *
 * Returns `0` when the row does not exist or the marker has not been set
 * (the seeder has not run on this device yet). Any non-zero integer means
 * the catalog was seeded under that bundle version; the seeder may re-seed
 * when the constant {@link SEED_CATALOG_BUNDLE_VERSION} ships a higher
 * value than the persisted marker.
 */
const readSeedsAppliedMarker = (database: LocalDatabase): number => {
  const row = database
    .select({
      appliedSeedMigrationAppVersion: syncRuntimeState.appliedSeedMigrationAppVersion,
    })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, SEED_RUNTIME_STATE_ID))
    .get();

  return row?.appliedSeedMigrationAppVersion ?? 0;
};

/**
 * Persists the `appliedSeedMigrationAppVersion` marker on the singleton
 * `sync_runtime_state` row, creating the row if it does not exist yet.
 * Subsequent seeder calls observe a marker >= the current bundle version
 * and short-circuit.
 */
const writeSeedsAppliedMarker = (database: LocalDatabase, version: number) => {
  database
    .insert(syncRuntimeState)
    .values({
      id: SEED_RUNTIME_STATE_ID,
      appliedSeedMigrationAppVersion: version,
    })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: {
        appliedSeedMigrationAppVersion: version,
      },
    })
    .run();
};

/**
 * Seed the client-only muscle-group taxonomy at boot.
 *
 * Muscle groups are a static, read-only taxonomy that never crosses the sync
 * wire — every device seeds its own copy from the bundle, independent of sign-in
 * and independent of the first-sync bootstrap. So this runs at boot, decoupled
 * from the entity-catalog seeder (which is gated on the first full pull). It is
 * an all-or-nothing insert today: when the table is empty it inserts every
 * bundle row; once any row exists it is a no-op, preserving existing rows
 * verbatim. The insert uses `onConflictDoNothing` so a partially-populated table
 * never throws on a primary-key collision.
 */
export const seedMuscleGroups = (database: LocalDatabase, now: Date = new Date()) => {
  const existing = database.select({ id: muscleGroups.id }).from(muscleGroups).limit(1).get();
  if (existing) {
    return;
  }

  database.transaction((tx) => {
    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      tx.insert(muscleGroups)
        .values({
          ...muscleGroup,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: muscleGroups.id })
        .run();
    }
  });
};

/**
 * Seed the local muscle group / exercise definition / mapping tables exactly
 * once per install (per catalog bundle version). Subsequent calls (every app
 * launch, every sync bootstrap) observe the
 * `appliedSeedMigrationAppVersion` marker on `sync_runtime_state` and return
 * early without touching seeded rows.
 *
 * This guard is what protects user edits to seeded rows (e.g. renaming
 * "Bench Press" → "My Bench") from being overwritten and what stops the
 * bootstrap merge from queueing spurious convergence events for unchanged
 * seed rows on every launch.
 *
 * Use {@link resetLocalDataAndReseed} (dev-only) to clear the marker and
 * force a re-seed.
 */
export const seedSystemExerciseCatalog = (database: LocalDatabase, now: Date = new Date()) => {
  if (readSeedsAppliedMarker(database) >= SEED_CATALOG_BUNDLE_VERSION) {
    return;
  }

  assertValidSystemExerciseCatalogSeeds();

  database.transaction((tx) => {
    const seedStampMs = nowMonotonic(tx);

    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      tx.insert(muscleGroups)
        .values({
          ...muscleGroup,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: muscleGroups.id,
          set: {
            displayName: muscleGroup.displayName,
            familyName: muscleGroup.familyName,
            sortOrder: muscleGroup.sortOrder,
            isEditable: 0,
            updatedAt: now,
          },
        })
        .run();
    }

    for (const exerciseDefinition of SYSTEM_EXERCISE_DEFINITION_SEEDS) {
      tx.insert(exerciseDefinitions)
        .values({
          ...exerciseDefinition,
          createdAt: now,
          updatedAt: now,
          localDirty: false,
          localUpdatedAtMs: seedStampMs,
        })
        .onConflictDoUpdate({
          target: exerciseDefinitions.id,
          set: {
            name: exerciseDefinition.name,
            updatedAt: now,
            localDirty: false,
            localUpdatedAtMs: seedStampMs,
          },
        })
        .run();
    }

    for (const mapping of SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS) {
      tx.insert(exerciseMuscleMappings)
        .values({
          ...mapping,
          createdAt: now,
          updatedAt: now,
          localDirty: false,
          localUpdatedAtMs: seedStampMs,
        })
        .onConflictDoUpdate({
          target: [exerciseMuscleMappings.exerciseDefinitionId, exerciseMuscleMappings.muscleGroupId],
          set: {
            weight: mapping.weight,
            role: mapping.role,
            updatedAt: now,
            localDirty: false,
            localUpdatedAtMs: seedStampMs,
          },
        })
        .run();
    }
  });

  const verification = verifySeededSystemExerciseCatalog(database);

  if (verification.muscleGroupCount !== SYSTEM_MUSCLE_GROUP_SEEDS.length) {
    throw new Error(
      `System exercise catalog seed verification failed: expected ${SYSTEM_MUSCLE_GROUP_SEEDS.length} muscle groups, found ${verification.muscleGroupCount}`
    );
  }

  if (verification.exerciseCount !== SYSTEM_EXERCISE_DEFINITION_SEEDS.length) {
    throw new Error(
      `System exercise catalog seed verification failed: expected ${SYSTEM_EXERCISE_DEFINITION_SEEDS.length} exercises, found ${verification.exerciseCount}`
    );
  }

  if (verification.mappingCount !== SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length) {
    throw new Error(
      `System exercise catalog seed verification failed: expected ${SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length} mappings, found ${verification.mappingCount}`
    );
  }

  if (verification.exercisesMissingMappings.length > 0) {
    throw new Error(
      `System exercise catalog seed verification failed: exercises missing mappings: ${verification.exercisesMissingMappings.join(', ')}`
    );
  }

  writeSeedsAppliedMarker(database, SEED_CATALOG_BUNDLE_VERSION);
};

/**
 * Test/dev-only helper: clears the `appliedSeedMigrationAppVersion` marker
 * (resetting it to `0`) so the next call to
 * {@link seedSystemExerciseCatalog} performs a full re-seed. Used by
 * `resetLocalDataAndReseed` and by tests that need to exercise the
 * first-seed code path against a database whose marker has already been
 * set. The `now` parameter is retained for callsite signature stability
 * with the v1 timestamp-based marker; it is unused.
 */
export const __clearSeedsAppliedMarkerForReset = (database: LocalDatabase, _now: Date = new Date()) => {
  database
    .update(syncRuntimeState)
    .set({
      appliedSeedMigrationAppVersion: 0,
    })
    .where(eq(syncRuntimeState.id, SEED_RUNTIME_STATE_ID))
    .run();
};

export type SeededSystemMuscleGroupRecord = {
  id: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
};

export const listSeededMuscleGroups = async (database: LocalDatabase): Promise<SeededSystemMuscleGroupRecord[]> => {
  const seedMuscleIds = SYSTEM_MUSCLE_GROUP_SEEDS.map((muscleGroup) => muscleGroup.id);

  return database
    .select({
      id: muscleGroups.id,
      displayName: muscleGroups.displayName,
      familyName: muscleGroups.familyName,
      sortOrder: muscleGroups.sortOrder,
    })
    .from(muscleGroups)
    .where(inArray(muscleGroups.id, seedMuscleIds))
    .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
    .all();
};

export type SeededExerciseMappingRecord = {
  muscleGroupId: string;
  weight: number;
  // Schema allows `stabilizer` even though M6 seed fixtures intentionally do not use it.
  role: 'primary' | 'secondary' | 'stabilizer' | null;
};

export type SeededExerciseDefinitionRecord = {
  id: string;
  name: string;
  mappings: SeededExerciseMappingRecord[];
};

export const listSeededExerciseDefinitionsWithMappings = async (
  database: LocalDatabase
): Promise<SeededExerciseDefinitionRecord[]> => {
  const seedExerciseIds = SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id);

  const exercises = database
    .select({
      id: exerciseDefinitions.id,
      name: exerciseDefinitions.name,
    })
    .from(exerciseDefinitions)
    .where(inArray(exerciseDefinitions.id, seedExerciseIds))
    .orderBy(asc(exerciseDefinitions.name))
    .all();

  const mappings = database
    .select({
      exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
      muscleGroupId: exerciseMuscleMappings.muscleGroupId,
      weight: exerciseMuscleMappings.weight,
      role: exerciseMuscleMappings.role,
    })
    .from(exerciseMuscleMappings)
    .where(inArray(exerciseMuscleMappings.exerciseDefinitionId, seedExerciseIds))
    .orderBy(asc(exerciseMuscleMappings.exerciseDefinitionId), asc(exerciseMuscleMappings.muscleGroupId))
    .all();

  return exercises.map((exercise) => ({
    ...exercise,
    mappings: mappings
      .filter((mapping) => mapping.exerciseDefinitionId === exercise.id)
      .map(({ exerciseDefinitionId: _exerciseDefinitionId, ...mapping }) => mapping),
  }));
};

export const getSeededExerciseMapping = (exerciseDefinitionId: string, muscleGroupId: string) =>
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.find(
    (mapping) => mapping.exerciseDefinitionId === exerciseDefinitionId && mapping.muscleGroupId === muscleGroupId
  ) ?? null;

export const hasSeededExerciseDefinition = (exerciseDefinitionId: string) =>
  SYSTEM_EXERCISE_DEFINITION_SEEDS.some((exercise) => exercise.id === exerciseDefinitionId);
