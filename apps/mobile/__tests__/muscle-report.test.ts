// The user's muscle setup as a pure transform ([[muscle.report-groups]]): entry-keyed
// analytics input becomes muscle-keyed input, and Detailed is the identity.
import {
  aggregateSelectedMuscleDailyEffort,
  applyMuscleReport,
  withoutSecondaryMappings,
  type MuscleAnalyticsInput,
  type MuscleReportAssignment,
} from '@/src/data/muscle-analytics';
import {
  BROAD_MUSCLE_PRESET,
  buildMuscleReportAssignment,
  reportGroupMuscleId,
  type MuscleReportRow,
} from '@/src/data/muscle-report-presets';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { aggregateStats } from '@/src/data/stats';

type Mapping = MuscleAnalyticsInput['muscleMappings'][number];

const detailedRows = (): MuscleReportRow[] =>
  SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) =>
    ({ id, displayName, familyName, sortOrder, reportGroup: null, tracked: 1 }));

/** The rows after choosing Broad: its table written onto the catalogue entries. */
const broadRows = (): MuscleReportRow[] => {
  const groupOf = new Map(BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) =>
    muscle.entries.map((entry) => [entry, muscle.key] as const)));
  return detailedRows().map((row) => ({
    ...row,
    reportGroup: groupOf.get(row.id) ?? null,
    tracked: BROAD_MUSCLE_PRESET.untracked.includes(row.id) ? 0 : 1,
  }));
};

const SESSION_AT = new Date('2026-05-20T10:00:00.000Z');

/** `exerciseDefinitionId`'s mappings trained over `sets` working sets of 100 kg × 5 (per-side). */
const inputFor = (
  muscleMappings: Mapping[], muscleGroups: MuscleAnalyticsInput['muscleGroups'], sets = 3,
): MuscleAnalyticsInput => ({
  sessions: [{ id: 'session', completedAt: SESSION_AT }],
  exerciseDefinitions: [{ id: 'squat', loadInputMode: 'per_side_load', bodyweightContribution: 0 }],
  sessionExercises: [{ id: 'block', sessionId: 'session', exerciseDefinitionId: 'squat', exerciseName: 'Squat' }],
  exerciseSets: Array.from({ length: sets }, (_, index) => ({
    id: `set-${index}`, sessionExerciseId: 'block', orderIndex: index, setType: null,
    weightValue: '100', repsValue: '5', performanceStatus: null,
  })),
  muscleMappings,
  muscleGroups,
});

const SQUAT: Mapping[] = [
  { exerciseDefinitionId: 'squat', muscleGroupId: 'quads', role: 'primary' },
  { exerciseDefinitionId: 'squat', muscleGroupId: 'glutes_max', role: 'secondary' },
  { exerciseDefinitionId: 'squat', muscleGroupId: 'adductors', role: 'secondary' },
  { exerciseDefinitionId: 'squat', muscleGroupId: 'spinal_erectors', role: 'secondary' },
];

const reported = (input: MuscleAnalyticsInput, rows: MuscleReportRow[]) =>
  applyMuscleReport(input, buildMuscleReportAssignment(rows));

const statsByMuscle = (input: MuscleAnalyticsInput) =>
  new Map(aggregateStats(input).muscleFamilies.flatMap((family) => family.muscles)
    .map((muscle) => [muscle.muscleGroupId, muscle]));

describe('Broad preset table', () => {
  const entryIds = SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => seed.id);

  it('places every catalogue entry exactly once, as a member or as untracked', () => {
    const placed = [...BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries), ...BROAD_MUSCLE_PRESET.untracked];
    expect([...placed].sort()).toEqual([...entryIds].sort());
  });

  it('has 11 muscles, each anchored on one of its own entries inside one family', () => {
    expect(BROAD_MUSCLE_PRESET.muscles).toHaveLength(11);
    const familyOf = new Map(SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => [seed.id, seed.familyName]));
    for (const muscle of BROAD_MUSCLE_PRESET.muscles) {
      expect(muscle.entries).toContain(muscle.anchor);
      // A merged entry sits in the family of its muscle, so families stay sections above muscles.
      for (const entry of muscle.entries) expect(familyOf.get(entry)).toBe(muscle.family);
    }
  });

  it('uses keys that are unique and never an entry id', () => {
    const keys = BROAD_MUSCLE_PRESET.muscles.map((muscle) => muscle.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(reportGroupMuscleId('glutes_hams')).toBe('group:glutes_hams');
    for (const entryId of SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => seed.id)) expect(entryId).not.toMatch(/:/);
  });
});

