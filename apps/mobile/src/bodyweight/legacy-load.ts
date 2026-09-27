import { parseSetWeight } from '@/src/exercise-calculations';
import { isWeightUnit, KG_PER_LB, resolveEffectiveLoad, type ExternalLoadMode, type LoadContext,
  type WeightUnit } from '@/src/exercise-calculations/effective-load';
import { canonicalizeWeightForReps } from '@/src/session-recorder/set-semantics';

export type LegacyLoadInterpretation = 'added' | 'assistance' | 'total' | 'unquantified_assistance';
export type LegacyLoadChoice = { interpretation: LegacyLoadInterpretation; unit: WeightUnit };
export type ReviewedLoad = {
  weightValue: string;
  weightUnit: WeightUnit;
  externalLoadMode: ExternalLoadMode;
  resistanceKg: number | null;
};

// Decimal text without exponents or plate rounding. Persist enough precision to
// reconstruct the original total; only display formatting may round it.
const decimalText = (value: number): string => {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const position = whole.length + Number(exponent);
  if (position <= 0) return `0.${'0'.repeat(-position)}${digits}`;
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length);
  return `${digits.slice(0, position)}.${digits.slice(position)}`;
};

/** Requires a deliberate unit even when the old schema's placeholder was kg. */
export const reviewLegacyLoad = (
  original: { weightValue: string; repsValue: string },
  context: LoadContext,
  choice: LegacyLoadChoice
): ReviewedLoad => {
  if (!isWeightUnit(choice.unit)) throw new Error('Confirm whether the original value was kg or lb.');
  if (!['added', 'assistance', 'total', 'unquantified_assistance'].includes(choice.interpretation)) {
    throw new Error('Choose what the original value meant.');
  }
  if (!Number.isFinite(context.bodyweightCoefficient) || context.bodyweightCoefficient < 0 ||
      context.bodyweightCoefficient > 1 || !['total_load', 'per_side_load'].includes(context.loadInputMode)) {
    throw new Error('Configure valid exercise load rules before reviewing old loads.');
  }
  const raw = canonicalizeWeightForReps(original.weightValue, original.repsValue).trim();
  const amount = parseSetWeight(raw);
  if (amount === null) throw new Error('The original amount is invalid. Correct the set before reviewing it.');
  let weightValue = raw;
  let mode: ExternalLoadMode;
  if (choice.interpretation === 'total') {
    if (context.bodyweightCoefficient > 0 && (context.bodyWeightKg == null || !Number.isFinite(context.bodyWeightKg) || context.bodyWeightKg <= 0)) {
      throw new Error('Add a dated reading on or before this session before converting an old total.');
    }
    // The reviewed original is TOTAL resistance, even when external entry is per side.
    const bodyContribution = context.bodyweightCoefficient === 0 ? 0
      : context.bodyweightCoefficient * context.bodyWeightKg!;
    const adjustmentKg = amount * (choice.unit === 'lb' ? KG_PER_LB : 1) - bodyContribution;
    const converted = Math.abs(adjustmentKg) / (context.loadInputMode === 'per_side_load' ? 2 : 1) /
      (choice.unit === 'lb' ? KG_PER_LB : 1);
    if (!Number.isFinite(converted)) throw new Error('This total cannot be converted safely.');
    weightValue = decimalText(converted);
    mode = adjustmentKg < 0 ? 'assistance' : 'added';
  } else {
    mode = choice.interpretation;
    // No kilogram equivalent is invented for a band. Keep the original amount;
    // it is explicitly unavailable to load metrics and is shown in the review.
  }
  const load = resolveEffectiveLoad({ ...context, weightValue, weightUnit: choice.unit, externalLoadMode: mode });
  if (load.status === 'invalid') throw new Error('This interpretation produces invalid resistance. Check the amount and session weight.');
  return { weightValue, weightUnit: choice.unit, externalLoadMode: mode,
    resistanceKg: load.status === 'known' ? load.resistanceKg : null };
};
