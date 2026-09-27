import { isValidSessionWeight, type SessionWeightSnapshot } from './snapshot';
import type { BodyWeightMeasurement } from '@/src/data/schema';
import { parseSetWeight } from '@/src/exercise-calculations';
import { isWeightUnit, weightToKg, type WeightUnit } from '@/src/exercise-calculations/effective-load';
import { formatCurrentDateTime, parseSessionDateTime } from '@/src/session-recorder/session-model';

export { isValidSessionWeight, type SessionWeightSnapshot } from './snapshot';

export type WeightEntry = { weightValue: string; weightUnit: string };
export type WeightReadingInput = WeightEntry & { id?: string; measuredAt: Date; now?: Date };
export const EMPTY_SESSION_WEIGHT: SessionWeightSnapshot = {
  bodyWeightKg: null, bodyWeightSource: null, bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null,
};

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

// Server sync is a typed mirror, so restored rows still need domain validation
// before supplying a snapshot. An invalid latest reading leaves B unknown.
export const isValidBodyWeightReading = (reading: BodyWeightMeasurement): boolean => {
  try {
    const value = validateBodyWeight(reading);
    requireDate(reading.measuredAt, 'measurement date');
    return Number.isFinite(reading.weightKg) && reading.weightKg > 0 &&
      Math.abs(value.weightKg - reading.weightKg) <= Number.EPSILON * 16 * Math.max(1, value.weightKg);
  } catch { return false; }
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
  if (!isValidSessionWeight(snapshot)) return 'No usable weight saved for this session';
  if (snapshot.bodyWeightSource === 'manual') return 'Set manually for this session';
  const prefix = snapshot.bodyWeightSource === 'historical_estimate' ? 'Estimated from' : 'Reading from';
  return `${prefix} ${formatCurrentDateTime(snapshot.bodyWeightMeasuredAt!)}`;
}
