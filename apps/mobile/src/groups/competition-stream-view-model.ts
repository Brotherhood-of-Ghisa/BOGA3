import { formatBoardDate } from './board-view-model';
import { isCompetitionMetric } from './competition-contract';
import { buildCompetitionSession } from './competition-session-view-model';
import { sessionRecordCertificationStatus, setCertification } from './competition-session-records-view-model';
import { COMPETITION_UNIT_LABELS, describeCompetitionEvent, formatCompetitionHistoricalValue, formatSetFigure, HISTORICAL_METRIC_LABELS } from './competition-view-model';
import type { CompetitionEventWire, CompetitionStreamItemWire,CompetitionHistoryValueWire,CompetitionHistoricalMetric,
  CompetitionStreamRecordWire } from './competition-wire';
import { formatMemberName, formatMetricFigure, formatMembershipSentence, formatSessionStatusLabel, formatSetCount,
  formatExerciseCount, formatStreamStartedAt, type RecordCertificationStatus, type StreamMembershipViewModel } from './stream-view-model';

export type CompetitionSessionCard = {
  kind: 'session'; key: string; groupId: string; memberUserId: string; sessionId: string;
  memberName: string; isTrainingNow: boolean; statusLabel: string; startedAtLabel: string;
  gymName: string | null; groupNames: string[]; setsLabel: string; exercisesLabel: string;
};
export type CompetitionStreamModel = CompetitionSessionCard | StreamMembershipViewModel |
  { kind: 'competition'; key: string; event: CompetitionEventWire; record?: CompetitionStreamRecordWire };

/** Counts come only from permitted set context; absolute totals are never reconstructed. */
export function buildCompetitionStreamItem(item: CompetitionStreamItemWire): CompetitionStreamModel {
  if (item.kind === 'competition') return { kind: item.kind,key: item.key,event: item.event,record: item.record };
  if (item.kind === 'membership') return { kind: item.kind,key: item.key,groupId: item.group.group_id,
    groupName: item.group.name,sentence: formatMembershipSentence(item.event,item.member.username) };
  const { session } = item;
  const counts = buildCompetitionSession(session);
  return { kind: 'session',key: item.key,groupId: item.groups[0].group_id,
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
  : `${formatMetricFigure('e1rm',value.value)} ${COMPETITION_UNIT_LABELS[value.unit as keyof typeof COMPETITION_UNIT_LABELS] ?? value.unit}`;
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
