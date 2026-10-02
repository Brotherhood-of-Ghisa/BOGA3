import { aggregateStats } from '@/src/data/stats';
import { buildHeatmapData } from '@/components/heatmaps/heatmapData';
import { personalLoadContext, addFiniteVolume, formatVolumeWithCoverage } from '@/src/exercise-calculations/analytics';
import type { Session } from '@/components/session-recorder/types';
import { aggregateExerciseDailyEffort, aggregateExerciseWeeklyEffort } from '@/src/data/exercise-analytics';
import { aggregateExerciseBlockHistory } from '@/src/data/exercise-block-history';
import { aggregateExerciseHistory } from '@/src/data/exercise-history';
import { aggregateSelectedMuscleDailyEffort, aggregateSelectedMuscleWeeklyEffort, collectMuscleSetContributions, type MuscleAnalyticsInput } from '@/src/data/muscle-analytics';
import { aggregateExerciseCatalogStats } from '@/src/data/exercise-catalog-stats';
import { buildSessionViewModel } from '@/src/session-recorder/session-view-model';
import { buildSetRows, previewMetrics } from '@/src/session-recorder/exercise-page-model';
import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { deriveExerciseRecords } from '@/src/session-recorder/exercise-records';
import { deriveSessionExerciseVolumeComparisons, deriveSessionPersonalRecords, type PersonalRecordSessionInput } from '@/src/session-insights';

const day = new Date('2026-09-20T12:00:00Z');
const now = new Date('2026-09-21T12:00:00Z');
function fixture(B: number | null, c: number, amount: string,
  loadInputMode: 'total_load' | 'per_side_load' = 'total_load', enabled = true) {
  const resolved = B === null ? null : { bodyWeightKg: B, bodyWeightSource: 'reading' as const,
    bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: day };
  const context = personalLoadContext(enabled, { bodyweightContribution: c, loadInputMode }, resolved);
  const definition = { id: 'pull', name: 'Pull-up', deletedAt: null,
    bodyweightContribution: c, bodyweightCalculationsEnabled: enabled, loadInputMode };
  const set = { setId: 'set', id: 'set', sessionExerciseId: 'exercise', orderIndex: 0,
    weightValue: amount, repsValue: '8', setType: 'rir_1' as const, performanceStatus: null };
  const sessionRow = { sessionId: 'session', sessionExerciseId: 'exercise', completedAt: day, gymName: null,
    bodyWeightKg: B, bodyWeightSource: B === null ? null : 'reading' as const, bodyWeightMeasurementId: B === null ? null : 'reading', bodyWeightMeasuredAt: B === null ? null : day };
  const history = aggregateExerciseHistory({ exerciseDefinition: definition, period: 'all', appliedTagDefinitionId: null,
    sessionsInPeriod: [sessionRow], sessionsAllTime: [sessionRow], setsBySessionExerciseId: { exercise: [set] }, tagsBySessionExerciseId: {} });
  const exercise = { id: 'exercise', exerciseDefinitionId: 'pull', exerciseName: 'Pull-up', orderIndex: 0,
    loadContext: context, sets: [set] };
  const performance: PersonalRecordSessionInput = { sessionId: 'session', status: 'completed', completedAt: day, bodyWeightKg: B, exercises: [exercise] };
  const uiSet = { id: 'set', weight: amount, reps: '8',
    setType: 'rir_1' as const, performanceStatus: null, plannedReps: null, plannedWeight: null, plannedSetType: null };
  const uiExercise = { id: 'exercise', exerciseDefinitionId: 'pull', name: 'Pull-up', machineName: '', loadContext: context, sets: [uiSet] };
  const session: Session = { dateTime: '2026-09-20 12:00', locationId: null, exercises: [uiExercise] };
  const muscle: MuscleAnalyticsInput = { bodyweightCalculationsEnabled: enabled,
    sessions: [{ id: 'session', completedAt: day, ...(resolved ?? {}) }],
    exerciseDefinitions: [definition], sessionExercises: [{ id: 'exercise', sessionId: 'session', exerciseDefinitionId: 'pull' }],
    exerciseSets: [set], muscleMappings: [{ exerciseDefinitionId: 'pull', muscleGroupId: 'left', role: 'primary' }],
    muscleGroups: [{ id: 'left', displayName: 'Left', familyName: 'Back', sortOrder: 0 }] };
  return { context, definition, set, history, performance, session, muscle, uiExercise };
}