describe('Broad', () => {
  const GLUTES_HAMS = reportGroupMuscleId('glutes_hams');
  const QUADS = reportGroupMuscleId('quads');

  it('counts a squat x 3 as Quads 3 and Glutes & Hams 1.5, Volume once per muscle', () => {
    const input = inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS);
    const byMuscle = statsByMuscle(reported(input, broadRows()));

    expect(byMuscle.get(QUADS)).toMatchObject({ displayName: 'Quads', familyName: 'Legs', workingSetCount: 3 });
    expect(byMuscle.get(GLUTES_HAMS)).toMatchObject({ displayName: 'Glutes & Hams', workingSetCount: 1.5 });

    // Per-side 100 kg x 5 reps x 3 sets. Quads has a primary and a secondary entry
    // (Adductors): the collapse gives it the primary set's Volume, not both added.
    const detailed = statsByMuscle(input);
    expect(byMuscle.get(QUADS)?.totalVolume).toBe(detailed.get('quads')?.totalVolume);
    expect(byMuscle.get(GLUTES_HAMS)?.totalVolume).toBe(detailed.get('glutes_max')?.totalVolume);
  });

  it('collapses one exercise\'s entries of a muscle to one mapping at the strongest role', () => {
    const output = reported(inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS), broadRows());
    expect(output.muscleMappings).toEqual([
      { exerciseDefinitionId: 'squat', muscleGroupId: QUADS, role: 'primary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: GLUTES_HAMS, role: 'secondary' },
    ]);
  });

  it('takes a muscle at the strongest role any of its entries has, wherever it comes first', () => {
    const output = reported(inputFor([
      { exerciseDefinitionId: 'squat', muscleGroupId: 'hamstrings', role: 'secondary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'glutes_max', role: 'primary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'hip_abductors', role: 'stabilizer' },
    ], SYSTEM_MUSCLE_GROUP_SEEDS), broadRows());
    expect(output.muscleMappings).toEqual([
      { exerciseDefinitionId: 'squat', muscleGroupId: GLUTES_HAMS, role: 'primary' },
    ]);
  });

  it('replaces the muscle list with the tracked muscles, labelled and placed by the preset', () => {
    const { muscleGroups } = reported(inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS), broadRows());

    expect(muscleGroups).toHaveLength(11);
    expect(muscleGroups.map((muscle) => muscle.displayName)).toEqual([
      'Chest', 'Front Delts', 'Lateral Delts', 'Rear Delts', 'Back', 'Biceps', 'Triceps', 'Core',
      'Quads', 'Glutes & Hams', 'Calves',
    ]);
    // A merged muscle sorts where its anchor entry sorts.
    const glutes = muscleGroups.find((muscle) => muscle.id === GLUTES_HAMS);
    expect(glutes?.sortOrder).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.find((seed) => seed.id === 'glutes_max')?.sortOrder);
    // No entry id survives as a muscle: nothing is broken into its entries.
    expect(muscleGroups.map((muscle) => muscle.id)).not.toContain('serratus_anterior');
  });

  it('leaves custom muscles, and a report group this build does not know, as their own muscle', () => {
    const rows: MuscleReportRow[] = [
      ...broadRows(),
      { id: 'custom-neck', displayName: 'Neck', familyName: 'Neck', sortOrder: 40, reportGroup: null, tracked: 1 },
      { id: 'future-entry', displayName: 'Future', familyName: 'Core', sortOrder: 41, reportGroup: 'newer_group', tracked: 1 },
    ];
    const input = inputFor([
      { exerciseDefinitionId: 'squat', muscleGroupId: 'custom-neck', role: 'primary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'future-entry', role: 'secondary' },
    ], rows);
    const output = reported(input, rows);

    expect(output.muscleMappings.map((mapping) => mapping.muscleGroupId)).toEqual(['custom-neck', 'future-entry']);
    expect(output.muscleGroups.map((muscle) => muscle.id)).toEqual(expect.arrayContaining(['custom-neck', 'future-entry']));
  });
});

describe('untracked muscles', () => {
  it('contribute nothing, and an exercise mapped only to untracked entries contributes nothing', () => {
    const input = inputFor([
      { exerciseDefinitionId: 'squat', muscleGroupId: 'forearms_grip', role: 'primary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'rotator_cuff', role: 'secondary' },
    ], SYSTEM_MUSCLE_GROUP_SEEDS);
    const output = reported(input, broadRows());

    expect(output.muscleMappings).toEqual([]);
    expect(output.muscleGroups.map((muscle) => muscle.displayName)).not.toContain('Forearms');
    for (const muscle of statsByMuscle(output).values()) {
      expect(muscle).toMatchObject({ workingSetCount: 0, totalVolume: 0 });
    }
    expect(aggregateSelectedMuscleDailyEffort(output, { muscleGroupIds: ['forearms_grip'], timeZone: 'UTC' })).toEqual([]);
  });

  it('hide only the untracked entry, keep its tracked siblings, and leave exercise-level figures alone', () => {
    const rows = broadRows().map((row) => (row.id === 'adductors' ? { ...row, tracked: 0 } : row));
    const output = reported(inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS), rows);

    expect(output.muscleMappings.map((mapping) => mapping.muscleGroupId)).toEqual([
      reportGroupMuscleId('quads'), reportGroupMuscleId('glutes_hams'),
    ]);
    // Sets are the exercise's: the transform changes mappings, never the sets.
    expect(output.exerciseSets).toEqual(inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS).exerciseSets);
    expect(aggregateStats(output).workingSetCount).toBe(3);
  });

  it('drop a muscle none of whose entries is tracked from the list', () => {
    const rows = broadRows().map((row) => (row.reportGroup === 'calves' ? { ...row, tracked: 0 } : row));
    expect(reported(inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS), rows).muscleGroups.map((muscle) => muscle.displayName))
      .not.toContain('Calves');
  });
});

