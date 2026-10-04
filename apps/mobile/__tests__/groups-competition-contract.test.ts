import { competitionUnit, isCompetitionMetric, isCompetitionValue, isNormalizedCompetition,
  validateCompetitionRules, type CompetitionRules } from '@/src/groups/competition-contract';
import { scoreCompetitionPerformance } from '@/src/groups/competition-score';
import { isCompetitionBoardWire, isCompetitionCertificationWire, isCompetitionContractWire,
  isCompetitionPerformanceWire, isCompetitionRulesWire } from '@/src/groups/competition-wire-guards';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import type { GroupPerformanceInput } from '@/src/groups/performance-score';

const rules: CompetitionRules = { name: 'Pull-up', loadInputMode: 'total_load', defaultMetric: 'e1rm',
  bodyweightCalculationsEnabled: true, bodyweightContribution: 1 };
const performance: GroupPerformanceInput = { live: true, weightValue: '20', repsValue: '5', performanceStatus: null,
  source: { loadInputMode: 'total_load' }, bodyWeightKg: 80, bodyWeightMeasurementId: 'reading',
  bodyWeightMeasuredAt: new Date(1000), bodyWeightSource: 'reading' };
const contract = { contract_version: 4, activation_state: 'pending', cache_version: 5, metrics: ['volume','e1rm'],
  default_metric: 'e1rm', ordinary_units: { volume: 'kg_reps', e1rm: 'kg' },
  normalized_units: { volume: 'percent_bw_reps', e1rm: 'percent_bw' } };
const publicSet = { visibility: 'normalized', session_id: 's', session_exercise_id: 'se', exercise_definition_id: 'd',
  set_id: 'set', reps: 5, performance_status: null, source_load_input_mode: 'total_load', achieved_at_ms: 1000,
  exercise_order_index: 0, set_order_index: 0 };
const certificate = { certification_id: 'c', metric: 'e1rm', certified_by: { user_id: 'w', username: null },
  certified_at_ms: 2000, observed_rules_revision: 1, ended_at_ms: null, end_reason: null };
const board = { contract_version: 4, group_exercise_id: 'g', rules: { bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1, load_input_mode: 'total_load', default_metric: 'e1rm', rules_revision: 2 },
  metric: 'e1rm', certified: true, state: 'ready', entries: [{ metric: 'e1rm', value: 145.72813161398653,
    unit: 'percent_bw', rank: 1, member: { user_id: 'u', username: 'Athlete' }, former: false,
    performance: publicSet, write_token: 'opaque-random-token', certification: certificate }],
  entry_count: 1, me: null, next_cursor: null };

