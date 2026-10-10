// One rule for a muscle's set count ([[muscle.set-count]]) across every surface
// that derives one: a working set gives a muscle 1 where it maps as primary and
// half where it maps as secondary, counted once per muscle at its strongest role.
// The last test is the cross-surface one: the session summary and Progress must
// report the same figure for the same session.
import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleDailyEffortMetrics,
  aggregateSelectedMuscleWeeklyEffort,
  collectMuscleSetContributions,
  countMuscleSets,
  type MuscleAnalyticsInput,
} from '@/src/data/muscle-analytics';
import { aggregateProgressComparisons } from '@/src/data/progress-comparisons';
import { aggregateStats } from '@/src/data/stats';
import {
  adaptCurrentSessionToMuscleAnalyticsInput,
  summarizeCurrentSessionMuscleLoad,
  type CurrentSessionMuscleSummaryInput,
} from '@/src/session-insights';

const AT = new Date('2026-05-20T10:00:00.000Z');
const periods = {
  current: { start: new Date('2026-05-18T00:00:00.000Z'), end: new Date('2026-05-25T00:00:00.000Z') },
  previous: { start: new Date('2026-05-11T00:00:00.000Z'), end: new Date('2026-05-18T00:00:00.000Z') },
};

const MUSCLE_GROUPS = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 10 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 20 },
  { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 30 },
  { id: 'delts', displayName: 'Delts', familyName: 'Shoulders', sortOrder: 40 },
  { id: 'core', displayName: 'Core', familyName: 'Core', sortOrder: 50 },
];

// Bench: three working sets and a warm-up. Curl: two working sets.
// chest is mixed (primary on bench, secondary on curl), triceps secondary only,
// biceps primary only, delts mapped twice on bench, core stabilizer only.
const MUSCLE_MAPPINGS = [
  { exerciseDefinitionId: 'bench', muscleGroupId: 'chest', role: 'primary' as const },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'triceps', role: 'secondary' as const },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'delts', role: 'secondary' as const },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'delts', role: 'primary' as const },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'core', role: 'stabilizer' as const },
  { exerciseDefinitionId: 'curl', muscleGroupId: 'biceps', role: 'primary' as const },
  { exerciseDefinitionId: 'curl', muscleGroupId: 'chest', role: 'secondary' as const },
];

const sessionInput = (): CurrentSessionMuscleSummaryInput => ({
  sessionId: 'target',
  sessionAt: AT,
  exercises: [
    {
      id: 'bench-block', orderIndex: 0, exerciseDefinitionId: 'bench', exerciseName: 'Bench',
      sets: [
        { id: 'bench-warm', orderIndex: 0, setType: 'warm_up', weightValue: '40', repsValue: '10', performanceStatus: null },
        { id: 'bench-1', orderIndex: 1, setType: null, weightValue: '100', repsValue: '5', performanceStatus: null },
        { id: 'bench-2', orderIndex: 2, setType: 'rir_1', weightValue: '100', repsValue: '5', performanceStatus: null },
        { id: 'bench-3', orderIndex: 3, setType: 'rir_0', weightValue: '100', repsValue: '5', performanceStatus: null },
      ],
    },
    {
      id: 'curl-block', orderIndex: 1, exerciseDefinitionId: 'curl', exerciseName: 'Curl',
      sets: [
        { id: 'curl-1', orderIndex: 0, setType: null, weightValue: '20', repsValue: '10', performanceStatus: null },
        { id: 'curl-2', orderIndex: 1, setType: null, weightValue: '20', repsValue: '10', performanceStatus: null },
      ],
    },
  ],
  exerciseDefinitions: [
    { id: 'bench', loadInputMode: 'per_side_load', bodyweightContribution: 0 },
    { id: 'curl', loadInputMode: 'per_side_load', bodyweightContribution: 0 },
  ],
  muscleMappings: MUSCLE_MAPPINGS,
  muscleGroups: MUSCLE_GROUPS,
});

