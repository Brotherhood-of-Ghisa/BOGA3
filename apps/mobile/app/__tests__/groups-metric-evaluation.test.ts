import { evaluateGroupMetricGraph, type GroupMetricEvaluationGraph, type GroupMetricSourceSet } from '@/src/groups/metric-evaluation';

const set: GroupMetricSourceSet = {
  member_user_id: 'member-a', session_id: 'session', session_exercise_id: 'block',
  exercise_definition_id: 'personal-pull-up', set_id: 'set', weight_value: '20', weight_unit: 'kg',
  external_load_mode: 'added', reps_value: '5', performance_status: null, live: true, counting: true,
  source_load_input_mode: 'total_load', movement_standard: 'Strict pull-up', loading_method: 'Belt',
  body_weight_kg: 60, body_weight_source: 'manual', body_weight_measurement_id: null,
  body_weight_measured_at_ms: null, achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0,
  set_created_at_ms: 2000, fingerprints: { bodyweight_reps: 'reps-pin', absolute_strength: 'strength-pin',
    relative_strength: 'strength-pin', weight: 'conventional-pin', e1rm: 'conventional-pin' },
};
const graph: GroupMetricEvaluationGraph = {
  group_id: 'group', group_exercise_id: 'comparison', name: 'Pull-up', source_token: 'source-hash',
  rules: { load_input_mode: 'total_load', bodyweight_coefficient: 1, movement_standard: 'Strict pull-up',
    loading_method: 'Belt', default_metric: 'relative_strength', rules_revision: 3 }, sets: [set],
};

it('carries revision, source token, raw session context and per-metric dependency pins unchanged', () => {
  const result = evaluateGroupMetricGraph(graph);
  expect(result).toMatchObject({ group_id: 'group', group_exercise_id: 'comparison',
    rules_revision: 3, source_token: 'source-hash' });
  expect(result.scores).toHaveLength(2);
  expect(result.scores[0]).toMatchObject({ metric: 'absolute_strength', unit: 'kg',
    fingerprint: 'strength-pin', counting: true, effective_resistance_kg: 80,
    performance: { weight_value: '20', weight_unit: 'kg', body_weight_status: 'known', body_weight_kg: 60, body_weight_source: 'manual' } });
  expect(result.scores[1]).toMatchObject({ metric: 'relative_strength', unit: 'x_bw' });
  expect(result.scores[0]).not.toHaveProperty('value_kg');
});

it('evaluates two members under one target revision with the required ranking reversal', () => {
  const result = evaluateGroupMetricGraph({ ...graph, sets: [set, { ...set, member_user_id: 'member-b', body_weight_kg: 90 }] });
  const score = (member: string, metric: string) => result.scores.find(row => row.member_user_id === member && row.metric === metric)!.value;
  expect(score('member-a', 'absolute_strength')).toBeLessThan(score('member-b', 'absolute_strength'));
  expect(score('member-a', 'relative_strength')).toBeGreaterThan(score('member-b', 'relative_strength'));
});

it('retains a valid unlinked observation without allowing it into the live board', () => {
  const before = evaluateGroupMetricGraph(graph).scores;
  const after = evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, counting: false }] }).scores;
  expect(after).toEqual(before.map(score => ({ ...score, counting: false })));
  expect(after.filter(score => score.counting)).toEqual([]);
});

it('retains reps without valid B but refuses unconfirmed or incompatible performances', () => {
  const noB = { ...set, weight_value: '', body_weight_kg: null, body_weight_source: null };
  const result = evaluateGroupMetricGraph({ ...graph, sets: [noB] });
  expect(result.scores).toEqual([expect.objectContaining({ metric: 'bodyweight_reps', unit: 'reps', value: 5,
    fingerprint: 'reps-pin', effective_resistance_kg: null,
    performance: expect.objectContaining({ body_weight_status: 'missing', body_weight_kg: null }) })]);
  for (const patch of [{ performance_status: 'unperformed' }, { performance_status: 'future-status' },
    { live: false }, { movement_standard: 'Kipping pull-up' }]) {
    expect(evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, ...patch }] }).scores).toEqual([]);
  }
});

it.each([
  { body_weight_kg: Number.NaN },
  { body_weight_kg: Number.POSITIVE_INFINITY },
  { body_weight_kg: -80 },
  { body_weight_source: 'future-source' },
  { body_weight_source: 'reading' },
  { body_weight_source: 'reading', body_weight_measurement_id: 'reading', body_weight_measured_at_ms: Number.POSITIVE_INFINITY },
  { body_weight_source: 'manual', body_weight_measurement_id: 'unexpected-reading' },
  { body_weight_kg: null, body_weight_source: 'reading' },
])('labels malformed session weight without losing an eligible unweighted-reps score: %p', patch => {
  const result = evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, weight_value: '0', ...patch }] });
  expect(result.scores).toEqual([expect.objectContaining({ metric: 'bodyweight_reps', value: 5,
    effective_resistance_kg: null, performance: expect.objectContaining({
      body_weight_status: 'invalid', body_weight_kg: null, body_weight_source: null,
      body_weight_measurement_id: null, body_weight_measured_at_ms: null,
    }) })]);
  expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
});

it('keeps valid historical-estimate provenance on every ranked score', () => {
  const result = evaluateGroupMetricGraph({ ...graph, sets: [{ ...set,
    body_weight_source: 'historical_estimate', body_weight_measurement_id: 'later-reading',
    body_weight_measured_at_ms: 9000 }] });
  for (const score of result.scores) {
    expect(score.performance).toMatchObject({ body_weight_status: 'known', body_weight_kg: 60,
      body_weight_source: 'historical_estimate', body_weight_measurement_id: 'later-reading',
      body_weight_measured_at_ms: 9000 });
  }
});

it('fails the complete publication on missing eligible pins, duplicate identities or invalid revision', () => {
  expect(() => evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, counting: undefined } as unknown as GroupMetricSourceSet] })).toThrow('source eligibility');
  expect(() => evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, fingerprints: {} }] })).toThrow('fingerprint');
  expect(() => evaluateGroupMetricGraph({ ...graph, sets: [set, set] })).toThrow('Duplicate');
  expect(() => evaluateGroupMetricGraph({ ...graph, rules: { ...graph.rules, rules_revision: 0 } })).toThrow('rules snapshot');
});
