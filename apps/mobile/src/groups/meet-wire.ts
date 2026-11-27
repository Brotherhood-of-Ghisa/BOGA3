import type { GroupMemberRef, GroupRole } from './types.ts';

export type MeetMetric = 'e1rm' | 'weight' | 'reps' | 'volume' | 'seconds';
export type MeetState = 'scheduled' | 'live' | 'finalizing' | 'final' | 'cancelled';
export type MeetWire = {
  meet_id: string; group_id: string; title: string | null; starts_at_ms: number; ends_at_ms: number;
  cutoff_at_ms: number; time_zone: string | null; venue_name: string; address: string | null;
  latitude: number | null; longitude: number | null; entry_note: string | null; version: number;
  state: MeetState; created_by: GroupMemberRef | null; created_at_ms: number;
  cancelled_at_ms: number | null; cancelled_by: GroupMemberRef | null;
};
export type MeetChallengeWire = { challenge_id: string; meet_id: string; group_exercise_id: string;
  exercise_name: string; exercise_archived: boolean; metric: MeetMetric; version: number;
  author: GroupMemberRef | null; created_at_ms: number };
export type MeetWriteWire = { meet: MeetWire };
export type MeetDetailWire = MeetWriteWire & { challenges: MeetChallengeWire[];
  roster: { member: GroupMemberRef; joined: boolean; joined_at_ms: number | null; linked: boolean; current_member: boolean }[];
  viewer: { role: GroupRole; joined: boolean } };
export type MeetListWire = { upcoming: MeetWire[]; past: MeetWire[]; next_cursor: string | null };
export type MeetChallengeSnapshot = Pick<MeetChallengeWire, 'challenge_id' | 'group_exercise_id' | 'exercise_name' | 'metric'>;
export type MeetStreamItemWire = { kind: 'meet'; key: string; sort_at_ms: number;
  event: 'scheduled' | 'on' | 'results' | 'cancelled' | 'results_refreshed' | 'challenge_changed';
  meet: Pick<MeetWire, 'meet_id' | 'title' | 'venue_name' | 'starts_at_ms' | 'ends_at_ms' | 'version'>;
  change: 'added' | 'edited' | 'removed' | null; challenge: MeetChallengeSnapshot | null;
  previous: MeetChallengeSnapshot | null; actor: GroupMemberRef | null };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const text = (v: unknown) => v === null || typeof v === 'string';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const member = (v: unknown) => exact(v, ['user_id', 'username']) && id(v.user_id) && text(v.username);