describe('Detailed', () => {
  const FIXTURES: Record<string, MuscleAnalyticsInput> = {
    squat: inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS),
    // A doubly mapped entry, a stabilizer, and a mapping to an entry missing from the list.
    mixed: inputFor([
      { exerciseDefinitionId: 'squat', muscleGroupId: 'chest', role: 'secondary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'chest', role: 'primary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'abs_rectus', role: 'stabilizer' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'removed-entry', role: 'primary' },
    ], SYSTEM_MUSCLE_GROUP_SEEDS),
  };

  it.each(Object.keys(FIXTURES))('returns the %s input\'s muscle list and figures unchanged', (name) => {
    const input = FIXTURES[name];
    const output = reported(input, detailedRows());

    expect(output.muscleGroups).toEqual(input.muscleGroups);
    expect(statsByMuscle(output)).toEqual(statsByMuscle(input));
    expect(aggregateStats(output)).toEqual(aggregateStats(input));
    const ids = input.muscleMappings.map((mapping) => mapping.muscleGroupId);
    expect(aggregateSelectedMuscleDailyEffort(output, { muscleGroupIds: ids, timeZone: 'UTC' }))
      .toEqual(aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ids, timeZone: 'UTC' }));
  });

  it('is the identity under an empty assignment too', () => {
    const input = FIXTURES.squat;
    expect(applyMuscleReport(input, new Map() as MuscleReportAssignment)).toEqual(input);
  });
});

describe('with the secondary filter', () => {
  it('filters secondary mappings first, then groups', () => {
    const rows = broadRows();
    const input = inputFor(SQUAT, SYSTEM_MUSCLE_GROUP_SEEDS);
    const primaryOnly = applyMuscleReport(withoutSecondaryMappings(input), buildMuscleReportAssignment(rows));

    expect(primaryOnly.muscleMappings).toEqual([
      { exerciseDefinitionId: 'squat', muscleGroupId: reportGroupMuscleId('quads'), role: 'primary' },
    ]);
    const byMuscle = statsByMuscle(primaryOnly);
    expect(byMuscle.get(reportGroupMuscleId('quads'))?.workingSetCount).toBe(3);
    expect(byMuscle.get(reportGroupMuscleId('glutes_hams'))?.workingSetCount).toBe(0);
  });

  it('leaves a muscle whose entries are all secondary with nothing once secondaries are hidden', () => {
    // Grouping first would keep the mapping (a group's role is its strongest entry's);
    // filtering first removes it, which is what hiding secondary work means.
    const input = inputFor([
      { exerciseDefinitionId: 'squat', muscleGroupId: 'glutes_max', role: 'secondary' },
      { exerciseDefinitionId: 'squat', muscleGroupId: 'hip_abductors', role: 'secondary' },
    ], SYSTEM_MUSCLE_GROUP_SEEDS);
    const assignment = buildMuscleReportAssignment(broadRows());
    expect(applyMuscleReport(withoutSecondaryMappings(input), assignment).muscleMappings).toEqual([]);
    expect(applyMuscleReport(input, assignment).muscleMappings).toHaveLength(1);
  });
});

describe('buildMuscleReportAssignment', () => {
  it('reads tracked from a 0/1 column or a boolean, and defaults nothing for unknown rows', () => {
    const rows: MuscleReportRow[] = [
      { id: 'a', displayName: 'A', familyName: 'F', sortOrder: 1, reportGroup: null, tracked: 0 },
      { id: 'b', displayName: 'B', familyName: 'F', sortOrder: 2, reportGroup: null, tracked: false },
      { id: 'c', displayName: 'C', familyName: 'F', sortOrder: 3, reportGroup: null, tracked: true },
      { id: 'd', displayName: 'D', familyName: 'F', sortOrder: 4, reportGroup: null, tracked: 1 },
    ];
    const assignment = buildMuscleReportAssignment(rows);
    expect([...assignment.values()].map((entry) => entry.tracked)).toEqual([false, false, true, true]);
    expect(assignment.get('a')?.muscle.id).toBe('a');
  });

  it('sorts a merged muscle at its first member when the anchor row is absent', () => {
    const rows: MuscleReportRow[] = [
      { id: 'adductors', displayName: 'Adductors', familyName: 'Legs', sortOrder: 17, reportGroup: 'quads', tracked: 1 },
      { id: 'hip_flexors', displayName: 'Hip flexors', familyName: 'Legs', sortOrder: 17, reportGroup: 'quads', tracked: 1 },
    ];
    expect(buildMuscleReportAssignment(rows).get('hip_flexors')?.muscle)
      .toEqual({ id: 'group:quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 17 });
  });
});
