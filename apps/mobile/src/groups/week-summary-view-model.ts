import { localDateKey } from '@/src/utils/calendar-weeks';
// Today's group card, from one `group_competition_week_summary` read (contract):
// the week's top five by working sets, the caller's own line when outside
// them, and up to four sessions. Pure; the card only draws it.

import { formatClockTime, formatCompactDate, formatCompactDateTime, formatLocalDateTime } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';

import { formatOrdinal } from './board-view-model';
import { buildCompetitionSession } from './competition-session-view-model';
import { SHOWN_BOARD } from './competition-session-records-view-model';
import { formatExerciseCount, formatStreamPersonName } from './stream-view-model';
import { formatGroupRecordCount, formatPersonalRecordCount, groupRecordEvent, spokenGroupRecordCount, splitRecordBoards } from './record-boards';

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

/** Today's starts keep their clock-only role; earlier starts use the selected compact family. */
export const formatTrainingStart = (startedAtMs: number, nowMs: number, dateFormat: ExerciseDateFormat): string =>
  `Started ${isSameLocalDay(startedAtMs, nowMs) ? formatClockTime(startedAtMs) : formatCompactDateTime(startedAtMs, dateFormat)}`;

/** One group record (GR): a record event and one shown board it took #1 on. */
type GroupRecordBoard = { event: CompetitionEventWire; value: CompetitionHistoryValueWire };

/**
 * The session's group records, one per board taken: a week summary's record
 * events keep only the `record` values of the boards each took #1 on, and a
 * stream session's are cut to them (`groupRecordEvent`). Counted as the
 * session view shows them — no Volume board, and no record it would hide — so
 * the row agrees with the GR card it opens.
 */
export const groupRecordBoards = (records: CompetitionEventWire[]): GroupRecordBoard[] =>
  records
    .filter((event) => !event.provisional && !event.voided)
    .flatMap((event) =>
      event.values
        .filter((value) => value.role === 'record' && SHOWN_BOARD(value.metric))
        .map((value) => ({ event, value })),
    );

/** One GR line under a session row: `Deadlift` and `1RM 213.3`, one line per record set. */
export type GroupRecordLineViewModel = { key: string; exercise: string; value: string };

/** Every GR the session took, a line per set, its boards joined. Historical values keep their unit and revision. */
export const buildGroupRecordLines = (records: CompetitionEventWire[]): GroupRecordLineViewModel[] => {
  const lines = new Map<string, GroupRecordLineViewModel & { values: string[] }>();
  for (const { event, value } of groupRecordBoards(records)) {
    const line = lines.get(event.event_id) ?? { key: event.event_id, exercise: event.group_exercise.name, value: '', values: [] };
    line.values.push(formatCompetitionHistoricalValue(value));
    lines.set(event.event_id, line);
  }
  return [...lines.values()].map(({ values, ...line }) => ({ ...line, value: values.join(' · ') }));
};

/**
 * A completed session for Today's group card: the week summary's shape, and
 * the member's PRs in the session (new bests that took no #1) where known —
 * read from the stream; null for the week summary's own latest session, whose
 * read carries its group records only.
 */
export type GroupRecentSession = GroupWeekLatestSession & { personalRecords: number | null };

/** Today's group card shows this many sessions, the live ones first. */
export const GROUP_SESSIONS_SHOWN = 4;

/** One session on Today's group card: who and when, where, what, its GRs and PRs. */
export type GroupSessionRowViewModel = {
  memberUserId: string;
  sessionId: string;
  name: string;
  /** `Started 07:40` while training; `26 Oct 26 06:10` once completed. */
  when: string;
  live: boolean;
  gym: string | null;
  /** `4 exercises · 16 sets · 2 PRs`, `… sets so far` while training. */
  figures: string;
  /** Each GR named; none while training (records are awarded on completion). */
  groupRecords: GroupRecordLineViewModel[];
  accessibilityLabel: string;
};

