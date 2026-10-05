import type { CompetitionBoardRowWire, CompetitionBoardWire, CompetitionCertificationWire, CompetitionExerciseWire,
  CompetitionEventWire,CompetitionSessionDetailWire, CompetitionStreamWire, CompetitionWeekSummaryWire } from '@/src/groups/competition-wire';
import type { GroupGetResult, GroupSummary } from '@/src/groups/types';

export const competitionGroup: GroupSummary = { group_id: 'g1',name: 'Crew',description: null,member_count: 2,
  my_role: 'member',bodyweight_calculations_enabled: true };
export const competitionGroupDetail: GroupGetResult = { group: competitionGroup,members: [
  { user_id: 'me',username: 'Me',role: 'member' },{ user_id: 'other',username: 'Friend',role: 'owner' }] };
export const competitionExercise: CompetitionExerciseWire = { group_exercise_id: 'ge1',name: 'Pull-up',source_exercise_id: null,
  archived_at_ms: null,published_revision: 2,rebuilding: false,rules: { bodyweight_calculations_enabled: true,
    bodyweight_contribution: 1,load_input_mode: 'total_load',default_metric: 'e1rm',rules_revision: 2 } };
export const competitionCertification: CompetitionCertificationWire = { certification_id: 'cert',metric: 'e1rm',
  certified_by: { user_id: 'me',username: 'Me' },certified_at_ms: 1_000,observed_rules_revision: 1,ended_at_ms: null,end_reason: null };
export const competitionRow: CompetitionBoardRowWire = { metric: 'e1rm',value: 145.7281316,unit: 'percent_bw',rank: 1,
  member: { user_id: 'other',username: 'Friend' },former: false,write_token: 'server-random-token',certification: null,
  performance: { visibility: 'normalized',session_id: 's1',session_exercise_id: 'se1',exercise_definition_id: 'ed1',
    set_id: 'set1',reps: 5,performance_status: null,source_load_input_mode: 'total_load',achieved_at_ms: 2_000,
    exercise_order_index: 0,set_order_index: 0 } };
export const competitionBoard: CompetitionBoardWire = { contract_version: 4,group_exercise_id: 'ge1',rules: competitionExercise.rules,
  metric: 'e1rm',certified: false,state: 'ready',entries: [competitionRow],entry_count: 1,me: null,next_cursor: null };
export const competitionSession: CompetitionSessionDetailWire = { contract_version: 4,group_id: 'g1',session: {
  member: competitionRow.member,session_id: 's1',gym_name: 'Gym',status: 'completed',started_at_ms: 2_000,
  completed_at_ms: 2_602_000,duration_sec: 2_600,exercises: [{ session_exercise_id: 'se1',exercise_definition_id: 'ed1',
    load_input_mode: 'total_load',name: 'Pull-up',machine_name: null,order_index: 0,visibility: 'normalized',
    sets: [{ set_id: 'set1',order_index: 0,reps_value: '5',set_type: null,performance_status: null }] }] } };
export const competitionStream: CompetitionStreamWire = { contract_version: 4,items: [{ kind: 'session',key: 'other:s1',sort_at_ms: 2_000,
  groups: [{ group_id: 'g1',name: 'Crew' }],session: competitionSession.session }],next_cursor: null,has_more: false };
export const competitionWeek: CompetitionWeekSummaryWire = { contract_version: 4,group_id: 'g1',members: [],training_now: [],latest_completed: null };

/** Closed public fixture for each disposable cache boundary. */
export function competitionCacheFixture(key: string,label = 'Crew') {
  if (key.startsWith('groups:')) return { groups: [{ ...competitionGroup,name: label }] };
  if (key.startsWith('group-exercises:')) return { contract_version: 4,exercises: [competitionExercise] };
  if (key.startsWith('group:')) return { ...competitionGroupDetail,group: { ...competitionGroup,group_id: key.split(':')[2],name: label } };
  if (key.startsWith('stream:')) return { ...competitionStream,items: [],next_cursor: null,has_more: false };
  if (key.startsWith('session:')) return { ...competitionSession,group_id: key.split(':')[2],session: { ...competitionSession.session,
    member: { ...competitionSession.session.member,user_id: key.split(':')[3] },session_id: key.split(':')[4] } };
  if (key.startsWith('week:')) return { windowStartMs: 0,summary: { ...competitionWeek,group_id: key.split(':')[2] } };
  return { contract_version: 4,certified: true,podiums: [] };
}

export const competitionEvent: CompetitionEventWire = {
  event_id: 'event1',sequence: 1,kind: 'record',group: { group_id: 'g1',name: 'Crew' },
  group_exercise: { group_exercise_id: 'ge1',name: 'Pull-up' },rules_revision: 2,representation_version: 4,
  visibility: 'normalized',sort_at_ms: 2000,member: competitionRow.member,metric: 'e1rm',certified: false,
  reason: null,related_event_id: null,session_id: 's1',set_id: 'set1',reps: 5,provisional: false,voided: false,
  values: [{ role: 'record',metric: 'e1rm',unit: 'percent_bw',value: competitionRow.value,unavailable: false,member: competitionRow.member }],
  record_context: { exercise: competitionExercise,former: false,
    metrics: [{ metric: 'e1rm',write_token: competitionRow.write_token,eligible: true,certification: null }] },
};
