import { isCompetitionBoardWire,isCompetitionRulesWire } from './competition-wire-guards';
import { isCompetitionExerciseListWire, isCompetitionPodiumsWire, isCompetitionHistoryWire,isCompetitionRevisionsWire,isCompetitionSessionDetailWire,
  isCompetitionStreamWire,isCompetitionWeekSummaryWire } from './competition-reader-guards';
import type { CompetitionExerciseWire, CompetitionRulesWire, CompetitionSessionWire } from './competition-wire';

type ExercisePolicy = { id: string; rules: CompetitionRulesWire; archived: boolean };
type SessionDisclosure = { member_id: string; session_id: string; exercise_id: string; visibility: 'normalized' | 'ordinary' };
export type ObservedCompetitionPolicy = { contract_version: 4; enabled: boolean | null;
  exercises: ExercisePolicy[]; sessions: SessionDisclosure[]; absolute_projection_seen: boolean };
export type CompetitionPolicyObservation = { groupId: string; enabled?: boolean;
  exercises?: ExercisePolicy[]; sessions?: SessionDisclosure[]; absolute_projection_seen?: boolean };
const exact = (v: unknown,keys: string[]): v is Record<string,unknown> => v !== null && typeof v === 'object' &&
  !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const id = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const exercisePolicy = (v: unknown) => exact(v,['id','rules','archived']) && id(v.id) &&
  isCompetitionRulesWire(v.rules) && typeof v.archived === 'boolean';
const sessionDisclosure = (v: unknown) => exact(v,['member_id','session_id','exercise_id','visibility']) &&
  id(v.member_id) && id(v.session_id) && id(v.exercise_id) && (v.visibility === 'normalized' || v.visibility === 'ordinary');
export const isObservedCompetitionPolicy = (v: unknown): v is ObservedCompetitionPolicy =>
  exact(v,['contract_version','enabled','exercises','sessions','absolute_projection_seen']) && v.contract_version === 4 &&
  (v.enabled === null || typeof v.enabled === 'boolean') && Array.isArray(v.exercises) && v.exercises.every(exercisePolicy) &&
  Array.isArray(v.sessions) && v.sessions.every(sessionDisclosure) && typeof v.absolute_projection_seen==='boolean';
export const emptyCompetitionPolicy = (): ObservedCompetitionPolicy => ({ contract_version: 4,enabled: null,exercises: [],sessions: [],absolute_projection_seen: false });
const publicExercise = (exercise: CompetitionExerciseWire): ExercisePolicy => ({ id: exercise.group_exercise_id,
  rules: exercise.rules,archived: exercise.archived_at_ms !== null });
const publicSession = (session: CompetitionSessionWire): SessionDisclosure[] => session.exercises.map(exercise => ({
  member_id: session.member.user_id,session_id: session.session_id,exercise_id: exercise.session_exercise_id,visibility: exercise.visibility }));

function catalogueObservation(groupId: string,exercises: CompetitionExerciseWire[]): CompetitionPolicyObservation {
  const enabled=new Set(exercises.filter(exercise=>exercise.rules.bodyweight_contribution>0).map(exercise=>exercise.rules.bodyweight_calculations_enabled));
  return { groupId,enabled: enabled.size===1?[...enabled][0]:undefined,exercises: exercises.map(publicExercise) };
}

/** Current public context only. An event's historic rules are never a current policy observation. */
function currentPolicyObservations(key: string,value: unknown): CompetitionPolicyObservation[] {
  const groupId = key.split(':')[2];
  if (isCompetitionBoardWire(value)) return [{ groupId,enabled: value.rules.bodyweight_contribution>0?value.rules.bodyweight_calculations_enabled:undefined,exercises: [{ id: value.group_exercise_id,
    rules: value.rules,archived: value.state === 'archived' }] }];
  if (isCompetitionHistoryWire(value) || isCompetitionRevisionsWire(value)) return [catalogueObservation(groupId,[value.exercise])];
  if (isCompetitionExerciseListWire(value)) return [catalogueObservation(groupId,value.exercises)];
  if (isCompetitionPodiumsWire(value)) return [catalogueObservation(groupId,value.podiums.map(row=>row.exercise))];
  if (isCompetitionSessionDetailWire(value)) return [{ groupId: value.group_id,sessions: publicSession(value.session) }];
  if (isCompetitionStreamWire(value)) return value.items.flatMap<CompetitionPolicyObservation>(item => {
    if (item.kind === 'session') return item.groups.map(group => ({ groupId: group.group_id,sessions: publicSession(item.session) }));
    if (item.kind === 'competition') return item.event.record_context
      ?[catalogueObservation(item.event.group.group_id,[item.event.record_context.exercise])]:[{ groupId: item.event.group.group_id }];
    return [];
  });
  if (isCompetitionWeekSummaryWire(value)) return [{ groupId: value.group_id }];
  if (!value || typeof value !== 'object') return [];
  if ('summary' in value && isCompetitionWeekSummaryWire(value.summary)) return [{ groupId: value.summary.group_id }];
  const record = value as { groups?: { group_id: string; bodyweight_calculations_enabled: boolean }[];
    group?: { group_id: string; bodyweight_calculations_enabled: boolean } };
  const groups = record.groups ?? (record.group ? [record.group] : []);
  return groups.map(group => ({ groupId: group.group_id,enabled: group.bodyweight_calculations_enabled }));
}
/** Closed public projections only: no reading or dependency context is retained.
 * The flag is sticky until retirement because other mounted views may keep it. */
