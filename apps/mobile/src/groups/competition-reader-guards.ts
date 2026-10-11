// Exact schemas are a privacy boundary, including every nested history/session.
import { isCompetitionMetric } from './competition-contract.ts';
import { isCompetitionBoardWire, isCompetitionCertificationWire, isCompetitionPerformanceWire, isCompetitionRulesWire } from './competition-wire-guards.ts';
import type { CompetitionCertifyResultWire, CompetitionCertificationResultWire, CompetitionEventWire,
  CompetitionExerciseListWire, CompetitionExerciseWire, CompetitionExerciseWriteWire, CompetitionHistoryWire,
  CompetitionPodiumsWire, CompetitionRevisionWire, CompetitionRevisionsWire, CompetitionSessionDetailWire,
  CompetitionSessionRecordsWire, CompetitionSessionWire, CompetitionStreamWire, CompetitionWeekSummaryWire } from './competition-wire.ts';

const exact = (v: unknown, fields: readonly string[]): v is Record<string, unknown> => v !== null && typeof v === 'object' &&
  !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(f => Object.prototype.hasOwnProperty.call(v,f));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const positive = (v: unknown): v is number => integer(v) && v > 0;
const count = (v: unknown) => integer(v) && v >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const text = (v: unknown) => typeof v === 'string';
const nullableText = (v: unknown) => v === null || text(v);
const nullableInteger = (v: unknown) => v === null || integer(v);
const member = (v: unknown) => exact(v,['user_id','username']) && id(v.user_id) && nullableText(v.username);
const group = (v: unknown) => exact(v,['group_id','name']) && id(v.group_id) && id(v.name);
const mode = (v: unknown) => v === 'total_load' || v === 'per_side_load';
const arrayOf = (v: unknown, guard: (entry: unknown) => boolean) => Array.isArray(v) && v.every(guard);
const historicalMetric = (v: unknown) => ['weight','volume','e1rm','bodyweight_reps','relative_strength','absolute_strength'].includes(String(v));
const nullableCertification = (v: unknown) => v === null || isCompetitionCertificationWire(v);

