export type SetValueInput = {
  reps: string;
  weight: string;
};

export const hasPositiveIntegerReps = (reps: string): boolean => {
  const trimmed = reps.trim();
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0;
};

export const canonicalizeWeightForReps = (weight: string, reps: string): string =>
  weight.trim().length === 0 && hasPositiveIntegerReps(reps) ? '0' : weight;

export const canonicalizeSetValues = <T extends SetValueInput>(set: T): T => {
  const weight = canonicalizeWeightForReps(set.weight, set.reps);
  return weight === set.weight ? set : { ...set, weight };
};

export const isPerformedSet = (set: SetValueInput): boolean => {
  if (!hasPositiveIntegerReps(set.reps)) {
    return false;
  }

  const canonicalWeight = canonicalizeWeightForReps(set.weight, set.reps).trim();
  if (canonicalWeight.length === 0) {
    return false;
  }

  const parsedWeight = Number(canonicalWeight);
  return Number.isFinite(parsedWeight) && parsedWeight >= 0;
};
