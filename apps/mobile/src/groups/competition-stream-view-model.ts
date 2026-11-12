import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatBoardDate } from './board-view-model';
import { isCompetitionMetric } from './competition-contract';
import { buildCompetitionSession } from './competition-session-view-model';
import { sessionRecordCertificationStatus, setCertification } from './competition-session-records-view-model';
import { describeCompetitionEvent, formatCompetitionHistoricalFigure, formatCompetitionHistoricalValue, formatSetFigure, HISTORICAL_METRIC_LABELS } from './competition-view-model';
import type { CompetitionEventWire, CompetitionStreamItemWire, CompetitionHistoryValueWire, CompetitionHistoricalMetric,
  CompetitionStreamRecordWire, CompetitionStreamSharedExerciseWire, CompetitionStreamWithdrawnWire, CoWStreamItemWire } from './competition-wire';
import { formatMemberName, formatMembershipSentence, formatSessionStatusLabel, formatSetCount,
  formatExerciseCount, formatStreamStartedAt, type RecordCertificationStatus, type StreamMembershipViewModel } from './stream-view-model';
import { splitRecordBoards, type RecordBoards } from './record-boards';

/** A group record taken in a session, drawn inside that session's card. */
export type CompetitionSessionRecordLine = {
  key: string; exercise: string; value: string; certified: boolean; accessibilityLabel: string;
};
export type CompetitionSessionCard = {
  kind: 'session'; key: string; groupId: string; memberUserId: string; sessionId: string;
  memberName: string; isTrainingNow: boolean; statusLabel: string; startedAtLabel: string;
  gymName: string | null; groupNames: string[]; setsLabel: string; exercisesLabel: string;
  /** The session's own group records (GR), one line per set; a card with none shows no record block. */
  records: CompetitionSessionRecordLine[];
  /** GR boards taken, counted on the figures line (one set can take more than one board). */
  groupRecordCount: number;
  /** The member's new bests in the group that took no #1 (PRs): counted, never listed. */
  personalRecordCount: number;
};
export type CompetitionStreamModel = CompetitionSessionCard | StreamMembershipViewModel |
  { kind: 'competition'; key: string; event: CompetitionEventWire; record?: CompetitionStreamRecordWire;
    withdrawn?: CompetitionStreamWithdrawnWire | null } |
  CompetitionStreamSharedExerciseWire | CoWStreamItemWire;

/** Every competition event kind the stream can carry, each able to be hidden. */
export const STREAM_EVENT_KINDS = ['record','record_voided','lead_change','link','unlink','rules_change'] as const;
export type StreamEventKind = typeof STREAM_EVENT_KINDS[number];
export const STREAM_EVENT_KIND_LABELS: Record<StreamEventKind,string> = {
  record: 'GR', record_voided: 'Withdrawn GR', lead_change: 'Lead changes',
  link: 'Exercise links', unlink: 'Exercise unlinks', rules_change: 'Rules changes',
};
/** Linking says nothing about training, so the stream leaves it out until the debug drawer asks for it. */
export const DEFAULT_HIDDEN_STREAM_EVENT_KINDS: readonly StreamEventKind[] = ['link','unlink'];

/** Counts come only from permitted set context; absolute totals are never reconstructed. */
export function buildCompetitionStreamItem(item: CompetitionStreamItemWire, dateFormat: ExerciseDateFormat): CompetitionStreamModel {
  if (item.kind === 'shared_exercise' || item.kind === 'cow') return item;
  if (item.kind === 'competition') return { kind: item.kind,key: item.key,event: item.event,record: item.record,withdrawn: item.withdrawn };
  if (item.kind === 'membership') return { kind: item.kind,key: item.key,groupId: item.group.group_id,
    groupName: item.group.name,sentence: formatMembershipSentence(item.event,item.member.username) };
  const { session } = item;
  const counts = buildCompetitionSession(session);
  return { kind: 'session',records: [],groupRecordCount: 0,personalRecordCount: 0,key: item.key,groupId: item.groups[0].group_id,
    memberUserId: session.member.user_id,sessionId: session.session_id,
    memberName: formatMemberName(session.member.username),isTrainingNow: session.status === 'active',
    statusLabel: session.status === 'draft' ? 'Draft' : formatSessionStatusLabel({ ...session,status: session.status }),
    startedAtLabel: formatStreamStartedAt(session.started_at_ms, dateFormat),gymName: session.gym_name,
    groupNames: item.groups.map(group => group.name),setsLabel: formatSetCount(counts.setCount),
    exercisesLabel: formatExerciseCount(counts.exerciseCount) };
}

/** A record card's certification line: the set's, one per set. */
export type StreamCertificationLine = { status: RecordCertificationStatus; label: string };