const analyticsInput = (): MuscleAnalyticsInput => adaptCurrentSessionToMuscleAnalyticsInput(sessionInput());

/** The figure every unqualified `Sets` for a muscle must show. */
const EXPECTED_WEIGHTED = { chest: 4, triceps: 1.5, biceps: 2, delts: 3, core: 0 };

describe('the muscle set-count rule itself', () => {
  it('splits primary, secondary and stabilizer, and counts a doubly mapped muscle once', () => {
    const contributions = collectMuscleSetContributions(analyticsInput());
    const forMuscle = (muscleGroupId: string) =>
      countMuscleSets(contributions.filter((contribution) => contribution.muscleGroupId === muscleGroupId));

    // Mixed: three primary bench sets and two secondary curl sets.
    expect(forMuscle('chest')).toEqual({ primarySetCount: 3, secondarySetCount: 2, weightedSetCount: 4 });
    // Secondary only: three halves.
    expect(forMuscle('triceps')).toEqual({ primarySetCount: 0, secondarySetCount: 3, weightedSetCount: 1.5 });
    // Primary only.
    expect(forMuscle('biceps')).toEqual({ primarySetCount: 2, secondarySetCount: 0, weightedSetCount: 2 });
    // Mapped primary and secondary on one exercise: the primary mapping wins, so 3 and never 4.5.
    expect(forMuscle('delts')).toEqual({ primarySetCount: 3, secondarySetCount: 0, weightedSetCount: 3 });
    // Stabilizer only: no contribution is even emitted.
    expect(forMuscle('core')).toEqual({ primarySetCount: 0, secondarySetCount: 0, weightedSetCount: 0 });
  });

  it('keeps every figure an exact half-step, with no floating-point drift', () => {
    const contributions = collectMuscleSetContributions(analyticsInput());
    for (const counts of Object.keys(EXPECTED_WEIGHTED).map((id) =>
      countMuscleSets(contributions.filter((contribution) => contribution.muscleGroupId === id)))) {
      expect(counts.weightedSetCount * 2).toBe(Math.round(counts.weightedSetCount * 2));
    }
  });
});

describe('Progress muscle comparisons', () => {
  it('weights every muscle row and its contributing exercises by role', () => {
    const rows = aggregateProgressComparisons(analyticsInput(), periods);
    const byId = new Map(rows.map((row) => [row.muscleGroupId, row]));

    for (const [muscleGroupId, weightedSetCount] of Object.entries(EXPECTED_WEIGHTED)) {
      expect(byId.get(muscleGroupId)?.current.workingSetCount).toBe(weightedSetCount);
    }
    // Chest's two contributors hold different roles and still sum to its row.
    expect(byId.get('chest')?.exercises.map((row) => [row.exerciseDefinitionId, row.current.workingSetCount]))
      .toEqual([['bench', 3], ['curl', 1]]);
    // A stabilizer-only muscle has no contributor at all.
    expect(byId.get('core')?.exercises).toEqual([]);
  });

  it('reports the change between periods in half-steps', () => {
    // One extra secondary-only bench set in the previous period: 1.5 now against 0.5 before.
    const input = analyticsInput();
    input.sessions = [...input.sessions, { id: 'earlier', completedAt: new Date('2026-05-13T10:00:00.000Z') }];
    input.sessionExercises = [...input.sessionExercises,
      { id: 'earlier-block', sessionId: 'earlier', exerciseDefinitionId: 'bench', exerciseName: 'Bench' }];
    input.exerciseSets = [...input.exerciseSets,
      { id: 'earlier-set', sessionExerciseId: 'earlier-block', orderIndex: 0, setType: null,
        weightValue: '100', repsValue: '5', performanceStatus: null }];

    expect(aggregateProgressComparisons(input, periods).find((row) => row.muscleGroupId === 'triceps'))
      .toMatchObject({ current: { workingSetCount: 1.5 }, previous: { workingSetCount: 0.5 }, workingSetChange: 1 });
  });
});