it('has two metrics with mode-specific units selected only by group rules', () => {
  expect(['volume','e1rm','weight','reps',null].map(isCompetitionMetric)).toEqual([true,true,false,false,false]);
  for (const metric of ['volume','e1rm'] as const) {
    for (const normalized of [true,false]) {
      expect(isCompetitionValue({ metric, value: 1, unit: competitionUnit(metric,normalized) },normalized)).toBe(true);
    }
  }
  expect(isNormalizedCompetition(rules)).toBe(true);
  expect(isNormalizedCompetition({ ...rules, bodyweightContribution: 0 })).toBe(false);
  expect(isNormalizedCompetition({ ...rules, bodyweightCalculationsEnabled: false })).toBe(false);
  expect(validateCompetitionRules({ ...rules, defaultMetric: 'volume' }).ok).toBe(true);
  for (const patch of [{ name: '' }, { loadInputMode: 'unknown' }, { bodyweightContribution: 1.1 },
    { bodyweightCalculationsEnabled: null }, { defaultMetric: 'weight' }]) {
    expect(validateCompetitionRules({ ...rules, ...patch }).ok).toBe(false);
  }
});
it.each([null, [], {}, { metric: 'volume', value: Infinity, unit: 'kg_reps' },
  { metric: 'e1rm', value: 0, unit: 'kg' }, { metric: 'e1rm', value: -1, unit: 'kg' },
  { metric: 'e1rm', value: NaN, unit: 'kg' }, { metric: 'e1rm', value: 1, unit: 'percent_bw' },
  { metric: 'e1rm', value: 1, unit: 'kg', weight_kg: 80 }])('rejects unsafe ordinary score %j', value => {
  expect(isCompetitionValue(value,false)).toBe(false);
});
it('projects effective total-load 1RM and single-set Volume using the same dated B without rounding', () => {
  const result = scoreCompetitionPerformance(performance,rules);
  expect(result).toEqual([{ metric: 'volume', value: 625, unit: 'percent_bw_reps' },
    { metric: 'e1rm', value: estimateOneRepMax(100,5)! / 80 * 100, unit: 'percent_bw' }]);
  const corrected = scoreCompetitionPerformance({ ...performance, bodyWeightKg: 90 },rules);
  expect(corrected[1].value).toBeCloseTo(142.48972868923127,12);
  const unweighted = scoreCompetitionPerformance({ ...performance, weightValue: '' },rules);
  expect(unweighted[0].value).toBe(500);
  expect(result.every(value=>Object.keys(value).length===3)).toBe(true);
});
it('uses physical total load when normalized; target distribution cancels with the denominator', () => {
  const total = scoreCompetitionPerformance(performance,rules);
  expect(scoreCompetitionPerformance({ ...performance, weightValue: '10', source: { loadInputMode: 'per_side_load' } },rules)).toEqual(total);
  expect(scoreCompetitionPerformance(performance,{ ...rules, loadInputMode: 'per_side_load' })).toEqual(total);
  expect(scoreCompetitionPerformance(performance,{ ...rules, bodyweightContribution: 0.5 })[0].value).toBe(375);
});
it('ordinary Volume/1RM convert to the group target and never inspect readings Off or at zero', () => {
  const input = { ...performance };
  Object.defineProperty(input,'bodyWeightKg',{ get: () => { throw new Error('private read'); } });
  for (const patch of [{ bodyweightCalculationsEnabled: false },{ bodyweightContribution: 0 }]) {
    expect(scoreCompetitionPerformance(input,{ ...rules, ...patch })).toEqual([
      { metric: 'volume', value: 100, unit: 'kg_reps' }, { metric: 'e1rm', value: estimateOneRepMax(20,5)!, unit: 'kg' }]);
    expect(scoreCompetitionPerformance(input,{ ...rules, ...patch, loadInputMode: 'per_side_load' })[0].value).toBe(50);
  }
});
it.each([{ bodyWeightKg: null }, { bodyWeightKg: 0 }, { bodyWeightKg: Infinity },
  { bodyWeightMeasurementId: null }, { bodyWeightMeasuredAt: new Date(NaN) }, { live: false },
  { performanceStatus: 'planned' }, { source: { loadInputMode: 'invalid' } },
  { weightValue: '-5' }, { repsValue: '1.5' }])('omits unavailable/invalid performance %j', patch => {
  expect(scoreCompetitionPerformance({ ...performance, ...patch } as GroupPerformanceInput,rules)).toEqual([]);
});
it('omits zero ordinary scores and invalid group rules', () => {
  expect(scoreCompetitionPerformance({ ...performance, weightValue: '0' },{ ...rules, bodyweightContribution: 0 })).toEqual([]);
  expect(scoreCompetitionPerformance(performance,{ ...rules, bodyweightContribution: NaN })).toEqual([]);
});
it('negotiates only exact supported contract/unit/cache versions', () => {
  expect(isCompetitionContractWire(contract)).toBe(true);
  expect(isCompetitionContractWire({ ...contract, activation_state: 'active' })).toBe(true);
  for (const patch of [{ contract_version: 3 },{ cache_version: 4 },{ activation_state: 'ready' },
    { metrics: ['weight','e1rm'] },{ ordinary_units: { volume: 'kg', e1rm: 'kg' } },
    { normalized_units: { volume: 'percent_bw_reps', e1rm: 'kg' } },{ body_weight_kg: 80 }]) {
    expect(isCompetitionContractWire({ ...contract, ...patch })).toBe(false);
  }
  expect(isCompetitionContractWire(null)).toBe(false);
});
it('validates public certification audit metadata without absolute audit values or private causes', () => {
  expect(isCompetitionCertificationWire(certificate)).toBe(true);
  expect(isCompetitionCertificationWire({ ...certificate, certified_by: null, ended_at_ms: 3000, end_reason: 'voided' })).toBe(true);
  for (const patch of [{ observed_value: 100 },{ end_reason: 'reading_changed' },{ ended_at_ms: 1000,end_reason: 'voided' },
    { observed_rules_revision: 0 },{ certified_by: {} },{ certification_id: '' }]) {
    expect(isCompetitionCertificationWire({ ...certificate, ...patch })).toBe(false);
  }
});
it('accepts coherent normalized/ordinary boards, active Certified rows and honest rebuilding', () => {
  expect(isCompetitionBoardWire(board)).toBe(true);
  expect(isCompetitionBoardWire({ ...board, me: board.entries[0] })).toBe(true);
  expect(isCompetitionBoardWire({ ...board, state: 'rebuilding', entries: [],entry_count: 0 })).toBe(true);
  const ordinary = { ...board, certified: false, rules: { ...board.rules, bodyweight_contribution: 0 },
    entries: [{ ...board.entries[0], unit: 'kg', certification: null, performance: { ...publicSet, visibility: 'ordinary', weight_value: '20' } }] };
  expect(isCompetitionBoardWire(ordinary)).toBe(true);
  expect(isCompetitionRulesWire({ ...board.rules, bodyweight_contribution: -1 })).toBe(false);
});
it.each(['weight_value','weight_kg','value_kg','body_weight_kg','body_weight_measurement_id',
  'body_weight_measured_at_ms','reading_pin','fingerprint','observed_value'])('rejects enabled absolute/private field %s at every object boundary', field => {
  expect(isCompetitionBoardWire({ ...board, [field]: 80 })).toBe(false);
  expect(isCompetitionBoardWire({ ...board, rules: { ...board.rules,[field]: 80 } })).toBe(false);
  expect(isCompetitionBoardWire({ ...board, entries: [{ ...board.entries[0],[field]: 80 }] })).toBe(false);
  expect(isCompetitionPerformanceWire({ ...publicSet,[field]: 80 },true)).toBe(false);
  expect(isCompetitionCertificationWire({ ...certificate,[field]: 80 })).toBe(false);
});
it('rejects wrong units, unsafe row metadata, legacy/unsupported boards and mixed rebuilding', () => {
  for (const patch of [{ unit: 'kg' },{ rank: 0 },{ write_token: '' },{ member: { user_id: 'u',username: 'A',body_weight_kg: 80 } },
    { performance: { ...publicSet,reps: 1.5 } },{ certification: null },
    { certification: { ...certificate,metric: 'volume' } },{ certification: { ...certificate,ended_at_ms: 3000,end_reason: 'voided' } }]) {
    expect(isCompetitionBoardWire({ ...board,entries: [{ ...board.entries[0],...patch }] })).toBe(false);
  }
  for (const patch of [{ contract_version: 3 },{ metric: 'weight' },{ state: 'rebuilding' },
    { entry_count: 0 },{ me: {} },{ next_cursor: 5 }]) expect(isCompetitionBoardWire({ ...board,...patch })).toBe(false);
  expect(isCompetitionPerformanceWire({ ...publicSet, visibility: 'ordinary' },false)).toBe(false);
});