function certificationLine(event: CompetitionEventWire,userId: string | null, dateFormat: ExerciseDateFormat): StreamCertificationLine | null {
  const metrics = event.record_context?.metrics;
  if (!metrics?.length) return null;
  const active = metrics.map(entry => entry.certification).find(c => c !== null && c.ended_at_ms === null) ?? null;
  if (active) return { status: 'certified',label: sessionRecordCertificationStatus(active,userId,dateFormat) };
  return metrics.some(entry => entry.certification !== null) ? { status: 'voided',label: 'Certification ended' }
    : { status: 'uncertified',label: 'Not certified' };
}

/** The record's set: `120.0 × 5` from the record stream, else `5 reps` from the event. */
export function streamRecordSet(event: CompetitionEventWire,record: CompetitionStreamRecordWire | undefined): string | null {
  if (record?.performance) return formatSetFigure(record.performance);
  return event.reps === null ? null : `${event.reps} reps`;
}

/**
 * A record's values as the stream shows them: its GR boards only (a PR is
 * counted on its session's card, never drawn). Without its `record` the
 * boards are unknown, and every value shows.
 */
const shownRecordValues = (event: CompetitionEventWire,record: CompetitionStreamRecordWire | undefined): CompetitionHistoryValueWire[] =>
  event.values.filter(value => value.role === 'leader' || value.role === 'record' && (!record || record.group_record_metrics.includes(value.metric)));

/** A withdrawn record's GR card: the card the record drew, dated at its withdrawal, without a certification. */
function withdrawnRecordCard(event: CompetitionEventWire,withdrawn: CompetitionStreamWithdrawnWire,userId: string | null,dateFormat: ExerciseDateFormat) {
  const source = withdrawn.event;
  const name = source.member?.user_id === userId ? 'You' : formatMemberName(source.member?.username);
  return { label: `${name} · GR withdrawn`,source,set: streamRecordSet(source,withdrawn.record),certification: null,
    details: shownRecordValues(source,withdrawn.record).map(value => formatCompetitionHistoricalValue(value)),
    date: formatBoardDate(event.sort_at_ms,dateFormat) };
}

function eventCardBody(event: CompetitionEventWire,userId: string | null,record: CompetitionStreamRecordWire | undefined,
  withdrawn: CompetitionStreamWithdrawnWire | null | undefined,dateFormat: ExerciseDateFormat) {
  if (event.kind === 'record_voided' && withdrawn) return withdrawnRecordCard(event,withdrawn,userId,dateFormat);
  const name = event.member?.user_id === userId ? 'You' : formatMemberName(event.member?.username);
  const ended = event.voided || event.kind === 'record_voided';
  const label = ended ? `${name} · GR withdrawn` : event.kind === 'record' ? `${name} · GR`
    : event.kind === 'rules_change' ? 'Group rules changed' : 'Leaderboard changed';
  const values = ended ? [] : shownRecordValues(event,record);
  const details = ended ? [] : values.length
    ? values.map(value => formatCompetitionHistoricalValue(value))
    : event.kind === 'rules_change' ? [] : [describeCompetitionEvent(event)];
  const isRecord = !ended && event.kind === 'record';
  const date = isRecord && event.provisional ? `${formatBoardDate(event.sort_at_ms,dateFormat)} · Session in progress` : formatBoardDate(event.sort_at_ms,dateFormat);
  return { label,source: event,set: isRecord ? streamRecordSet(event,record) : null,
    certification: isRecord ? certificationLine(event,userId,dateFormat) : null,details,date };
}

/**
 * A stream card. A withdrawal (`record_voided`) shows the withdrawn record's
 * GR card (who, exercise, set, GR values) dated at withdrawal; the stream
 * draws one only for a record that was a GR (`buildCompetitionStreamModels`).
 */
export function buildCompetitionEventCard(event: CompetitionEventWire,userId: string | null,showGroup: boolean,
  record: CompetitionStreamRecordWire | undefined, dateFormat: ExerciseDateFormat, withdrawn?: CompetitionStreamWithdrawnWire | null) {
  const { label,source,set,certification,details,date } = eventCardBody(event,userId,record,withdrawn,dateFormat);
  const context = source.group_exercise.name;
  const groupName = showGroup ? event.group.name : null;
  return { label,context,set,certification,details,groupName,date,
    accessibilityLabel: [groupName,label,context,set,certification?.label,...details,date].filter(Boolean).join(', '),
    historyPath: `/group/${event.group.group_id}/leaderboards/${event.group_exercise.group_exercise_id}/history?metric=${isCompetitionMetric(source.metric) ? source.metric : 'e1rm'}&scope=all` as const };
}

