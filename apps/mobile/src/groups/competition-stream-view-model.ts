import { formatBoardDate } from './board-view-model';
import { buildCompetitionSession } from './competition-session-view-model';
import { describeCompetitionEvent, formatCompetitionHistoricalValue } from './competition-view-model';
import type { CompetitionEventWire, CompetitionStreamItemWire,CompetitionHistoryValueWire,CompetitionCertificationWire } from './competition-wire';
import { formatMemberName, formatMembershipSentence, formatSessionStatusLabel, formatSetCount,
  formatExerciseCount, formatStreamStartedAt, type StreamMembershipViewModel } from './stream-view-model';

export type CompetitionSessionCard = {
  kind: 'session'; key: string; groupId: string; memberUserId: string; sessionId: string;
  memberName: string; isTrainingNow: boolean; statusLabel: string; startedAtLabel: string;
  gymName: string | null; groupNames: string[]; setsLabel: string; exercisesLabel: string;
};
export type CompetitionStreamModel = CompetitionSessionCard | StreamMembershipViewModel |
  { kind: 'competition'; key: string; event: CompetitionEventWire };

/** Counts come only from permitted set context; absolute totals are never reconstructed. */
export function buildCompetitionStreamItem(item: CompetitionStreamItemWire): CompetitionStreamModel {
  if (item.kind === 'competition') return { kind: item.kind,key: item.key,event: item.event };
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

export function buildCompetitionEventCard(event: CompetitionEventWire,userId: string | null,showGroup: boolean) {
  const name = event.member?.user_id === userId ? 'You' : formatMemberName(event.member?.username);
  const ended = event.voided || event.kind === 'record_voided';
  const label = ended ? 'Certification ended' : event.kind === 'record' ? `${name} · record`
    : event.kind === 'rules_change' ? 'Group rules changed' : 'Leaderboard changed';
  const values = ended ? [] : event.values.filter(value => value.role === 'record' || value.role === 'leader');
  const details = ended ? ['Score unavailable'] : values.length
    ? values.map(value => formatCompetitionHistoricalValue(value)) : [describeCompetitionEvent(event)];
  if (!ended && event.kind === 'record') details.push(...recordDetails(event,values,userId));
  const context = `${event.group_exercise.name} · Rules ${event.rules_revision}`;
  const date = formatBoardDate(event.sort_at_ms);
  const groupName = showGroup ? event.group.name : null;
  return { label,context,details,groupName,date,
    accessibilityLabel: [groupName,label,context,...details,date].filter(Boolean).join(', '),
    historyPath: `/group/${event.group.group_id}/leaderboards/${event.group_exercise.group_exercise_id}/history?metric=${event.metric ?? 'e1rm'}&scope=all&revision=${event.rules_revision}` as const };
}

function recordDetails(event: CompetitionEventWire,values: CompetitionHistoryValueWire[],userId: string | null): string[] {
  const details=event.reps===null?[]:[`As logged: ${event.reps} reps`];
  for(const value of values){
    const current=event.record_context?.metrics.find(item=>item.metric===value.metric);
    details.push(current ? certificationLabel(current.certification,userId) : 'Refresh to check certification');
  }
  if(event.provisional) details.push('Session in progress');
  return details;
}
function certificationLabel(certificate: CompetitionCertificationWire | null,userId: string | null): string {
  if(!certificate) return 'Uncertified';
  if(certificate.ended_at_ms!==null) return 'Certification ended';
  const witness=certificate.certified_by?.user_id===userId?'you':certificate.certified_by?.username??'a group member';
  return `Certified by ${witness}`;
}