describe('the muscle heatmaps', () => {
  const dailyFor = (muscleGroupIds: string[]) =>
    aggregateSelectedMuscleDailyEffort(analyticsInput(), { muscleGroupIds, timeZone: 'UTC' });

  it.each(Object.entries(EXPECTED_WEIGHTED))(
    'gives the %s day and week cells its weighted count (%s)', (muscleGroupId, weightedSetCount) => {
      const daily = dailyFor([muscleGroupId]);
      if (weightedSetCount === 0) {
        expect(daily).toEqual([]);
        return;
      }
      expect(daily[0].setCount).toBe(weightedSetCount);
      expect(aggregateSelectedMuscleDailyEffortMetrics(daily)[0].workingSetCount).toBe(weightedSetCount);
      expect(aggregateSelectedMuscleWeeklyEffort(daily)[0].workingSetCount).toBe(weightedSetCount);
    });

  it('grades the weekly target on the same weighted count the cell shows', () => {
    const [day] = aggregateSelectedMuscleDailyEffortMetrics(dailyFor(['chest', 'triceps']));
    expect(day.workingSetCountsByMuscle).toEqual({ chest: 4, triceps: 1.5 });
  });

  it('counts a set once across a multi-muscle selection, at its strongest role', () => {
    // bench maps chest primary and triceps secondary, so its three sets are
    // whole; the two curl sets are chest-secondary only.
    expect(dailyFor(['chest', 'triceps'])[0].setCount).toBe(4);
  });
});

describe('the Stats muscle breakdown', () => {
  it('weights each muscle and deduplicates physical sets into its family', () => {
    const totals = aggregateStats(analyticsInput());
    const byId = new Map(totals.muscleFamilies.flatMap((family) => family.muscles)
      .map((muscle) => [muscle.muscleGroupId, muscle]));
    const byFamily = new Map(totals.muscleFamilies.map((family) => [family.familyName, family]));

    for (const [muscleGroupId, weightedSetCount] of Object.entries(EXPECTED_WEIGHTED)) {
      expect(byId.get(muscleGroupId)?.workingSetCount).toBe(weightedSetCount);
    }
    // Arms: the three bench sets at triceps' secondary half, plus two whole curl sets.
    expect(byFamily.get('Arms')?.workingSetCount).toBe(3.5);
    expect(byFamily.get('Core')?.workingSetCount).toBe(0);
    // The session's physical working-set total is never weighted.
    expect(totals.workingSetCount).toBe(5);
  });
});

describe('cross-surface agreement', () => {
  it('reports the same per-muscle figure on the session summary as on Progress', () => {
    const summary = summarizeCurrentSessionMuscleLoad(sessionInput());
    const progress = aggregateProgressComparisons(analyticsInput(), periods);
    const progressById = new Map(progress.map((row) => [row.muscleGroupId, row.current.workingSetCount]));

    const summaryById = new Map(summary.workingSetsByMuscle.map((entry) => [entry.id, entry.weightedSetCount]));
    for (const [muscleGroupId, weightedSetCount] of Object.entries(EXPECTED_WEIGHTED)) {
      expect(summaryById.get(muscleGroupId) ?? 0).toBe(weightedSetCount);
      expect(progressById.get(muscleGroupId)).toBe(weightedSetCount);
    }
    // The summary's own two per-muscle fields agree with each other too.
    const loadById = new Map(summary.muscles.map((entry) => [entry.id, entry.workingSetCount]));
    for (const entry of summary.workingSetsByMuscle) {
      expect(loadById.get(entry.id) ?? 0).toBe(entry.weightedSetCount);
    }
  });

  it('agrees on the role split the session summary names', () => {
    const summary = summarizeCurrentSessionMuscleLoad(sessionInput());
    expect(summary.workingSetsByMuscle.map((entry) =>
      [entry.id, entry.primarySetCount, entry.secondarySetCount, entry.weightedSetCount])).toEqual([
      ['chest', 3, 2, 4],
      ['delts', 3, 0, 3],
      ['biceps', 2, 0, 2],
      ['triceps', 0, 3, 1.5],
    ]);
  });
});
