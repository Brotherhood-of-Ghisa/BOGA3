import { formatWholeSetCount, formatWorkingSetCount } from '@/src/exercise-calculations/format';

it.each([
  [0, '0'], [-0, '0'], [3, '3'], [1.5, '1.5'], [1 / 3, '0.3'], [2 / 3, '0.7'],
  [1 / 6, '0.2'], [0.9999999999999999, '1'], [1.375, '1.4'], [-0.04, '0'],
  [1 / 300, '0'], [NaN, '—'], [Infinity, '—'], [-Infinity, '—'],
])('formats allocated count %s with at most one decimal as %s', (count, expected) => {
  expect(formatWorkingSetCount(count)).toBe(expected);
});

it.each([
  [0, '0'], [-0.4, '0'], [3, '3'], [1.5, '2'], [1 / 3, '0'], [2.49, '2'], [3.75, '4'],
  [NaN, '—'], [Infinity, '—'],
])('formats allocated count %s as whole sets %s', (count, expected) => {
  expect(formatWholeSetCount(count)).toBe(expected);
});