export type StreamRecordMetric = { metric: CompetitionHistoricalMetric; label: string; value: string };
export type StreamPreviousRecord = { metric: CompetitionHistoricalMetric; label: string; value: string; holder: string; set: string | null };

const figure = formatCompetitionHistoricalFigure;
const e1rmFirst = (a: { metric: string },b: { metric: string }) => (a.metric === 'e1rm' ? 0 : 1) - (b.metric === 'e1rm' ? 0 : 1);

/**
 * The stream record sheet: who and when, the set and its one certification,
 * each record value (1RM first), and the group's previous #1 on each board it
 * took. A voided record has no certification.
 */
export function buildStreamRecordSheet(event: CompetitionEventWire,record: CompetitionStreamRecordWire | undefined,
  userId: string | null,dateFormat: ExerciseDateFormat) {
  const nameOf = (member: { user_id: string; username: string | null } | null | undefined) =>
    member?.user_id === userId ? 'You' : formatMemberName(member?.username);
  const metrics: StreamRecordMetric[] = shownRecordValues(event,record).filter(value => value.role === 'record').sort(e1rmFirst)
    .map(value => ({ metric: value.metric,label: HISTORICAL_METRIC_LABELS[value.metric],
      value: event.voided ? 'Score unavailable' : figure(value) }));
  const previous: StreamPreviousRecord[] = event.voided ? [] : (record?.previous ?? []).map(entry => ({
    metric: entry.value.metric,label: HISTORICAL_METRIC_LABELS[entry.value.metric],value: figure(entry.value),
    holder: nameOf(entry.value.member),set: entry.performance ? formatSetFigure(entry.performance) : null })).sort(e1rmFirst);
  return { who: `${nameOf(event.member)} · ${formatBoardDate(event.sort_at_ms,dateFormat)}`,set: streamRecordSet(event,record),
    certification: event.voided ? null : setCertification(event),metrics,previous };
}

/** A record's one line inside its session card, its GR boards only: `Deadlift · 1RM 213.3`. */
function sessionRecordLine(key: string,event: CompetitionEventWire,boards: RecordBoards): CompetitionSessionRecordLine {
  const value = boards.groupRecords.map(formatCompetitionHistoricalValue).join(' · ');
  const certified = (event.record_context?.metrics ?? [])
    .some(entry => entry.certification !== null && entry.certification.ended_at_ms === null);
  return { key,exercise: event.group_exercise.name,value,certified,
    accessibilityLabel: [event.group_exercise.name,value,certified ? 'certified' : null].filter(Boolean).join(', ') };
}

/**
 * The stream as drawn: a session carries the records it took, so one session
 * is one card, and the hidden event kinds are dropped. Its group records (GR)
 * are lines and its PRs a count. Only a record tied to a session in the same
 * page nests; any other record keeps its own card, and only while it is a GR.
 * A withdrawn record leaves both; its withdrawal draws it once, if it was a GR.
 */
export function buildCompetitionStreamModels(items: CompetitionStreamItemWire[],
  hiddenKinds: readonly StreamEventKind[] = DEFAULT_HIDDEN_STREAM_EVENT_KINDS, dateFormat: ExerciseDateFormat): CompetitionStreamModel[] {
  const models = items.map(item => buildCompetitionStreamItem(item, dateFormat));
  const sessions = new Map<string,CompetitionSessionCard>();
  for (const model of models) if (model.kind === 'session') sessions.set(model.sessionId,model);
  const drawn: CompetitionStreamModel[] = [];
  for (const model of models) {
    if (model.kind !== 'competition') { drawn.push(model); continue; }
    if (hiddenKinds.includes(model.event.kind as StreamEventKind)) continue;
    // A withdrawal is drawn only for a record the stream showed: one that took #1 (a GR).
    if (model.event.kind === 'record_voided') { if (model.withdrawn?.record.group_record_metrics.length) drawn.push(model); continue; }
    if (model.event.kind !== 'record') { drawn.push(model); continue; }
    // A withdrawn record leaves its place: its withdrawal shows it, once.
    if (model.event.voided) continue;
    const boards = splitRecordBoards(model.event,model.record);
    const host = model.event.session_id === null ? undefined : sessions.get(model.event.session_id);
    if (host) {
      host.personalRecordCount += boards.personalRecords.length;
      host.groupRecordCount += boards.groupRecords.length;
      if (boards.groupRecords.length > 0) host.records.push(sessionRecordLine(model.key,model.event,boards));
      continue;
    }
    // A record standing alone is drawn only while it took #1 on a board (a Volume GR included).
    if (!model.record || model.record.group_record_metrics.length > 0) drawn.push(model);
  }
  return drawn;
}
