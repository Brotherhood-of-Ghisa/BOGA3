// The dated-reading boundary shared by device repositories and server adapters.
// Resolve selection before validation: a malformed latest reading cannot silently
// fall back to an older, plausible weight. No timezone or wall clock enters here.
import { parseSetWeight } from '../exercise-calculations/index.ts';
import { isWeightUnit, weightToKg } from '../exercise-calculations/effective-load.ts';

export type DatedWeightReading = {
  id: string;
  measuredAt: Date | number;
  weightValue: string;
  weightUnit: string;
  weightKg: number;
  deletedAt?: Date | number | null;
};
export type ResolvedSessionWeight = {
  bodyWeightKg: number | null;
  bodyWeightSource: 'reading' | null;
  bodyWeightMeasurementId: string | null;
  bodyWeightMeasuredAt: Date | null;
};
export const EMPTY_SESSION_WEIGHT: ResolvedSessionWeight = {
  bodyWeightKg: null, bodyWeightSource: null, bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null,
};
const millis = (value: Date | number) => value instanceof Date ? value.getTime() : value;

/** Unicode code-point order, matching SQLite BINARY and PostgreSQL COLLATE "C". */
export function compareReadingIds(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (diff) return diff;
  }
  return a.length - b.length;
}

export function isValidBodyWeightReading(reading: DatedWeightReading): boolean {
  if (!reading.id.trim() || (!Number.isSafeInteger(millis(reading.measuredAt)) || Math.abs(millis(reading.measuredAt)) > 8640000000000000)) return false;
  if (typeof reading.weightValue !== 'string' || !isWeightUnit(reading.weightUnit)) return false;
  const amount = parseSetWeight(reading.weightValue);
  if (amount === null || amount <= 0) return false;
  const kg = weightToKg(amount, reading.weightUnit);
  return kg !== null && Number.isFinite(kg) && kg > 0 &&
    Number.isFinite(reading.weightKg) && reading.weightKg > 0 &&
    Math.abs(kg - reading.weightKg) <= Number.EPSILON * 16 * Math.max(1, kg);
}

export function resolveReadingContext(reading: DatedWeightReading | null): ResolvedSessionWeight {
  if (!reading) return { ...EMPTY_SESSION_WEIGHT };
  return {
    bodyWeightKg: isValidBodyWeightReading(reading) ? reading.weightKg : null,
    bodyWeightSource: 'reading', bodyWeightMeasurementId: reading.id,
    bodyWeightMeasuredAt: new Date(millis(reading.measuredAt)),
  };
}

/** Sort once per graph; each session lookup is logarithmic, with no per-set reads. */
export function createAsOfWeightResolver(readings: readonly DatedWeightReading[]) {
  const sorted = readings.filter(row => row.deletedAt == null && Number.isSafeInteger(millis(row.measuredAt)))
    .slice().sort((a, b) => millis(a.measuredAt) - millis(b.measuredAt) || compareReadingIds(a.id, b.id));
  const timeline = sorted.filter((row, i) => i === 0 || millis(row.measuredAt) !== millis(sorted[i - 1].measuredAt));
  return (startedAt: Date | number): ResolvedSessionWeight => {
    const at = millis(startedAt);
    if (!Number.isSafeInteger(at) || Math.abs(at) > 8640000000000000) return { ...EMPTY_SESSION_WEIGHT };
    let lo = 0, hi = timeline.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (millis(timeline[mid].measuredAt) <= at) lo = mid + 1;
      else hi = mid;
    }
    return resolveReadingContext(lo ? timeline[lo - 1] : null);
  };
}
