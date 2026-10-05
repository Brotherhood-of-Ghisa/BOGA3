import { evaluateCompetitionGraph, evaluateGroupComparisonGraph,
  type CompetitionEvaluationGraph, type CompetitionSourceSet } from '@/src/groups/competition-evaluation';
import type { GroupMetricEvaluationGraph } from '@/src/groups/metric-evaluation';
import { scoreCompetitionPerformance } from '@/src/groups/competition-score';

const source: CompetitionSourceSet = {
  member_user_id: 'member-a', session_id: 'session', session_exercise_id: 'block',
  exercise_definition_id: 'pull-up', set_id: 'set', weight_value: '20', reps_value: '5',
  set_type: 'rir_1', performance_status: null, live: true, counting: true,
  source_load_input_mode: 'total_load', body_weight_kg: 80, body_weight_source: 'reading',
  body_weight_measurement_id: 'reading', body_weight_measured_at_ms: 1000,
  achieved_at_ms: 2000, exercise_order_index: 1, set_order_index: 2, set_created_at_ms: 3000,
  observed_set_pin: 'private-observation', reading_pin: 'private-reading',
  fingerprints: { volume: 'volume-pin', e1rm: 'rm-pin' },
};
const graph: CompetitionEvaluationGraph = {
  contract_version: 4, group_id: 'group', group_exercise_id: 'comparison',
  name: 'Pull-up', source_token: 'source-hash', sets: [source],
  rules: { load_input_mode: 'total_load', bodyweight_calculations_enabled: true,
    bodyweight_contribution: 1, default_metric: 'e1rm', rules_revision: 7 },
};
const evaluate = (change: Partial<CompetitionSourceSet>) => evaluateCompetitionGraph({ ...graph, sets: [{ ...source, ...change }] });

it('publishes the complete versioned service evaluation with unrounded shared-kernel scores', () => {
  const result = evaluateCompetitionGraph(graph);
  expect(result).toMatchObject({ contract_version: 4, group_id: 'group', group_exercise_id: 'comparison',
    rules_revision: 7, source_token: 'source-hash' });
  const expected = scoreCompetitionPerformance({ weightValue: '20', repsValue: '5', performanceStatus: null,
    live: true, source: { loadInputMode: 'total_load' }, bodyWeightKg: 80, bodyWeightSource: 'reading',
    bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: new Date(1000) }, {
    name: 'Pull-up', loadInputMode: 'total_load', bodyweightCalculationsEnabled: true,
    bodyweightContribution: 1, defaultMetric: 'e1rm' });
  expect(result.scores.map(({ metric, value, unit }) => ({ metric, value, unit }))).toEqual(expected);
  expect(result.scores[1].value).not.toEqual(Number(result.scores[1].value.toFixed(6)));
  expect(result.scores).toEqual([
    expect.objectContaining({ metric: 'volume', value: 625, unit: 'percent_bw_reps', fingerprint: 'volume-pin' }),
    expect.objectContaining({ metric: 'e1rm', unit: 'percent_bw', fingerprint: 'rm-pin' }),
  ]);
  expect(result.scores[0]).toMatchObject({ member_user_id: 'member-a', set_id: 'set', counting: true, working: true,
    achieved_at_ms: 2000, exercise_order_index: 1, set_order_index: 2, set_created_at_ms: 3000,
    performance: { weight_value: '20', reps_value: '5', reps: 5 } });
  // Raw kg is service-only audit, not a public projection; reading/pin facts never copy into it.
  expect(JSON.stringify(result)).not.toMatch(/private-observation|private-reading|observed_set_pin|reading_pin|body_weight/);
});

it('compares two members by relative physical load, independently of source/target distribution', () => {
  const result = evaluateCompetitionGraph({ ...graph, sets: [source,
    { ...source, member_user_id: 'member-b', source_load_input_mode: 'per_side_load', body_weight_kg: 120 }] });
  const values = result.scores.filter(score => score.metric === 'volume');
  expect(values.map(score => score.value)).toEqual([625, (160 * 5) / 120 * 100]);
  expect(evaluateCompetitionGraph({ ...graph, rules: { ...graph.rules, load_input_mode: 'per_side_load' } })
    .scores.map(score => score.value)).toEqual(evaluateCompetitionGraph(graph).scores.map(score => score.value));
});

it.each([{ bodyweight_calculations_enabled: false }, { bodyweight_contribution: 0 }])(
  'never touches private source fields under ordinary rules %p', change => {
    const row = { ...source };
    for (const key of ['body_weight_kg','body_weight_source','body_weight_measurement_id','body_weight_measured_at_ms']) {
      Object.defineProperty(row, key, { get: () => { throw new Error('private lookup'); } });
    }
    const result = evaluateCompetitionGraph({ ...graph, rules: { ...graph.rules, ...change, load_input_mode: 'per_side_load' }, sets: [row] });
    expect(result.scores[0]).toMatchObject({ metric: 'volume', value: 50, unit: 'kg_reps' });
    expect(result.scores[1].unit).toBe('kg');
  });

it.each([{ body_weight_kg: null }, { body_weight_kg: NaN }, { body_weight_kg: Infinity },
  { body_weight_source: 'unknown' }, { body_weight_measurement_id: null },
  { body_weight_measured_at_ms: NaN }, { live: false }, { performance_status: 'planned' }])(
  'omits both dependent scores for %p', change => expect(evaluate(change).scores).toEqual([]));

it.each([null, 'rir_0', 'unknown'])('retains shared working-set eligibility for %p', setType => {
  expect(evaluate({ set_type: setType }).scores.every(score => score.working)).toBe(true);
});

it('keeps warm-up/unlinked observations available for validation without ranking them', () => {
  expect(evaluate({ set_type: 'warm_up', counting: false }).scores).toEqual(
    evaluateCompetitionGraph(graph).scores.map(score => ({ ...score, working: false, counting: false })));
});

it('fails whole publication on unsupported rules, incomplete sources, missing pins or duplicate identity', () => {
  for (const changed of [
    { ...graph, contract_version: 5 }, { ...graph, source_token: '' },
    { ...graph, rules: { ...graph.rules, rules_revision: 0 } },
    { ...graph, rules: { ...graph.rules, default_metric: 'weight' } },
    { ...graph, sets: [source, source] },
  ]) expect(() => evaluateCompetitionGraph(changed as CompetitionEvaluationGraph)).toThrow();
  expect(() => evaluate({ fingerprints: {} })).toThrow('fingerprint');
  expect(() => evaluate({ counting: undefined } as unknown as CompetitionSourceSet)).toThrow('eligibility');
  expect(() => evaluate({ set_type: undefined } as unknown as CompetitionSourceSet)).toThrow('set type');
});

it('dispatches the existing pending graph and rejects unknown competition versions', () => {
  const legacy: GroupMetricEvaluationGraph = { ...graph, rules: { ...graph.rules, default_metric: 'e1rm' },
    sets: [{ ...source, fingerprints: { weight: 'weight-pin', e1rm: 'rm-pin' } }] };
  delete (legacy as unknown as Record<string, unknown>).contract_version;
  expect(evaluateGroupComparisonGraph(legacy).scores.map(score => score.metric)).toEqual(['weight','e1rm']);
  expect(evaluateGroupComparisonGraph(graph)).toEqual(evaluateCompetitionGraph(graph));
  expect(() => evaluateGroupComparisonGraph({ ...graph, contract_version: 5 } as unknown as CompetitionEvaluationGraph))
    .toThrow('Unsupported');
});
