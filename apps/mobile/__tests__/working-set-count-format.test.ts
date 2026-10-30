import { formatWorkingSetCount } from '@/src/exercise-calculations/format';

it.each([
  [0, '0'], [-0, '0'], [3, '3'], [1.5, '1.5'], [1 / 3, '0.33'], [2 / 3, '0.67'],
  [1 / 6, '0.17'], [0.9999999999999999, '1'], [1.375, '1.38'],
  [1 / 300, '0.0033'], [1 / 30000, '0.000033'],
  [NaN, '—'], [Infinity, '—'], [-Infinity, '—'],
])('formats allocated count %s as %s only at display time', (count, expected) => {
  expect(formatWorkingSetCount(count)).toBe(expected);
});
