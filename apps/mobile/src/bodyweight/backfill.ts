import type { BodyWeightMeasurement, Session } from '@/src/data/schema';
import { isValidBodyWeightReading, type SessionWeightSnapshot } from './weight-entry';

export type BackfillSession = Pick<Session, 'id' | 'status' | 'startedAt' | 'deletedAt' |
  'bodyWeightKg' | 'bodyWeightSource' | 'bodyWeightMeasurementId' | 'bodyWeightMeasuredAt' |
  'localBodyweightMetadataKnown'>;
export type BackfillRange = { from: Date | null; before: Date | null };
export type BackfillRow = {
  sessionId: string;
  startedAt: Date;
} & ({ status: 'ready'; snapshot: SessionWeightSnapshot } | { status: 'blocked'; reason: string });

export const hasEmptySessionWeight = (session: BackfillSession): boolean =>
  session.bodyWeightKg === null && session.bodyWeightSource === null &&
  session.bodyWeightMeasurementId === null && session.bodyWeightMeasuredAt === null;

/** Parse local calendar days, with an exclusive next-day bound for the end. */
export function parseBackfillRange(fromText: string, throughText: string): BackfillRange {
  const parse = (text: string): Date | null => {
    if (!text.trim()) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
    if (!match) throw new Error('Use a date in YYYY-MM-DD format.');
    const [, year, month, day] = match.map(Number);
    const value = new Date(year, month - 1, day);
    if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) {
      throw new Error('Use a valid calendar date.');
    }
    return value;
  };
  const from = parse(fromText);
  const through = parse(throughText);
  if (from && through && from > through) throw new Error('The end date must be on or after the start date.');
  const before = through ? new Date(through.getFullYear(), through.getMonth(), through.getDate() + 1) : null;
  return { from, before };
}

export function planSessionWeightBackfill(
  sessions: BackfillSession[], readings: BodyWeightMeasurement[],
  range: BackfillRange = { from: null, before: null },
): BackfillRow[] {
  // SQLite's BINARY UTF-8 ordering is code-point order for stored Unicode.
  // JS string ordering uses UTF-16 code units and disagrees for astral ids.
  const compareId = (a: string, b: string) => {
    const left = Array.from(a, character => character.codePointAt(0)!);
    const right = Array.from(b, character => character.codePointAt(0)!);
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  };
  const timeline = readings.filter(reading => !reading.deletedAt)
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime() || compareId(a.id, b.id));
  const invalidTimeline = timeline.some(reading => !Number.isFinite(reading.measuredAt.getTime()));
  // Same-time ties use the same ascending id ordering as SQLite capture.
  const byTime = timeline.filter((reading, index) => index === 0 ||
    reading.measuredAt.getTime() !== timeline[index - 1].measuredAt.getTime());
  const atOrBefore = (time: number) => {
    let low = 0; let high = byTime.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (byTime[middle].measuredAt.getTime() <= time) low = middle + 1;
      else high = middle;
    }
    return low > 0 ? byTime[low - 1] : undefined;
  };
  return sessions.filter(session => !session.deletedAt && session.status === 'completed' &&
    hasEmptySessionWeight(session) && (!range.from || session.startedAt >= range.from) &&
    (!range.before || session.startedAt < range.before))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || compareId(a.id, b.id))
    .map(session => {
      const identity = { sessionId: session.id, startedAt: session.startedAt };
      if (!session.localBodyweightMetadataKnown) return { ...identity, status: 'blocked', reason: 'Sync this session’s saved weight before filling it.' };
      if (!Number.isFinite(session.startedAt.getTime())) return { ...identity, status: 'blocked', reason: 'Correct this session’s date before filling it.' };
      if (invalidTimeline) return { ...identity, status: 'blocked', reason: 'Correct invalid reading dates before filling sessions.' };
      const prior = atOrBefore(session.startedAt.getTime());
      const reading = prior ?? timeline[0];
      if (!reading) return { ...identity, status: 'blocked', reason: 'Add a weight reading or set a weight on this session.' };
      if (!isValidBodyWeightReading(reading)) return { ...identity, status: 'blocked', reason: 'Correct the source reading before using it.' };
      return { ...identity, status: 'ready', snapshot: {
        bodyWeightKg: reading.weightKg, bodyWeightSource: prior ? 'reading' : 'historical_estimate',
        bodyWeightMeasurementId: reading.id, bodyWeightMeasuredAt: reading.measuredAt,
      } };
    });
}