export function isCompetitionExerciseWire(v: unknown): v is CompetitionExerciseWire {
  return exact(v,['group_exercise_id','name','source_exercise_id','archived_at_ms','rules','published_revision','rebuilding']) &&
    id(v.group_exercise_id) && id(v.name) && nullableText(v.source_exercise_id) && nullableInteger(v.archived_at_ms) &&
    isCompetitionRulesWire(v.rules) && (v.published_revision === null || positive(v.published_revision) && v.published_revision <= v.rules.rules_revision) &&
    typeof v.rebuilding === 'boolean' && v.rebuilding === (v.archived_at_ms === null && v.published_revision !== v.rules.rules_revision);
}
export function isCompetitionExerciseListWire(v: unknown): v is CompetitionExerciseListWire {
  return exact(v,['contract_version','exercises']) && v.contract_version === 4 && arrayOf(v.exercises,isCompetitionExerciseWire);
}
export function isCompetitionExerciseWriteWire(v: unknown): v is CompetitionExerciseWriteWire {
  return exact(v,['contract_version','exercise']) && v.contract_version === 4 && isCompetitionExerciseWire(v.exercise);
}
export function isCompetitionCertificationResultWire(v: unknown): v is CompetitionCertificationResultWire {
  return exact(v,['contract_version','certification']) && v.contract_version === 4 && isCompetitionCertificationWire(v.certification);
}
export function isCompetitionCertifyResultWire(v: unknown): v is CompetitionCertifyResultWire {
  return exact(v,['contract_version','certification','created']) && v.contract_version === 4 &&
    isCompetitionCertificationWire(v.certification) && typeof v.created === 'boolean';
}
export function isCompetitionPodiumsWire(v: unknown): v is CompetitionPodiumsWire {
  return exact(v,['contract_version','certified','podiums']) && v.contract_version === 4 && typeof v.certified === 'boolean' &&
    arrayOf(v.podiums,p => {
      if (!exact(p,['exercise','board']) || !isCompetitionExerciseWire(p.exercise) || !isCompetitionBoardWire(p.board)) return false;
      const board = p.board, exercise = p.exercise;
      return board.group_exercise_id === exercise.group_exercise_id && board.metric === exercise.rules.default_metric && board.certified === v.certified &&
        Object.keys(exercise.rules).every(key => board.rules[key as keyof typeof board.rules] === exercise.rules[key as keyof typeof exercise.rules]);
    });
}
export function isCompetitionRevisionWire(v: unknown): v is CompetitionRevisionWire {
  if (!exact(v,['rules_revision','representation_version','rules','reason','legacy','published_at_ms','retired_at_ms']) ||
    !positive(v.rules_revision) || !(v.representation_version === 3 || v.representation_version === 4) || typeof v.legacy !== 'boolean' ||
    !['initial','activation','rules_change'].includes(String(v.reason)) || !nullableInteger(v.published_at_ms) || !nullableInteger(v.retired_at_ms)) return false;
  return exact(v.rules,['load_input_mode','bodyweight_calculations_enabled','bodyweight_contribution','default_metric']) &&
    mode(v.rules.load_input_mode) && typeof v.rules.bodyweight_calculations_enabled === 'boolean' &&
    typeof v.rules.bodyweight_contribution === 'number' && v.rules.bodyweight_contribution >= 0 && v.rules.bodyweight_contribution <= 1 &&
    historicalMetric(v.rules.default_metric) && (v.representation_version !== 4 || isCompetitionMetric(v.rules.default_metric));
}
function historyValue(v: unknown, normalized: boolean): boolean {
  if (!exact(v,['role','metric','unit','value','unavailable','member']) ||
    !['record','leader','previous','before','after'].includes(String(v.role)) || !historicalMetric(v.metric) || !id(v.unit) ||
    typeof v.unavailable !== 'boolean' || !(v.member === null || member(v.member))) return false;
  return v.unavailable ? v.value === null : typeof v.value === 'number' && Number.isFinite(v.value) && v.value > 0 &&
    (normalized ? ['percent_bw','percent_bw_reps'] : ['kg','kg_reps','percent_bw','percent_bw_reps']).includes(v.unit);
}
function recordContext(v: unknown): boolean {
  return v === null || exact(v,['exercise','former','metrics']) && isCompetitionExerciseWire(v.exercise) && typeof v.former === 'boolean' &&
    arrayOf(v.metrics,m => exact(m,['metric','write_token','eligible','certification']) && isCompetitionMetric(m.metric) &&
      id(m.write_token) && typeof m.eligible === 'boolean' && nullableCertification(m.certification) &&
      (m.certification === null || m.certification.metric === m.metric));
}
const EVENT_FIELDS = ['event_id','sequence','kind','group','group_exercise','rules_revision','representation_version','sort_at_ms',
  'visibility','member','metric','certified','reason','related_event_id','session_id','set_id','reps','provisional','voided','values','record_context'];
