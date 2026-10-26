import { localDateKey } from '@/src/utils/calendar-weeks';
// Today's group card, from one `group_competition_week_summary` read (contract):
// the week's top five by working sets, the caller's own line when outside
// them, and up to four sessions. Pure; the card only draws it.

import {
  buildSessionRecordLine,
  GROUP_RECORD_NOUN,
  sessionRecordLineText,
  type SessionRecordLine,
} from '@/src/session-insights/record-line';
import { formatClockTime, formatCompactDateTime } from '@/src/utils/local-time';

import { formatOrdinal } from './board-view-model';
import { buildCompetitionSession } from './competition-session-view-model';
import { SHOWN_BOARD } from './competition-session-records-view-model';
import { formatExerciseCount, formatStreamPersonName } from './stream-view-model';

import type {
  CompetitionEventWire,
  CompetitionHistoryValueWire,
  CompetitionStreamItemWire,
  CompetitionWeekSummaryWire as GroupWeekSummaryResult,
} from './competition-wire';
import { formatCompetitionHistoricalValue } from './competition-view-model';
/** A completed session as Today's group card draws it. */
export type GroupWeekLatestSession = NonNullable<GroupWeekSummaryResult['latest_completed']>;
type GroupWeekTrainingSession = GroupWeekSummaryResult['training_now'][number];
/** One current member's week: competition rank (equal working sets and group records share a rank). */
export type GroupWeekBoardRow = GroupWeekSummaryResult['members'][number];

export const WEEK_BOARD_SIZE = 5;

export type WeekBoardRowViewModel = {
  userId: string;
  rank: number;
  name: string;
  isMe: boolean;
  workingSets: number;
  groupRecords: number;
  /** The bar: working sets as a share of the leader's. */
  fraction: number;
  /** Rank 1 with working sets: the bar's darker step. */
  leader: boolean;
};

export type WeekBoardViewModel = {
  rows: WeekBoardRowViewModel[];
  /** The caller's own line, only when they are outside the rows shown. */
  me: { rankLabel: string; workingSets: number; groupRecords: number } | null;
  /** Ranked members past the rows shown, the caller's own line not counted. */
  hiddenCount: number;
};

const toBoardRow = (row: GroupWeekBoardRow, topWorkingSets: number, myUserId: string): WeekBoardRowViewModel => ({
  userId: row.member.user_id,
  rank: row.rank,
  name: formatStreamPersonName(row.member, myUserId),
  isMe: row.member.user_id === myUserId,
  workingSets: row.working_sets,
  groupRecords: row.group_records,
  fraction: topWorkingSets > 0 ? row.working_sets / topWorkingSets : 0,
  leader: row.rank === 1 && row.working_sets > 0,
});

/**
 * The server ranks every current member (ties share a rank); the board keeps
 * its first `size` rows, five. The caller is found by user id, so a tie at the last row shown can
 * still put them on their own line, at that shared rank.
 */
export const buildWeekBoard = (members: GroupWeekBoardRow[], myUserId: string, size = WEEK_BOARD_SIZE): WeekBoardViewModel => {
  const topWorkingSets = members[0]?.working_sets ?? 0;
  const rows = members.slice(0, Math.max(0, size)).map((row) => toBoardRow(row, topWorkingSets, myUserId));
  const mine = rows.some((row) => row.isMe) ? undefined : members.find((row) => row.member.user_id === myUserId);
  return {
    hiddenCount: members.length - rows.length - (mine ? 1 : 0),
    rows,
    me: mine
      ? { rankLabel: formatOrdinal(mine.rank), workingSets: mine.working_sets, groupRecords: mine.group_records }
      : null,
  };
};


const isSameLocalDay = (a: number, b: number): boolean => localDateKey(new Date(a)) === localDateKey(new Date(b));

/** `Started 07:40` today; Today's compact date and time on an earlier day: `Started 25 Oct 26 23:10`. */
export const formatTrainingStart = (startedAtMs: number, nowMs: number): string =>
  `Started ${isSameLocalDay(startedAtMs, nowMs) ? formatClockTime(startedAtMs) : formatCompactDateTime(startedAtMs)}`;

/** One group record: a record event and one shown board it took #1 on. */
type GroupRecordBoard = { event: CompetitionEventWire; value: CompetitionHistoryValueWire };

/**
 * The session's group records, one per board taken: the server keeps only the
 * `record` values of the boards each record took #1 on, counted as the session
 * view shows them — no Volume board, and no record it would hide — so the
 * card's count agrees with the Group records card the row opens.
 */
export const groupRecordBoards = (records: CompetitionEventWire[]): GroupRecordBoard[] =>
  records
    .filter((event) => !event.provisional && !event.voided)
    .flatMap((event) =>
      event.values
        .filter((value) => value.role === 'record' && SHOWN_BOARD(value.metric))
        .map((value) => ({ event, value })),
    );

