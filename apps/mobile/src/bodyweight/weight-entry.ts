import type { ExerciseDateFormat } from '@/src/preferences/model';
import { parseSetWeight } from '@/src/exercise-calculations';
import { formatLocalDateTime, parseSessionDateTime } from '@/src/utils/local-time';

export { isValidSessionWeight } from './as-of';

export type WeightEntry = { weightValue: string };
export type WeightReadingInput = WeightEntry & { id?: string; measuredAt: Date; now?: Date };
export { EMPTY_SESSION_WEIGHT, isValidBodyWeightReading } from './as-of';

export const validateBodyWeight = (input: WeightEntry): {
  weightKg: number;
} => {
  const weightValue = input.weightValue.trim();
  const weightKg = parseSetWeight(weightValue);
  if (weightKg === null || weightKg <= 0) throw new Error('Enter a weight greater than zero.');
  return { weightKg };
};

export const requireDate = (date: Date, label: string): void => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error(`Enter a valid ${label}.`);
};

// Date fields show minutes; keeping unchanged text must not alter a reading's
// exact timestamp or its ordering against other readings in that same minute.
export function resolveMeasurementDate(text: string, original: Date, now = new Date(), dateFormat: ExerciseDateFormat = 'YYYY-MM-DD'): Date {
  const date = text.trim() === formatLocalDateTime(original.getTime(), dateFormat) ? original : parseSessionDateTime(text, dateFormat);
  if (!date) throw new Error(`Use a valid date and time: ${dateFormat} HH:mm.`);
  requireDate(date, 'measurement date');
  if (date.getTime() > now.getTime()) throw new Error('The measurement date cannot be in the future.');
  return date;
}
