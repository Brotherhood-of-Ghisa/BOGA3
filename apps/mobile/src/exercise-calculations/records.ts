/**
 * The one record definition (`training-metrics-contract.md` §3): what beats a
 * record and how the all-time best is folded over sessions. Exercise session
 * facts (PR flags), the records panel, the session records of the exercise
 * page, session view and completion, and the coaching API all read these.
 * Values are the session bests of working sets (§1); this module never
 * decides which sets count.
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

/** Every record kind, in the order a session lists its PRs. */
export const RECORD_KINDS: readonly RecordKind[] = ['oneRepMax', 'weight', 'volume'];

/**
 * The PRs one exercise set in a session: one per record kind it took, so one
 * exercise adds up to three. A session's PR count is the sum over its
 * exercises; every screen that counts a session's PRs counts these.
 */
export const sessionRecordKinds = (flags: RecordFlags): RecordKind[] => RECORD_KINDS.filter((kind) => flags[kind]);

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

/** The records a session is compared with: the bests before it. */
export type RecordBaseline = {
  oneRepMax: number | null;
  weight: WeightRecordValue | null;
  // The best complete Volume.
  volume: number | null;
};
