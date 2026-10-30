/** Kahan summation keeps repeated fractional muscle shares from falling below whole-set targets. */
export type CompensatedSum = { value: number; correction: number };

export const createCompensatedSum = (): CompensatedSum => ({ value: 0, correction: 0 });

/** Only remove representational drift at a whole-set boundary, retaining small positive shares. */
export const compensatedValue = (sum: CompensatedSum): number => {
  const whole = Math.round(sum.value);
  return whole !== 0 && Math.abs(sum.value - whole) <= Number.EPSILON * Math.abs(sum.value) ? whole : sum.value;
};

export const addCompensated = (sum: CompensatedSum, value: number): number => {
  const adjusted = value - sum.correction;
  const next = sum.value + adjusted;
  sum.correction = (next - sum.value) - adjusted;
  sum.value = next;
  return compensatedValue(sum);
};

export const sumNumbers = (values: Iterable<number>): number => {
  const sum = createCompensatedSum();
  for (const value of values) addCompensated(sum, value);
  return compensatedValue(sum);
};
