import { baselineFrom, deriveComparisonFormStatus, validateCompetitionFormRules } from '@/src/groups/comparison-form-model';
import type { CompetitionRules } from '@/src/groups/competition-contract';

import { competitionExercise as existing } from './helpers/competition-fixtures';

const rules: CompetitionRules = { name: 'Bench', loadInputMode: 'total_load',
  bodyweightCalculationsEnabled: false, bodyweightContribution: 0, defaultMetric: 'e1rm' };
const baseline = baselineFrom(rules, existing);

it.each([
  ['zero → positive contribution', { bodyweightCalculationsEnabled: true, bodyweightContribution: 0.7 }],
  ['a load-mode change', { loadInputMode: 'per_side_load' as const }],
])('a calculation change (%s) leaves no review state: the status is errors and staleness only', (_name, change) => {
  const status = deriveComparisonFormStatus({ baseline, validation: { ok: true, value: { ...rules, ...change } },
    existing, dirty: true, showErrors: true });
  expect(status).toEqual({ nameError: null, rulesError: null, stale: false });
});

it.each([
  ['name', { ...rules, name: '  ' }, 'nameError', 'rulesError'],
  ['contribution', { ...rules, bodyweightContribution: 1.01 }, 'rulesError', 'nameError'],
] as const)('shows a %s error on its own field once errors are revealed', (_name, input, field, other) => {
  const validation = validateCompetitionFormRules(input);
  expect(deriveComparisonFormStatus({ baseline, validation, existing, dirty: true, showErrors: false }))
    .toEqual({ nameError: null, rulesError: null, stale: false });
  const shown = deriveComparisonFormStatus({ baseline, validation, existing, dirty: true, showErrors: true });
  expect(shown[field]).toEqual(expect.any(String));
  expect(shown[other]).toBeNull();
});

it.each([
  ['dirty edits on an older revision', true, 3, true],
  ['an untouched form on an older revision', false, 3, false],
  ['dirty edits on the loaded revision', true, 2, false],
])('%s → stale %s', (_name, dirty, loadedRevision, stale) => {
  const loaded = { ...existing, rules: { ...existing.rules, rules_revision: loadedRevision } };
  const status = deriveComparisonFormStatus({ baseline, validation: { ok: true, value: rules },
    existing: loaded, dirty, showErrors: false });
  expect(status.stale).toBe(stale);
});
