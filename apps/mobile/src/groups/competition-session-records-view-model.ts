// The group session view's records, as plain data: the Group records card's
// rows (one per #1 board), each exercise card's record band (one line per
// record set), and the screen's title. No React, no I/O.
import { formatCompactDuration } from '@/src/data/session-list';
import type { RecordLine } from '@/src/session-insights/record-band';

import { formatBoardDate, YOU_LABEL } from './board-view-model';
import { isCompetitionMetric } from './competition-contract';
import type { CompetitionSessionExerciseCard } from './competition-session-view-model';
import { COMPETITION_UNIT_LABELS, HISTORICAL_METRIC_LABELS } from './competition-view-model';
import type { CompetitionCertificationWire, CompetitionExerciseWire, CompetitionHistoricalMetric,
  CompetitionSessionRecordWire, CompetitionSessionWire } from './competition-wire';
import type { MetricCertificationTarget } from './metric-record-sheet-view-model';
import { formatMemberName, formatMetricFigure } from './stream-view-model';
import type { GroupMemberRef } from './types';

export const GROUP_RECORD_LABEL = '#1 in group';
export const GROUP_VIEW_LABEL = 'group view';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** What a record row needs to certify or withdraw: the board row it stands for, on its comparison. */
export type SessionRecordCertification = {
  target: MetricCertificationTarget;
  exercise: CompetitionExerciseWire;
  /** The server's word on whether the set is still a current, certifiable entry. */
  eligible: boolean;
};

export type SessionRecordRow = {
  key: string;
  setId: string;
  title: string;
  value: string;
  detail: string;
  boardHref: string;
  /** Null for a board the current rules no longer have (a historic Weight record). */
  certification: SessionRecordCertification | null;
};

const isMe = (member: GroupMemberRef | null | undefined, userId: string | null): boolean =>
  member !== null && member !== undefined && userId !== null && member.user_id === userId;

const nameOf = (member: GroupMemberRef, userId: string | null): string =>
  isMe(member, userId) ? YOU_LABEL : formatMemberName(member.username);

/** `sam · Mon 6 Oct`; `You · Mon 6 Oct` on my own session. */
export function groupSessionTitle(session: Pick<CompetitionSessionWire, 'member' | 'started_at_ms'>, userId: string | null, nowMs = Date.now()): string {
  const day = WEEKDAYS[new Date(session.started_at_ms).getDay()];
  return `${nameOf(session.member, userId)} · ${day} ${formatBoardDate(session.started_at_ms, nowMs)}`;
}

/** `Iron Crew · group view`; just the words until the group's name is known. */
export const groupSessionEyebrow = (groupName: string | null): string =>
  groupName?.trim() ? `${groupName.trim()} · ${GROUP_VIEW_LABEL}` : `Group view`;

/** View Session's Duration: the session's own once completed, else the time since it started. */
export function formatGroupSessionDuration(session: Pick<CompetitionSessionWire, 'status' | 'started_at_ms' | 'completed_at_ms' | 'duration_sec'>,
  nowMs = Date.now()): string {
  if (session.status !== 'completed') return formatCompactDuration(Math.floor(Math.max(0, nowMs - session.started_at_ms) / 1000));
  if (session.duration_sec !== null) return formatCompactDuration(session.duration_sec);
  return session.completed_at_ms === null ? '—' : formatCompactDuration(Math.floor(Math.max(0, session.completed_at_ms - session.started_at_ms) / 1000));
}

/** Group competition no longer ranks Volume; only the boards it keeps show. */
const SHOWN_BOARD = (metric: string): boolean => metric !== 'volume';

/** Records only once the session is completed: an in-progress record can still move or vanish. */
export const shownSessionRecords = (session: Pick<CompetitionSessionWire, 'status'>,
  records: readonly CompetitionSessionRecordWire[]): CompetitionSessionRecordWire[] =>
  session.status === 'completed' ? records.filter(record => !record.event.provisional && !record.event.voided)
    .map(record => ({ ...record, boards: record.boards.filter(board => SHOWN_BOARD(board.metric)) }))
    .filter(record => record.boards.length > 0) : [];

type SetPlace = { figure: string; cardId: string; order: number };

/** Each performed set's figures (`110 × 2`, `5 reps`) and its place in the session. */
export function sessionSetPlaces(cards: readonly CompetitionSessionExerciseCard[]): Map<string, SetPlace> {
  const places = new Map<string, SetPlace>();
  cards.forEach((card, cardIndex) => card.rows.forEach((row, rowIndex) =>
    places.set(row.id, { figure: row.weightReps, cardId: card.id, order: cardIndex * 10_000 + rowIndex })));
  return places;
}