export type GroupSessionsViewModel = { live: GroupSessionRowViewModel[]; recent: GroupSessionRowViewModel[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const sessionFigures = (session: { working_sets: number; exercise_count: number }, live: boolean, personalRecords: number | null = null): string =>
  [`${formatExerciseCount(session.exercise_count)}`, `${plural(session.working_sets, 'set', 'sets')}${live ? ' so far' : ''}`,
    personalRecords ? formatPersonalRecordCount(personalRecords) : null].filter(Boolean).join(' · ');

const sessionLabel = (parts: (string | null | undefined)[]): string =>
  parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(', ');

const liveRow = (session: GroupWeekTrainingSession, myUserId: string, nowMs: number, dateFormat: ExerciseDateFormat): GroupSessionRowViewModel => {
  const name = formatStreamPersonName(session.member, myUserId);
  const when = formatTrainingStart(session.started_at_ms, nowMs, dateFormat);
  const spokenWhen = `Started ${isSameLocalDay(session.started_at_ms, nowMs)
    ? formatClockTime(session.started_at_ms) : formatLocalDateTime(session.started_at_ms, dateFormat)}`;
  const figures = sessionFigures(session, true);
  return {
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    when,
    live: true,
    gym: session.gym_name,
    figures,
    groupRecords: [],
    accessibilityLabel: sessionLabel([name, 'training now', spokenWhen, session.gym_name && `at ${session.gym_name}`, figures]),
  };
};

const recentRow = (session: GroupRecentSession, myUserId: string, dateFormat: ExerciseDateFormat): GroupSessionRowViewModel => {
  const name = formatStreamPersonName(session.member, myUserId);
  const when = formatCompactDateTime(session.started_at_ms, dateFormat);
  const figures = sessionFigures(session, false, session.personalRecords);
  const groupRecords = buildGroupRecordLines(session.group_records);
  return {
    memberUserId: session.member.user_id,
    sessionId: session.session_id,
    name,
    when,
    live: false,
    gym: session.gym_name,
    figures,
    groupRecords,
    accessibilityLabel: sessionLabel([
      name,
      `completed session on ${formatLocalDateTime(session.started_at_ms, dateFormat)}`,
      session.gym_name && `at ${session.gym_name}`,
      figures,
      ...groupRecords.map((line) => `group record, ${line.exercise} ${line.value}`),
    ]),
  };
};

/**
 * Up to `GROUP_SESSIONS_SHOWN` sessions, shared between the two kinds: every
 * member training now first, then the latest completed sessions, newest
 * first — the week summary's latest, then the loaded stream's (`recent`), each
 * session once. The latest takes its PR count from the stream once loaded;
 * its figures and GRs stay the week summary's.
 */
export const buildGroupSessions = (
  summary: Pick<GroupWeekSummaryResult, 'training_now' | 'latest_completed'>,
  recent: GroupRecentSession[],
  myUserId: string,
  nowMs: number,
  dateFormat: ExerciseDateFormat,
): GroupSessionsViewModel => {
  const live = summary.training_now.slice(0, GROUP_SESSIONS_SHOWN).map((session) => liveRow(session, myUserId, nowMs, dateFormat));
  const liveIds = new Set(summary.training_now.map((session) => session.session_id));
  const loaded = new Map(recent.map((session) => [session.session_id, session]));
  const latest = summary.latest_completed;
  const seen = new Set<string>();
  const completed = [
    ...(latest ? [{ ...latest, personalRecords: loaded.get(latest.session_id)?.personalRecords ?? null }] : []),
    ...recent,
  ].filter((session) => {
    if (liveIds.has(session.session_id) || seen.has(session.session_id)) return false;
    seen.add(session.session_id);
    return true;
  });
  return {
    live,
    recent: completed.slice(0, GROUP_SESSIONS_SHOWN - live.length).map((session) => recentRow(session, myUserId, dateFormat)),
  };
};

/**
 * The completed sessions in loaded stream pages, newest first, each in the
 * week summary's shape: working sets and exercises counted from the shared
 * sets as the group's stream card counts them; its group records, cut to the
 * boards each record took #1 on; and its PRs, the other boards its records
 * beat the member's own best on.
 */
export const completedSessionsFromStream = (items: CompetitionStreamItemWire[]): GroupRecentSession[] => {
  const recordsBySession = new Map<string, { groupRecords: CompetitionEventWire[]; personalRecords: number }>();
  for (const item of items) {
    if (item.kind !== 'competition' || item.event.kind !== 'record' || item.event.voided || item.event.session_id === null) continue;
    const boards = splitRecordBoards(item.event, item.record);
    const records = recordsBySession.get(item.event.session_id) ?? { groupRecords: [], personalRecords: 0 };
    if (boards.groupRecords.length > 0) records.groupRecords.push(groupRecordEvent(item.event, boards));
    records.personalRecords += boards.personalRecords.length;
    recordsBySession.set(item.event.session_id, records);
  }
  return items.flatMap((item) => {
    if (item.kind !== 'session' || item.session.status !== 'completed') return [];
    const { session } = item;
    const counts = buildCompetitionSession(session);
    const records = recordsBySession.get(session.session_id);
    return [{
      member: session.member,
      session_id: session.session_id,
      started_at_ms: session.started_at_ms,
      completed_at_ms: session.completed_at_ms,
      duration_sec: session.duration_sec,
      gym_name: session.gym_name,
      working_sets: counts.setCount,
      exercise_count: counts.exerciseCount,
      group_records: records?.groupRecords ?? [],
      personalRecords: records?.personalRecords ?? 0,
    }];
  });
};

/** At a glance's Latest sessions card lists this many sessions. */
export const LATEST_SESSIONS_SHOWN = 5;

/** One row of At a glance's Latest sessions: who, when, and the figure the metric chip picks. */
export type LatestSessionRowViewModel = {
  memberUserId: string;
  sessionId: string;
  name: string;
  when: string;
  /** `18 sets`, or `3 GR` for the GR metric. */
  value: string;
  /** A GR figure above zero, drawn in the record colour. */
  record: boolean;
  accessibilityLabel: string;
};

/**
 * The group's latest completed sessions in the loaded stream, newest first,
 * whatever period the page has selected: working sets, or the GR boards each
 * took, as the metric chip picks.
 */
export const buildLatestSessionRows = (
  items: CompetitionStreamItemWire[],
  metric: 'sets' | 'prs',
  myUserId: string,
  dateFormat: ExerciseDateFormat,
): LatestSessionRowViewModel[] =>
  completedSessionsFromStream(items).slice(0, LATEST_SESSIONS_SHOWN).map((session) => {
    const name = formatStreamPersonName(session.member, myUserId);
    const groupRecords = groupRecordBoards(session.group_records).length;
    const value = metric === 'sets' ? plural(session.working_sets, 'set', 'sets') : formatGroupRecordCount(groupRecords);
    const spoken = metric === 'sets' ? value : spokenGroupRecordCount(groupRecords);
    return {
      memberUserId: session.member.user_id,
      sessionId: session.session_id,
      name,
      when: formatCompactDate(new Date(session.started_at_ms), dateFormat),
      value,
      record: metric === 'prs' && groupRecords > 0,
      accessibilityLabel: sessionLabel([name, formatLocalDateTime(session.started_at_ms, dateFormat), spoken]),
    };
  });