const equalMetric = (actual: number | null | undefined, expected: number | null) => {
  if (expected === null) expect(actual).toBeNull();
  else expect(actual).toBeCloseTo(expected, 8);
};

it.each([
  [80, 1, '0', 'total_load', true, 640, 320],
  [80, 1, '', 'total_load', true, 640, 320],
  [80, 1, '20', 'total_load', true, 800, 400],
  [80, 0.7, '20', 'total_load', true, 608, 304],
  [80, 1, '20', 'per_side_load', true, 960, 480],
  [null, 0, '20', 'per_side_load', true, 160, 160],
  [null, 0, '20', 'total_load', true, 160, 80],
  [null, 1, '20', 'total_load', true, 160, 80],
  [80, 1, '20', 'total_load', false, 160, 80],
  [80, 1, '100', 'total_load', true, 1440, 720],
] as const)('agrees across surfaces for B=%s c=%s Weight=%s mode=%s enabled=%s', (B, c, amount, loadMode, enabled, volume, muscleVolume) => {
  const f = fixture(B, c, amount, loadMode, enabled);
  const entry = f.history.sessions[0];
  const daily = aggregateExerciseDailyEffort([{ completedAt: day, loadContext: f.context, sets: [f.set] }])[0];
  const blocks = aggregateExerciseBlockHistory({ now, sessions: [{ sessionId: 'session', completedAt: day, loadContext: f.context }],
    sessionExercises: [{ sessionExerciseId: 'exercise', sessionId: 'session', orderIndex: 0 }], setsBySessionExerciseId: { exercise: [f.set] } });
  const catalog = aggregateExerciseCatalogStats({ bodyweightCalculationsEnabled: enabled,
    sessions: f.muscle.sessions, exerciseDefinitions: [f.definition],
    sessionExercises: f.muscle.sessionExercises, exerciseSets: [f.set] }, 'all', now).aggregatesById.get('pull')!;
  equalMetric(entry.totalVolume, volume); equalMetric(daily.totalVolume, volume);
  equalMetric(buildSetRows([f.set], null, f.context)[0].volume, volume);
  equalMetric(previewMetrics(amount, '8', f.context).volume, volume);
  equalMetric(blocks.blocks[0].totalVolume, volume); equalMetric(catalog.totalVolume, volume);
  equalMetric(collectMuscleSetContributions(f.muscle)[0].weightedVolume, muscleVolume);
  const records = deriveExerciseRecords(f.history.sessions);
  equalMetric(records.last?.volume, volume);
  equalMetric(records.records.volume?.value ?? null, volume);
  expect(daily.estimatedRM1).toBe(entry.estimatedOneRepMax);
  expect(blocks.blocks[0].estimatedOneRepMax).toBe(entry.estimatedOneRepMax);
  expect(catalog.estimatedOneRepMax).toBe(entry.estimatedOneRepMax);
  expect(entry.workingSetCount).toBe(1); expect(catalog.setCount).toBe(1); expect(daily.workingSetCount).toBe(1);
  const shown = volume === null ? '—' : String(Math.round(volume));
  expect(buildSessionViewModel(f.session, new Map()).volume).toBe(shown);
  expect(buildCompletedSessionDetailModel([f.uiExercise], new Map()).volume).toBe(shown);
});

