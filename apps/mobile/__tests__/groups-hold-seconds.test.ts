import { competitionMetrics, competitionUnit, isCompetitionValue, type CompetitionRules } from '@/src/groups/competition-contract';
import { scoreCompetitionPerformance, type CompetitionPerformanceInput } from '@/src/groups/competition-score';
import { evaluateCompetitionGraph, type CompetitionEvaluationGraph, type CompetitionSourceSet } from '@/src/groups/competition-evaluation';
import { isCompetitionBoardWire, isCompetitionPerformanceWire } from '@/src/groups/competition-wire-guards';
import { buildCompetitionPodiums, buildCompetitionRow, formatSetFigure, speakHoldSeconds } from '@/src/groups/competition-view-model';
import { buildCompetitionEventCard } from '@/src/groups/competition-stream-view-model';
import { competitionBoard, competitionRow, competitionEvent, competitionExercise } from './helpers/competition-fixtures';
import type { CompetitionEventWire, CompetitionStreamRecordWire } from '@/src/groups/competition-wire';

const rules: CompetitionRules = { name: 'Plank', defaultMetric: 'seconds', loadInputMode: 'total_load',
  bodyweightCalculationsEnabled: true, bodyweightContribution: 1 };
const hold: CompetitionPerformanceInput = { live: true, recordingMode: 'hold', durationSec: 30,
  weightValue: '', repsValue: '', performanceStatus: null, source: { loadInputMode: 'total_load' },
  bodyWeightKg: null, bodyWeightSource: null, bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null };

it('ranks Holds by seconds only: 30 seconds unweighted beats 29 with 24, and equal durations have equal scores', () => {
  expect(scoreCompetitionPerformance(hold, rules)).toEqual([{ metric: 'seconds', value: 30, unit: 'seconds' }]);
  expect(scoreCompetitionPerformance({ ...hold, weightValue: '24', durationSec: 29 }, rules)[0].value).toBe(29);
  for (const weightValue of ['', '0', '24', '1000']) {
    expect(scoreCompetitionPerformance({ ...hold, weightValue }, rules)).toEqual(scoreCompetitionPerformance(hold, rules));
  }
});

it.each([false, true])('does not read private bodyweight or convert per-side loads when bodyweight calculations are %s', enabled => {
  const input = { ...hold, source: { loadInputMode: 'per_side_load' } };
  for (const field of ['bodyWeightKg', 'bodyWeightSource', 'bodyWeightMeasurementId', 'bodyWeightMeasuredAt']) {
    Object.defineProperty(input, field, { get: () => { throw new Error('private bodyweight accessed'); } });
  }
  expect(scoreCompetitionPerformance(input, { ...rules, bodyweightCalculationsEnabled: enabled }))
    .toEqual([{ metric: 'seconds', value: 30, unit: 'seconds' }]);
  expect(competitionUnit('seconds', enabled)).toBe('seconds');
});

it.each([{ recordingMode: 'reps' }, { durationSec: null }, { durationSec: 0 }, { durationSec: 301 },
  { durationSec: 1.5 }, { durationSec: Infinity }, { repsValue: '1' }, { weightValue: '-1' },
  { performanceStatus: 'unperformed' }, { live: false }])('rejects an ineligible Hold %j', patch => {
  expect(scoreCompetitionPerformance({ ...hold, ...patch } as CompetitionPerformanceInput, rules)).toEqual([]);
});

it('keeps timed and repetition comparisons separate and validates bounded whole-second scores', () => {
  expect(competitionMetrics(rules)).toEqual(['seconds']);
  expect(competitionMetrics({ defaultMetric: 'volume' })).toEqual(['volume', 'e1rm']);
  expect(scoreCompetitionPerformance(hold, { ...rules, defaultMetric: 'e1rm' })).toEqual([]);
  expect(scoreCompetitionPerformance({ ...hold, recordingMode: 'reps', durationSec: null, repsValue: '5' }, rules)).toEqual([]);
  for (const value of [0, 1.5, 301, Infinity]) expect(isCompetitionValue({ metric: 'seconds', unit: 'seconds', value }, true)).toBe(false);
});

const source: CompetitionSourceSet = { member_user_id: 'member', session_id: 'session', session_exercise_id: 'block',
  exercise_definition_id: 'plank', set_id: 'set', recording_mode: 'hold', duration_sec: 30, weight_value: '24', reps_value: '',
  set_type: 'rir_0', performance_status: null, live: true, counting: true, source_load_input_mode: 'total_load',
  body_weight_kg: null, body_weight_source: null, body_weight_measurement_id: null, body_weight_measured_at_ms: null,
  achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0, set_created_at_ms: 1000, fingerprints: { seconds: 'pin' } };
