import { formatWeight } from '@/src/exercise-calculations/format';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatBoardDate, formatBoardMemberLabel, formatOrdinal, type BoardRowViewModel } from './board-view-model';
import { COMPETITION_LABELS, formatCompetitionFigure, speakHoldSeconds } from './competition-view-model';
import type { MedalBoard, MedalRow } from './medal-view-model';
import { meetDate, MEET_METRICS } from './meet-presentation';
import type { MeetLeaderboardWire, MeetResultsWire, MeetStandingWire, MeetTrophyWire } from './meet-results-wire';
import type { MeetMetric } from './meet-wire';
import { formatMemberName } from './stream-view-model';
import type { GroupMemberRef } from './types';

export const MEET_PODIUM_PLACES = 3;
export const MEET_UNAVAILABLE_LABEL = 'Unavailable';

/** The caption from the server's own state: finality is the server's, never the clock's. */
export function meetResultsCaption(results: MeetResultsWire, format: ExerciseDateFormat, numeric = false): string {
  const { meet, results: state } = results;
  const at = (ms: number) => meetDate(ms, meet.time_zone, format, numeric);
  switch (state.state) {
    case 'scheduled': return 'Scheduled';
    case 'live': return 'Live';
    case 'so_far': return `Standings so far · final at ${at(state.final_at_ms)}`;
    case 'final': return 'Final';
    case 'refreshed': return `Results refreshed ${state.refreshed_at_ms === null ? '' : at(state.refreshed_at_ms)}`.trim();
    default: return 'Cancelled';
  }
}

const standingValue = (standing: MeetStandingWire): string => {
  if (standing.unavailable || standing.value === null) return MEET_UNAVAILABLE_LABEL;
  if (standing.unit === 'reps') return `${standing.value} reps`;
  if (standing.unit === 'seconds') return `${standing.value} s`;
  return formatCompetitionFigure(standing.value, standing.unit);
};

/** The set behind a score, as the boards show it: `120.0 × 5`, `5 reps` where the load is hidden, `60 s`. */
export function meetSetFigure(set: MeetStandingWire['set']): string {
  const load = set.weight_value?.trim() ? Number(set.weight_value) : NaN;
  const weight = Number.isFinite(load) ? formatWeight(load) : null;
  if (set.recording_mode === 'hold') {
    const time = `${set.duration_sec ?? 0} s`;
    return weight === null ? time : `${weight} × ${time}`;
  }
  return weight === null ? `${set.reps_value ?? 0} reps` : `${weight} × ${set.reps_value ?? 0}`;
}

/** One standings row in the board row's shape: server places and figures, never re-ranked. */
export function buildMeetStandingRows(results: MeetResultsWire, standings: MeetStandingWire[], metric: MeetMetric, userId: string,
  dateFormat: ExerciseDateFormat): BoardRowViewModel[] {
  const started = new Map(results.sessions.map(s => [s.session_id, s.started_at_ms]));
  return standings.map((standing, index) => {
    const memberLabel = formatBoardMemberLabel(standing.member, !standing.current_member, userId);
    const valueLabel = standingValue(standing);
    const detailLabel = standing.unavailable && standing.set.weight_value === null && standing.set.reps_value === null ? null : meetSetFigure(standing.set);
    const at = started.get(standing.set.session_id);
    const dateLabel = at === undefined ? '' : formatBoardDate(at, dateFormat);
    const certification = standing.certified ? 'certified' as const : null;
    return { key: `${standing.member.user_id}:${index}`, rank: standing.place, rankLabel: String(standing.place), memberLabel,
      isMe: standing.member.user_id === userId, former: !standing.current_member, valueLabel, detailLabel, dateLabel, certification,
      accessibilityLabel: speakHoldSeconds([formatOrdinal(standing.place), memberLabel, MEET_METRICS[metric], valueLabel, detailLabel, dateLabel,
        standing.certified ? 'certified' : null].filter(Boolean).join(', ')) };
  });
}

/** Places 1–3 are the podium; everyone else is the rest of the standings. */
export const splitMeetStandings = <T extends { rank: number }>(rows: T[]) => ({
  podium: rows.filter(row => row.rank <= MEET_PODIUM_PLACES), rest: rows.filter(row => row.rank > MEET_PODIUM_PLACES),
});

export type MeetSessionRow = { key: string; memberUserId: string; sessionId: string; label: string; accessibilityLabel: string };
export function buildMeetSessionRows(results: MeetResultsWire, dateFormat: ExerciseDateFormat, userId: string): MeetSessionRow[] {
  return results.sessions.map(session => {
    const name = formatBoardMemberLabel(session.member, !session.current_member, userId);
    const date = meetDate(session.started_at_ms, results.meet.time_zone, dateFormat);
    return { key: `${session.member.user_id}:${session.session_id}`, memberUserId: session.member.user_id, sessionId: session.session_id,
      label: `${name} · ${date}`, accessibilityLabel: `${name}, ${meetDate(session.started_at_ms, results.meet.time_zone, dateFormat, true)}` };
  });
}

export type MeetRecordRow = { key: string; title: string; figures: string };
export function buildMeetRecordRows(results: MeetResultsWire, userId: string): MeetRecordRow[] {
  return results.records.map((record, index) => ({ key: `${record.session_id}:${record.set_id}:${index}`,
    title: `${record.exercise_name} · ${formatBoardMemberLabel(record.member, false, userId)}`,
    figures: record.boards.map(board => {
      const label = COMPETITION_LABELS[board.metric as keyof typeof COMPETITION_LABELS] ?? board.metric;
      return `${label} ${board.unavailable || board.value === null ? MEET_UNAVAILABLE_LABEL : formatCompetitionFigure(board.value, board.unit)}`;
    }).join(' · ') }));
}

/** The Meets leaderboard as a medal board: server ranks (ties share one), counts of 🥇🥈🥉. */
export function buildMeetLeaderboard(wire: MeetLeaderboardWire, userId: string): MedalBoard {
  const rows: MedalRow[] = wire.rows.map(row => {
    const former = !row.current_member;
    const name = formatMemberName(row.member.username);
    const isMe = row.member.user_id === userId;
    return { userId: row.member.user_id, name, memberLabel: formatBoardMemberLabel(row.member, former, userId), isMe, former,
      gold: row.gold, silver: row.silver, bronze: row.bronze, rank: row.rank,
      accessibilityLabel: [formatOrdinal(row.rank), isMe ? `You, ${name}` : name, former ? 'Former' : null,
        `Gold ${row.gold}`, `Silver ${row.silver}`, `Bronze ${row.bronze}`].filter(Boolean).join(', ') };
  });
  return { state: 'ready', rows, me: rows.find(row => row.isMe) ?? null };
}

export const TROPHY_PLACE_LABELS: Record<MeetTrophyWire['place'], string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
export const TROPHY_PLACE_WORDS: Record<MeetTrophyWire['place'], string> = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };
/** The meet a trophy was won at: its title and date in the viewer's date format. */
export const trophyLabel = (trophy: MeetTrophyWire, format: ExerciseDateFormat) =>
  `${trophy.title || 'Meet'} · ${formatBoardDate(trophy.starts_at_ms, format)}`;

export const meetMemberName = (member: GroupMemberRef | null) => formatMemberName(member?.username);
export const meetResultsRefreshMessage = (code: string, offline: boolean): string => {
  if (offline) return "You're offline. Connect to the internet and try again.";
  if (code === 'CONFLICT') return 'Results are not ready to refresh yet. Try again shortly.';
  if (code === 'FORBIDDEN') return "You can't refresh these results.";
  return "Couldn't refresh the results. Try again.";
};
