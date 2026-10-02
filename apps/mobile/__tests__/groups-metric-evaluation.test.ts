import { evaluateGroupMetricGraph, type GroupMetricEvaluationGraph,
  type GroupMetricSourceSet } from '@/src/groups/metric-evaluation';

const set: GroupMetricSourceSet = {
  member_user_id: 'member-a', session_id: 'session', session_exercise_id: 'block',
  exercise_definition_id: 'personal-pull-up', set_id: 'set', weight_value: '20',
  reps_value: '5', performance_status: null, live: true, counting: true,
  source_load_input_mode: 'total_load', body_weight_kg: 60, body_weight_source: 'reading',
  body_weight_measurement_id: 'r', body_weight_measured_at_ms: 1000,
  achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0,
  set_created_at_ms: 2000, fingerprints: { weight: 'weight-pin', e1rm: 'rm-pin' },
};
const graph: GroupMetricEvaluationGraph = {
  group_id: 'group', group_exercise_id: 'comparison', name: 'Pull-up', source_token: 'source-hash',
  rules: { load_input_mode: 'total_load', bodyweight_calculations_enabled: true,
    bodyweight_contribution: 1, default_metric: 'e1rm', rules_revision: 3 },
  sets: [set],
};

it('carries revision, raw performance and Weight/1RM dependency pins', () => {
  const result = evaluateGroupMetricGraph(graph);
  expect(result).toMatchObject({ group_id: 'group', group_exercise_id: 'comparison',
    rules_revision: 3, source_token: 'source-hash' });
  expect(result.scores).toEqual([
    expect.objectContaining({ metric: 'weight', unit: 'kg', value: 20,
      fingerprint: 'weight-pin', counting: true,
      performance: expect.objectContaining({ weight_value: '20', reps_value: '5' }) }),
    expect.objectContaining({ metric: 'e1rm', unit: 'kg', fingerprint: 'rm-pin', counting: true }),
  ]);
  expect(result.scores[0].performance).not.toHaveProperty('body_weight_kg');
});

it('retains a valid unlinked observation without allowing it into the live board', () => {
  const before = evaluateGroupMetricGraph(graph).scores;
  const after = evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, counting: false }] }).scores;
  expect(after).toEqual(before.map(score => ({ ...score, counting: false })));
  expect(after.filter(score => score.counting)).toEqual([]);
});

it('retains Weight while omitting 1RM without a valid reading', () => {
  const noReading = { ...set, body_weight_kg: null, body_weight_source: null,
    body_weight_measurement_id: null, body_weight_measured_at_ms: null };
  expect(evaluateGroupMetricGraph({ ...graph, sets: [noReading] }).scores)
    .toEqual([expect.objectContaining({ metric: 'weight', value: 20, fingerprint: 'weight-pin' })]);
});

it.each([
  { body_weight_kg: Number.NaN },
  { body_weight_kg: Number.POSITIVE_INFINITY },
  { body_weight_kg: -80 },
  { body_weight_source: 'unknown' },
  { body_weight_measurement_id: null },
  { body_weight_measured_at_ms: Number.POSITIVE_INFINITY },
])('does not let malformed private context remove raw Weight: %p', change => {
  const result = evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, ...change }] });
  expect(result.scores).toEqual([expect.objectContaining({ metric: 'weight', value: 20 })]);
  expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
});

it('fails complete publication on missing pins, duplicate identities or invalid revision', () => {
  expect(() => evaluateGroupMetricGraph({ ...graph,
    sets: [{ ...set, counting: undefined } as unknown as GroupMetricSourceSet] })).toThrow('source eligibility');
  expect(() => evaluateGroupMetricGraph({ ...graph, sets: [{ ...set, fingerprints: {} }] })).toThrow('fingerprint');
  expect(() => evaluateGroupMetricGraph({ ...graph, sets: [set, set] })).toThrow('Duplicate');
  expect(() => evaluateGroupMetricGraph({ ...graph,
    rules: { ...graph.rules, rules_revision: 0 } })).toThrow('rules snapshot');
});
