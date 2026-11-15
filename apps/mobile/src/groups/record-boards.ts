// A record event's boards, split into group records (GR: the boards the set
// took #1 on) and the member's personal bests in the group (PR: every other
// board it beat their own best on). One board counts once, as one or the
// other, and only the boards the group still shows (no Volume). Pure.
import { SHOWN_BOARD } from './competition-session-records-view-model';
import type { CompetitionEventWire, CompetitionHistoryValueWire, CompetitionStreamRecordWire } from './competition-wire';

export type RecordBoards = { groupRecords: CompetitionHistoryValueWire[]; personalRecords: CompetitionHistoryValueWire[] };

/**
 * The event's shown `record` boards, GR where the stream's record names the
 * board, else PR. Without a `record` (the first reader, which the app no
 * longer calls) the boards are unknown and all read as GR, as they always did.
 * Provisional records split too: a live session's stream card counts them, as
 * it always listed them; Today's rows draw completed sessions only.
 */
export function splitRecordBoards(event: CompetitionEventWire, record: Pick<CompetitionStreamRecordWire, 'group_record_metrics'> | undefined): RecordBoards {
  const boards = event.values.filter(value => value.role === 'record' && SHOWN_BOARD(value.metric));
  const isGroupRecord = (value: CompetitionHistoryValueWire) => !record || record.group_record_metrics.includes(value.metric);
  return {
    groupRecords: boards.filter(isGroupRecord),
    personalRecords: boards.filter(value => !isGroupRecord(value)),
  };
}

/** The event as its group records alone: `values` keeps only the GR boards, so it reads like a week summary's group record. */
export const groupRecordEvent = (event: CompetitionEventWire, boards: RecordBoards): CompetitionEventWire => ({
  ...event,
  values: event.values.filter(value => value.role !== 'record' || boards.groupRecords.includes(value)),
});

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** `1 PR`, `3 PRs`: a member's own new bests in the group. */
export const formatPersonalRecordCount = (count: number): string => plural(count, 'PR', 'PRs');
/** `2 GR`: the label is the same for one and many. */
export const formatGroupRecordCount = (count: number): string => `${count} GR`;
/** What a screen reader hears for the GR count. */
export const spokenGroupRecordCount = (count: number): string => plural(count, 'group record', 'group records');
