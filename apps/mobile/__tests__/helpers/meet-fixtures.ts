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
