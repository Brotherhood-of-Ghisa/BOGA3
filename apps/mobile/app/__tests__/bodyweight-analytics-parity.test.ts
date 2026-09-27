import { aggregateStats } from '@/src/data/stats';
import { buildHeatmapData } from '@/components/heatmaps/heatmapData';
import { exerciseLoadContext, formatEnteredLoad, addFiniteVolume, formatVolumeWithCoverage } from '@/src/exercise-calculations/analytics';
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
import { loadingEstimateSources, projectLoadingEstimate } from '@/src/bodyweight/loading-estimate';

const day = new Date('2026-09-20T12:00:00Z');
const now = new Date('2026-09-21T12:00:00Z');
function fixture(B: number | null, c: number, amount: string, mode: string | null,
  loadInputMode: 'total_load' | 'per_side_load' = 'total_load', unit = 'kg', known: { definition?: boolean; session?: boolean; set?: boolean } = {}) {
  if (known.session === false) B = null;
  const context = exerciseLoadContext({ bodyweightCoefficient: c, loadInputMode, localBodyweightMetadataKnown: known.definition }, { bodyWeightKg: B });
  const definition = { id: 'pull', name: 'Pull-up', deletedAt: null, bodyweightCoefficient: c, loadInputMode, localBodyweightMetadataKnown: known.definition };
  const set = { setId: 'set', id: 'set', sessionExerciseId: 'exercise', orderIndex: 0,
    localBodyweightMetadataKnown: known.set, weightValue: amount, weightUnit: unit, externalLoadMode: mode, repsValue: '8', setType: 'rir_1' as const, performanceStatus: null };
  const sessionRow = { sessionId: 'session', sessionExerciseId: 'exercise', completedAt: day, gymName: null,
    bodyWeightKg: B, bodyWeightSource: B === null ? null : 'reading', bodyWeightMeasurementId: B === null ? null : 'reading', bodyWeightMeasuredAt: B === null ? null : day };
  const history = aggregateExerciseHistory({ exerciseDefinition: definition, period: 'all', appliedTagDefinitionId: null,
    sessionsInPeriod: [sessionRow], sessionsAllTime: [sessionRow], setsBySessionExerciseId: { exercise: [set] }, tagsBySessionExerciseId: {} });
  const exercise = { id: 'exercise', exerciseDefinitionId: 'pull', exerciseName: 'Pull-up', orderIndex: 0,
    loadContext: context, sets: [set] };
  const performance: PersonalRecordSessionInput = { sessionId: 'session', status: 'completed', completedAt: day, bodyWeightKg: B, exercises: [exercise] };
  const uiSet = { id: 'set', localBodyweightMetadataKnown: known.set, weight: amount, reps: '8', weightUnit: unit, externalLoadMode: mode,
    setType: 'rir_1' as const, performanceStatus: null, plannedReps: null, plannedWeight: null, plannedSetType: null };
  const uiExercise = { id: 'exercise', exerciseDefinitionId: 'pull', name: 'Pull-up', machineName: '', loadContext: context, sets: [uiSet] };
  const session: Session = { dateTime: '2026-09-20 12:00', locationId: null, bodyWeightKg: B, exercises: [uiExercise] };
  const muscle: MuscleAnalyticsInput = { sessions: [{ id: 'session', completedAt: day, bodyWeightKg: B }],
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
  [80, 1, '0', 'added', 'total_load', 'kg', 640, 320],
  [80, 1, '', 'added', 'total_load', 'kg', 640, 320],
  [80, 1, '20', 'added', 'total_load', 'kg', 800, 400],
  [80, 1, '20', 'assistance', 'total_load', 'kg', 480, 240],
  [80, 0.7, '20', 'added', 'total_load', 'kg', 608, 304],
  [80, 1, '20', 'added', 'per_side_load', 'kg', 960, 480],
  [null, 0, '20', null, 'per_side_load', 'kg', 160, 160],
  [null, 0, '20', null, 'total_load', 'kg', 160, 80],
  [80, 1, '20', 'added', 'total_load', 'lb', 712.5747792, 356.2873896],
  [null, 1, '20', 'added', 'total_load', 'kg', null, null],
  [80, 1, '20', 'unquantified_assistance', 'total_load', 'kg', null, null],
  [80, 1, '0', null, 'total_load', 'kg', null, null],
  [80, 1, '100', 'assistance', 'total_load', 'kg', null, null],
] as const)('agrees across surfaces for B=%s c=%s %s %s %s %s', (B, c, amount, mode, loadMode, unit, volume, muscleVolume) => {
  const f = fixture(B, c, amount, mode, loadMode, unit);
  const entry = f.history.sessions[0];
  const daily = aggregateExerciseDailyEffort([{ completedAt: day, loadContext: f.context, sets: [f.set] }])[0];
  const blocks = aggregateExerciseBlockHistory({ now, sessions: [{ sessionId: 'session', completedAt: day, loadContext: f.context }],
    sessionExercises: [{ sessionExerciseId: 'exercise', sessionId: 'session', orderIndex: 0 }], setsBySessionExerciseId: { exercise: [f.set] } });
  const catalog = aggregateExerciseCatalogStats({ sessions: f.muscle.sessions, exerciseDefinitions: [f.definition],
    sessionExercises: f.muscle.sessionExercises, exerciseSets: [f.set] }, 'all', now).aggregatesById.get('pull')!;
  equalMetric(entry.totalVolume, volume); equalMetric(daily.totalVolume, volume);
  equalMetric(buildSetRows([f.set], null, f.context)[0].volume, volume);
  equalMetric(previewMetrics(amount, '8', f.context, { weightUnit: unit, externalLoadMode: mode }).volume, volume);
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
  const known = fixture(80, 1, '0', 'added');
  const missing = fixture(null, 1, '100', 'added');
  const target = { ...known.performance, sessionId: 'later', completedAt: now };
  const incomplete = deriveSessionExerciseVolumeComparisons({ targetSession: missing.performance, historicalSessions: [] })[0];
  expect(incomplete).toMatchObject({ currentVolume: null, state: 'incomplete', setCount: 1, workingSetCount: 1 });
  const baseline = deriveSessionExerciseVolumeComparisons({ targetSession: target, historicalSessions: [missing.performance] })[0];
  expect(baseline).toMatchObject({ currentVolume: 640, historicalSessionCount: 0, excludedHistoricalSessionCount: 1, state: 'no-history' });
  expect(deriveSessionPersonalRecords({ targetSession: { ...missing.performance, sessionId: 'later', completedAt: now }, historicalSessions: [known.performance] })).toEqual([]);
  expect(deriveSessionPersonalRecords({ targetSession: target, historicalSessions: [] })).toEqual([]);
});

