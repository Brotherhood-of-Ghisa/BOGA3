import { sumNumbers } from '@/src/utils/sum';
import { buildHeatmapData } from '@/components/heatmaps/heatmapData';
import { deriveStatusMuscles, statusSettings, trainingStatusWindow } from '../../../supabase/functions/agent-api/training-status.ts';
import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleDailyEffortMetrics,
  aggregateSelectedMuscleWeeklyEffort,
  applyMuscleReport,
  collectMuscleSetContributions,
  countMuscleSets,
  withoutSecondaryMappings,
  type MuscleAnalyticsInput,
  type MuscleReportAssignment,
} from '@/src/data/muscle-analytics';
import { aggregateMuscleDailySets } from '@/src/data/muscle-daily-sets';
import { aggregateProgressComparisons } from '@/src/data/progress-comparisons';
import { aggregateStats } from '@/src/data/stats';
import { summarizeCurrentSessionMuscleLoad } from '@/src/session-insights/calculations';
import { todayPlanWindow, deriveRecoveryRows } from '@/src/today-plan/calculations';

const at = new Date(2026, 9, 30, 12);
const inputFor = (primaries: number, secondaries: number, sets = 3): MuscleAnalyticsInput => {
  const primaryIds = ['chest', 'triceps', 'delts'].slice(0, primaries);
  const secondaryIds = ['serratus', 'forearms', 'core'].slice(0, secondaries);
  return {
    sessions: [{ id: 'old-session', completedAt: at }],
    exerciseDefinitions: [{ id: 'machine-dips', name: 'Machine Dips', loadInputMode: 'total_load', bodyweightContribution: 0 }],
    sessionExercises: [{ id: 'block', sessionId: 'old-session', exerciseDefinitionId: 'machine-dips', exerciseName: 'Machine Dips' }],
    exerciseSets: Array.from({ length: sets }, (_, index) => ({
      id: `set-${index}`, sessionExerciseId: 'block', setType: null, weightValue: '60', repsValue: '10',
    })),
    muscleMappings: [
      ...primaryIds.map(muscleGroupId => ({ exerciseDefinitionId: 'machine-dips', muscleGroupId, role: 'primary' as const })),
      ...secondaryIds.map(muscleGroupId => ({ exerciseDefinitionId: 'machine-dips', muscleGroupId, role: 'secondary' as const })),
    ],
    muscleGroups: [...primaryIds, ...secondaryIds].map((id, sortOrder) => ({ id, displayName: id, familyName: 'Upper', sortOrder })),
  };
};
const muscleRows = (input: MuscleAnalyticsInput) => aggregateStats(input).muscleFamilies.flatMap(family => family.muscles);
const comparisonPeriods = {
  current: { start: new Date(2026, 9, 26), end: new Date(2026, 10, 2) },
  previous: { start: new Date(2026, 9, 19), end: new Date(2026, 9, 26) },
};

