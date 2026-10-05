import { isObservedCompetitionPolicy } from './competition-cache-policy';
import { isCompetitionExerciseListWire, isCompetitionPodiumsWire, isCompetitionSessionDetailWire,
  isCompetitionStreamWire, isCompetitionWeekSummaryWire } from './competition-reader-guards';

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
  if (version !== 'v5') return false;
  if (kind === 'groups') return scope.join(':') === 'mine' && exact(value,['groups']) &&
    Array.isArray(value.groups) && value.groups.every(summary);
  const groupId = scope[0];
  if (!groupId) return false;
  if (kind === 'group-policy') return isObservedCompetitionPolicy(value);
  if (kind === 'group') return exact(value,['group','members']) && summary(value.group) && record(value.group) &&
    value.group.group_id === groupId && Array.isArray(value.members) && value.members.every(member);
  if (kind === 'group-exercises') return isCompetitionExerciseListWire(value);
  if (kind === 'boards') return isCompetitionPodiumsWire(value);
  if (kind === 'week') return exact(value,['windowStartMs','summary']) &&
    Number.isSafeInteger(value.windowStartMs) && isCompetitionWeekSummaryWire(value.summary) && value.summary.group_id === groupId;
  if (kind === 'session') return isCompetitionSessionDetailWire(value) && value.group_id === groupId &&
    value.session.member.user_id === scope[1] && value.session.session_id === scope.slice(2).join(':');
  if (kind === 'stream') return isCompetitionStreamWire(value) && value.items.every(item => item.kind === 'session'
    ? item.groups.every(group => group.group_id === groupId)
    : (item.kind === 'competition' ? item.event.group.group_id : item.group.group_id) === groupId);
  return false;
}
