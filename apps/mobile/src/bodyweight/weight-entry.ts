import { isValidSessionWeight, type SessionWeightSnapshot } from './snapshot';
import { parseSetWeight } from '@/src/exercise-calculations';
import { isWeightUnit, weightToKg, type WeightUnit } from '@/src/exercise-calculations/effective-load';
import { formatCurrentDateTime, parseSessionDateTime } from '@/src/session-recorder/session-model';

export { isValidSessionWeight, type SessionWeightSnapshot } from './snapshot';

export type WeightEntry = { weightValue: string; weightUnit: string };
export type WeightReadingInput = WeightEntry & { id?: string; measuredAt: Date; now?: Date };
export { EMPTY_SESSION_WEIGHT, isValidBodyWeightReading } from './as-of';

export const validateBodyWeight = (input: WeightEntry): {
  weightValue: string; weightUnit: WeightUnit; weightKg: number;
} => {
  const weightValue = input.weightValue.trim();
  const parsed = parseSetWeight(weightValue);
  if (!isWeightUnit(input.weightUnit)) throw new Error('Choose kg or lb.');
  if (parsed === null || parsed <= 0) throw new Error('Enter a weight greater than zero.');
  const weightKg = weightToKg(parsed, input.weightUnit);
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) throw new Error('Enter a valid positive weight.');
  return { weightValue, weightUnit: input.weightUnit, weightKg };
};

export const requireDate = (date: Date, label: string): void => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error(`Enter a valid ${label}.`);
};

// Date fields show minutes; keeping unchanged text must not alter a reading's
// exact timestamp or its ordering against other readings in that same minute.
export function resolveMeasurementDate(text: string, original: Date, now = new Date()): Date {
  const date = text.trim() === formatCurrentDateTime(original) ? original : parseSessionDateTime(text);
  if (!date) throw new Error('Use a valid date and time: YYYY-MM-DD HH:mm.');
  requireDate(date, 'measurement date');
  if (date.getTime() > now.getTime()) throw new Error('The measurement date cannot be in the future.');
  return date;
}


export function sessionWeightSourceLabel(snapshot: Partial<SessionWeightSnapshot>): string {
  if (!isValidSessionWeight(snapshot)) return snapshot.bodyWeightMeasurementId
    ? 'The applicable reading needs review.' : 'No reading on or before this session';
  return `Reading from ${formatCurrentDateTime(snapshot.bodyWeightMeasuredAt!)}`;
}