const recordValue = (record: CompetitionSessionRecordWire, metric: CompetitionHistoricalMetric): string => {
  const value = record.event.values.find(entry => entry.role === 'record' && entry.metric === metric);
  if (!value || value.unavailable || value.value === null) return 'Score unavailable';
  const unit = COMPETITION_UNIT_LABELS[value.unit as keyof typeof COMPETITION_UNIT_LABELS] ?? value.unit;
  return `${formatMetricFigure('e1rm', value.value)} ${unit}`;
};

const certificationOf = (record: CompetitionSessionRecordWire, metric: CompetitionHistoricalMetric): SessionRecordCertification | null => {
  const context = record.event.record_context;
  const member = record.event.member;
  const setId = record.event.set_id;
  if (!isCompetitionMetric(metric) || !context || !member || !setId) return null;
  const entry = context.metrics.find(candidate => candidate.metric === metric);
  if (!entry) return null;
  return {
    target: { metric, member, former: context.former, write_token: entry.write_token,
      certification: entry.certification, performance: { set_id: setId } },
    exercise: context.exercise,
    eligible: entry.eligible,
  };
};

/** The Group records card: one row per #1 board, in session order, 1RM before Volume. */
export function buildSessionRecordRows({ records, places, groupId, userId }: {
  records: readonly CompetitionSessionRecordWire[]; places: ReadonlyMap<string, SetPlace>; groupId: string; userId: string | null;
}): SessionRecordRow[] {
  return records.flatMap(record => {
    const setId = record.event.set_id ?? '';
    const place = places.get(setId);
    const exercise = record.event.group_exercise;
    return record.boards.map(board => {
      const passedBy = !board.leads && board.leader ? `since passed by ${isMe(board.leader, userId) ? 'you' : formatMemberName(board.leader.username)}` : null;
      const metricQuery = isCompetitionMetric(board.metric) ? `?metric=${board.metric}&scope=all` : '';
      return {
        sort: [place?.order ?? Number.MAX_SAFE_INTEGER, record.event.sequence, board.metric === 'e1rm' ? 0 : 1] as const,
        row: {
          key: `${record.event.event_id}:${board.metric}`,
          setId,
          title: `${exercise.name} · ${HISTORICAL_METRIC_LABELS[board.metric]}`,
          value: recordValue(record, board.metric),
          detail: [GROUP_RECORD_LABEL, place?.figure ?? null, passedBy].filter(Boolean).join(' · '),
          boardHref: `/group/${encodeURIComponent(groupId)}/leaderboards/${encodeURIComponent(exercise.group_exercise_id)}${metricQuery}`,
          certification: certificationOf(record, board.metric),
        },
      };
    });
  }).sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2]).map(entry => entry.row);
}

/** Each exercise card's band: one line per record set, its boards joined (`#1 in group · 1RM + Volume`). */
export function buildSessionRecordBands(records: readonly CompetitionSessionRecordWire[],
  places: ReadonlyMap<string, SetPlace>): Map<string, RecordLine[]> {
  const bands = new Map<string, RecordLine[]>();
  const ordered = [...records].sort((a, b) => (places.get(a.event.set_id ?? '')?.order ?? 0) - (places.get(b.event.set_id ?? '')?.order ?? 0));
  for (const record of ordered) {
    const place = places.get(record.event.set_id ?? '');
    if (!place) continue;
    const labels = [...record.boards].sort((a, b) => (a.metric === 'e1rm' ? 0 : 1) - (b.metric === 'e1rm' ? 0 : 1))
      .map(board => HISTORICAL_METRIC_LABELS[board.metric]);
    const line: RecordLine = {
      key: record.event.event_id,
      label: `${GROUP_RECORD_LABEL} · ${labels.join(' + ')}`,
      set: place.figure,
      spoken: `${GROUP_RECORD_LABEL} on ${labels.join(' and ')}, ${place.figure}`,
    };
    bands.set(place.cardId, [...(bands.get(place.cardId) ?? []), line]);
  }
  return bands;
}

/** `Certified by alex · 7 Oct` (`you` for mine) while a certification stands, else `Not certified`. */
export function sessionRecordCertificationStatus(active: CompetitionCertificationWire | null, userId: string | null): string {
  if (!active) return 'Not certified';
  const by = active.certified_by;
  const witness = !by ? 'a group member' : isMe(by, userId) ? 'you' : formatMemberName(by.username);
  return `Certified by ${witness} · ${formatBoardDate(active.certified_at_ms)}`;
}
