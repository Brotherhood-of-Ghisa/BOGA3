import type { MeetLeaderboardWire, MeetResultsWire, MeetStandingWire, MeetTrophiesWire } from '@/src/groups/meet-results-wire';
import type { MeetDetailWire, MeetStreamItemWire, MeetWire } from '@/src/groups/meet-wire';
export const meetFixture = (patch: Partial<MeetWire> = {}): MeetWire => ({ meet_id: 'm1', group_id: 'g1', title: 'Saturday lifts', starts_at_ms: 1800000000000,
  ends_at_ms: 1800010800000, cutoff_at_ms: 1800097200000, time_zone: 'Europe/London', venue_name: 'The gym', address: '1 High Street',
  latitude: null, longitude: null, entry_note: 'Use the side door', version: 1, state: 'scheduled', created_by: { user_id: 'u1', username: 'Alex' },
  created_at_ms: 1700000000000, cancelled_at_ms: null, cancelled_by: null, ...patch });
export const meetDetailFixture = (): MeetDetailWire => ({ meet: meetFixture(), challenges: [{ challenge_id: 'c1', meet_id: 'm1', group_exercise_id: 'ge1',
  exercise_name: 'Squat', exercise_archived: false, metric: 'e1rm', version: 1, author: { user_id: 'u1', username: 'Alex' }, created_at_ms: 1700000000000 }],
  roster: [{ member: { user_id: 'u1', username: 'Alex' }, joined: true, joined_at_ms: 1700000000000, linked: false, current_member: true }], viewer: { role: 'owner', joined: true } });
export const meetStreamFixture = (event: MeetStreamItemWire['event'] = 'scheduled'): MeetStreamItemWire => ({ kind: 'meet', key: '0001', sort_at_ms: 1700000000000,
  event, meet: { meet_id: 'm1', title: 'Saturday lifts', venue_name: 'The gym', starts_at_ms: 1800000000000, ends_at_ms: 1800010800000, version: 1 },
  change: event === 'challenge_changed' ? 'added' : null,
  challenge: event === 'challenge_changed' ? { challenge_id: 'c1', group_exercise_id: 'ge1', exercise_name: 'Squat', metric: 'e1rm' } : null,
  previous: null, actor: { user_id: 'u1', username: 'Alex' } });
export const standingFixture = (patch: Partial<MeetStandingWire> & { id?: string; name?: string | null } = {}): MeetStandingWire => {
  const { id = 'u1', name = 'Alex', ...rest } = patch;
  return { place: 1, member: { user_id: id, username: name }, current_member: true, value: 142.5, unit: 'kg', unavailable: false,
    set: { set_id: `s-${id}`, session_id: `x-${id}`, recording_mode: 'reps', reps_value: '1', duration_sec: null, weight_value: '140' }, certified: false, ...rest };
};
export const meetResultsFixture = (patch: Partial<MeetResultsWire['results']> = {}, meet = meetFixture()): MeetResultsWire => ({
  meet, results: { state: 'live', final_at_ms: meet.cutoff_at_ms, refreshed_at_ms: null, refreshed_by: null, ...patch },
  challenges: [{ challenge: meetDetailFixture().challenges[0], standings: [
    standingFixture({ certified: true }), standingFixture({ id: 'u2', name: 'Blake', place: 2, value: 130 }),
    standingFixture({ id: 'u3', name: 'Casey', place: 2, value: 130 }), standingFixture({ id: 'u4', name: 'Dana', place: 4, value: 100, current_member: false }) ] }],
  sessions: [{ member: { user_id: 'u1', username: 'Alex' }, current_member: true, session_id: 'x-u1', started_at_ms: meet.starts_at_ms + 60000, completed_at_ms: null },
    { member: { user_id: 'u2', username: 'Blake' }, current_member: true, session_id: 'x-u2', started_at_ms: meet.starts_at_ms + 120000, completed_at_ms: meet.starts_at_ms + 3600000 }],
  records: [{ member: { user_id: 'u1', username: 'Alex' }, session_id: 'x-u1', set_id: 's-u1', group_exercise_id: 'ge1', exercise_name: 'Squat',
    boards: [{ metric: 'e1rm', unit: 'kg', value: 142.5, unavailable: false }] }],
});
export const leaderboardFixture = (): MeetLeaderboardWire => ({ rows: [
  { rank: 1, member: { user_id: 'u1', username: 'Alex' }, current_member: true, gold: 2, silver: 0, bronze: 1 },
  { rank: 2, member: { user_id: 'u2', username: 'Blake' }, current_member: true, gold: 1, silver: 1, bronze: 0 },
  { rank: 2, member: { user_id: 'u3', username: 'Casey' }, current_member: true, gold: 1, silver: 1, bronze: 0 },
  { rank: 4, member: { user_id: 'u4', username: 'Dana' }, current_member: false, gold: 0, silver: 0, bronze: 2 } ] });
export const trophiesFixture = (next: string | null = null): MeetTrophiesWire => ({ trophies: [
  { place: 1, meet_id: 'm1', title: 'Saturday lifts', venue_name: 'The gym', starts_at_ms: 1800000000000, challenge_id: 'c1', group_exercise_id: 'ge1', exercise_name: 'Squat', metric: 'e1rm' }], next_cursor: next });