function eventIdentity(v: Record<string, unknown>): boolean {
  return id(v.event_id) && positive(v.sequence) && ['record','record_voided','lead_change','link','unlink','rules_change'].includes(String(v.kind)) &&
    group(v.group) && exact(v.group_exercise,['group_exercise_id','name']) && id(v.group_exercise.group_exercise_id) && id(v.group_exercise.name) &&
    positive(v.rules_revision) && (v.representation_version === 1 || v.representation_version === 3 || v.representation_version === 4) && integer(v.sort_at_ms);
}
export function isCompetitionEventWire(v: unknown): v is CompetitionEventWire {
  return exact(v,EVENT_FIELDS) && eventIdentity(v) && (v.member === null || member(v.member)) &&
    (v.metric === null || historicalMetric(v.metric)) && (v.certified === null || typeof v.certified === 'boolean') &&
    ['reason','related_event_id','session_id','set_id'].every(f => nullableText(v[f])) && (v.reps === null || positive(v.reps)) &&
    typeof v.provisional === 'boolean' && typeof v.voided === 'boolean' && ['normalized','ordinary'].includes(String(v.visibility)) &&
    arrayOf(v.values,x => historyValue(x,v.visibility === 'normalized')) && recordContext(v.record_context);
}
export function isCompetitionRevisionsWire(v: unknown): v is CompetitionRevisionsWire {
  return exact(v,['contract_version','exercise','revisions']) && v.contract_version === 4 && isCompetitionExerciseWire(v.exercise) &&
    arrayOf(v.revisions,isCompetitionRevisionWire);
}
export function isCompetitionHistoryWire(v: unknown): v is CompetitionHistoryWire {
  if (!exact(v,['contract_version','exercise','revision','metric','certified','events','next_cursor']) || v.contract_version !== 4 ||
    !isCompetitionExerciseWire(v.exercise) || !isCompetitionRevisionWire(v.revision)) return false;
  const exercise = v.exercise, revision = v.revision;
  return historicalMetric(v.metric) && typeof v.certified === 'boolean' && arrayOf(v.events,e => isCompetitionEventWire(e) &&
    e.group_exercise.group_exercise_id === exercise.group_exercise_id && e.rules_revision === revision.rules_revision) && nullableText(v.next_cursor);
}
function sessionSet(v: unknown, normalized: boolean): boolean {
  const fields = ['set_id','order_index','reps_value','set_type','performance_status'];
  return exact(v,normalized ? fields : [...fields,'weight_value']) && id(v.set_id) && count(v.order_index) && text(v.reps_value) &&
    nullableText(v.set_type) && nullableText(v.performance_status) && (normalized || text(v.weight_value));
}
function sessionExercise(v: unknown): boolean {
  return exact(v,['session_exercise_id','exercise_definition_id','load_input_mode','name','machine_name','order_index','visibility','sets']) &&
    id(v.session_exercise_id) && (v.exercise_definition_id === null || id(v.exercise_definition_id)) &&
    (v.load_input_mode === null || mode(v.load_input_mode)) && id(v.name) && nullableText(v.machine_name) &&
    count(v.order_index) && ['ordinary','normalized'].includes(String(v.visibility)) && arrayOf(v.sets,s => sessionSet(s,v.visibility === 'normalized'));
}
export function isCompetitionSessionWire(v: unknown): v is CompetitionSessionWire {
  return exact(v,['member','session_id','gym_name','status','started_at_ms','completed_at_ms','duration_sec','exercises']) &&
    member(v.member) && id(v.session_id) && nullableText(v.gym_name) && ['draft','active','completed'].includes(String(v.status)) &&
    integer(v.started_at_ms) && nullableInteger(v.completed_at_ms) && (v.duration_sec === null || count(v.duration_sec)) && arrayOf(v.exercises,sessionExercise);
}
export function isCompetitionSessionDetailWire(v: unknown): v is CompetitionSessionDetailWire {
  return exact(v,['contract_version','group_id','session']) && v.contract_version === 4 && id(v.group_id) && isCompetitionSessionWire(v.session);
}
// A board's leader comes only from a current Volume/1RM board; `leads` means that leader's set is this record's.
function sessionRecordBoard(v: unknown, memberId: string): boolean {
  if (!exact(v,['metric','leader','leads']) || !historicalMetric(v.metric) || typeof v.leads !== 'boolean') return false;
  if (v.leader === null) return !v.leads;
  return member(v.leader) && isCompetitionMetric(v.metric) && (!v.leads || (v.leader as { user_id: string }).user_id === memberId);
}
function sessionRecord(v: unknown, memberId: string, sessionId: string): boolean {
  if (!exact(v,['event','boards']) || !isCompetitionEventWire(v.event) || !Array.isArray(v.boards) || v.boards.length === 0 ||
    !v.boards.every(board => sessionRecordBoard(board,memberId))) return false;
  const event = v.event, metrics = v.boards.map(board => (board as { metric: string }).metric);
  const recordMetrics = event.values.filter(value => value.role === 'record').map(value => value.metric);
  return event.kind === 'record' && !event.voided && event.member?.user_id === memberId && event.session_id === sessionId && event.set_id !== null &&
    new Set(metrics).size === metrics.length && recordMetrics.every(metric => metrics.includes(metric));
}
export function isCompetitionSessionRecordsWire(v: unknown): v is CompetitionSessionRecordsWire {
  return exact(v,['contract_version','group_id','member_user_id','session_id','records']) && v.contract_version === 4 &&
    id(v.group_id) && id(v.member_user_id) && id(v.session_id) &&
    arrayOf(v.records,r => sessionRecord(r,v.member_user_id as string,v.session_id as string) &&
      (r as { event: CompetitionEventWire }).event.group.group_id === v.group_id);
}
const performedSet = (v: unknown) => v === null ||
  (typeof v === 'object' && isCompetitionPerformanceWire(v,(v as { visibility?: unknown }).visibility === 'normalized'));
