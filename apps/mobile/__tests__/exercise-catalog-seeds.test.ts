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

// The reviewed fresh-account catalogue, including the intentional coverage gaps.
const EXPECTED_STARTER = [
  {
    id: 'seed_barbell_bench_press', name: 'Barbell Bench Press',
    primary: ['chest'], secondary: ['delts_front', 'triceps'],
  },
  {
    id: 'seed_push_up', name: 'Push-Up',
    primary: ['chest'], secondary: ['delts_front', 'triceps', 'serratus_anterior'],
  },
  {
    id: 'seed_seated_dumbbell_overhead_press', name: 'Seated Dumbbell Shoulder Press',
    primary: ['delts_front'], secondary: ['delts_lateral', 'triceps', 'serratus_anterior', 'traps_upper', 'traps_lower'],
  },
  {
    id: 'seed_dumbbell_lateral_raise', name: 'Dumbbell Lateral Raise',
    primary: ['delts_lateral'], secondary: ['rotator_cuff'],
  },
  {
    id: 'seed_reverse_machine_flys', name: 'Reverse Machine Fly',
    primary: ['delts_rear'], secondary: ['back_upper'],
  },
  {
    id: 'seed_pull_up', name: 'Pull-Up',
    primary: ['back_lats'], secondary: ['biceps', 'brachialis', 'forearms_grip', 'back_upper', 'traps_lower'],
  },
  {
    id: 'seed_lat_pulldown', name: 'Lat Pulldown',
    primary: ['back_lats'], secondary: ['biceps', 'brachialis', 'forearms_grip', 'back_upper', 'traps_lower'],
  },
  {
    id: 'seed_seated_cable_row', name: 'Seated Cable Row',
    primary: ['back_upper'], secondary: ['back_lats', 'delts_rear', 'biceps', 'brachialis', 'forearms_grip'],
  },
  {
    id: 'seed_back_extensions', name: 'Back Extension',
    primary: ['spinal_erectors'], secondary: ['glutes_max', 'hamstrings'],
  },
  {
    id: 'seed_hammer_curl', name: 'Dumbbell Hammer Curl',
    primary: ['biceps', 'brachialis'], secondary: ['forearms_grip'],
  },
  {
    id: 'seed_push-downs', name: 'Cable Triceps Pushdown',
    primary: ['triceps'], secondary: [],
  },
  {
    id: 'seed_dumbbell_wrist_curls', name: 'Dumbbell Wrist Curl',
    primary: ['forearms_grip'], secondary: [],
  },
  {
    id: 'seed_cable_crunch', name: 'Cable Crunch',
    primary: ['abs_rectus'], secondary: ['abs_obliques'],
  },
  {
    id: 'seed_russian_twists', name: 'Russian Twist',
    primary: ['abs_obliques'], secondary: ['abs_rectus'],
  },
  {
    id: 'seed_hanging_leg_raises', name: 'Hanging Leg Raise',
    primary: ['hip_flexors', 'abs_rectus'], secondary: ['abs_obliques'],
  },
  {
    id: 'seed_barbell_back_squat', name: 'Barbell Back Squat',
    primary: ['quads', 'glutes_max'], secondary: ['adductors', 'spinal_erectors'],
  },
  {
    id: 'seed_romanian_deadlift', name: 'Barbell Romanian Deadlift',
    primary: ['hamstrings', 'glutes_max'], secondary: ['spinal_erectors'],
  },
  {
    id: 'seed_seated_leg_curl', name: 'Seated Leg Curl',
    primary: ['hamstrings'], secondary: [],
  },
  {
    id: 'seed_seated_machine_hip_abductions', name: 'Machine Hip Abduction',
    primary: ['hip_abductors'], secondary: ['glutes_max'],
  },
  {
    id: 'seed_machine_adductions', name: 'Machine Hip Adduction',
    primary: ['adductors'], secondary: [],
  },
  {
    id: 'seed_standing_machine_calf_raises', name: 'Machine Calf Raise',
    primary: ['calves'], secondary: [],
  },
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

describe('exercise catalog seeds', () => {
  it('uses per-side entry only for the four retained dumbbell exercises', () => {
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.filter((seed) => seed.loadInputMode === 'per_side_load')
      .map((seed) => seed.id).sort()).toEqual([
      'seed_dumbbell_lateral_raise', 'seed_dumbbell_wrist_curls',
      'seed_hammer_curl', 'seed_seated_dumbbell_overhead_press',
    ]);
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.filter((seed) => seed.loadInputMode === 'total_load'))
      .toHaveLength(17);
  });

  it.each(EXPECTED_STARTER)('ships singular $name with the reviewed primary and secondary mappings', (expected) => {
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.find((seed) => seed.id === expected.id)?.name).toBe(expected.name);
    const mappings = SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.filter((mapping) => mapping.exerciseDefinitionId === expected.id);
    expect(mappings.filter((mapping) => mapping.role === 'primary').map((mapping) => mapping.muscleGroupId).sort())
      .toEqual([...expected.primary].sort());
    expect(mappings.filter((mapping) => mapping.role === 'secondary').map((mapping) => mapping.muscleGroupId).sort())
      .toEqual([...expected.secondary].sort());
    expect(mappings.every((mapping) => mapping.weight === (mapping.role === 'primary' ? 1 : 0.5))).toBe(true);
  });

  it('covers 20 muscles directly, four secondarily, and intentionally leaves tibialis uncovered', () => {
    const primary = new Set(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.filter((m) => m.role === 'primary').map((m) => m.muscleGroupId));
    const secondary = new Set(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.filter((m) => m.role === 'secondary').map((m) => m.muscleGroupId));
    expect(primary.size).toBe(20);
    expect([...secondary].filter((id) => !primary.has(id)).sort())
      .toEqual(['rotator_cuff', 'serratus_anterior', 'traps_lower', 'traps_upper']);
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.filter((muscle) => !primary.has(muscle.id) && !secondary.has(muscle.id))
      .map((muscle) => muscle.id)).toEqual(['tibialis_anterior']);
  });

  it('ships a valid pruned default seed bundle and summary', () => {
    expect(validateSystemExerciseCatalogSeeds()).toEqual([]);
    expect(() => assertValidSystemExerciseCatalogSeeds()).not.toThrow();

    const summary = getSystemExerciseCatalogSeedSummary();

    expect(summary.muscleGroupCount).toBe(25);
    expect(summary.exerciseCount).toBe(21);
    expect(summary.mappingCount).toBe(62);
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

  it('includes Tibialis Anterior after Calves in Lower Legs', () => {
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.filter((muscle) => muscle.familyName === 'Lower Legs')).toEqual([
      { id: 'calves', displayName: 'Calves', familyName: 'Lower Legs', sortOrder: 18, isEditable: 0 },
      { id: 'tibialis_anterior', displayName: 'Tibialis Anterior', familyName: 'Lower Legs', sortOrder: 19, isEditable: 0 },
    ]);
  });

  it.each([
    { id: 'chest', displayName: 'Pectoralis', familyName: 'Chest' },
    { id: 'back_upper', displayName: 'Upper back', familyName: 'Back' },
    { id: 'forearms_grip', displayName: 'Forearms', familyName: 'Arms' },
    { id: 'abs_rectus', displayName: 'Abs', familyName: 'Core' },
    { id: 'hip_abductors', displayName: 'Hip Abductors', familyName: 'Legs' },
    { id: 'hip_flexors', displayName: 'Hip flexors', familyName: 'Legs' },
    { id: 'rotator_cuff', displayName: 'Rotator Cuff', familyName: 'Shoulders' },
    { id: 'serratus_anterior', displayName: 'Serratus Anterior', familyName: 'Chest' },
    { id: 'traps_lower', displayName: 'Lower Traps', familyName: 'Back' },
    { id: 'brachialis', displayName: 'Brachialis', familyName: 'Arms' },
  ])('includes $displayName in $familyName', (muscle) => {
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.find((seed) => seed.id === muscle.id)).toMatchObject(muscle);
  });

  it('keeps each muscle family together in catalog sort order', () => {
    const families = [...SYSTEM_MUSCLE_GROUP_SEEDS]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName))
      .map((muscle) => muscle.familyName);
    expect(families.filter((family, index) => index === 0 || family !== families[index - 1])).toEqual([
      'Chest', 'Shoulders', 'Back', 'Arms', 'Core', 'Legs', 'Lower Legs',
    ]);
  });

  it('contains exactly the reviewed identities, mappings and documentation', () => {
    const expectedIds = EXPECTED_STARTER.map((seed) => seed.id).sort();
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((seed) => seed.id).sort()).toEqual(expectedIds);
    expect([...new Set(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.map((mapping) => mapping.exerciseDefinitionId))].sort())
      .toEqual(expectedIds);
    expect(SYSTEM_EXERCISE_SEED_DOCUMENTATION.map((doc) => doc.exerciseDefinitionId).sort()).toEqual(expectedIds);
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
      ['invalid_muscle_group_is_editable', 'Muscle group back must be non-editable (isEditable=0) in system seeds'],
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
        'Mapping ghost_ex::ghost_mg has invalid role stabilizer; system seeds allow only primary|secondary',
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
      /^Invalid system exercise catalog seeds \(24 issues\): Duplicate muscle group id: chest \| Muscle group back must be non-editable/,
    );
    bundle.muscleGroups = bundle.muscleGroups.slice(0, 1);
    bundle.exerciseDefinitions = bundle.exerciseDefinitions.slice(0, 1);
    bundle.sourceReferences = bundle.sourceReferences.slice(0, 1);
    bundle.exerciseDocumentation = bundle.exerciseDocumentation.slice(0, 1);
    bundle.granularWeightRationales = bundle.granularWeightRationales.slice(0, 1);
    bundle.mappings = bundle.mappings.slice(0, 1).map((mapping) => ({ ...mapping, weight: 0.4 }));
    expect(() => assertValidSystemExerciseCatalogSeeds(bundle)).toThrow(
      'Invalid system exercise catalog seeds (1 issue): Mapping ex_a::chest uses non-default weight 0.4 without a granular rationale',
    );
  });
});
