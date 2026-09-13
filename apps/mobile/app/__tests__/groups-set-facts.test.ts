/**
 * Group evaluator normalization (groups contract §2.9): the fact rows the
 * `group-eval` Edge Function writes, and their agreement with the device's
 * card rule (`toGroupPerformedSet`), which delegates to the same core.
 */

import { estimateOneRepMax } from '@/src/exercise-calculations';
import {
  GROUP_EVAL_RULES_VERSION,
  normalizeGroupSetFacts,
  toGroupPerformedSet,
  type GroupEvalSetRow,
} from '@/src/groups';

const STARTED_AT_MS = 1_757_500_000_000;

const row = (setId: string, weight: string, reps: string, overrides: Partial<GroupEvalSetRow> = {}): GroupEvalSetRow => ({
  set_id: setId,
  session_exercise_id: 'se-bench',
  exercise_definition_id: 'def-bench',
  exercise_order_index: 0,
  set_order_index: 0,
  weight_value: weight,
  reps_value: reps,
  performance_status: null,
  live: true,
  fingerprint: `fp-${setId}`,
  ...overrides,
});

const factOf = (set: GroupEvalSetRow) =>
  normalizeGroupSetFacts({ session_id: 'session-1', started_at_ms: STARTED_AT_MS, sets: [set] })[0];

// The raw-set cases of groups-session-metrics.test.ts: [weight, reps, status].
const METRICS_FIXTURES: [string, string, string | null][] = [
  [' 102.5 ', '5 ', null],
  ['', '8', null],
  ['100', '5', 'planned'],
  ['100', '5', 'skipped'],
  ['100', '5', 'unperformed'],
  ['100', '5', 'future_status'],
  ['100', '', null],
  ['100', '0', null],
  ['100', '2.5', null],
  ['1e3', '5', null],
  ['-5', '5', null],
  ['abc', '5', null],
  ['', '', null],
];

describe('group evaluator set facts', () => {
  it('agrees with the device card rule on every metrics fixture', () => {
    for (const [weight, reps, status] of METRICS_FIXTURES) {
      const fact = factOf(row('s1', weight, reps, { performance_status: status }));
      const device = toGroupPerformedSet({
        set_id: 's1',
        order_index: 0,
        weight_value: weight,
        reps_value: reps,
        set_type: 'working',
        performance_status: status,
      });
      expect({ weight, reps, status, performed: fact.performed, weightKg: fact.weight_kg, reps_: fact.reps }).toEqual({
        weight,
        reps,
        status,
        performed: device !== null,
        weightKg: device?.weightKg ?? null,
        reps_: device?.reps ?? null,
      });
    }
  });

  it('writes a performed set with its e1RM, position, fingerprint, and rules version', () => {
    expect(factOf(row('s1', ' 102.5 ', '5 ', { exercise_order_index: 2, set_order_index: 3 }))).toEqual({
      set_id: 's1',
      session_exercise_id: 'se-bench',
      exercise_definition_id: 'def-bench',
      exercise_order_index: 2,
      set_order_index: 3,
      performed: true,
      live: true,
      weight_kg: 102.5,
      reps: 5,
      e1rm_kg: estimateOneRepMax(102.5, 5),
      achieved_at_ms: STARTED_AT_MS,
      fingerprint: 'fp-s1',
      rules_version: GROUP_EVAL_RULES_VERSION,
    });
    expect(GROUP_EVAL_RULES_VERSION).toBe(1);
  });

  it('keeps the entered value of a per-side set (conversion happens later, in SQL)', () => {
    expect(factOf(row('s1', '30', '10'))).toMatchObject({ weight_kg: 30, e1rm_kg: estimateOneRepMax(30, 10) });
  });

  it('counts a blank weight with valid reps as a performed 0 kg set with no e1RM', () => {
    expect(factOf(row('s1', '', '8'))).toMatchObject({ performed: true, weight_kg: 0, reps: 8, e1rm_kg: null });
  });

  it('nulls the numbers of a set that is not performed and passes live through', () => {
    expect(factOf(row('s1', '100', '5', { performance_status: 'planned', live: false }))).toMatchObject({
      performed: false,
      live: false,
      weight_kg: null,
      reps: null,
      e1rm_kg: null,
    });
  });

  it('keeps every set in input order, including unlinked-exercise and tombstoned ones', () => {
    const facts = normalizeGroupSetFacts({
      session_id: 'session-1',
      started_at_ms: STARTED_AT_MS,
      sets: [row('a', '100', '5'), row('b', '100', '5', { live: false }), row('c', '50', '10', { exercise_definition_id: null })],
    });
    expect(facts.map((fact) => [fact.set_id, fact.live, fact.exercise_definition_id])).toEqual([
      ['a', true, 'def-bench'],
      ['b', false, 'def-bench'],
      ['c', true, null],
    ]);
  });

  it('yields no facts for a session that no longer exists', () => {
    expect(normalizeGroupSetFacts({ session_id: 'gone', started_at_ms: null, sets: [] })).toEqual([]);
  });
});