export function competitionPolicyObservations(key: string,value: unknown): CompetitionPolicyObservation[] {
  const absolute=hasAbsoluteProjection(value);
  return currentPolicyObservations(key,value).map(observation=>({ ...observation,absolute_projection_seen: absolute }));
}
function hasAbsoluteProjection(value: unknown): boolean {
  if (!value || typeof value!=='object') return false;
  if (Array.isArray(value)) return value.some(hasAbsoluteProjection);
  const row=value as Record<string,unknown>;
  if (Object.hasOwn(row,'weight_value') && row.weight_value!==null ||
    (row.unit==='kg' || row.unit==='kg_reps') && typeof row.value==='number') return true;
  return Object.values(row).some(hasAbsoluteProjection);
}
const sessionKey = (row: SessionDisclosure) => JSON.stringify([row.member_id,row.session_id,row.exercise_id]);
const rulesKey = (row: ExercisePolicy) => JSON.stringify([row.rules.rules_revision,row.rules.load_input_mode,
  row.rules.bodyweight_calculations_enabled,row.rules.bodyweight_contribution,row.archived]);
/** Unknown newly enabled standards retire projections whose compatibility cannot be proven. */
export function applyCompetitionPolicy(previous: ObservedCompetitionPolicy,observation: CompetitionPolicyObservation,hasProjections: boolean) {
  let changed = observation.enabled !== undefined && observation.enabled !== previous.enabled &&
    (previous.enabled !== null || hasProjections && (observation.enabled || previous.exercises.some(row=>row.rules.bodyweight_calculations_enabled) || previous.sessions.some(row=>row.visibility==='normalized')));
  const exercises = new Map(previous.exercises.map(row => [row.id,row]));
  for (const row of observation.exercises ?? []) {
    const before = exercises.get(row.id);
    changed ||= before ? rulesKey(before) !== rulesKey(row) : hasProjections &&
      row.rules.bodyweight_calculations_enabled && row.rules.bodyweight_contribution > 0;
    exercises.set(row.id,row);
  }
  const sessions = new Map(previous.sessions.map(row => [sessionKey(row),row]));
  for (const row of observation.sessions ?? []) {
    const before = sessions.get(sessionKey(row));
    changed ||= before ? before.visibility !== row.visibility : row.visibility === 'normalized' && previous.absolute_projection_seen;
    sessions.set(sessionKey(row),row);
  }
  return { changed,policy: { contract_version: 4 as const,enabled: observation.enabled ?? previous.enabled,
    exercises: [...exercises.values()],sessions: [...sessions.values()],absolute_projection_seen:
      observation.absolute_projection_seen===true || !changed && previous.absolute_projection_seen } };
}

/** A persisted stamp takes precedence over retained projection rows. */
export function bootstrapCompetitionPolicy(previous: ObservedCompetitionPolicy,observation: CompetitionPolicyObservation) {
  const knownExercises=new Set(previous.exercises.map(row => row.id));
  const knownSessions=new Set(previous.sessions.map(sessionKey));
  const policy=applyCompetitionPolicy(previous,{ ...observation,
    enabled: previous.enabled === null ? observation.enabled : undefined,
    exercises: observation.exercises?.filter(row => !knownExercises.has(row.id)),
    sessions: observation.sessions?.filter(row => !knownSessions.has(sessionKey(row))),
  },false).policy;
  return { ...policy,absolute_projection_seen: previous.absolute_projection_seen || observation.absolute_projection_seen===true };
}
