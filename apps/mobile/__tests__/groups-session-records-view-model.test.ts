/**
 * The group session view's records as plain data: the title and eyebrow, which
 * records show, the Group records rows (frozen value, who passed it since,
 * board link, certification target) and the exercise cards' merged band.
 */
import {
  buildSessionRecordBands,
  buildSessionRecordRows,
  groupSessionEyebrow,
  groupSessionTitle,
  sessionRecordCertificationStatus,
  sessionSetPlaces,
  shownSessionRecords,
} from '@/src/groups/competition-session-records-view-model';
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import type { CompetitionCertificationWire, CompetitionSessionRecordWire, CompetitionSessionWire } from '@/src/groups/competition-wire';

const ME = 'user-me';
const alex = { user_id: 'alex-id', username: 'alex' };
const sam = { user_id: 'sam-id', username: 'sam' };
const STARTED = new Date(2026, 9, 6, 17, 2).getTime();
const NOW = new Date(2026, 9, 8, 12).getTime();

const session = (overrides: Partial<CompetitionSessionWire> = {}): CompetitionSessionWire => ({
  member: alex, session_id: 's-1', gym_name: null, status: 'completed', started_at_ms: STARTED,
  completed_at_ms: STARTED + 3_840_000, duration_sec: 3840,
  exercises: [
    { session_exercise_id: 'bench', exercise_definition_id: null, load_input_mode: 'total_load', name: 'Bench Press', machine_name: null,
      order_index: 0, visibility: 'ordinary', sets: [
        { set_id: 'b-1', order_index: 0, weight_value: '100', reps_value: '5', set_type: null, performance_status: null },
        { set_id: 'b-2', order_index: 1, weight_value: '110', reps_value: '2', set_type: null, performance_status: null }] },
    { session_exercise_id: 'pull', exercise_definition_id: null, load_input_mode: 'total_load', name: 'Pull-up', machine_name: null,
      order_index: 1, visibility: 'normalized', sets: [
        { set_id: 'p-1', order_index: 0, reps_value: '8', set_type: null, performance_status: null }] },
  ],
  ...overrides,
});

const exercise = { group_exercise_id: 'ge-bench', name: 'Bench', source_exercise_id: null, archived_at_ms: null,
  rules: { load_input_mode: 'total_load' as const, bodyweight_calculations_enabled: false, bodyweight_contribution: 0, default_metric: 'e1rm' as const, rules_revision: 2 },
  published_revision: 2, rebuilding: false };

const record = ({ eventId = 'ev-1', sequence = 1, setId = 'b-2', groupExercise = { group_exercise_id: 'ge-bench', name: 'Bench' },
  values = [{ metric: 'e1rm' as const, unit: 'kg', value: 122.5 }, { metric: 'volume' as const, unit: 'kg_reps', value: 220 }],
  boards = [{ metric: 'e1rm', leader: alex, leads: true }, { metric: 'volume', leader: sam, leads: false }] as CompetitionSessionRecordWire['boards'],
  certification = null as CompetitionCertificationWire | null, provisional = false, voided = false, withContext = true } = {}): CompetitionSessionRecordWire => ({
  event: { event_id: eventId, sequence, kind: 'record', group: { group_id: 'g', name: 'Crew' }, group_exercise: groupExercise,
    rules_revision: 2, representation_version: 4, visibility: 'ordinary', sort_at_ms: STARTED, member: alex, metric: null,
    certified: null, reason: null, related_event_id: null, session_id: 's-1', set_id: setId, reps: 2, provisional, voided,
    values: values.map(value => ({ role: 'record' as const, ...value, unavailable: false, member: alex })),
    record_context: withContext ? { exercise, former: false, metrics: [
      { metric: 'e1rm', write_token: 'tok-1rm', eligible: true, certification },
      { metric: 'volume', write_token: 'tok-vol', eligible: false, certification: null }] } : null },
  boards,
});

const places = sessionSetPlaces(buildCompetitionSession(session()).cards);

test('the title names the member (You for me) and the day; the eyebrow names the group', () => {
  expect(groupSessionTitle(session(), ME, NOW)).toBe('alex · Tue 6 Oct');
  expect(groupSessionTitle(session({ member: { user_id: ME, username: 'dino' } }), ME, NOW)).toBe('You · Tue 6 Oct');
  expect(groupSessionTitle(session({ member: { user_id: 'x', username: null } }), ME, NOW)).toBe('Unnamed member · Tue 6 Oct');
  expect(groupSessionTitle(session(), ME, new Date(2027, 0, 2).getTime())).toBe('alex · Tue 6 Oct 2026');
  expect(groupSessionEyebrow('Iron Crew')).toBe('Iron Crew · group view');
  expect(groupSessionEyebrow(null)).toBe('Group view');
  expect(groupSessionEyebrow('  ')).toBe('Group view');
});

test('records show only once the session is completed, never provisional or voided', () => {
  const kept = record();
  expect(shownSessionRecords(session(), [kept, record({ eventId: 'p', provisional: true }), record({ eventId: 'v', voided: true })])).toEqual([kept]);
  expect(shownSessionRecords(session({ status: 'active' }), [kept])).toEqual([]);
  expect(shownSessionRecords(session({ status: 'draft' }), [kept])).toEqual([]);
});

