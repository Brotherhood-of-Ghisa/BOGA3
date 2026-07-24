import {
  M6_SYSTEM_EXERCISE_SEED_POLICY_NOTE,
  assertValidSystemExerciseCatalogSeeds,
  getSystemExerciseCatalogSeedSummary,
  type SystemExerciseCatalogSeedBundle,
  SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_EXERCISE_SEED_DOCUMENTATION,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  validateSystemExerciseCatalogSeeds,
} from '@/src/data/exercise-catalog-seeds';

const M19_PRESERVED_INCLINE_SEED_IDS = [
  'seed_incline_dumbbell_press',
  'seed_incline_dumbbell_flys',
  'seed_incline_machine_bench_presses',
  'seed_incline_barbell_bench_presses',
  'seed_incline_cable_bench_presses',
  'seed_incline_dumbbell_bench_presses',
  'seed_incline_smith_machine_bench_presses',
  'seed_ball_incline_push-ups',
  'seed_incline_push-ups',
  'seed_incline_dumbbell_pullover',
  'seed_incline_barbell_rows',
  'seed_incline_dumbbell_rows',
  'seed_reverse_incline_barbell_rows',
  'seed_close-grip_incline_dumbbell_bench_presses',
  'seed_close-grip_incline_push-ups',
  'seed_incline_low_cable_triceps_extensions',
  'seed_alternating_incline_dumbbell_curls',
  'seed_alternating_incline_hammer_curls',
  'seed_incline_dumbbell_curls',
  'seed_incline_hammer_curls',
  'seed_alternating_incline_dumbbell_twist_curls',
  'seed_incline_dumbbell_twist_curls',
  'seed_incline_leg_raises',
  'seed_incline_sit-ups',
  'seed_incline_twist_sit-ups',
];

const M19_SUPPRESSED_DUPLICATE_SEED_IDS = [
  'seed_barbell_bench_presses',
  'seed_dumbbell_bench_presses',
  'seed_push-ups',
  'seed_pull-ups',
  'seed_planks',
  'seed_leg_extensions',
  'seed_leg_presses',
  'seed_front_elbow_pull_stretch',
];

const cloneSeedBundle = (
  bundle: SystemExerciseCatalogSeedBundle = SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE
): SystemExerciseCatalogSeedBundle => ({
  muscleGroups: bundle.muscleGroups.map((entry) => ({ ...entry })),
  exerciseDefinitions: bundle.exerciseDefinitions.map((entry) => ({ ...entry })),
  mappings: bundle.mappings.map((entry) => ({ ...entry })),
  sourceReferences: bundle.sourceReferences.map((entry) => ({ ...entry })),
  exerciseDocumentation: bundle.exerciseDocumentation.map((entry) => ({ ...entry, sourceReferenceIds: [...entry.sourceReferenceIds] })),
  granularWeightRationales: bundle.granularWeightRationales.map((entry) => ({
    ...entry,
    sourceReferenceIds: [...entry.sourceReferenceIds],
  })),
});

