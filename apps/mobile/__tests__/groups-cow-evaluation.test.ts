import { COW_SCORER_VERSION, evaluateCoWGraph, type CoWEvaluationGraph } from '@/src/groups/cow-evaluation';
import { estimateOneRepMax } from '@/src/exercise-calculations';
// Lifetime rebuilds may advance independently of the retained CoW scorer.
jest.mock('@/src/groups/set-facts', () => ({ GROUP_EVAL_RULES_VERSION: 8 }));

function graph(normalized = true): CoWEvaluationGraph {
  const input = { session_started_at_ms: 1100, completed: true, shared: true, eligible: true,
    weight_value: '20', reps_value: '5', performance_status: null, set_type: null,
    source_load_input_mode: 'total_load' as const, exercise_definition_id: 'definition',
    body_weight_context: { body_weight_kg: 80, body_weight_source: 'reading',
      body_weight_measurement_id: 'private-reading', body_weight_measured_at: 1 } };
  return { cowId: 'cow', groupId: 'group', revision: 1, sourceToken: 'private-token',
    window: { startUs: 1_000_000, endUs: 2_000_000, readBeforeUs: 2_000_000,
      context: { key: 'context', normalized }, contextChangedAtUs: null },
    context: { load_input_mode: 'total_load', bodyweight_calculations_enabled: normalized,
      bodyweight_contribution: 1, scorer_version: COW_SCORER_VERSION },
    metrics: ['e1rm', 'volume', 'improvement'], participants: [{ memberId: 'a', endedAtUs: null }],
    sources: [{ memberId: 'a', setId: 'weekly', version: 2, receivedAtUs: 1_100_000, contextKey: 'context', input },
      { memberId: 'a', setId: 'baseline', version: 1, receivedAtUs: 900_000, contextKey: 'context',
        input: { ...input, session_started_at_ms: 100, weight_value: '0', reps_value: '1' } }] };
}
const ranking = (result: ReturnType<typeof evaluateCoWGraph>, metric: string) => result.rankings.find(row => row.metric === metric)!;

it('uses the elected group bodyweight setting for all three metrics without exposing the private context', () => {
  const result = evaluateCoWGraph(graph());
  const e1rm = estimateOneRepMax(100, 5)! / 80 * 100;
  expect(result.rankings.map(row => row.unit)).toEqual(['percent_bw', 'percent_bw_reps', 'percent']);
  expect(ranking(result, 'e1rm').entries[0].value).toBe(e1rm);
  expect(ranking(result, 'volume').entries[0].value).toBe(625);
  expect(ranking(result, 'improvement').entries[0].value).toBe((e1rm / 100 - 1) * 100);
  expect(JSON.stringify(result)).not.toMatch(/body_weight|private-reading|sourceToken|contextKey/);
  expect(ranking(result, 'improvement').entries[0]).toMatchObject({ sources: [
    { set_id: 'weekly', definition_id: 'definition' }, { set_id: 'baseline', definition_id: 'definition' }] });
});

it('never reads B when the group switch is Off or contribution is zero', () => {
  for (const input of [graph(false), graph()]) {
    if (input.window.context!.normalized) { input.window.context!.normalized = false; input.context!.bodyweight_contribution = 0; }
    input.sources.forEach(row => Object.defineProperty(row.input, 'body_weight_context', { get: () => { throw new Error('private read'); } }));
    const result = evaluateCoWGraph(input);
    expect(result.rankings.map(row => row.unit)).toEqual(['kg', 'kg_reps', 'percent']);
    expect(ranking(result, 'volume').entries[0].value).toBe(100);
    expect(ranking(result, 'e1rm').entries[0].value).toBe(estimateOneRepMax(20, 5));
  }
});

it('omits missing normalized readings, nonworking efforts and unsettled performances without fallback', () => {
  for (const patch of [{ body_weight_context: null }, { set_type: 'warm_up' }, { performance_status: 'planned' }, { eligible: false }]) {
    const input = graph(); input.sources.forEach(row => Object.assign(row.input, patch));
    expect(evaluateCoWGraph(input).rankings.every(row => row.entries.length === 0)).toBe(true);
  }
});

it('preserves source distribution and private provenance for only the actual counted/winning sets', () => {
  const input = graph(); input.sources[0].input.weight_value = '10'; input.sources[0].input.source_load_input_mode = 'per_side_load';
  expect(ranking(evaluateCoWGraph(input), 'volume').entries[0].value).toBe(625);
  input.sources.push({ ...input.sources[0], setId: 'warm-up', version: 3, input: { ...input.sources[0].input, set_type: 'warm_up', weight_value: '999' } });
  expect(JSON.stringify(evaluateCoWGraph(input))).not.toContain('warm-up');
  input.sources[0].input.exercise_definition_id = '';
  expect(ranking(evaluateCoWGraph(input), 'e1rm').entries[0]).toMatchObject({ sources: [{ set_id: 'weekly', definition_id: '' }] });
});

it('isolates per-set and aggregate overflow to the affected member metric', () => {
  const input = graph(false); input.sources = [input.sources[0]];
  Object.assign(input.sources[0].input, { weight_value: `1${'0'.repeat(307)}`, reps_value: '2' });
  let result = evaluateCoWGraph(input);
  expect(ranking(result, 'e1rm').unavailableMemberIds).toEqual(['a']);
  expect(ranking(result, 'volume').entries[0].value).toBe(2e307);
  Object.assign(input.sources[0].input, { weight_value: `8${'0'.repeat(307)}`, reps_value: '1' });
  input.sources = [1, 2, 3].map(version => ({ ...input.sources[0], setId: `s${version}`, version }));
  result = evaluateCoWGraph(input);
  expect(ranking(result, 'volume').unavailableMemberIds).toEqual(['a']);
  expect(ranking(result, 'e1rm').entries[0].value).toBe(8e307);
});

it('never runs an unsupported retained scorer through the current math, but can classify a known context failure', () => {
  const input = graph(); input.context!.scorer_version += 1;
  expect(() => evaluateCoWGraph(input)).toThrow('Unsupported CoW scorer version');
  input.window.contextChangedAtUs = 1_200_000;
  expect(evaluateCoWGraph(input)).toEqual({ state: 'unavailable', rankings: [] });
});