// A record's set follows the record's own visibility. A previous holder's may
// be stricter, never looser: a normalized record discloses no holder's kg.
function streamRecord(v: unknown, event: CompetitionEventWire): boolean {
  const normalized = event.visibility === 'normalized';
  const visibility = (set: unknown) => (set as { visibility: string }).visibility;
  return exact(v,['performance','previous']) && event.kind === 'record' && performedSet(v.performance) &&
    (v.performance === null || visibility(v.performance) === event.visibility) &&
    arrayOf(v.previous,p => exact(p,['value','performance']) && performedSet(p.performance) &&
      (p.value as { role?: unknown }).role === 'previous' &&
      historyValue(p.value,normalized || (p.performance !== null && visibility(p.performance) === 'normalized')) &&
      (!normalized || p.performance === null || visibility(p.performance) === 'normalized'));
}
function streamItem(v: unknown): boolean {
  if (exact(v,['kind','key','sort_at_ms','event']) && v.kind === 'competition') return id(v.key) && integer(v.sort_at_ms) &&
    isCompetitionEventWire(v.event) && v.event.event_id === v.key;
  if (exact(v,['kind','key','sort_at_ms','event','record']) && v.kind === 'competition') return id(v.key) && integer(v.sort_at_ms) &&
    isCompetitionEventWire(v.event) && v.event.event_id === v.key && streamRecord(v.record,v.event);
  if (exact(v,['kind','key','sort_at_ms','groups','session']) && v.kind === 'session') return id(v.key) && integer(v.sort_at_ms) &&
    Array.isArray(v.groups) && v.groups.length > 0 && v.groups.every(group) && isCompetitionSessionWire(v.session);
  return exact(v,['kind','key','sort_at_ms','event','group','member']) && v.kind === 'membership' && id(v.key) && integer(v.sort_at_ms) &&
    ['joined','left','removed'].includes(String(v.event)) && group(v.group) && member(v.member);
}
export function isCompetitionStreamWire(v: unknown): v is CompetitionStreamWire {
  return exact(v,['contract_version','items','has_more','next_cursor']) && v.contract_version === 4 && arrayOf(v.items,streamItem) &&
    typeof v.has_more === 'boolean' && (v.has_more ? id(v.next_cursor) : v.next_cursor === null);
}
function weekMember(v: unknown): boolean {
  return exact(v,['rank','member','working_sets','group_records']) && positive(v.rank) && member(v.member) && count(v.working_sets) && count(v.group_records);
}
function training(v: unknown): boolean {
  return exact(v,['member','session_id','started_at_ms','gym_name','working_sets','exercise_count']) && member(v.member) && id(v.session_id) &&
    integer(v.started_at_ms) && nullableText(v.gym_name) && count(v.working_sets) && count(v.exercise_count);
}
function latest(v: unknown): boolean {
  return v === null || exact(v,['member','session_id','started_at_ms','completed_at_ms','duration_sec','gym_name','working_sets','exercise_count','group_records']) &&
    member(v.member) && id(v.session_id) && integer(v.started_at_ms) && nullableInteger(v.completed_at_ms) &&
    (v.duration_sec === null || count(v.duration_sec)) && nullableText(v.gym_name) && count(v.working_sets) && count(v.exercise_count) && arrayOf(v.group_records,isCompetitionEventWire);
}
export function isCompetitionWeekSummaryWire(v: unknown): v is CompetitionWeekSummaryWire {
  return exact(v,['contract_version','group_id','members','training_now','latest_completed']) && v.contract_version === 4 && id(v.group_id) &&
    arrayOf(v.members,weekMember) && arrayOf(v.training_now,training) && latest(v.latest_completed);
}