describe('independent muscle allocation pools', () => {
  it.each([[1, 0], [1, 2], [2, 0], [2, 2], [3, 3]])(
    '%s Primaries and %s Secondaries split each pool once', (primaries, secondaries) => {
      const input = inputFor(primaries, secondaries);
      for (const contribution of collectMuscleSetContributions(input)) {
        const expected = contribution.role === 'primary' ? 1 / primaries : 0.5 / secondaries;
        expect(contribution.roleWeight).toBe(expected);
        expect(contribution.weightedVolume).toBeCloseTo(300 * expected, 10);
      }
      const stats = aggregateStats(input);
      expect(stats.workingSetCount).toBe(3);
      expect(stats.muscleFamilies[0].workingSetCount).toBeCloseTo(secondaries ? 4.5 : 3, 10);
      expect(stats.muscleFamilies[0].totalVolume).toBeCloseTo(secondaries ? 1350 : 900, 10);
    },
  );

  it('Machine Dips gives Chest and Triceps 1.5 sets and 450 Volume, even with Secondary off', () => {
    const input = inputFor(2, 2);
    const originalSets = input.exerciseSets.map(set => ({ ...set }));
    const all = muscleRows(input);
    const primaryOnly = muscleRows(withoutSecondaryMappings(input));
    for (const id of ['chest', 'triceps']) {
      const expected = { workingSetCount: 1.5, totalVolume: 450 };
      expect(all.find(row => row.muscleGroupId === id)).toMatchObject(expected);
      expect(primaryOnly.find(row => row.muscleGroupId === id)).toMatchObject(expected);
    }
    expect(primaryOnly.find(row => row.muscleGroupId === 'serratus')).toMatchObject({ workingSetCount: 0, totalVolume: 0 });
    expect(input.exerciseSets).toEqual(originalSets);
    // Reinterpreting old history changes no stored set or exercise load metric.
    const contribution = collectMuscleSetContributions(input)[0];
    expect(contribution.metrics.volumeKgReps).toBe(600);
  });

  it('applies allocation after the established per-side load normalization', () => {
    const total = inputFor(2, 0);
    const perSide = inputFor(2, 0);
    perSide.exerciseDefinitions![0].loadInputMode = 'per_side_load';
    perSide.exerciseSets = perSide.exerciseSets.map(set => ({ ...set, weightValue: '30' }));
    expect(muscleRows(perSide)).toEqual(muscleRows(total));
  });

  it('retains a third through daily, weekly, Progress, recovery and session projections', () => {
    const input = inputFor(3, 0, 1);
    const [daily] = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] });
    expect(daily.setCount).toBe(1 / 3);
    expect(aggregateSelectedMuscleDailyEffortMetrics([daily])[0].workingSetCount).toBe(1 / 3);
    expect(aggregateSelectedMuscleWeeklyEffort([daily])[0].workingSetCount).toBe(1 / 3);
    expect(aggregateProgressComparisons(input, comparisonPeriods)[0].current.workingSetCount).toBe(1 / 3);
    expect(deriveRecoveryRows(aggregateMuscleDailySets(input), todayPlanWindow(at), { weeklyTarget: 10, overrides: {} })[0])
      .toMatchObject({ today: 1 / 3, weekSets: 1 / 3 });
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 'old-session', sessionAt: at,
      exercises: [{ id: 'block', orderIndex: 0, exerciseDefinitionId: 'machine-dips', exerciseName: 'Machine Dips', sets: [
        { id: 'set-0', orderIndex: 0, setType: null, weightValue: '60', repsValue: '10' },
      ] }], exerciseDefinitions: input.exerciseDefinitions!, muscleMappings: input.muscleMappings, muscleGroups: input.muscleGroups,
    });
    expect(summary.workingSetCount).toBe(1);
    expect(summary.workingSetsByMuscle.every(row => row.weightedSetCount === 1 / 3)).toBe(true);
  });
});

describe('allocated shares under Broad and hidden mappings', () => {
  const setup = (input: MuscleAnalyticsInput, hidden: string[] = []): MuscleReportAssignment => new Map(
    input.muscleGroups.map(group => [group.id, {
      tracked: !hidden.includes(group.id),
      muscle: ['chest', 'serratus'].includes(group.id)
        ? { ...input.muscleGroups[0], displayName: 'Chest' } : group,
    }]),
  );

  it('adds Broad member shares from both pools and keeps Secondary off independent', () => {
    const input = inputFor(2, 2);
    const all = applyMuscleReport(input, setup(input));
    const off = applyMuscleReport(withoutSecondaryMappings(input), setup(input));
    expect(muscleRows(all).find(row => row.muscleGroupId === 'chest'))
      .toMatchObject({ workingSetCount: 2.25, totalVolume: 675 });
    expect(muscleRows(off).find(row => row.muscleGroupId === 'chest'))
      .toMatchObject({ workingSetCount: 1.5, totalVolume: 450 });
    expect(countMuscleSets(collectMuscleSetContributions(all)).weightedSetCount).toBe(4.5);
  });

  it('drops hidden shares without redistributing either pool or mutating input', () => {
    const input = inputFor(2, 2);
    const original = input.muscleMappings.map(mapping => ({ ...mapping }));
    const reported = applyMuscleReport(input, setup(input, ['triceps', 'forearms']));
    expect(muscleRows(reported)).toEqual([expect.objectContaining({ muscleGroupId: 'chest', workingSetCount: 2.25, totalVolume: 675 })]);
    expect(input.muscleMappings).toEqual(original);
  });

  it('sums two co-primary entries merged into one muscle, retaining one physical set', () => {
    const input = inputFor(2, 0, 1);
    const assignment: MuscleReportAssignment = new Map(input.muscleGroups.map(group => [group.id, { muscle: input.muscleGroups[0], tracked: true }]));
    const reported = applyMuscleReport(input, assignment);
    const contributions = collectMuscleSetContributions(reported);
    expect(contributions).toHaveLength(1);
    expect(countMuscleSets([...contributions, ...contributions]).weightedSetCount).toBe(1);
    expect(muscleRows(reported)[0]).toMatchObject({ workingSetCount: 1, totalVolume: 300 });
  });
});