const nullableMember = (v: unknown) => v === null || member(v);
const metric = (v: unknown) => ['e1rm', 'weight', 'reps', 'volume', 'seconds'].includes(String(v));
function zone(v: unknown): boolean {
  if (v === null) return true;
  if (!id(v)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}
const coordinates = (v: Record<string, unknown>) => v.latitude === null && v.longitude === null ||
  typeof v.latitude === 'number' && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 &&
  typeof v.longitude === 'number' && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180;
export function isMeetWire(v: unknown): v is MeetWire {
  return exact(v, ['meet_id', 'group_id', 'title', 'starts_at_ms', 'ends_at_ms', 'cutoff_at_ms', 'time_zone',
    'venue_name', 'address', 'latitude', 'longitude', 'entry_note', 'version', 'state', 'created_by',
    'created_at_ms', 'cancelled_at_ms', 'cancelled_by']) && id(v.meet_id) && id(v.group_id) && text(v.title) &&
    integer(v.starts_at_ms) && integer(v.ends_at_ms) && v.ends_at_ms > v.starts_at_ms &&
    v.cutoff_at_ms === v.ends_at_ms + 86_400_000 && zone(v.time_zone) && id(v.venue_name) && text(v.address) &&
    coordinates(v) && text(v.entry_note) && positive(v.version) &&
    ['scheduled', 'live', 'finalizing', 'final', 'cancelled'].includes(String(v.state)) &&
    nullableMember(v.created_by) && integer(v.created_at_ms) && (v.cancelled_at_ms === null || integer(v.cancelled_at_ms)) && nullableMember(v.cancelled_by) &&
    (v.state === 'cancelled') === (v.cancelled_at_ms !== null);
}
export const isMeetWriteWire = (v: unknown): v is MeetWriteWire => exact(v, ['meet']) && isMeetWire(v.meet);
export function isMeetChallengeWire(v: unknown): v is MeetChallengeWire {
  return exact(v, ['challenge_id', 'meet_id', 'group_exercise_id', 'exercise_name', 'exercise_archived', 'metric', 'version', 'author', 'created_at_ms']) &&
    id(v.challenge_id) && id(v.meet_id) && id(v.group_exercise_id) && id(v.exercise_name) &&
    typeof v.exercise_archived === 'boolean' && metric(v.metric) && positive(v.version) && nullableMember(v.author) && integer(v.created_at_ms);
}
export const isMeetChallengeWriteWire = (v: unknown): v is { challenge: MeetChallengeWire } => exact(v, ['challenge']) && isMeetChallengeWire(v.challenge);
export const isMeetChallengeRemoveWire = (v: unknown): v is { challenge_id: string; removed: true } => exact(v, ['challenge_id', 'removed']) && id(v.challenge_id) && v.removed === true;
export const isMeetJoinWire = (v: unknown): v is { meet_id: string; joined: boolean } => exact(v, ['meet_id', 'joined']) && id(v.meet_id) && typeof v.joined === 'boolean';
export function isMeetDetailWire(v: unknown): v is MeetDetailWire {
  if (!exact(v, ['meet', 'challenges', 'roster', 'viewer']) || !isMeetWire(v.meet)) return false;
  const meetId = v.meet.meet_id;
  return Array.isArray(v.challenges) && v.challenges.every(c => isMeetChallengeWire(c) && c.meet_id === meetId) &&
    new Set(v.challenges.map(c => c.challenge_id)).size === v.challenges.length &&
    Array.isArray(v.roster) && v.roster.every(r => exact(r, ['member', 'joined', 'joined_at_ms', 'linked', 'current_member']) && member(r.member) && typeof r.joined === 'boolean' && typeof r.linked === 'boolean' && (r.joined ? integer(r.joined_at_ms) : r.joined_at_ms === null) && typeof r.current_member === 'boolean') &&
    exact(v.viewer, ['role', 'joined']) && ['owner', 'admin', 'member'].includes(String(v.viewer.role)) && typeof v.viewer.joined === 'boolean';
}
export const isMeetListWire = (v: unknown): v is MeetListWire => exact(v, ['upcoming', 'past', 'next_cursor']) &&
  Array.isArray(v.upcoming) && v.upcoming.every(isMeetWire) && Array.isArray(v.past) && v.past.every(isMeetWire) && (v.next_cursor === null || id(v.next_cursor));
const snapshot = (v: unknown) => exact(v, ['challenge_id', 'group_exercise_id', 'exercise_name', 'metric']) &&
  id(v.challenge_id) && id(v.group_exercise_id) && id(v.exercise_name) && metric(v.metric);
export function isMeetStreamItemWire(v: unknown): v is MeetStreamItemWire {
  if (!exact(v, ['kind', 'key', 'sort_at_ms', 'event', 'meet', 'change', 'challenge', 'previous', 'actor']) ||
    v.kind !== 'meet' || !id(v.key) || !integer(v.sort_at_ms) || !nullableMember(v.actor) ||
    !exact(v.meet, ['meet_id', 'title', 'venue_name', 'starts_at_ms', 'ends_at_ms', 'version']) ||
    !id(v.meet.meet_id) || !text(v.meet.title) || !id(v.meet.venue_name) || !integer(v.meet.starts_at_ms) ||
    !integer(v.meet.ends_at_ms) || v.meet.ends_at_ms <= v.meet.starts_at_ms || !positive(v.meet.version)) return false;
  if (v.event === 'challenge_changed') return ['added', 'edited', 'removed'].includes(String(v.change)) && snapshot(v.challenge) &&
    (v.change === 'edited' ? snapshot(v.previous) : v.previous === null);
  return ['scheduled', 'on', 'results', 'cancelled', 'results_refreshed'].includes(String(v.event)) && v.change === null && v.challenge === null && v.previous === null;
}
