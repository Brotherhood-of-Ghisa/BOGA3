import { isObservedCompetitionPolicy } from './competition-cache-policy';
import { coWSummaryCacheKey, isCoWSummaryWire } from './cow-wire';
import { isCompetitionExerciseListWire, isCompetitionPodiumsWire, isCompetitionSessionDetailWire,
  isCompetitionPeriodTotalsWire, isCompetitionStreamWire, isCompetitionWeekSummaryWire, isGroupSharedExercisesListWire } from './competition-reader-guards';

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) &&
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const id = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const role = (v: unknown) => v === 'owner' || v === 'admin' || v === 'member';
const member = (v: unknown) => exact(v,['user_id','username','role']) && id(v.user_id) &&
  (v.username === null || typeof v.username === 'string') && role(v.role);
const summary = (v: unknown) => exact(v,['group_id','name','description','member_count','my_role','bodyweight_calculations_enabled']) &&
  id(v.group_id) && typeof v.name === 'string' && (v.description === null || typeof v.description === 'string') &&
  typeof v.member_count === 'number' && Number.isSafeInteger(v.member_count) && v.member_count >= 0 && role(v.my_role) &&
  typeof v.bodyweight_calculations_enabled === 'boolean';

/** Disk data crosses the same closed public boundary as an RPC response. */
export function isCompetitionCachePayload(key: string, value: unknown): boolean {
  const [kind,version,...scope] = key.split(':');
  if (version !== 'v7') return false;
  if (kind === 'groups') return scope.join(':') === 'mine' && exact(value,['groups']) &&
    Array.isArray(value.groups) && value.groups.every(summary);
  const groupId = scope[0];
  if (!groupId) return false;
  if (kind === 'cow-summary') return isCoWSummaryWire(value) && value.group_id === groupId && key === coWSummaryCacheKey(value);
  if (kind === 'group-policy') return isObservedCompetitionPolicy(value);
  if (kind === 'group') return exact(value,['group','members']) && summary(value.group) && record(value.group) &&
    value.group.group_id === groupId && Array.isArray(value.members) && value.members.every(member);
  if (kind === 'group-exercises') return isCompetitionExerciseListWire(value);
  if (kind === 'shared-exercises') return isGroupSharedExercisesListWire(value) && value.group_id === groupId;
  if (kind === 'boards') return scope[1] === 'all' && scope.length === 2 && isCompetitionPodiumsWire(value) && !value.certified;
  if (kind === 'week') return exact(value,['windowStartMs','summary']) &&
    Number.isSafeInteger(value.windowStartMs) && isCompetitionWeekSummaryWire(value.summary) && value.summary.group_id === groupId;
  if (kind === 'glance') return scope[1] === 'week' && /^(0|-[1-9][0-9]*)$/.test(scope[2] ?? '') &&
    scope.length === 3 && isCompetitionPeriodTotalsWire(value) && value.group_id === groupId;
  if (kind === 'session') return isCompetitionSessionDetailWire(value) && value.group_id === groupId &&
    value.session.member.user_id === scope[1] && value.session.session_id === scope.slice(2).join(':');
  if (kind === 'stream') return scope.length === 2 && scope[1] === 'cow-events-v1' && isCompetitionStreamWire(value) && value.items.every(item => item.kind === 'session'
    ? item.groups.every(group => group.group_id === groupId)
    : item.kind === 'cow' ? item.definition.group_id === groupId
    : item.kind === 'shared_exercise' ? item.group_id === groupId
    : (item.kind === 'competition' ? item.event.group.group_id : item.group.group_id) === groupId);
  return false;
}