const graph: CompetitionEvaluationGraph = { contract_version: 4, group_id: 'group', group_exercise_id: 'comparison',
  name: 'Plank', source_token: 'token', sets: [source], rules: { ...competitionBoard.rules, default_metric: 'seconds' } };

it('publishes a duration snapshot without inventing repetitions, and preserves the shared Effort eligibility', () => {
  const result = evaluateCompetitionGraph(graph);
  expect(result.scores).toHaveLength(1);
  expect(result.scores[0]).toMatchObject({ metric: 'seconds', value: 30, unit: 'seconds', working: true,
    performance: { recording_mode: 'hold', duration_sec: 30, reps: null } });
  expect(evaluateCompetitionGraph({ ...graph, sets: [{ ...source, set_type: 'warm_up' }] }).scores[0].working).toBe(false);
});

it('decodes and presents Seconds boards, including hidden Weight, without normalized strength projections', () => {
  const performance = { ...competitionRow.performance, reps: null, recording_mode: 'hold' as const, duration_sec: 30 };
  const row = { ...competitionRow, metric: 'seconds' as const, unit: 'seconds' as const, value: 30, performance };
  delete row.added_e1rm_percent_bw;
  const board = { ...competitionBoard, metric: 'seconds', rules: graph.rules, entries: [row] };
  expect(isCompetitionBoardWire(board)).toBe(true);
  expect(formatSetFigure(performance)).toBe('30 s');
  expect(buildCompetitionRow(row, 'all', null, 'DD-MM-YYYY')).toMatchObject({ valueLabel: '30 s', detailLabel: '30 s' });
  expect(buildCompetitionRow(row, 'all', null, 'DD-MM-YYYY').accessibilityLabel).toContain('30 seconds');
  expect(isCompetitionBoardWire({ ...board, entries: [{ ...row, value: 29 }] })).toBe(false);
  expect(isCompetitionPerformanceWire({ ...performance, reps: 1 }, true)).toBe(false);
  expect(isCompetitionPerformanceWire({ ...performance, normalized_metrics: null }, true)).toBe(false);
  expect(isCompetitionPerformanceWire({ ...performance, weight_value: '24' }, true)).toBe(false);
  const ordinary = { ...performance, visibility: 'ordinary' as const, weight_value: '24' };
  expect(isCompetitionBoardWire({ ...board, entries: [{ ...row, performance: ordinary }] })).toBe(false);
  expect(isCompetitionBoardWire({ ...board, rules: { ...board.rules, bodyweight_calculations_enabled: false }, entries: [row] })).toBe(true);
  expect(isCompetitionPerformanceWire(ordinary, false)).toBe(true);
  expect(formatSetFigure(ordinary)).toBe('24.0 × 30 s');
  expect(buildCompetitionPodiums({ contract_version: 4, certified: false, podiums: [{
    exercise: { ...competitionExercise, rules: graph.rules }, board: { ...board, metric: 'seconds', entries: [row] },
  }] }, null, 'DD-MM-YYYY')[0].accessibilityLabel).toContain('30 seconds');
});

it('opens Seconds history from record and withdrawn-record cards, speaking durations in full', () => {
  const event: CompetitionEventWire = { ...competitionEvent, metric: null, reps: null,
    values: [{ role: 'record', metric: 'seconds', unit: 'seconds', value: 30, unavailable: false, member: competitionRow.member }] };
  const record: CompetitionStreamRecordWire = { performance: null, previous: [], group_record_metrics: ['seconds'] };
  const card = buildCompetitionEventCard(event, null, false, { record }, 'DD-MM-YYYY');
  expect(card.historyPath).toContain('metric=seconds');
  expect(card.accessibilityLabel).toContain('30 seconds');
  const withdrawn = buildCompetitionEventCard({ ...event, kind: 'record_voided' }, null, false,
    { withdrawn: { event: { ...event, voided: true }, record } }, 'DD-MM-YYYY');
  expect(withdrawn.historyPath).toContain('metric=seconds');
  expect(withdrawn.accessibilityLabel).toContain('30 seconds');
  expect(speakHoldSeconds('30 s · +2 s on best')).toBe('30 seconds · +2 seconds on best');
});
