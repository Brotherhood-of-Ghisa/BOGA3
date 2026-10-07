/**
 * The record line under a session summary on Today's cards:
 * one PR names itself, more than one is only counted. A session's PRs are one
 * per record kind (`training-metrics-contract.md` §3); a group session's are
 * its group records, one per board taken (`groups-contract.md`).
 */

export type RecordNoun = { one: string; many: string };

export const PERSONAL_RECORD_NOUN: RecordNoun = { one: 'PR', many: 'PRs' };
export const GROUP_RECORD_NOUN: RecordNoun = { one: 'group record', many: 'group records' };

export type SessionRecordLine =
  /** `Bench Press 1RM 102.5` in `record`, then ` · PR`. */
  | { kind: 'one'; lead: string; note: string }
  /** `3 PRs` in `record`. */
  | { kind: 'many'; count: string };

export const buildSessionRecordLine = <T>(
  records: readonly T[],
  describe: (record: T) => string,
  noun: RecordNoun,
): SessionRecordLine | null => {
  const [first] = records;
  if (first === undefined) return null;
  if (records.length === 1) return { kind: 'one', lead: describe(first), note: noun.one };
  return { kind: 'many', count: `${records.length} ${noun.many}` };
};

/** The line as one phrase, for an accessibility label. */
export const sessionRecordLineText = (line: SessionRecordLine | null): string | null => {
  if (line === null) return null;
  return line.kind === 'one' ? `${line.lead} · ${line.note}` : line.count;
};
