import { baselineFrom, deriveComparisonFormStatus } from '@/src/groups/comparison-form-model';
import type { GroupExerciseRules } from '@/src/groups/metric-contract';

const rules: GroupExerciseRules = { name: 'Bench', loadInputMode: 'total_load',
  bodyweightCalculationsEnabled: false, bodyweightContribution: 0, defaultMetric: 'e1rm' };

it.each([
  ['zero contribution ignores Off → On', false, true, 0, 0, false],
  ['cached zero contribution ignores On → Off', true, false, 0, 0, false],
  ['positive contribution reviews Off → On', false, true, 0.7, 0.7, true],
  ['positive contribution reviews On → Off', true, false, 0.7, 0.7, true],
  ['zero → positive reviews activation', false, true, 0, 0.7, true],
  ['positive → zero reviews ordinary scoring', true, true, 0.7, 0, true],
] as const)('%s', (_name, beforeEnabled, nextEnabled, beforeContribution, nextContribution, changed) => {
  const baseline = { ...baselineFrom({ ...rules, bodyweightCalculationsEnabled: beforeEnabled,
    bodyweightContribution: beforeContribution }, undefined), revision: 1 };
  const next = { ...rules, bodyweightCalculationsEnabled: nextEnabled, bodyweightContribution: nextContribution };
  const status = deriveComparisonFormStatus({ baseline, validation: { ok: true, value: next },
    existing: undefined, dirty: true, showErrors: false, reviewed: false });
  expect(status.calculationChanged).toBe(changed);
});
