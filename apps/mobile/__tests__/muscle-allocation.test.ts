import { buildHeatmapData } from '@/components/heatmaps/heatmapData';
import { deriveStatusMuscles, statusSettings, trainingStatusWindow } from '../../../supabase/functions/agent-api/training-status.ts';
import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleDailyEffortMetrics,
  aggregateSelectedMuscleWeeklyEffort,
  applyMuscleReport,
  collectMuscleSetContributions,
  countMuscleSets,
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

describe('independent muscle Sets and Volume', () => {
  it.each([[1, 0], [1, 2], [2, 0], [2, 2], [3, 3]])(
    '%s primaries each receive a whole set; %s secondaries share the Volume half-pool', (primaries, secondaries) => {
      const input = inputFor(primaries, secondaries);
      for (const contribution of collectMuscleSetContributions(input)) {
        expect(contribution.roleWeight).toBe(contribution.role === 'primary' ? 1 : 0.5);
        expect(contribution.weightedVolume).toBeCloseTo(300 * (contribution.role === 'primary' ? 1 / primaries : 0.5 / secondaries));
      }
      const stats = aggregateStats(input);
      expect(stats.workingSetCount).toBe(3);
      expect(stats.muscleFamilies[0].workingSetCount).toBe(3);
      expect(stats.muscleFamilies[0].totalVolume).toBeCloseTo(900 + (secondaries > 0 ? 450 : 0));
    },
  );

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'keeps Sets secondary=%s independent from Volume secondary=%s across projections', (countSecondarySets, countSecondaryVolume) => {
      const input = { ...inputFor(2, 2), countSecondarySets, countSecondaryVolume };
      const rows = muscleRows(input);
      expect(rows.find(row => row.muscleGroupId === 'chest')).toMatchObject({ workingSetCount: 3, totalVolume: 450 });
      expect(rows.find(row => row.muscleGroupId === 'serratus')).toMatchObject({
        workingSetCount: countSecondarySets ? 1.5 : 0, totalVolume: countSecondaryVolume ? 225 : 0,
      });
      const daily = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['serratus'] });
      if (!countSecondarySets && !countSecondaryVolume) {
        expect(daily).toEqual([]);
      } else {
        const weekly = aggregateSelectedMuscleWeeklyEffort(daily)[0];
        expect(weekly).toMatchObject({ workingSetCount: countSecondarySets ? 1.5 : 0, totalVolume: countSecondaryVolume ? 225 : 0 });
        expect(aggregateSelectedMuscleDailyEffortMetrics(daily)[0]).toMatchObject({
          workingSetCount: weekly.workingSetCount, totalVolume: weekly.totalVolume,
        });
      }
      const comparison = aggregateProgressComparisons(input, comparisonPeriods).find(row => row.muscleGroupId === 'serratus');
      expect(comparison?.current).toMatchObject({ workingSetCount: countSecondarySets ? 1.5 : 0, totalVolume: countSecondaryVolume ? 225 : 0 });
    },
  );

  it('keeps whole primary Sets through daily, weekly, comparisons, Recovery and session summaries', () => {
    const input = inputFor(3, 0, 1);
    const [daily] = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] });
    expect(daily.setCount).toBe(1);
    expect(aggregateSelectedMuscleWeeklyEffort([daily])[0].workingSetCount).toBe(1);
    expect(aggregateProgressComparisons(input, comparisonPeriods)[0].current.workingSetCount).toBe(1);
    expect(deriveRecoveryRows(aggregateMuscleDailySets(input), todayPlanWindow(at), { weeklyTarget: 10, overrides: {} })[0])
      .toMatchObject({ today: 1, weekSets: 1, target: 10 });
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 'old-session', sessionAt: at,
      exercises: [{ id: 'block', orderIndex: 0, exerciseDefinitionId: 'machine-dips', exerciseName: 'Machine Dips', sets: [
        { id: 'set-0', orderIndex: 0, setType: null, weightValue: '60', repsValue: '10' },
      ] }], exerciseDefinitions: input.exerciseDefinitions!, muscleMappings: input.muscleMappings, muscleGroups: input.muscleGroups,
    });
    expect(summary.workingSetCount).toBe(1);
    expect(summary.workingSetsByMuscle.map(row => row.weightedSetCount)).toEqual([1, 1, 1]);
  });

  it('keeps a secondary-only muscle with positive Volume and zero direct Sets in session rows', () => {
    const input = inputFor(1, 1, 1);
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 'old-session', sessionAt: at, countSecondarySets: false, countSecondaryVolume: true,
      exercises: [{ id: 'block', orderIndex: 0, exerciseDefinitionId: 'machine-dips', exerciseName: 'Machine Dips', sets: [
        { id: 'set-0', orderIndex: 0, setType: null, weightValue: '60', repsValue: '10' },
      ] }], exerciseDefinitions: input.exerciseDefinitions!, muscleMappings: input.muscleMappings, muscleGroups: input.muscleGroups,
    });
    expect(summary.muscles.find(row => row.id === 'serratus')).toMatchObject({ workingSetCount: 0, weightedVolume: 150 });
    expect(summary.workingSetsByMuscle.find(row => row.id === 'serratus')).toMatchObject({ weightedSetCount: 0 });
  });

  it('retains load normalization, including total/per-side equivalence, without changing workouts', () => {
    const total = inputFor(2, 0);
    const before = JSON.stringify(total);
    const perSide = inputFor(2, 0);
    perSide.exerciseDefinitions![0].loadInputMode = 'per_side_load';
    perSide.exerciseSets = perSide.exerciseSets.map(set => ({ ...set, weightValue: '30' }));
    expect(muscleRows(perSide)).toEqual(muscleRows(total));
    expect(collectMuscleSetContributions(total)[0].metrics.volumeKgReps).toBe(600);
    expect(JSON.stringify(total)).toBe(before);
  });

  it('classifies mapped physical working sets independently from Volume-only rows and role filters', () => {
    const input = inputFor(1, 1, 1);
    const loadContext = { policy: 'ordinary' as const, loadInputMode: 'total_load' as const, bodyweightContribution: 0,
      effortPolicy: { workingSetEfforts: ['unspecified' as const], volumeEfforts: ['warm_up' as const] } };
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 's', sessionAt: at, countSecondarySets: false, countSecondaryVolume: true,
      exercises: [
        { id: 'unmapped', orderIndex: 0, exerciseDefinitionId: null, exerciseName: 'Unmapped', loadContext,
          sets: [{ id: 'work', orderIndex: 0, setType: null, weightValue: '60', repsValue: '10' }] },
        { id: 'mapped', orderIndex: 1, exerciseDefinitionId: 'machine-dips', exerciseName: 'Dips', loadContext,
          sets: [0, 1].map(index => ({ id: `volume-${index}`, orderIndex: index, setType: 'warm_up', weightValue: '60', repsValue: '10' })) },
      ], exerciseDefinitions: input.exerciseDefinitions!, muscleMappings: input.muscleMappings, muscleGroups: input.muscleGroups,
    });
    expect(summary).toMatchObject({ workingSetCount: 1, mappedSetCount: 0, unmappedSetCount: 1 });
    expect(summary.muscles.find(row => row.id === 'serratus')).toMatchObject({ workingSetCount: 0, weightedVolume: 300 });
  });

  it('opens only the sessions that contributed to the selected metric on a mixed-role day', () => {
    const input = inputFor(1, 0, 1);
    input.countSecondarySets = false;
    input.sessions.push({ id: 'secondary-session', completedAt: at });
    input.sessionExercises.push({ id: 'row-block', sessionId: 'secondary-session', exerciseDefinitionId: 'row' });
    input.exerciseDefinitions!.push({ id: 'row', loadInputMode: 'total_load', bodyweightContribution: 0 });
    input.muscleMappings.push({ exerciseDefinitionId: 'row', muscleGroupId: 'chest', role: 'secondary' });
    input.exerciseSets.push({ ...input.exerciseSets[0], id: 'row-set', sessionExerciseId: 'row-block' });
    const daily = aggregateSelectedMuscleDailyEffortMetrics(aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] }));
    const options = { todayDateKey: '2026-10-30', weeks: 1 };
    const setDay = buildHeatmapData(daily, 'workingSetCount', options).daily.find(day => day.dateKey === '2026-10-30');
    const volumeDay = buildHeatmapData(daily, 'totalVolume', options).daily.find(day => day.dateKey === '2026-10-30');
    expect(setDay).toMatchObject({ value: 1, sessionIds: ['old-session'] });
    expect(volumeDay).toMatchObject({ value: 450, sessionIds: ['old-session', 'secondary-session'] });
  });

  it.each([[0, 2], [2, 0], [0, 0]])('leaves absent role pools unused: P=%s S=%s', (primaries, secondaries) => {
    const contributions = collectMuscleSetContributions(inputFor(primaries, secondaries, 1));
    expect(contributions.every(row => Number.isFinite(row.weightedVolume))).toBe(true);
    expect(contributions.reduce((sum, row) => sum + (row.weightedVolume ?? 0), 0))
      .toBe((primaries > 0 ? 300 : 0) + (secondaries > 0 ? 150 : 0));
  });
});

