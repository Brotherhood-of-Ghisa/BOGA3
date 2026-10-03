/**
 * The one record definition (`training-metrics-contract.md` §3): what beats a
 * record, how the all-time best is folded over sessions, and which set of a
 * session holds its record. Exercise session facts (PR flags), the records
 * panel, the exercise page and session view markers, the completion screen and
 * the coaching API all read these. Values are the session bests of working
 * sets (§1); this module never decides which sets count.
 */

/** A Weight record compares the pair: heavier, or as heavy with more reps. */
export type WeightRecordValue = { weight: number; reps: number };

export const compareWeightRecord = (left: WeightRecordValue, right: WeightRecordValue): number =>
  left.weight - right.weight || left.reps - right.reps;

/** A zero (or missing) result is never a record, a baseline or a rank. */
const isRecordValue = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isWeightRecordValue = (value: WeightRecordValue | null | undefined): value is WeightRecordValue =>
  value != null && isRecordValue(value.weight);

/**
 * A 1RM or Volume beats the record when it is strictly above it. With no
 * record yet there is nothing to beat: the first value is the baseline.
 */
export const beatsRecord = (value: number | null | undefined, record: number | null | undefined): boolean =>
  isRecordValue(value) && isRecordValue(record) && value > record;

/** A Weight beats the record when it is heavier, or as heavy with more reps. */
export const beatsWeightRecord = (
  value: WeightRecordValue | null | undefined,
  record: WeightRecordValue | null | undefined,
): boolean =>
  isWeightRecordValue(value) && isWeightRecordValue(record) && compareWeightRecord(value, record) > 0;

/** One session's candidates for each record; `volume` only when the session's volume is complete. */
export type RecordEntry = {
  oneRepMax: { value: number } | null;
  weight: WeightRecordValue | null;
  volume: { value: number } | null;
};

export type RecordKind = keyof RecordEntry;

export type RecordFlags = Record<RecordKind, boolean>;

export type RecordHolders<E extends RecordEntry> = { [K in RecordKind]: NonNullable<E[K]> | null };

/**
 * Folds sessions in record order (`completed_at`, then session id). `add`
 * returns which records the session set. A session's value must beat the
 * record so far, so a tie keeps the earliest session; the first value is the
 * baseline, never a record; a zero neither sets nor raises one. `holders` are
 * the entries holding each record, extra fields included.
 */
export const createRecordBook = <E extends RecordEntry>() => {
  const holders: RecordHolders<E> = { oneRepMax: null, weight: null, volume: null };
  const add = (entry: E): RecordFlags => {
    const oneRepMax = entry.oneRepMax as NonNullable<E['oneRepMax']> | null;
    const weight = entry.weight as NonNullable<E['weight']> | null;
    const volume = entry.volume as NonNullable<E['volume']> | null;
    const flags: RecordFlags = {
      oneRepMax: beatsRecord(oneRepMax?.value, holders.oneRepMax?.value),
      weight: beatsWeightRecord(weight, holders.weight),
      volume: beatsRecord(volume?.value, holders.volume?.value),
    };
    if (flags.oneRepMax || (holders.oneRepMax === null && isRecordValue(oneRepMax?.value))) holders.oneRepMax = oneRepMax;
    if (flags.weight || (holders.weight === null && isWeightRecordValue(weight))) holders.weight = weight;
    if (flags.volume || (holders.volume === null && isRecordValue(volume?.value))) holders.volume = volume;
    return flags;
  };
  return { holders, add };
};

/** The order records are folded in: `completed_at`, then session id. */
export const compareRecordOrder = (
  left: { completedAt: Date; sessionId: string },
  right: { completedAt: Date; sessionId: string },
): number =>
  left.completedAt.getTime() - right.completedAt.getTime() ||
  left.sessionId.localeCompare(right.sessionId);

/** The records a session's sets are compared with: the bests before it. */
export type RecordBaseline = {
  oneRepMax: number | null;
  weight: WeightRecordValue | null;
};

export type RecordSetCandidate = {
  id: string;
  oneRepMax: number | null;
  weight: number | null;
  reps: number | null;
};

/** The winning set, and which of its records it sets (a 1RM winner may set both). */
export type SessionRecordSet = { id: string; oneRepMax: boolean; weight: boolean };

/**
 * The one set of a session (one exercise, every block) whose record is shown
 * (`design-language.md` §5: one superlative). `candidates` are the session's
 * working sets of that exercise in session order. The highest 1RM that beats
 * the baseline wins; with none, the heaviest Weight that beats it; a tie keeps
 * the set that reached it first.
 */
export const pickSessionRecordSet = (
  candidates: readonly RecordSetCandidate[],
  baseline: RecordBaseline | null,
): SessionRecordSet | null => {
  if (baseline === null) return null;
  let oneRepMax: RecordSetCandidate | null = null;
  let weight: (RecordSetCandidate & WeightRecordValue) | null = null;
  for (const candidate of candidates) {
    if (beatsRecord(candidate.oneRepMax, baseline.oneRepMax) &&
      (oneRepMax === null || (candidate.oneRepMax as number) > (oneRepMax.oneRepMax as number))) {
      oneRepMax = candidate;
    }
    const value = candidate.weight === null || candidate.reps === null
      ? null : { weight: candidate.weight, reps: candidate.reps };
    if (value && beatsWeightRecord(value, baseline.weight) &&
      (weight === null || compareWeightRecord(value, weight) > 0)) {
      weight = { ...candidate, ...value };
    }
  }
  const winner = oneRepMax ?? weight;
  if (winner === null) return null;
  return {
    id: winner.id,
    oneRepMax: oneRepMax !== null,
    weight: winner.weight !== null && winner.reps !== null &&
      beatsWeightRecord({ weight: winner.weight, reps: winner.reps }, baseline.weight),
  };
};
