// Today's group card, from one `group_week_summary` read (contract §4.7):
// the week's top three by working sets, the caller's own line when outside
// them, and the latest activity row. Pure; the card only draws it.

import { formatCompactDuration } from '@/src/data/session-list';
import { formatClockTime, formatMonthDayTime } from '@/src/utils/local-time';

import { formatBoardFigure, formatOrdinal } from './board-view-model';
import { formatExerciseCount, formatStreamPersonName, METRIC_NAMES } from './stream-view-model';
import type {
  GroupMemberRef,
  GroupWeekBoardRow,
  GroupWeekLatestSession,
  GroupWeekRecord,
  GroupWeekSummaryResult,
  GroupWeekTrainingSession,
} from './types';

export const WEEK_BOARD_SIZE = 3;

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
  /** The caller's own line, only when they are outside the top three rows. */
  me: { rankLabel: string; workingSets: number; groupRecords: number } | null;
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
 * its first three rows. The caller is found by user id, so a tie at third
 * place can still put them on their own line, at that shared rank.
 */
export const buildWeekBoard = (members: GroupWeekBoardRow[], myUserId: string): WeekBoardViewModel => {
  const topWorkingSets = members[0]?.working_sets ?? 0;
  const rows = members.slice(0, WEEK_BOARD_SIZE).map((row) => toBoardRow(row, topWorkingSets, myUserId));
  const mine = rows.some((row) => row.isMe) ? undefined : members.find((row) => row.member.user_id === myUserId);
  return {
    rows,
    me: mine
      ? { rankLabel: formatOrdinal(mine.rank), workingSets: mine.working_sets, groupRecords: mine.group_records }
      : null,
  };
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** `7 W/sets · 3 exercises`. */
export const formatWeekSessionFigures = (session: { working_sets: number; exercise_count: number }): string =>
  `${session.working_sets} W/sets · ${formatExerciseCount(session.exercise_count)}`;

const isSameLocalDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

/** `Started 07:40` today; `Started 10/15 23:10` when it began on an earlier day. */
export const formatTrainingStart = (startedAtMs: number, nowMs: number): string =>
  `Started ${isSameLocalDay(startedAtMs, nowMs) ? formatClockTime(startedAtMs) : formatMonthDayTime(startedAtMs)}`;

const joinContext = (...parts: (string | null | undefined)[]): string =>
  parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(' · ');

/** `a`, `a and b`, `a, b and c`. */
export const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// A record's leading board: 1RM first, as the boards default to it.
const leadingBoard = (record: GroupWeekRecord) =>
  record.boards.find((board) => board.metric === 'e1rm') ?? record.boards[0] ?? null;

export type GroupRecordLine = { lead: string; note: string };

/** `Deadlift 1RM 213.3` + `group record`; with more, `3 group records`. The lead is the `record` figure. */
export const buildGroupRecordLine = (records: GroupWeekRecord[]): GroupRecordLine | null => {
  const first = records[0];
  if (!first) return null;
  const board = leadingBoard(first);
  const lead = board
    ? `${first.group_exercise.name} ${METRIC_NAMES[board.metric]} ${formatBoardFigure(board.metric, board.value)}`
    : first.group_exercise.name;
  return { lead, note: records.length === 1 ? 'group record' : plural(records.length, 'group record', 'group records') };
};

const recordLineText = (line: GroupRecordLine | null): string | null => (line ? `${line.lead} · ${line.note}` : null);

export type LatestActivityViewModel =
  | {
      kind: 'training';
      memberUserId: string;
      sessionId: string;
      name: string;
      context: string;
      figures: string;
      accessibilityLabel: string;
    }
  | { kind: 'several'; count: number; names: string; gyms: string; accessibilityLabel: string }
  | {
      kind: 'completed';
      memberUserId: string;
      sessionId: string;
      name: string;
      status: string;
      context: string;
      figures: string;
      record: GroupRecordLine | null;
      accessibilityLabel: string;
    };

const personName = (member: GroupMemberRef, myUserId: string) => formatStreamPersonName(member, myUserId);

const trainingRow = (session: GroupWeekTrainingSession, myUserId: string, nowMs: number): LatestActivityViewModel => {
  const name = personName(session.member, myUserId);
  const context = joinContext(formatTrainingStart(session.started_at_ms, nowMs), session.gym_name);
  const figures = formatWeekSessionFigures(session);
  return {
    kind: 'training',
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    context,
    figures,
    accessibilityLabel: `${name}, training now, ${context}, ${figures}`,
  };
};

const severalRow = (sessions: GroupWeekTrainingSession[], myUserId: string): LatestActivityViewModel => {
  const names = joinNames(sessions.map((session) => personName(session.member, myUserId)));
  const gyms = joinContext(...new Set(sessions.map((session) => session.gym_name?.trim() || null)));
  return {
    kind: 'several',
    count: sessions.length,
    names,
    gyms,
    accessibilityLabel: [`${sessions.length} training now: ${names}`, gyms].filter(Boolean).join(', '),
  };
};

const completedDuration = (session: GroupWeekLatestSession): number | null => {
  if (session.duration_sec !== null) return session.duration_sec;
  if (session.completed_at_ms !== null && session.completed_at_ms >= session.started_at_ms) {
    return Math.floor((session.completed_at_ms - session.started_at_ms) / 1000);
  }
  return null;
};

const completedRow = (session: GroupWeekLatestSession, myUserId: string): LatestActivityViewModel => {
  const name = personName(session.member, myUserId);
  const durationSec = completedDuration(session);
  const status = durationSec === null ? 'Completed' : `Completed · ${formatCompactDuration(durationSec)}`;
  const context = joinContext(formatMonthDayTime(session.started_at_ms), session.gym_name);
  const figures = formatWeekSessionFigures(session);
  const record = buildGroupRecordLine(session.group_records);
  return {
    kind: 'completed',
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    status,
    context,
    figures,
    record,
    accessibilityLabel: [name, status, context, figures, recordLineText(record)].filter(Boolean).join(', '),
  };
};

/**
 * One member training now opens their session; several collapse into one row
 * that opens the group; otherwise the latest completed session, at any time.
 * Null when the group has neither.
 */
export const buildLatestActivity = (
  summary: Pick<GroupWeekSummaryResult, 'training_now' | 'latest_completed'>,
  myUserId: string,
  nowMs: number,
): LatestActivityViewModel | null => {
  const [first, ...rest] = summary.training_now;
  if (first && rest.length === 0) return trainingRow(first, myUserId, nowMs);
  if (first) return severalRow(summary.training_now, myUserId);
  return summary.latest_completed ? completedRow(summary.latest_completed, myUserId) : null;
};