it('uses the historical snapshot for strength and changes only the projected external target', () => {
  const f = fixture(80, 1, '20', 'added');
  const source = loadingEstimateSources(f.history.sessions)[0];
  const before = JSON.stringify(source);
  const at90 = projectLoadingEstimate(source, f.context, { reps: '8', bodyWeightKg: '90', unit: 'kg' });
  const at110 = projectLoadingEstimate(source, f.context, { reps: '8', bodyWeightKg: '110', unit: 'kg' });
  expect(at90.enteredAmount).toBeCloseTo(10, 9); expect(at90.externalLoadMode).toBe('added');
  expect(at110.enteredAmount).toBeCloseTo(10, 9); expect(at110.externalLoadMode).toBe('assistance');
  expect(at90.predictedResistanceKg).toBeCloseTo(100, 9);
  expect(at110.predictedResistanceKg).toBeCloseTo(100, 9);
  expect(JSON.stringify(source)).toBe(before);
  const atOne = projectLoadingEstimate(source, f.context, { reps: '1', bodyWeightKg: '80', unit: 'kg' });
  expect(atOne.oneRepConvention).toBe('capacity'); expect(atOne.predictedResistanceKg).toBe(source.estimatedOneRepMaxKg);
  expect(() => projectLoadingEstimate(source, f.context, { reps: '0', bodyWeightKg: '80', unit: 'kg' })).toThrow('positive whole');
  expect(() => projectLoadingEstimate(source, f.context, { reps: '8', bodyWeightKg: '', unit: 'kg' })).toThrow('positive target');
  expect(loadingEstimateSources(fixture(null, 1, '20', 'added').history.sessions)).toEqual([]);
  expect(loadingEstimateSources(fixture(80, 1, '20', 'unquantified_assistance').history.sessions)).toEqual([]);
});


it.each(['definition', 'session', 'set'] as const)('withholds load metrics while %s metadata is awaiting upgrade hydration', part => {
  const f = fixture(80, 1, '20', 'added', 'total_load', 'kg', { [part]: false });
  expect(f.history.sessions[0].totalVolume).toBeNull();
  expect(f.history.sessions[0].estimatedOneRepMax).toBeNull();
  expect(deriveExerciseRecords(f.history.sessions).records.oneRepMax).toBeNull();
  expect(loadingEstimateSources(f.history.sessions)).toEqual([]);
  expect(collectMuscleSetContributions(f.muscle)[0].weightedVolume).toBeNull();
  const daily = aggregateExerciseDailyEffort([{ completedAt: day, loadContext: f.context, sets: [f.set] }])[0];
  expect(daily).toMatchObject({ totalVolume: null, workingSetCount: 1 });
  expect(buildSessionViewModel(f.session, new Map()).volume).toBe('—');
});

it('names the entered meaning without disguising coefficient or per-side amounts', () => {
  expect(previewMetrics('20', '8', undefined, { weightUnit: 'lb' }).volume).toBeCloseTo(72.5747792, 8);
  expect(formatEnteredLoad(20, { bodyweightCoefficient: 0.7, bodyWeightKg: 80, loadInputMode: 'total_load' }, 'added', 'kg'))
    .toBe('70% BW + 20.0 kg');
  expect(formatEnteredLoad(10, { bodyweightCoefficient: 1, bodyWeightKg: 80, loadInputMode: 'per_side_load' }, 'assistance', 'lb'))
    .toBe('BW − 10.0 lb/side');
});


it('withholds overflowing aggregates without losing independent counts or later resetting an unknown subtotal', () => {
  const f = fixture(null, 0, '1' + '0'.repeat(306), null);
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