/** `Deadlift 1RM 213.3 · group record`; several are only counted. Historical values keep their unit and revision. */
export const buildGroupRecordLine = (records: CompetitionEventWire[]): SessionRecordLine | null =>
  buildSessionRecordLine(
    groupRecordBoards(records),
    ({ event, value }) => `${event.group_exercise.name} ${formatCompetitionHistoricalValue(value)}`,
    GROUP_RECORD_NOUN,
  );

/** Today's group card shows this many sessions, the live ones first. */
export const GROUP_SESSIONS_SHOWN = 4;

/** One session on Today's group card: who and when, where, what, its group records. */
export type GroupSessionRowViewModel = {
  memberUserId: string;
  sessionId: string;
  name: string;
  /** `Started 07:40` while training; `26 Oct 26 06:10` once completed. */
  when: string;
  live: boolean;
  gym: string | null;
  /** `4 exercises · 16 sets`, `… sets so far` while training. */
  figures: string;
  /** One group record named, several counted; none while training (records are awarded on completion). */
  record: SessionRecordLine | null;
  accessibilityLabel: string;
};

export type GroupSessionsViewModel = { live: GroupSessionRowViewModel[]; recent: GroupSessionRowViewModel[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const sessionFigures = (session: { working_sets: number; exercise_count: number }, live: boolean): string =>
  `${formatExerciseCount(session.exercise_count)} · ${plural(session.working_sets, 'set', 'sets')}${live ? ' so far' : ''}`;

const sessionLabel = (parts: (string | null | undefined)[]): string =>
  parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(', ');

const liveRow = (session: GroupWeekTrainingSession, myUserId: string, nowMs: number): GroupSessionRowViewModel => {
  const name = formatStreamPersonName(session.member, myUserId);
  const when = formatTrainingStart(session.started_at_ms, nowMs);
  const figures = sessionFigures(session, true);
  return {
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    when,
    live: true,
    gym: session.gym_name,
    figures,
    record: null,
    accessibilityLabel: sessionLabel([name, 'training now', when, session.gym_name && `at ${session.gym_name}`, figures]),
  };
};

const recentRow = (session: GroupWeekLatestSession, myUserId: string): GroupSessionRowViewModel => {
  const name = formatStreamPersonName(session.member, myUserId);
  const when = formatCompactDateTime(session.started_at_ms);
  const figures = sessionFigures(session, false);
  const record = buildGroupRecordLine(session.group_records);
  return {
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    when,
    live: false,
    gym: session.gym_name,
    figures,
    record,
    accessibilityLabel: sessionLabel([
      name,
      `completed session on ${when}`,
      session.gym_name && `at ${session.gym_name}`,
      figures,
      sessionRecordLineText(record),
    ]),
  };
};

/**
 * Up to `GROUP_SESSIONS_SHOWN` sessions, shared between the two kinds: every
 * member training now first, then the latest completed sessions, newest
 * first — the week summary's latest, then the loaded stream's (`recent`), each
 * session once.
 */
export const buildGroupSessions = (
  summary: Pick<GroupWeekSummaryResult, 'training_now' | 'latest_completed'>,
  recent: GroupWeekLatestSession[],
  myUserId: string,
  nowMs: number,
): GroupSessionsViewModel => {
  const live = summary.training_now.slice(0, GROUP_SESSIONS_SHOWN).map((session) => liveRow(session, myUserId, nowMs));
  const liveIds = new Set(summary.training_now.map((session) => session.session_id));
  const seen = new Set<string>();
  const completed = [...(summary.latest_completed ? [summary.latest_completed] : []), ...recent].filter((session) => {
    if (liveIds.has(session.session_id) || seen.has(session.session_id)) return false;
    seen.add(session.session_id);
    return true;
  });
  return {
    live,
    recent: completed.slice(0, GROUP_SESSIONS_SHOWN - live.length).map((session) => recentRow(session, myUserId)),
  };
};

/**
 * The completed sessions in loaded stream pages, newest first, each in the
 * week summary's shape: working sets and exercises counted from the shared
 * sets as the group's stream card counts them, and the session's group
 * records from the record events loaded with it.
 */
export const completedSessionsFromStream = (items: CompetitionStreamItemWire[]): GroupWeekLatestSession[] => {
  const recordsBySession = new Map<string, CompetitionEventWire[]>();
  for (const item of items) {
    if (item.kind !== 'competition' || item.event.kind !== 'record' || item.event.voided || item.event.session_id === null) continue;
    const records = recordsBySession.get(item.event.session_id) ?? [];
    records.push(item.event);
    recordsBySession.set(item.event.session_id, records);
  }
  return items.flatMap((item) => {
    if (item.kind !== 'session' || item.session.status !== 'completed') return [];
    const { session } = item;
    const counts = buildCompetitionSession(session);
    return [{
      member: session.member,
      session_id: session.session_id,
      started_at_ms: session.started_at_ms,
      completed_at_ms: session.completed_at_ms,
      duration_sec: session.duration_sec,
      gym_name: session.gym_name,
      working_sets: counts.setCount,
      exercise_count: counts.exerciseCount,
      group_records: recordsBySession.get(session.session_id) ?? [],
    }];
  });
};
