// A comparison's versioned rules pass the guard; bodyweight readings and
// evaluator-only dependencies never do.
import { isGroupMetricExerciseWire } from '@/src/groups/metric-wire-guards';
import type { GroupMetricExerciseWire } from '@/src/groups/metric-wire';

const exercise: GroupMetricExerciseWire = {
  group_exercise_id: 'pull',
  name: 'Pull-up',
  bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1,
  load_input_mode: 'total_load',
  default_metric: 'e1rm',
  rules_revision: 2,
  published_revision: 2,
  rebuilding: false,
  legacy: false,
  source_exercise_id: null,
  archived_at_ms: null,
};

it('accepts a published, a rebuilding and a legacy comparison', () => {
  expect(isGroupMetricExerciseWire(exercise)).toBe(true);
  expect(isGroupMetricExerciseWire({ ...exercise, published_revision: null, rebuilding: true })).toBe(true);
  expect(isGroupMetricExerciseWire({ ...exercise, legacy: true, bodyweight_calculations_enabled: false,
    bodyweight_contribution: 0, default_metric: 'weight' })).toBe(true);
});

it.each([
  ['a contribution outside [0, 1]', { bodyweight_contribution: 1.2 }],
  ['a metric other than Weight/1RM', { default_metric: 'reps' }],
  ['a published revision ahead of the rules', { published_revision: 3 }],
  ['a missing legacy flag', { legacy: undefined }],
])('rejects %s', (_label, change) => {
  expect(isGroupMetricExerciseWire({ ...exercise, ...change })).toBe(false);
});

it.each(['body_weight_kg', 'body_weight_dependency_digest', 'observed_set_pin', 'reading_pin', 'current_fingerprint',
  'legacy_certification_id', 'rule_rescore_baseline', 'source_rules_only'])(
  'rejects the internal %s before a comparison reaches UI or cache', key => {
    expect(isGroupMetricExerciseWire({ ...exercise, [key]: 'internal' })).toBe(false);
  },
);