test('one row per #1 board, frozen value, passed-by note, board link and certification target', () => {
  const [rm, volume] = buildSessionRecordRows({ records: [record()], places, groupId: 'g 1', userId: ME });
  expect(rm).toMatchObject({ key: 'ev-1:e1rm', setId: 'b-2', title: 'Bench · 1RM', value: '122.5 kg', detail: '#1 in group · 110.0 × 2',
    boardHref: '/group/g%201/leaderboards/ge-bench?metric=e1rm&scope=all' });
  expect(rm.certification).toEqual({ exercise, eligible: true, target: { metric: 'e1rm', member: alex, former: false,
    write_token: 'tok-1rm', certification: null, performance: { set_id: 'b-2' } } });
  expect(volume).toMatchObject({ title: 'Bench · Volume', value: '220.0 kg·reps', detail: '#1 in group · 110.0 × 2 · since passed by sam' });
  expect(volume.certification?.eligible).toBe(false);
  const [, passedByMe] = buildSessionRecordRows({ records: [record({ boards: [{ metric: 'e1rm', leader: alex, leads: true },
    { metric: 'volume', leader: { user_id: ME, username: 'dino' }, leads: false }] })], places, groupId: 'g', userId: ME });
  expect(passedByMe.detail).toBe('#1 in group · 110.0 × 2 · since passed by you');
});

test('a historic Weight board has no current board to certify or link a metric to; an unknown set or value still reads', () => {
  const [weight] = buildSessionRecordRows({ records: [record({ values: [{ metric: 'weight' as never, unit: 'kg', value: 110 }],
    boards: [{ metric: 'weight' as never, leader: null, leads: false }] })], places, groupId: 'g', userId: ME });
  expect(weight).toMatchObject({ title: 'Bench · Weight', value: '110.0 kg', boardHref: '/group/g/leaderboards/ge-bench', certification: null });
  const [lost] = buildSessionRecordRows({ records: [record({ setId: 'gone', values: [], withContext: false })], places, groupId: 'g', userId: ME });
  expect(lost).toMatchObject({ value: 'Score unavailable', detail: '#1 in group', certification: null });
});

test('rows follow the session: exercise then set order, then 1RM before Volume', () => {
  const later = record({ eventId: 'ev-early-set', sequence: 9, setId: 'b-1',
    boards: [{ metric: 'volume', leader: alex, leads: true }, { metric: 'e1rm', leader: alex, leads: true }] });
  const rows = buildSessionRecordRows({ records: [record(), later], places, groupId: 'g', userId: ME });
  expect(rows.map(row => row.key)).toEqual(['ev-early-set:e1rm', 'ev-early-set:volume', 'ev-1:e1rm', 'ev-1:volume']);
});

test('the exercise card band: one line per record set, its boards joined', () => {
  const bands = buildSessionRecordBands([record(), record({ eventId: 'ev-pull', setId: 'p-1', groupExercise: { group_exercise_id: 'ge-pull', name: 'Pull' },
    boards: [{ metric: 'volume', leader: alex, leads: true }] }), record({ eventId: 'ev-gone', setId: 'gone' })], places);
  expect(bands.get('bench')).toEqual([{ key: 'ev-1', label: '#1 in group · 1RM + Volume', set: '110.0 × 2',
    spoken: '#1 in group on 1RM and Volume, 110.0 × 2' }]);
  expect(bands.get('pull')).toEqual([{ key: 'ev-pull', label: '#1 in group · Volume', set: '8 reps', spoken: '#1 in group on Volume, 8 reps' }]);
  expect([...bands.keys()]).toEqual(['bench', 'pull']);
});

test('certification status names the witness (you for me) and the day, else Not certified', () => {
  const certification = (certified_by: CompetitionCertificationWire['certified_by']): CompetitionCertificationWire => ({ certification_id: 'c',
    metric: 'e1rm', certified_by, certified_at_ms: new Date(new Date().getFullYear(), 9, 7).getTime(), observed_rules_revision: 2, ended_at_ms: null, end_reason: null });
  expect(sessionRecordCertificationStatus(null, ME)).toBe('Not certified');
  expect(sessionRecordCertificationStatus(certification(sam), ME)).toBe('Certified by sam · 7 Oct');
  expect(sessionRecordCertificationStatus(certification({ user_id: ME, username: 'Youssef' }), ME)).toBe('Certified by you · 7 Oct');
  expect(sessionRecordCertificationStatus(certification({ user_id: 'y', username: 'Youssef' }), ME)).toBe('Certified by Youssef · 7 Oct');
  expect(sessionRecordCertificationStatus(certification(null), ME)).toBe('Certified by a group member · 7 Oct');
});

test('Volume sums only the ordinary volume-included sets; none reads —', () => {
  expect(buildCompetitionSession(session()).volume).toBe('720');
  const bench = session().exercises[0] as Extract<CompetitionSessionWire['exercises'][number], { visibility: 'ordinary' }>;
  const withWarmUp = session({ exercises: [{ ...bench, sets: [
    { set_id: 'w', order_index: 0, weight_value: '60', reps_value: '10', set_type: 'warm_up', performance_status: null },
    { set_id: 'k', order_index: 1, weight_value: '100', reps_value: '5', set_type: 'rir_2', performance_status: null },
    { set_id: 'x', order_index: 2, weight_value: '100', reps_value: '5', set_type: null, performance_status: 'skipped' }] }] });
  expect(buildCompetitionSession(withWarmUp).volume).toBe('500');
  expect(buildCompetitionSession(session({ exercises: [session().exercises[1]] })).volume).toBe('—');
});
