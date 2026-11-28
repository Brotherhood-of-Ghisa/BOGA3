import { isMeetChallengeWire, isMeetWire, type MeetChallengeWire, type MeetMetric, type MeetWire } from './meet-wire.ts';
import type { GroupMemberRef } from './types.ts';

// Closed wire shapes of the meet results, leaderboard and trophies reads
// (`docs/specs/tech/group-meet-contract.md`, "Scoring, snapshot and refresh").

export type MeetResultsState = 'scheduled' | 'live' | 'so_far' | 'final' | 'refreshed' | 'cancelled';
export type MeetStandingUnit = 'kg' | 'percent_bw' | 'kg_reps' | 'percent_bw_reps' | 'reps' | 'seconds';
export type MeetStandingWire = {
  place: number; member: GroupMemberRef; current_member: boolean; value: number | null; unit: MeetStandingUnit; unavailable: boolean;
  set: { set_id: string; session_id: string; recording_mode: string; reps_value: string | null; duration_sec: number | null; weight_value: string | null };
  certified: boolean;
};
export type MeetResultsWire = {
  meet: MeetWire;
  results: { state: MeetResultsState; final_at_ms: number; refreshed_at_ms: number | null; refreshed_by: GroupMemberRef | null };
  challenges: { challenge: MeetChallengeWire; standings: MeetStandingWire[] }[];
  sessions: { member: GroupMemberRef; current_member: boolean; session_id: string; started_at_ms: number; completed_at_ms: number | null }[];
  records: { member: GroupMemberRef; session_id: string; set_id: string; group_exercise_id: string; exercise_name: string;
    boards: { metric: string; unit: string; value: number | null; unavailable: boolean }[] }[];
};
export type MeetLeaderboardRowWire = { rank: number; member: GroupMemberRef; current_member: boolean; gold: number; silver: number; bronze: number };
export type MeetLeaderboardWire = { rows: MeetLeaderboardRowWire[] };
export type MeetTrophyWire = { place: 1 | 2 | 3; meet_id: string; title: string | null; venue_name: string; starts_at_ms: number;
  challenge_id: string; group_exercise_id: string; exercise_name: string; metric: MeetMetric };
export type MeetTrophiesWire = { trophies: MeetTrophyWire[]; next_cursor: string | null };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const text = (v: unknown) => v === null || typeof v === 'string';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const member = (v: unknown) => exact(v, ['user_id', 'username']) && id(v.user_id) && text(v.username);
const nullableMember = (v: unknown) => v === null || member(v);
const UNITS = ['kg', 'percent_bw', 'kg_reps', 'percent_bw_reps', 'reps', 'seconds'];

function isStanding(v: unknown): v is MeetStandingWire {
  if (!exact(v, ['place', 'member', 'current_member', 'value', 'unit', 'unavailable', 'set', 'certified'])) return false;
  const set = v.set;
  return positive(v.place) && member(v.member) && typeof v.current_member === 'boolean' && typeof v.unit === 'string' && UNITS.includes(v.unit) &&
    typeof v.unavailable === 'boolean' && (v.value === null ? v.unavailable : finite(v.value) && !v.unavailable) &&
    typeof v.certified === 'boolean' && exact(set, ['set_id', 'session_id', 'recording_mode', 'reps_value', 'duration_sec', 'weight_value']) &&
    id(set.set_id) && id(set.session_id) && id(set.recording_mode) && text(set.reps_value) && text(set.weight_value) &&
    (set.duration_sec === null || finite(set.duration_sec));
}
const isSession = (v: unknown) => exact(v, ['member', 'current_member', 'session_id', 'started_at_ms', 'completed_at_ms']) && member(v.member) &&
  typeof v.current_member === 'boolean' && id(v.session_id) && integer(v.started_at_ms) && (v.completed_at_ms === null || integer(v.completed_at_ms));
const isRecord = (v: unknown) => exact(v, ['member', 'session_id', 'set_id', 'group_exercise_id', 'exercise_name', 'boards']) && member(v.member) &&
  id(v.session_id) && id(v.set_id) && id(v.group_exercise_id) && id(v.exercise_name) && Array.isArray(v.boards) &&
  v.boards.every(b => exact(b, ['metric', 'unit', 'value', 'unavailable']) && id(b.metric) && id(b.unit) && typeof b.unavailable === 'boolean' &&
    (b.value === null ? b.unavailable : finite(b.value) && !b.unavailable));

export function isMeetResultsWire(v: unknown): v is MeetResultsWire {
  if (!exact(v, ['meet', 'results', 'challenges', 'sessions', 'records']) || !isMeetWire(v.meet)) return false;
  const meetId = v.meet.meet_id; const results = v.results;
  return exact(results, ['state', 'final_at_ms', 'refreshed_at_ms', 'refreshed_by']) &&
    typeof results.state === 'string' && ['scheduled', 'live', 'so_far', 'final', 'refreshed', 'cancelled'].includes(results.state) && integer(results.final_at_ms) &&
    (results.refreshed_at_ms === null || integer(results.refreshed_at_ms)) && nullableMember(results.refreshed_by) &&
    Array.isArray(v.challenges) && v.challenges.every(c => exact(c, ['challenge', 'standings']) && isMeetChallengeWire(c.challenge) &&
      c.challenge.meet_id === meetId && Array.isArray(c.standings) && c.standings.every(isStanding)) &&
    new Set(v.challenges.map(c => (c as { challenge: MeetChallengeWire }).challenge.challenge_id)).size === v.challenges.length &&
    Array.isArray(v.sessions) && v.sessions.every(isSession) && Array.isArray(v.records) && v.records.every(isRecord);
}
export const isMeetLeaderboardWire = (v: unknown): v is MeetLeaderboardWire => exact(v, ['rows']) && Array.isArray(v.rows) &&
  v.rows.every(r => exact(r, ['rank', 'member', 'current_member', 'gold', 'silver', 'bronze']) && positive(r.rank) && member(r.member) &&
    typeof r.current_member === 'boolean' && integer(r.gold) && integer(r.silver) && integer(r.bronze));
export const isMeetTrophiesWire = (v: unknown): v is MeetTrophiesWire => exact(v, ['trophies', 'next_cursor']) && Array.isArray(v.trophies) &&
  v.trophies.every(t => exact(t, ['place', 'meet_id', 'title', 'venue_name', 'starts_at_ms', 'challenge_id', 'group_exercise_id', 'exercise_name', 'metric']) &&
    [1, 2, 3].includes(t.place as number) && id(t.meet_id) && text(t.title) && id(t.venue_name) && integer(t.starts_at_ms) && id(t.challenge_id) &&
    id(t.group_exercise_id) && id(t.exercise_name) && ['e1rm', 'weight', 'reps', 'volume', 'seconds'].includes(String(t.metric))) &&
  (v.next_cursor === null || id(v.next_cursor));
