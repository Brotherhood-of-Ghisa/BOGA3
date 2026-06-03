import {
  M6_SYSTEM_EXERCISE_SEED_POLICY_NOTE,
  assertValidSystemExerciseCatalogSeeds,
  getSystemExerciseCatalogSeedSummary,
  type SystemExerciseCatalogSeedBundle,
  SYSTEM_EXERCISE_CATALOG_SEED_BUNDLE,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  validateSystemExerciseCatalogSeeds,
} from '@/src/data/exercise-catalog-seeds';

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
  it('ships a valid expanded default seed bundle and summary', () => {
    expect(validateSystemExerciseCatalogSeeds()).toEqual([]);
    expect(() => assertValidSystemExerciseCatalogSeeds()).not.toThrow();

    const summary = getSystemExerciseCatalogSeedSummary();

    expect(summary.muscleGroupCount).toBe(19);
    expect(summary.exerciseCount).toBe(393);
    expect(summary.mappingCount).toBe(1194);
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