describe('fractional sums at whole-set targets', () => {
  it('corrects division drift at whole totals without erasing small shares', () => {
    expect(sumNumbers(Array(49).fill(1 / 49))).toBe(1);
    expect(sumNumbers([1 / 3])).toBe(1 / 3);
    expect(sumNumbers([1e-20])).toBe(1e-20);
    expect(sumNumbers([1.999])).toBe(1.999);
  });
  it('six thirds meet two sets across counters and projections without rounding individual shares', () => {
    const input = inputFor(3, 0, 6);
    expect(collectMuscleSetContributions(input)[0].roleWeight).toBe(1 / 3);
    expect(muscleRows(input)[0].workingSetCount).toBe(2);
    expect(aggregateStats(input).muscleFamilies[0].workingSetCount).toBe(6);
    expect(aggregateProgressComparisons(input, comparisonPeriods)[0].current.workingSetCount).toBe(2);
    const daily = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] });
    expect(daily[0].setCount).toBe(2);
    expect(aggregateSelectedMuscleWeeklyEffort(daily)[0].workingSetCount).toBe(2);
    const recovery = deriveRecoveryRows(aggregateMuscleDailySets(input), todayPlanWindow(at), { weeklyTarget: 2, overrides: {} });
    expect(recovery[0].weekSets).toBe(2);
    expect(Math.floor(recovery[0].weekSets)).toBe(2);
    expect(recovery[0].weekSets >= recovery[0].target).toBe(true);
  });

  it('sums six separate third-set days exactly for Recovery, heatmap grading and coaching', () => {
    const input = inputFor(3, 0, 1);
    input.sessions = Array.from({ length: 6 }, (_, day) => ({ id: `day-${day}`, completedAt: new Date(2026, 9, 26 + day, 12) }));
    input.sessionExercises = input.sessions.map(session => ({ id: session.id, sessionId: session.id, exerciseDefinitionId: 'machine-dips' }));
    input.exerciseSets = input.sessions.map(session => ({ ...input.exerciseSets[0], id: `set-${session.id}`, sessionExerciseId: session.id }));
    const now = new Date(2026, 10, 1, 12);
    const daily = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] });
    expect(daily.map(day => day.setCount)).toEqual(Array(6).fill(1 / 3));
    expect(aggregateSelectedMuscleWeeklyEffort(daily)[0].workingSetCount).toBe(2);
    const recovery = deriveRecoveryRows(aggregateMuscleDailySets(input), todayPlanWindow(now), { weeklyTarget: 2, overrides: {} });
    expect(recovery[0]).toMatchObject({ weekSets: 2, target: 2 });
    const heatmap = buildHeatmapData(aggregateSelectedMuscleDailyEffortMetrics(daily), 'workingSetCount', {
      todayDateKey: '2026-11-01', weeks: 1, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 2 },
    });
    expect(heatmap.weekly.at(-1)).toMatchObject({ value: 2, targetAttainment: 1, level: 4 });
    const rows = input.muscleGroups.map(muscle => ({ ...muscle, reportGroup: null, tracked: 1 }));
    const settings = statusSettings({ weekly_working_set_target: 2, muscle_target_mode: 'single', muscle_target_overrides: {},
      count_secondary_muscles: true, client_updated_at_ms: 0 });
    const status = deriveStatusMuscles(input, rows, settings, trainingStatusWindow(now, 'Europe/London'));
    expect(status.muscles[0]).toMatchObject({ week_sets: 2, weekly_target: 2 });
    const nextWeek = deriveStatusMuscles(input, rows, settings, trainingStatusWindow(new Date(2026, 10, 8, 12), 'Europe/London'));
    expect(nextWeek.muscles[0].weekly_sets_last_4_weeks.at(-1)).toMatchObject({ sets: 2 });
  });

  it('merges six Primary sixth-shares into one whole Broad set', () => {
    const input = inputFor(3, 3, 1);
    input.muscleMappings = input.muscleMappings.map(mapping => ({ ...mapping, role: 'primary' }));
    expect(collectMuscleSetContributions(input)[0].roleWeight).toBe(1 / 6);
    const assignment: MuscleReportAssignment = new Map(input.muscleGroups.map(muscle => [muscle.id,
      { muscle: input.muscleGroups[0], tracked: true }]));
    expect(muscleRows(applyMuscleReport(input, assignment))[0].workingSetCount).toBe(1);
  });
});
