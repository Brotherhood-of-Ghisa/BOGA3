import { formatBoardDate } from './board-view-model';
import { isCompetitionMetric } from './competition-contract';
import { buildCompetitionSession } from './competition-session-view-model';
import { sessionRecordCertificationStatus, setCertification } from './competition-session-records-view-model';
import { describeCompetitionEvent, formatCompetitionFigure, formatCompetitionHistoricalValue, formatSetFigure, HISTORICAL_METRIC_LABELS } from './competition-view-model';
import type { CompetitionEventWire, CompetitionStreamItemWire,CompetitionHistoryValueWire,CompetitionHistoricalMetric,
  CompetitionStreamRecordWire } from './competition-wire';
import { formatMemberName, formatMembershipSentence, formatSessionStatusLabel, formatSetCount,
  formatExerciseCount, formatStreamStartedAt, type RecordCertificationStatus, type StreamMembershipViewModel } from './stream-view-model';

/** A group record taken in a session, drawn inside that session's card. */
export type CompetitionSessionRecordLine = {
  key: string; exercise: string; value: string; certified: boolean; accessibilityLabel: string;
};
export type CompetitionSessionCard = {
  kind: 'session'; key: string; groupId: string; memberUserId: string; sessionId: string;
  memberName: string; isTrainingNow: boolean; statusLabel: string; startedAtLabel: string;
  gymName: string | null; groupNames: string[]; setsLabel: string; exercisesLabel: string;
  /** The session's own group records; a card with none shows no record block. */
  records: CompetitionSessionRecordLine[];
};
export type CompetitionStreamModel = CompetitionSessionCard | StreamMembershipViewModel |
  { kind: 'competition'; key: string; event: CompetitionEventWire; record?: CompetitionStreamRecordWire };

/** Every competition event kind the stream can carry, each able to be hidden. */
export const STREAM_EVENT_KINDS = ['record','record_voided','lead_change','link','unlink','rules_change'] as const;
export type StreamEventKind = typeof STREAM_EVENT_KINDS[number];
export const STREAM_EVENT_KIND_LABELS: Record<StreamEventKind,string> = {
  record: 'Records', record_voided: 'Voided records', lead_change: 'Lead changes',
  link: 'Exercise links', unlink: 'Exercise unlinks', rules_change: 'Rules changes',
};
/** Linking says nothing about training, so the stream leaves it out until the debug drawer asks for it. */
export const DEFAULT_HIDDEN_STREAM_EVENT_KINDS: readonly StreamEventKind[] = ['link','unlink'];

/** Counts come only from permitted set context; absolute totals are never reconstructed. */
export function buildCompetitionStreamItem(item: CompetitionStreamItemWire): CompetitionStreamModel {
  if (item.kind === 'competition') return { kind: item.kind,key: item.key,event: item.event,record: item.record };
  if (item.kind === 'membership') return { kind: item.kind,key: item.key,groupId: item.group.group_id,
    groupName: item.group.name,sentence: formatMembershipSentence(item.event,item.member.username) };
  const { session } = item;
  const counts = buildCompetitionSession(session);
  return { kind: 'session',records: [],key: item.key,groupId: item.groups[0].group_id,
    memberUserId: session.member.user_id,sessionId: session.session_id,
    memberName: formatMemberName(session.member.username),isTrainingNow: session.status === 'active',
    statusLabel: session.status === 'draft' ? 'Draft' : formatSessionStatusLabel({ ...session,status: session.status }),
    startedAtLabel: formatStreamStartedAt(session.started_at_ms),gymName: session.gym_name,
    groupNames: item.groups.map(group => group.name),setsLabel: formatSetCount(counts.setCount),
    exercisesLabel: formatExerciseCount(counts.exerciseCount) };
}

/** A record card's certification line: the set's, one per set. */
export type StreamCertificationLine = { status: RecordCertificationStatus; label: string };

function certificationLine(event: CompetitionEventWire,userId: string | null): StreamCertificationLine | null {
  const metrics = event.record_context?.metrics;
  if (!metrics?.length) return null;
  const active = metrics.map(entry => entry.certification).find(c => c !== null && c.ended_at_ms === null) ?? null;
  if (active) return { status: 'certified',label: sessionRecordCertificationStatus(active,userId) };
  return metrics.some(entry => entry.certification !== null) ? { status: 'voided',label: 'Certification ended' }
    : { status: 'uncertified',label: 'Not certified' };
}

/** The record's set: `120.0 × 5` from the record stream, else `5 reps` from the event. */
export function streamRecordSet(event: CompetitionEventWire,record: CompetitionStreamRecordWire | undefined): string | null {
  if (record?.performance) return formatSetFigure(record.performance);
  return event.reps === null ? null : `${event.reps} reps`;
}

