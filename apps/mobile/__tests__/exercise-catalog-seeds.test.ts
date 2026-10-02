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

/** A small hand-built bundle that trips every validation code at least once. */
const everyIssueBundle = (): SystemExerciseCatalogSeedBundle => ({
  muscleGroups: [
    { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0, isEditable: 0 },
    { id: 'chest', displayName: 'Chest again', familyName: 'Chest', sortOrder: 1, isEditable: 0 },
    { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: -1, isEditable: 1 as never },
    { id: 'legs', displayName: 'Legs', familyName: 'Legs', sortOrder: 1.5, isEditable: 0 },
  ],
  exerciseDefinitions: [
    { id: 'ex_a', name: 'Bench', loadInputMode: 'total_load', bodyweightContribution: 0 },
    { id: 'ex_a', name: ' bench ', loadInputMode: 'per_side_load', bodyweightContribution: 0 },
    { id: 'ex_b', name: 'Row', loadInputMode: 'bogus' as never, bodyweightContribution: 0 },
  ],
  sourceReferences: [
    { id: 'src1', title: 'One', url: 'https://example.com/1', type: 'study', note: '' },
    { id: 'src1', title: 'One again', url: 'http://example.com/1b', type: 'study', note: '' },
    { id: 'src2', title: 'Two', url: 'ftp://example.com/2', type: 'reference', note: '' },
  ],
  exerciseDocumentation: [
    { exerciseDefinitionId: 'ex_a', sourceReferenceIds: ['src1'], rationale: '' },
    { exerciseDefinitionId: 'ex_a', sourceReferenceIds: ['src1', 'nope'], rationale: '' },
  ],
  granularWeightRationales: [
    { exerciseDefinitionId: 'ex_a', muscleGroupId: 'chest', weight: 0.75, sourceReferenceIds: ['src1'], rationale: '' },
    { exerciseDefinitionId: 'ex_a', muscleGroupId: 'chest', weight: 0.75, sourceReferenceIds: ['ghost'], rationale: '' },
  ],
  mappings: [
    { id: 'm1', exerciseDefinitionId: 'ex_a', muscleGroupId: 'chest', weight: 1, role: 'primary' },
    { id: 'm2', exerciseDefinitionId: 'ex_a', muscleGroupId: 'chest', weight: 0.75, role: 'secondary' },
    { id: 'm3', exerciseDefinitionId: 'ghost_ex', muscleGroupId: 'ghost_mg', weight: 0, role: 'stabilizer' as never },
    { id: 'm4', exerciseDefinitionId: 'ex_a', muscleGroupId: 'back', weight: 0.75, role: 'secondary' },
    { id: 'm5', exerciseDefinitionId: 'ex_a', muscleGroupId: 'legs', weight: Number.NaN, role: 'secondary' },
  ],
});

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
  it('reports every issue code, in section order, with its message', () => {
    expect(validateSystemExerciseCatalogSeeds(everyIssueBundle()).map((issue) => [issue.code, issue.message])).toEqual([
      ['duplicate_muscle_group_id', 'Duplicate muscle group id: chest'],
      ['invalid_muscle_group_is_editable', 'Muscle group back must be non-editable (isEditable=0) in M6 seeds'],
      ['invalid_muscle_group_sort_order', 'Muscle group back has invalid sortOrder -1'],
      ['invalid_muscle_group_sort_order', 'Muscle group legs has invalid sortOrder 1.5'],
      ['duplicate_exercise_definition_id', 'Duplicate exercise definition id: ex_a'],
      ['duplicate_exercise_definition_name', 'Duplicate exercise definition name (case-insensitive):  bench '],
      ['duplicate_source_reference_id', 'Duplicate source reference id: src1'],
      ['invalid_source_reference_url', 'Source reference src2 must have an absolute http(s) URL'],
      ['duplicate_exercise_documentation', 'Duplicate exercise documentation entry for ex_a'],
      ['unknown_exercise_documentation_source', 'Exercise documentation for ex_a references unknown source nope'],
      ['invalid_exercise_load_input_mode', 'Exercise ex_b has invalid load input mode bogus'],
      ['missing_exercise_documentation', 'Missing exercise documentation for ex_b'],
      ['duplicate_granular_weight_rationale', 'Duplicate granular weight rationale for ex_a::chest::0.75'],
      [
        'unknown_granular_weight_rationale_source',
        'Granular weight rationale for ex_a::chest::0.75 references unknown source ghost',
      ],
      ['duplicate_mapping_pair', 'Duplicate mapping pair: ex_a::chest'],
      ['unknown_mapping_exercise_definition_id', 'Mapping references unknown exerciseDefinitionId: ghost_ex'],
      ['unknown_mapping_muscle_group_id', 'Mapping references unknown muscleGroupId: ghost_mg'],
      ['invalid_mapping_weight', 'Mapping ghost_ex::ghost_mg has invalid weight 0'],
      [
        'invalid_mapping_role',
        'Mapping ghost_ex::ghost_mg has invalid role stabilizer; M6 seeds allow only primary|secondary',
      ],
      ['undocumented_granular_weight', 'Mapping ghost_ex::ghost_mg uses non-default weight 0 without a granular rationale'],
      ['undocumented_granular_weight', 'Mapping ex_a::back uses non-default weight 0.75 without a granular rationale'],
      ['invalid_mapping_weight', 'Mapping ex_a::legs has invalid weight NaN'],
      ['undocumented_granular_weight', 'Mapping ex_a::legs uses non-default weight NaN without a granular rationale'],
      ['exercise_missing_mapping', 'Exercise ex_b has no muscle mappings'],
    ]);
  });

  it('throws one error listing every issue, in order', () => {
    const bundle = everyIssueBundle();
    expect(() => assertValidSystemExerciseCatalogSeeds(bundle)).toThrow(
      /^Invalid M6 system exercise catalog seeds \(24 issues\): Duplicate muscle group id: chest \| Muscle group back must be non-editable/,
    );
    bundle.muscleGroups = bundle.muscleGroups.slice(0, 1);
    bundle.exerciseDefinitions = bundle.exerciseDefinitions.slice(0, 1);
    bundle.sourceReferences = bundle.sourceReferences.slice(0, 1);
    bundle.exerciseDocumentation = bundle.exerciseDocumentation.slice(0, 1);
    bundle.granularWeightRationales = bundle.granularWeightRationales.slice(0, 1);
    bundle.mappings = bundle.mappings.slice(0, 1).map((mapping) => ({ ...mapping, weight: 0.4 }));
    expect(() => assertValidSystemExerciseCatalogSeeds(bundle)).toThrow(
      'Invalid M6 system exercise catalog seeds (1 issue): Mapping ex_a::chest uses non-default weight 0.4 without a granular rationale',
    );
  });
});
