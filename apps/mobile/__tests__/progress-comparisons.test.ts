import { aggregateProgressComparisons, compareProgressVolume, type ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import { aggregateStats, createStatsRepository, type StatsAggregationInput, type StatsStore } from '@/src/data/stats';
import { DEFAULT_PERSONAL_EFFORT_POLICY, type EffortCalculationPolicy } from '@/src/exercise-calculations/effort-policy';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';

const periods = {
  current: { start: new Date('2026-05-18T00:00:00Z'), end: new Date('2026-05-21T12:00:00Z') },
  previous: { start: new Date('2026-05-11T00:00:00Z'), end: new Date('2026-05-18T00:00:00Z') },
};
const input = (): StatsAggregationInput => ({
  effortPolicy: DEFAULT_PERSONAL_EFFORT_POLICY,
  exerciseDefinitions: [
    { id: 'lift', name: 'Lift', loadInputMode: 'total_load', bodyweightContribution: 0 },
    { id: 'old', name: 'Lift', loadInputMode: 'per_side_load', bodyweightContribution: 0 },
  ],
  sessions: [{ id: 'now', completedAt: new Date('2026-05-20T10:00:00Z') },
    { id: 'prev', completedAt: new Date('2026-05-13T10:00:00Z') }],
  sessionExercises: [
    { id: 'block', sessionId: 'now', exerciseDefinitionId: 'lift', exerciseName: 'Historical name' },
    { id: 'repeat', sessionId: 'now', exerciseDefinitionId: 'lift' },
    { id: 'old-block', sessionId: 'prev', exerciseDefinitionId: 'old' },
  ],
  exerciseSets: [
    { id: 'one', sessionExerciseId: 'block', setType: 'rir_2', weightValue: '40', repsValue: '5' },
    { id: 'two', sessionExerciseId: 'repeat', setType: null, weightValue: '60', repsValue: '5' },
    { id: 'old-set', sessionExerciseId: 'old-block', setType: 'rir_0', weightValue: '30', repsValue: '5' },
  ],
  muscleMappings: [
    { exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'secondary' },
    { exerciseDefinitionId: 'old', muscleGroupId: 'back', role: 'primary' },
    { exerciseDefinitionId: 'lift', muscleGroupId: 'arms', role: 'primary' },
    { exerciseDefinitionId: 'old', muscleGroupId: 'empty', role: 'stabilizer' },
  ],
  muscleGroups: [
    { id: 'empty', displayName: 'Empty', familyName: 'Legs', sortOrder: 30 },
    { id: 'arms', displayName: 'Arms', familyName: 'Arms', sortOrder: 20 },
    { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 10 },
  ],
});

const reconcile = (rows: ProgressMuscleComparison[], source: StatsAggregationInput) => {
  for (const period of ['current', 'previous'] as const) {
    const oracle = aggregateStats({ ...source, sessions: source.sessions.filter(session =>
      session.completedAt >= periods[period].start && session.completedAt < periods[period].end) });
    for (const muscle of rows) {
      const expected = oracle.muscleFamilies.flatMap(family => family.muscles).find(row => row.muscleGroupId === muscle.muscleGroupId);
      expect(muscle[period]).toMatchObject({ workingSetCount: expected!.workingSetCount,
        totalVolume: expected!.totalVolume });
      expect(muscle.exercises.reduce((sum, row) => sum + row[period].workingSetCount, 0)).toBe(muscle[period].workingSetCount);
      expect(muscle.exercises.reduce<number | null>((sum, row) => addFiniteVolume(sum, row[period].totalVolume), 0)).toBe(muscle[period].totalVolume);
      expect(muscle.exercises.reduce((sum, row) => sum + row[period].volumeSetCount, 0)).toBe(muscle[period].volumeSetCount);
      expect(muscle.exercises.reduce((sum, row) => sum + row.workingSetChange, 0)).toBe(muscle.workingSetChange);
    }
  }
};

it('keeps taxonomy order, zero muscles and previous-only definitions; repeated blocks count whole sets', () => {
  const source = input();
  const rows = aggregateProgressComparisons(source, periods);
  expect(rows.map(row => row.muscleGroupId)).toEqual(['back', 'arms', 'empty']);
  // Back is secondary on `lift` and primary on `old`: two halves now, one whole before.
  expect(rows[0]).toMatchObject({ current: { workingSetCount: 1, totalVolume: 125 },
    previous: { workingSetCount: 1, totalVolume: 150 }, workingSetChange: 0,
    volumeChange: { kind: 'percent', percent: -17 } });
  expect(rows[0].exercises).toMatchObject([
    { exerciseDefinitionId: 'lift', displayName: 'Lift', role: 'secondary',
      current: { workingSetCount: 1, totalVolume: 125 }, previous: { workingSetCount: 0 }, volumeChange: { kind: 'new' } },
    { exerciseDefinitionId: 'old', displayName: 'Lift', role: 'primary',
      current: { workingSetCount: 0 }, previous: { workingSetCount: 1, totalVolume: 150 }, volumeChange: { kind: 'percent', percent: -100 } },
  ]);
  expect(rows[2]).toMatchObject({ current: { workingSetCount: 0, totalVolume: 0 }, previous: { workingSetCount: 0, totalVolume: 0 }, exercises: [] });
  // Back and Arms overlap. There is deliberately no sum of their counts, and
  // Arms is primary on `lift` so its two sets stay whole.
  expect(rows[1].current.workingSetCount).toBe(2);
  reconcile(rows, source);
});

it('deduplicates source mappings at the strongest role, regardless of order or legacy weight', () => {
  const source = input();
  source.muscleMappings.push(
    { exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'primary', weight: 99 },
    { exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'secondary' },
    { exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'primary' });
  const rows = aggregateProgressComparisons(source, periods);
  expect(rows[0].current).toMatchObject({ workingSetCount: 2, totalVolume: 250, volumeSetCount: 2 });
  expect(rows[0].exercises[0].role).toBe('primary');
  source.muscleMappings.reverse();
  expect(aggregateProgressComparisons(source, periods)).toEqual(rows);
  reconcile(rows, source);
});

// Back is secondary on `lift`, so each working set it keeps is half a set.
it.each([
  ['default', DEFAULT_PERSONAL_EFFORT_POLICY, 1, 125, 2],
  ['warm-ups included', { workingSetEfforts: ['warm_up'], volumeEfforts: ['warm_up'] }, 0.5, 200, 1],
  ['independent columns / excluded RIR', { workingSetEfforts: ['unspecified'], volumeEfforts: ['warm_up'] }, 0.5, 200, 1],
  ['volume only', { workingSetEfforts: [], volumeEfforts: ['warm_up'] }, 0, 200, 1],
  ['working only', { workingSetEfforts: ['rir_2'], volumeEfforts: [] }, 0.5, 0, 0],
  ['both empty', { workingSetEfforts: [], volumeEfforts: [] }, 0, 0, 0],
] as [string, EffortCalculationPolicy, number, number, number][])(
  'settles %s effort choices independently and reconciles the summary', (_name, policy, workingSetCount, totalVolume, volumeSetCount) => {
    const source = input();
    source.effortPolicy = policy;
    source.exerciseSets.push({ id: 'warm', sessionExerciseId: 'block', setType: 'warm_up', weightValue: '80', repsValue: '10' });
    const rows = aggregateProgressComparisons(source, periods);
    expect(rows[0].current).toMatchObject({ workingSetCount, totalVolume, volumeSetCount });
    reconcile(rows, source);
  });

it('retains volume-only exercises even at zero load and omits planned, unperformed and unlinked rows', () => {
  const source = input();
  source.effortPolicy = { workingSetEfforts: [], volumeEfforts: ['unspecified'] };
  source.exerciseSets[1].weightValue = '';
  for (const performanceStatus of ['planned', 'unperformed', 'skipped'] as const) {
    source.exerciseSets.push({ id: performanceStatus, sessionExerciseId: 'block', setType: null,
      weightValue: '100', repsValue: '5', performanceStatus });
  }
  source.sessionExercises.push({ id: 'unlinked', sessionId: 'now', exerciseDefinitionId: null, exerciseName: 'Lift' });
  source.exerciseSets.push({ id: 'unlinked', sessionExerciseId: 'unlinked', setType: null, weightValue: '100', repsValue: '5' });
  const rows = aggregateProgressComparisons(source, periods);
  expect(rows[0].exercises).toHaveLength(1);
  expect(rows[0].exercises[0].current).toEqual({ workingSetCount: 0, totalVolume: 0, volumeSetCount: 1 });
  reconcile(rows, source);
});

it('leaves sets whose load cannot be calculated out of Volume ([[copy.no-inline-explanation]])', () => {
  const source = input();
  source.bodyweightCalculationsEnabled = true;
  source.exerciseDefinitions![0].bodyweightContribution = 2; // Malformed historical metadata: unknown load.
  const rows = aggregateProgressComparisons(source, periods);
  expect(rows[0]).toMatchObject({ current: { workingSetCount: 1, totalVolume: 0, volumeSetCount: 2 } });
  expect(rows[0].volumeChange.kind).not.toBe('unavailable');
  reconcile(rows, source);
});

it('shows the Volume of the rest when one exercise has unknown load', () => {
  const source = input();
  source.bodyweightCalculationsEnabled = true;
  source.exerciseDefinitions![1].bodyweightContribution = 2;
  source.sessions[1].completedAt = new Date('2026-05-20T11:00:00Z');
  const rows = aggregateProgressComparisons(source, periods);
  expect(rows[0].current).toMatchObject({ totalVolume: 125, volumeSetCount: 3 });
  reconcile(rows, source);
});

it('resolves bodyweight before per-side allocation and uses the current mapping', () => {
  const source = input();
  source.bodyweightCalculationsEnabled = true;
  source.sessions[0].bodyWeightKg = 80;
  source.exerciseDefinitions![0].bodyweightContribution = 1;
  source.exerciseDefinitions![0].loadInputMode = 'per_side_load';
  const rows = aggregateProgressComparisons(source, periods);
  // ((80 + 2*40)*5/2 + (80 + 2*60)*5/2) * secondary .5 = 450.
  expect(rows[0].current.totalVolume).toBe(450);
  expect(rows[1].current.totalVolume).toBe(900);
  source.muscleMappings[0].role = 'primary';
  expect(aggregateProgressComparisons(source, periods)[0].current.totalVolume).toBe(900);
  reconcile(rows, { ...source, muscleMappings: input().muscleMappings });
});

it('uses stable IDs and falls back to recorded labels only when definition names are absent', () => {
  const source = input();
  source.exerciseDefinitions = [];
  expect(aggregateProgressComparisons(source, periods)[0].exercises.map(row => row.displayName)).toEqual(['Historical name', 'old']);
});

it.each([
  [null, 10, { kind: 'unavailable' }], [10, null, { kind: 'unavailable' }],
  [Infinity, 10, { kind: 'unavailable' }], [0, 0, { kind: 'empty' }],
  [10, 0, { kind: 'new' }], [10, 10, { kind: 'percent', percent: 0 }],
  [20, 10, { kind: 'percent', percent: 100 }], [0, 10, { kind: 'percent', percent: -100 }],
  [Number.MAX_VALUE, Number.MIN_VALUE, { kind: 'increased' }],
])('compares Volume %s against %s without invented percentages', (current, previous, expected) => {
  expect(compareProgressVolume(current as number | null, previous as number | null)).toEqual(expected);
});

it('loads both periods once, including the previous weekend', async () => {
  const source = input();
  source.sessions.push({ id: 'weekend', completedAt: new Date('2026-05-16T10:00:00Z') });
  source.sessionExercises.push({ id: 'weekend-block', sessionId: 'weekend', exerciseDefinitionId: 'lift' });
  source.exerciseSets.push({ id: 'weekend-set', sessionExerciseId: 'weekend-block', setType: null, weightValue: '999', repsValue: '5' });
  const store: jest.Mocked<StatsStore> = { loadAggregationInput: jest.fn().mockResolvedValue(source), loadMuscleGroupTaxonomy: jest.fn() };
  const result = await createStatsRepository(store).computeProgressComparisons({ periodWeeks: 1, now: periods.current.end });
  expect(store.loadAggregationInput).toHaveBeenCalledTimes(1);
  // London calendar Mondays are at 23:00 UTC during British Summer Time.
  expect(store.loadAggregationInput).toHaveBeenCalledWith({ start: new Date('2026-05-10T23:00:00Z'), end: periods.current.end });
  expect(result.current.totals.workingSetCount).toBe(2);
  expect(result.previous.totals.workingSetCount).toBe(2);
  // Back: the weekend `lift` set at its secondary half plus the primary `old-set`.
  expect(result.muscles[0].previous).toMatchObject({ workingSetCount: 1.5, totalVolume: 1398.75 });
  expect(result.muscles[0].current.totalVolume).toBe(125);
});
