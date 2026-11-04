import { blockCountsLabel, planOutcomeLabel } from '@/components/session-planner/progress-labels';

it.each([
  [{ pending: 0, attached: 0, completed: 0, skipped: 0 }, '0 blocks · 0 completed · 0 skipped'],
  [{ pending: 1, attached: 0, completed: 0, skipped: 0 }, '1 block · 0 completed · 0 skipped'],
  [{ pending: 2, attached: 1, completed: 3, skipped: 4 }, '10 blocks · 3 completed · 4 skipped'],
])('keeps total blocks and both outcome counts, including zero: %o', (counts, label) => {
  expect(blockCountsLabel(counts)).toBe(label);
});

it.each([
  ['planned', 0, 0, 'Planned'],
  ['in_progress', 0, 1, 'In progress'],
  ['completed', 0, 1, 'Skipped'],
  ['completed', 1, 0, 'Completed'],
  ['completed', 1, 1, 'Completed'],
] as const)('labels session progress %s with %i completed and %i skipped blocks as %s', (progress, completed, skipped, label) => {
  expect(planOutcomeLabel({ progress, blockCounts: { pending: 0, attached: 0, completed, skipped } })).toBe(label);
});