describe('allocation before merging and filtering', () => {
  const setup = (input: MuscleAnalyticsInput, merge: string[], hidden: string[] = []): MuscleReportAssignment => new Map(
    input.muscleGroups.map(group => [group.id, {
      tracked: !hidden.includes(group.id), muscle: merge.includes(group.id) ? input.muscleGroups[0] : group,
    }]),
  );

  it('allocates the 1200 base across three primaries before merging two of them', () => {
    const input = inputFor(3, 1, 1);
    input.exerciseSets[0].weightValue = '240';
    const reported = applyMuscleReport(input, setup(input, ['chest', 'triceps']));
    expect(muscleRows(reported).map(row => [row.workingSetCount, row.totalVolume])).toEqual([[1, 800], [1, 400], [0.5, 600]]);
  });

  it('retains primary and secondary Volume inside a mixed-role merged muscle', () => {
    const input = inputFor(1, 2, 1);
    input.exerciseSets[0].weightValue = '240';
    const reported = applyMuscleReport(input, setup(input, ['chest', 'serratus']));
    expect(muscleRows(reported).map(row => [row.workingSetCount, row.totalVolume])).toEqual([[1, 1500], [0.5, 300]]);
    expect(muscleRows({ ...reported, countSecondaryVolume: false }).map(row => [row.workingSetCount, row.totalVolume]))
      .toEqual([[1, 1200], [0.5, 0]]);
    expect(muscleRows({ ...reported, countSecondarySets: false }).map(row => [row.workingSetCount, row.totalVolume]))
      .toEqual([[1, 1500], [0, 300]]);
  });

  it('drops disabled shares without redistributing them', () => {
    const input = inputFor(2, 2);
    const original = input.muscleMappings.map(mapping => ({ ...mapping }));
    const reported = applyMuscleReport(input, setup(input, ['chest', 'serratus'], ['triceps', 'forearms']));
    expect(muscleRows(reported)).toEqual([expect.objectContaining({ workingSetCount: 3, totalVolume: 675 })]);
    expect(input.muscleMappings).toEqual(original);
  });

  it('merges several secondary shares additively for Volume and once at half credit for Sets', () => {
    const input = inputFor(1, 3);
    const secondary = input.muscleGroups[1];
    const assignment: MuscleReportAssignment = new Map(input.muscleGroups.map(group => [group.id, {
      tracked: true, muscle: group.id === 'chest' ? group : secondary,
    }]));
    const reported = applyMuscleReport(input, assignment);
    expect(muscleRows(reported)[1]).toMatchObject({ workingSetCount: 1.5, totalVolume: 450 });
  });

  it('deduplicates duplicate raw roles and repeated physical-set contributions at the strongest role', () => {
    const input = inputFor(2, 2, 1);
    input.muscleMappings.push({ ...input.muscleMappings[0], role: 'secondary', weight: 0.01 });
    const reported = applyMuscleReport(input, setup(input, ['chest', 'triceps', 'serratus']));
    const contributions = collectMuscleSetContributions(reported);
    expect(countMuscleSets([...contributions, ...contributions])).toEqual({ primarySetCount: 1, secondarySetCount: 0, weightedSetCount: 1 });
    expect(muscleRows(reported)[0]).toMatchObject({ workingSetCount: 1, totalVolume: 375 });
  });

  it('retains exact half-step weekly target grading and coaching totals', () => {
    const input = inputFor(3, 0, 1);
    input.sessions = Array.from({ length: 6 }, (_, day) => ({ id: `day-${day}`, completedAt: new Date(2026, 9, 26 + day, 12) }));
    input.sessionExercises = input.sessions.map(session => ({ id: session.id, sessionId: session.id, exerciseDefinitionId: 'machine-dips' }));
    input.exerciseSets = input.sessions.map(session => ({ ...input.exerciseSets[0], id: `set-${session.id}`, sessionExerciseId: session.id }));
    const daily = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'] });
    const heatmap = buildHeatmapData(aggregateSelectedMuscleDailyEffortMetrics(daily), 'workingSetCount', {
      todayDateKey: '2026-11-01', weeks: 1, muscleTargets: { muscleIds: ['chest'], weeklyTarget: 6 },
    });
    expect(heatmap.weekly.at(-1)).toMatchObject({ value: 6, targetAttainment: 1, level: 4 });
    const settings = statusSettings({ weekly_working_set_target: 6, muscle_target_mode: 'single', muscle_target_overrides: {},
      count_secondary_muscles: true, client_updated_at_ms: 0 });
    const status = deriveStatusMuscles(input, input.muscleGroups.map(muscle => ({ ...muscle, reportGroup: null, tracked: 1 })),
      settings, trainingStatusWindow(new Date(2026, 10, 1, 12), 'Europe/London'));
    expect(status.muscles[0]).toMatchObject({ week_sets: 6, weekly_target: 6 });
  });
});