export function buildCompetitionEventCard(event: CompetitionEventWire,userId: string | null,showGroup: boolean,
  record?: CompetitionStreamRecordWire) {
  const name = event.member?.user_id === userId ? 'You' : formatMemberName(event.member?.username);
  const ended = event.voided || event.kind === 'record_voided';
  const label = ended ? 'Certification ended' : event.kind === 'record' ? `${name} · record`
    : event.kind === 'rules_change' ? 'Group rules changed' : 'Leaderboard changed';
  const values = ended ? [] : event.values.filter(value => value.role === 'record' || value.role === 'leader');
  const details = ended ? ['Score unavailable'] : values.length
    ? values.map(value => formatCompetitionHistoricalValue(value))
    : event.kind === 'rules_change' ? [] : [describeCompetitionEvent(event)];
  const isRecord = !ended && event.kind === 'record';
  const set = isRecord ? streamRecordSet(event,record) : null;
  const certification = isRecord ? certificationLine(event,userId) : null;
  const context = event.group_exercise.name;
  const date = isRecord && event.provisional ? `${formatBoardDate(event.sort_at_ms)} · Session in progress` : formatBoardDate(event.sort_at_ms);
  const groupName = showGroup ? event.group.name : null;
  return { label,context,set,certification,details,groupName,date,
    accessibilityLabel: [groupName,label,context,set,certification?.label,...details,date].filter(Boolean).join(', '),
    historyPath: `/group/${event.group.group_id}/leaderboards/${event.group_exercise.group_exercise_id}/history?metric=${isCompetitionMetric(event.metric) ? event.metric : 'e1rm'}&scope=all` as const };
}

export type StreamRecordMetric = { metric: CompetitionHistoricalMetric; label: string; value: string };
export type StreamPreviousRecord = { metric: CompetitionHistoricalMetric; label: string; value: string; holder: string; set: string | null };

const figure = (value: CompetitionHistoryValueWire): string => value.unavailable || value.value === null ? 'Score unavailable'
  : formatCompetitionFigure(value.value,value.unit);
const e1rmFirst = (a: { metric: string },b: { metric: string }) => (a.metric === 'e1rm' ? 0 : 1) - (b.metric === 'e1rm' ? 0 : 1);

/**
 * The stream record sheet: who and when, the set and its one certification,
 * each record value (1RM first), and the group's previous #1 on each board it
 * took. A voided record has no certification.
 */
export function buildStreamRecordSheet(event: CompetitionEventWire,record: CompetitionStreamRecordWire | undefined,
  userId: string | null,nowMs: number = Date.now()) {
  const nameOf = (member: { user_id: string; username: string | null } | null | undefined) =>
    member?.user_id === userId ? 'You' : formatMemberName(member?.username);
  const metrics: StreamRecordMetric[] = event.values.filter(value => value.role === 'record').sort(e1rmFirst)
    .map(value => ({ metric: value.metric,label: HISTORICAL_METRIC_LABELS[value.metric],
      value: event.voided ? 'Score unavailable' : figure(value) }));
  const previous: StreamPreviousRecord[] = event.voided ? [] : (record?.previous ?? []).map(entry => ({
    metric: entry.value.metric,label: HISTORICAL_METRIC_LABELS[entry.value.metric],value: figure(entry.value),
    holder: nameOf(entry.value.member),set: entry.performance ? formatSetFigure(entry.performance) : null })).sort(e1rmFirst);
  return { who: `${nameOf(event.member)} · ${formatBoardDate(event.sort_at_ms,nowMs)}`,set: streamRecordSet(event,record),
    certification: event.voided ? null : setCertification(event),metrics,previous };
}

/** A record's one line inside its session card: `Deadlift · 1RM 213.3`. */
function sessionRecordLine(key: string,event: CompetitionEventWire): CompetitionSessionRecordLine {
  const values = event.values.filter(value => value.role === 'record');
  const value = values.map(formatCompetitionHistoricalValue).join(' · ') || describeCompetitionEvent(event);
  const certified = (event.record_context?.metrics ?? [])
    .some(entry => entry.certification !== null && entry.certification.ended_at_ms === null);
  return { key,exercise: event.group_exercise.name,value,certified,
    accessibilityLabel: [event.group_exercise.name,value,certified ? 'certified' : null].filter(Boolean).join(', ') };
}

/**
 * The stream as drawn: a session carries the group records it took, so one
 * session is one card, and the hidden event kinds are dropped. Only a record
 * tied to a session in the same page nests; anything else keeps its own card.
 */
export function buildCompetitionStreamModels(items: CompetitionStreamItemWire[],
  hiddenKinds: readonly StreamEventKind[] = DEFAULT_HIDDEN_STREAM_EVENT_KINDS): CompetitionStreamModel[] {
  const models = items.map(buildCompetitionStreamItem);
  const sessions = new Map<string,CompetitionSessionCard>();
  for (const model of models) if (model.kind === 'session') sessions.set(model.sessionId,model);
  const drawn: CompetitionStreamModel[] = [];
  for (const model of models) {
    if (model.kind !== 'competition') { drawn.push(model); continue; }
    if (hiddenKinds.includes(model.event.kind as StreamEventKind)) continue;
    const host = model.event.session_id === null ? undefined : sessions.get(model.event.session_id);
    if (host && model.event.kind === 'record' && !model.event.voided) {
      host.records.push(sessionRecordLine(model.key,model.event));
      continue;
    }
    drawn.push(model);
  }
  return drawn;
}