it('keeps partial volume out of baselines and never awards an unavailable strength record', () => {
  const known = fixture(80, 1, '0');
  const invalid = fixture(80, Number.NaN, '100');
  const target = { ...known.performance, sessionId: 'later', completedAt: now };
  const incomplete = deriveSessionExerciseVolumeComparisons({ targetSession: invalid.performance, historicalSessions: [] })[0];
  expect(incomplete).toMatchObject({ currentVolume: null, state: 'incomplete', setCount: 1, workingSetCount: 1 });
  const baseline = deriveSessionExerciseVolumeComparisons({ targetSession: target, historicalSessions: [invalid.performance] })[0];
  expect(baseline).toMatchObject({ currentVolume: 640, historicalSessionCount: 0, excludedHistoricalSessionCount: 1, state: 'no-history' });
  expect(deriveSessionPersonalRecords({ targetSession: { ...invalid.performance, sessionId: 'later', completedAt: now }, historicalSessions: [known.performance] })).toEqual([]);
  expect(deriveSessionPersonalRecords({ targetSession: target, historicalSessions: [] })).toEqual([]);
});

it('withholds overflowing aggregates without losing independent counts or later resetting an unknown subtotal', () => {
  const f = fixture(null, 0, '1' + '0'.repeat(306));
  const sets = Array.from({ length: 50 }, (_, index) => ({ ...f.set, id: `set-${index}`, setId: `set-${index}`, orderIndex: index }));
  const raw = [{ completedAt: day, loadContext: f.context, sets }];
  expect(aggregateExerciseDailyEffort(raw)[0]).toMatchObject({ totalVolume: null, knownVolume: null, workingSetCount: 50 });
  expect(aggregateExerciseWeeklyEffort(raw)[0]).toMatchObject({ totalVolume: null, knownVolume: null, workingSetCount: 50 });
  const muscle = { ...f.muscle, exerciseSets: sets };
  expect(aggregateSelectedMuscleDailyEffort(muscle, { muscleGroupIds: ['left'] })[0])
    .toMatchObject({ totalWeight: null, knownWeight: null, setCount: 50 });
  expect(aggregateSelectedMuscleWeeklyEffort(aggregateSelectedMuscleDailyEffort(muscle, { muscleGroupIds: ['left'] }))[0])
    .toMatchObject({ totalVolume: null, knownVolume: null, workingSetCount: 50 });
  expect(aggregateStats(muscle).muscleFamilies[0]).toMatchObject({ totalVolume: null, knownVolume: null, setCount: 50 });
  const target = { ...f.performance, exercises: [{ ...f.performance.exercises[0], sets }] };
  expect(deriveSessionExerciseVolumeComparisons({ targetSession: target, historicalSessions: [] })[0])
    .toMatchObject({ currentVolume: null, knownVolume: null, state: 'incomplete', setCount: 50 });
  const catalog = aggregateExerciseCatalogStats({ ...muscle, exerciseDefinitions: [f.definition] }, 'all', now).aggregatesById.get('pull');
  expect(catalog).toMatchObject({ totalVolume: null, knownVolume: null, setCount: 50 });
  expect(addFiniteVolume(null, 20)).toBeNull();
  expect(formatVolumeWithCoverage(null, null)).toBe('— · unavailable');
});

it('does not render an overflowing weekly heatmap sum as a complete or infinite value', () => {
  const days = ['2026-09-14', '2026-09-15', '2026-09-16'].map(dateKey => ({ dateKey,
    totalVolume: 8e307, knownVolume: 8e307, workingSetCount: 1, estimatedRM1: 1e307, highestWeight: 1e307 }));
  const data = buildHeatmapData(days, 'totalVolume', { todayDateKey: '2026-09-20', weeks: 1 });
  expect(data.weekly[0]).toMatchObject({ value: 0, knownValue: null, unavailable: true, hasTraining: true });
  expect(data.daily.filter(day => day.hasTraining).every(day => !day.unavailable)).toBe(true);
});
