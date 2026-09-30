// The dated-reading boundary shared by device repositories and server adapters.
// Invalid restored rows remain editable but are never calculation candidates.
// No timezone or wall clock enters here.

export type DatedWeightReading = {
  id: string;
  measuredAt: Date | number;
  weightKg: number;
  deletedAt?: Date | number | null;
};
export type ResolvedSessionWeight = {
  bodyWeightKg: number | null;
  bodyWeightSource: 'reading' | null;
  bodyWeightMeasurementId: string | null;
  bodyWeightMeasuredAt: Date | null;
};
export type SessionWeightContext = Partial<ResolvedSessionWeight>;
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
  return Number.isFinite(reading.weightKg) && reading.weightKg > 0;
}

export function resolveReadingContext(reading: DatedWeightReading | null): ResolvedSessionWeight {
  if (!reading) return { ...EMPTY_SESSION_WEIGHT };
  return {
    bodyWeightKg: isValidBodyWeightReading(reading) ? reading.weightKg : null,
    bodyWeightSource: 'reading', bodyWeightMeasurementId: reading.id,
    bodyWeightMeasuredAt: new Date(millis(reading.measuredAt)),
  };
}

/** A calculation context is valid only when its dated-reading tuple is complete. */
export function isValidSessionWeight(context: SessionWeightContext): context is ResolvedSessionWeight & {
  bodyWeightKg: number;
  bodyWeightSource: 'reading';
  bodyWeightMeasurementId: string;
  bodyWeightMeasuredAt: Date;
} {
  const { bodyWeightKg: kg, bodyWeightSource: source, bodyWeightMeasurementId: id, bodyWeightMeasuredAt: at } = context;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return false;
  return source === 'reading' && typeof id === 'string' && id.trim().length > 0 &&
    at instanceof Date && Number.isFinite(at.getTime());
}

/** DB readers supply the full tuple. Pure calculation inputs may supply only B. */
export function sessionBodyWeightForCalculation(session?: SessionWeightContext | null): number | null {
  if (!session) return null;
  const kg = session.bodyWeightKg;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  const hasProvenance = 'bodyWeightSource' in session || 'bodyWeightMeasurementId' in session ||
    'bodyWeightMeasuredAt' in session;
  return hasProvenance && !isValidSessionWeight(session) ? null : kg;
}

/** Sort once per graph; each session lookup is logarithmic, with no per-set reads. */
export function createAsOfWeightResolver(readings: readonly DatedWeightReading[]) {
  const sorted = readings.filter(row => row.deletedAt == null && isValidBodyWeightReading(row))
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