describe('M6 exercise catalog seeds', () => {
  it('assigns explicit load semantics to every starter exercise', () => {
    for (const exercise of SYSTEM_EXERCISE_DEFINITION_SEEDS) {
      expect(['total_load', 'per_side_load']).toContain(exercise.loadInputMode);
    }

    const mode = (id: string) =>
      SYSTEM_EXERCISE_DEFINITION_SEEDS.find((exercise) => exercise.id === id)?.loadInputMode;
    expect(mode('seed_barbell_bench_press')).toBe('total_load');
    expect(mode('seed_dumbbell_bench_press')).toBe('per_side_load');
    expect(mode('seed_dumbbell_one-arm_rows')).toBe('per_side_load');
    expect(mode('seed_incline_dumbbell_pullover')).toBe('total_load');

    for (const id of [
      'seed_arnold_presses',
      'seed_landmine_press',
      'seed_cable_flys',
      'seed_incline_cable_bench_presses',
      'seed_triceps_kickbacks',
      'seed_concentration_curls',
      'seed_hammer_curl',
      'seed_high_cable_curls',
      'seed_cable_hip_abductions',
      'seed_single_leg_romanian_deadlift',
      'seed_bulgarian_split_squat',
      'seed_standing_leg_curls',
    ]) {
      expect(mode(id)).toBe('per_side_load');
    }

    for (const id of [
      'seed_barbell_back_squat',
      'seed_pull_up',
      'seed_push_up',
      'seed_incline_dumbbell_pullover',
      'seed_dumbbell_goblet_squats',
    ]) {
      expect(mode(id)).toBe('total_load');
    }
  });

  it('ships a valid pruned default seed bundle and summary', () => {
    expect(validateSystemExerciseCatalogSeeds()).toEqual([]);
    expect(() => assertValidSystemExerciseCatalogSeeds()).not.toThrow();

    const summary = getSystemExerciseCatalogSeedSummary();

    expect(summary.muscleGroupCount).toBe(19);
    expect(summary.exerciseCount).toBe(136);
    expect(summary.mappingCount).toBe(412);
    expect(summary.defaultWeightPolicy).toContain('non-normalized');

    expect(M6_SYSTEM_EXERCISE_SEED_POLICY_NOTE).toContain('practical logging defaults');

    expect(SYSTEM_MUSCLE_GROUP_SEEDS.map((row) => row.id)).toContain('chest');
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.map((row) => row.id)).not.toContain('chest_sternal');
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.map((row) => row.id)).not.toContain('chest_upper');

    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((row) => row.id)).not.toContain('seed_side_plank');
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((row) => row.id)).not.toContain('seed_cable_triceps_pushdown');

    expect(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.every((mapping) => mapping.muscleGroupId !== 'chest_sternal')).toBe(true);
    expect(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.every((mapping) => mapping.muscleGroupId !== 'chest_upper')).toBe(true);
    expect(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.every((mapping) => ['primary', 'secondary'].includes(mapping.role))).toBe(true);
    expect(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.every((mapping) => [1, 0.5].includes(mapping.weight))).toBe(true);
  });

  it('ships the M19-pruned starter list while preserving every current incline seed', () => {
    const exerciseIds = new Set(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id));
    const exerciseNames = new Set(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.name));
    const mappingExerciseIds = new Set(
      SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.map((mapping) => mapping.exerciseDefinitionId)
    );
    const documentationExerciseIds = new Set(
      SYSTEM_EXERCISE_SEED_DOCUMENTATION.map((documentation) => documentation.exerciseDefinitionId)
    );

    expect(exerciseIds.size).toBe(136);
    expect(mappingExerciseIds.size).toBe(136);
    expect(documentationExerciseIds.size).toBe(136);

    for (const exerciseId of M19_PRESERVED_INCLINE_SEED_IDS) {
      expect(exerciseIds.has(exerciseId)).toBe(true);
      expect(mappingExerciseIds.has(exerciseId)).toBe(true);
      expect(documentationExerciseIds.has(exerciseId)).toBe(true);
    }

    for (const exerciseId of M19_SUPPRESSED_DUPLICATE_SEED_IDS) {
      expect(exerciseIds.has(exerciseId)).toBe(false);
      expect(mappingExerciseIds.has(exerciseId)).toBe(false);
      expect(documentationExerciseIds.has(exerciseId)).toBe(false);
    }

    expect(exerciseNames).toContain('Incline Dumbbell Fly');
    expect(exerciseNames).toContain('Incline Barbell Bench Press');
    expect(exerciseNames).toContain('Cable Triceps Pushdown');
    expect(exerciseNames).toContain('Single-Leg Leg Press');
    expect(exerciseNames).not.toContain('Incline Dumbbell Flys');
    expect(exerciseNames).not.toContain('Barbell Bench Presses');
    expect(exerciseNames).not.toContain('Push-Ups');
  });

  it('flags duplicate mappings and unknown referenced IDs', () => {
    const bundle = cloneSeedBundle();

    bundle.mappings.push({
      ...bundle.mappings[0],
      id: 'duplicate-pair-different-row-id',
    });

    bundle.mappings.push({
      id: 'bad-ref-row',
      exerciseDefinitionId: 'unknown_exercise',
      muscleGroupId: 'unknown_muscle',
      weight: 1,
      role: 'primary',
    });

    const issues = validateSystemExerciseCatalogSeeds(bundle);
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('duplicate_mapping_pair');
    expect(codes).toContain('unknown_mapping_exercise_definition_id');
    expect(codes).toContain('unknown_mapping_muscle_group_id');
  });

  it('flags undocumented non-default weights and invalid seed roles', () => {
    const bundle = cloneSeedBundle();

    bundle.mappings[0] = {
      ...bundle.mappings[0],
      weight: 0.33,
      role: 'stabilizer' as never,
    };

    const issues = validateSystemExerciseCatalogSeeds(bundle);
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('undocumented_granular_weight');
    expect(codes).toContain('invalid_mapping_role');
  });
});
