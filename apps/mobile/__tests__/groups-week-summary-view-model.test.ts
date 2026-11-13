/**
 * Today's group card rules over a `group_competition_week_summary` payload: the top five
 * and the caller's own line, the bars, and up to four sessions, live first.
 * Pure; the suite runs in Europe/London (jest.config.js).
 */

import {
  GROUP_SESSIONS_SHOWN,
  buildGroupSessions,
  buildWeekBoard,
  buildGroupRecordLines,
  buildLatestGroupRecordRows,
  buildLatestSessionRows,
  completedSessionsFromStream,
  formatTrainingStart,
  groupRecordBoards,
  type GroupWeekBoardRow,
} from '@/src/groups';

import { competitionEvent, competitionSession } from './helpers/competition-fixtures';
import type { CompetitionEventWire,CompetitionHistoricalMetric,CompetitionWeekSummaryWire } from '@/src/groups/competition-wire';
type GroupWeekLatestSession = NonNullable<CompetitionWeekSummaryWire['latest_completed']>;
type GroupWeekTrainingSession = CompetitionWeekSummaryWire['training_now'][number];
const ME = 'me';

const row = (userId: string, rank: number, workingSets: number, groupRecords = 0, username: string | null = userId): GroupWeekBoardRow => ({
  rank,
  member: { user_id: userId, username },
  working_sets: workingSets,
  group_records: groupRecords,
});

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

const NOW = local(2026, 10, 16, 9);

const training = (userId: string, overrides: Partial<GroupWeekTrainingSession> = {}): GroupWeekTrainingSession => ({
  member: { user_id: userId, username: userId },
  session_id: `${userId}-live`,
  started_at_ms: local(2026, 10, 16, 7, 40),
  gym_name: 'Iron Works',
  working_sets: 7,
  exercise_count: 3,
  ...overrides,
});

type RecordBoard = { metric: CompetitionHistoricalMetric; value: number; unit: string };

const record = (name: string,boards: RecordBoard[]): CompetitionEventWire => ({
  ...competitionEvent,group_exercise: { group_exercise_id: `${name}-id`,name },
  values: boards.map(board => ({ role: 'record',metric: board.metric,unit: board.unit,value: board.value,unavailable: false,member: null })),
});

const completed = (overrides: Partial<GroupWeekLatestSession> = {}): GroupWeekLatestSession => ({
  member: { user_id: 'dave', username: 'dave' },
  session_id: 'dave-done',
  started_at_ms: local(2026, 10, 16, 6, 10),
  completed_at_ms: local(2026, 10, 16, 7, 2),
  duration_sec: 52 * 60,
  gym_name: 'Iron Works',
  working_sets: 18,
  exercise_count: 4,
  group_records: [],
  ...overrides,
});

describe('buildWeekBoard', () => {
  it('keeps the top five and adds my line, at my shared rank, when I am outside them', () => {
    const board = buildWeekBoard(
      [row('dave', 1, 58, 3), row('maria', 2, 39, 1), row('sam', 3, 35, 2), row('kit', 4, 30), row('ana', 5, 25), row(ME, 6, 21), row('tom', 7, 3)],
      ME,
    );

    expect(board.rows.map((entry) => [entry.rank, entry.name, entry.workingSets, entry.groupRecords])).toEqual([
      [1, 'dave', 58, 3],
      [2, 'maria', 39, 1],
      [3, 'sam', 35, 2],
      [4, 'kit', 30, 0],
      [5, 'ana', 25, 0],
    ]);
    expect(board.me).toEqual({ rankLabel: '6th', workingSets: 21, groupRecords: 0 });
  });

  it('names me You inside the three, with no extra line', () => {
    const board = buildWeekBoard([row('dave', 1, 58), row(ME, 2, 42, 2), row('maria', 3, 39)], ME);

    expect(board.rows[1]).toMatchObject({ name: 'You', isMe: true });
    expect(board.me).toBeNull();
  });

  it('finds me by user id when a tie at fifth pushes me to the sixth row', () => {
    const board = buildWeekBoard([row('dave', 1, 30), row('maria', 2, 20), row('sam', 3, 15), row('kit', 4, 12), row('ana', 5, 10), row(ME, 5, 10)], ME);

    expect(board.rows.map((entry) => entry.userId)).toEqual(['dave', 'maria', 'sam', 'kit', 'ana']);
    expect(board.me).toEqual({ rankLabel: '5th', workingSets: 10, groupRecords: 0 });
  });

  it('draws each bar as a share of the leader, the leader (ties too) in the darker step', () => {
    const board = buildWeekBoard([row('dave', 1, 40), row('maria', 1, 40), row(ME, 3, 10)], ME);

    expect(board.rows.map((entry) => [entry.fraction, entry.leader])).toEqual([
      [1, true],
      [1, true],
      [0.25, false],
    ]);
  });

  it('leaves every bar empty when nobody has a working set, and falls back for an unnamed member', () => {
    const board = buildWeekBoard([row('dave', 1, 0, 0, null), row(ME, 1, 0)], ME);

    expect(board.rows.map((entry) => [entry.name, entry.fraction, entry.leader])).toEqual([
      ['Unnamed member', 0, false],
      ['You', 0, false],
    ]);
  });

  it('shows no line for a caller missing from the board', () => {
    expect(buildWeekBoard([row('dave', 1, 5)], ME).me).toBeNull();
  });

  it('keeps as many rows as asked, counting the members past them besides my own line', () => {
    const members = [row('dave', 1, 58), row('maria', 2, 39), row('sam', 3, 35), row('kit', 4, 30), row(ME, 5, 21), row('tom', 6, 3), row('ana', 7, 1)];

    expect(buildWeekBoard(members, ME, 3)).toMatchObject({ me: { rankLabel: '5th' }, hiddenCount: 3 });
    const five = buildWeekBoard(members, ME);
    expect(five.rows.map((entry) => entry.userId)).toEqual(['dave', 'maria', 'sam', 'kit', ME]);
    expect(five).toMatchObject({ me: null, hiddenCount: 2 });
    expect(buildWeekBoard(members, ME, 20)).toMatchObject({ me: null, hiddenCount: 0 });
  });
});

describe('buildGroupSessions', () => {
  it('draws a live session by its start, its figures so far and no record', () => {
    const { live, recent } = buildGroupSessions({ training_now: [training('maria')], latest_completed: null }, [], ME, NOW, 'DD-MM-YYYY');

    expect(recent).toEqual([]);
    expect(live).toEqual([{
      memberUserId: 'maria',
      sessionId: 'maria-live',
      name: 'maria',
      when: 'Started 07:40',
      live: true,
      gym: 'Iron Works',
      figures: '3 exercises · 7 sets so far',
      groupRecords: [],
      accessibilityLabel: 'maria, training now, Started 07:40, at Iron Works, 3 exercises · 7 sets so far',
    }]);
  });

  it("draws a completed session by its start in Today's format, naming each GR", () => {
    const { recent } = buildGroupSessions(
      {
        training_now: [],
        latest_completed: completed({ group_records: [record('Deadlift', [{ metric: 'e1rm', value: 213.3, unit: 'kg' }])] }),
      },
      [],
      ME,
      NOW,
      'DD-MM-YYYY',
    );

    expect(recent).toEqual([{
      memberUserId: 'dave',
      sessionId: 'dave-done',
      name: 'dave',
      when: '16 Oct 26 06:10',
      live: false,
      gym: 'Iron Works',
      figures: '4 exercises · 18 sets',
      groupRecords: [{ key: competitionEvent.event_id, exercise: 'Deadlift', value: '1RM 213.3' }],
      accessibilityLabel: 'dave, completed session on 16-10-2026 06:10, at Iron Works, 4 exercises · 18 sets, group record, Deadlift 1RM 213.3',
    }]);
  });

  it('draws the latest session from the stream when loaded, so its PRs are counted', () => {
    const latest = completed({ group_records: [record('Deadlift', [{ metric: 'e1rm', value: 213.3, unit: 'kg' }])] });
    const fromSummary = buildGroupSessions({ training_now: [], latest_completed: latest }, [], ME, NOW, 'DD-MM-YYYY');
    expect(fromSummary.recent[0].figures).toBe('4 exercises · 18 sets');
    const fromStream = buildGroupSessions({ training_now: [], latest_completed: latest }, [{ ...latest, personalRecords: 2 }], ME, NOW, 'DD-MM-YYYY');
    expect(fromStream.recent.map((row) => [row.sessionId, row.figures])).toEqual([['dave-done', '4 exercises · 18 sets · 2 PRs']]);
    expect(buildGroupSessions({ training_now: [], latest_completed: null }, [{ ...latest, group_records: [], personalRecords: 1 }], ME, NOW, 'DD-MM-YYYY')
      .recent[0]).toMatchObject({ figures: '4 exercises · 18 sets · 1 PR', groupRecords: [] });
  });

  it('shows four in all, live first, then the latest completed and the stream, each session once', () => {
    const stream = [
      completed({ session_id: 'dave-done' }),
      completed({ session_id: 'maria-live' }),
      completed({ session_id: 'older-1', gym_name: null }),
      completed({ session_id: 'older-2' }),
      completed({ session_id: 'older-3' }),
    ].map((session) => ({ ...session, personalRecords: 0 }));
    const sessions = buildGroupSessions(
      { training_now: [training('maria'), training(ME)], latest_completed: completed() },
      stream,
      ME,
      NOW,
      'DD-MM-YYYY',
    );

    expect(GROUP_SESSIONS_SHOWN).toBe(4);
    expect(sessions.live.map((session) => [session.sessionId, session.name])).toEqual([['maria-live', 'maria'], ['me-live', 'You']]);
    expect(sessions.recent.map((session) => session.sessionId)).toEqual(['dave-done', 'older-1']);
    expect(sessions.recent[1]).toMatchObject({ gym: null, accessibilityLabel: 'dave, completed session on 16-10-2026 06:10, 4 exercises · 18 sets' });
  });

  it('gives every slot to live sessions when four or more are training', () => {
    const live = ['a', 'b', 'c', 'd', 'e'].map((id) => training(id));
    const sessions = buildGroupSessions({ training_now: live, latest_completed: completed() }, [], ME, NOW, 'DD-MM-YYYY');
    expect(sessions.live).toHaveLength(4);
    expect(sessions.recent).toEqual([]);
  });

  it('is empty for a group with no live or completed session', () => {
    expect(buildGroupSessions({ training_now: [], latest_completed: null }, [], ME, NOW, 'DD-MM-YYYY')).toEqual({ live: [], recent: [] });
  });
});

describe('formatting', () => {
  it.each([
    ['DD-MM-YYYY', '15 Oct 26', '16 Oct 26', '15-10-2026', '16-10-2026'],
    ['MM-DD-YYYY', 'Oct 15 26', 'Oct 16 26', '10-15-2026', '10-16-2026'],
    ['YYYY-MM-DD', '2026 Oct 15', '2026 Oct 16', '2026-10-15', '2026-10-16'],
  ] as const)('%s pairs compact group timestamps with full numeric spoken dates', (format, earlier, date, spokenEarlier, spokenDate) => {
    const previousStart = local(2026, 10, 15, 23, 10);
    const summary = { training_now: [training('maria', { started_at_ms: previousStart })], latest_completed: completed() };
    const before = JSON.stringify(summary);
    const { live, recent } = buildGroupSessions(summary, [], ME, NOW, format);
    expect(live[0].when).toBe(`Started ${earlier} 23:10`);
    expect(live[0].accessibilityLabel).toContain(`Started ${spokenEarlier} 23:10`);
    expect(recent[0].when).toBe(`${date} 06:10`);
    expect(recent[0].accessibilityLabel).toContain(`completed session on ${spokenDate} 06:10`);
    expect(formatTrainingStart(local(2026, 10, 16, 7, 40), NOW, format)).toBe('Started 07:40');
    expect(JSON.stringify(summary)).toBe(before);
  });

  it('names a start time today by the clock, and an earlier day by its date', () => {
    expect(formatTrainingStart(local(2026, 10, 16, 7, 40), NOW, 'DD-MM-YYYY')).toBe('Started 07:40');
    expect(formatTrainingStart(local(2026, 10, 15, 23, 10), NOW, 'DD-MM-YYYY')).toBe('Started 15 Oct 26 23:10');
  });

  it('names every GR, one line per record set, its boards joined', () => {
    expect(buildGroupRecordLines([])).toEqual([]);
    // A record that took no listed board (no `record` value) adds nothing.
    expect(buildGroupRecordLines([record('Squat', [])])).toEqual([]);
    const bench = { ...record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }]), event_id: 'bench' };
    const deadlift = { ...record('Deadlift', [{ metric: 'weight', value: 200, unit: 'kg' }, { metric: 'e1rm', value: 213.3, unit: 'kg' }]), event_id: 'deadlift' };
    expect(buildGroupRecordLines([bench, deadlift])).toEqual([
      { key: 'bench', exercise: 'Bench', value: '1RM 120.0' },
      { key: 'deadlift', exercise: 'Deadlift', value: 'Weight 200.0 · 1RM 213.3' },
    ]);
  });

  it('lists the boards the session view shows: no Volume, no provisional or voided record', () => {
    // A record that took 1RM and Volume shows its 1RM only, as the session's GR card does.
    expect(buildGroupRecordLines([record('Squat', [{ metric: 'e1rm', value: 150, unit: 'kg' }, { metric: 'volume', value: 2400, unit: 'kg' }])]))
      .toEqual([{ key: competitionEvent.event_id, exercise: 'Squat', value: '1RM 150.0' }]);
    // A Volume-only record shows nowhere on the session.
    expect(buildGroupRecordLines([record('Bench', [{ metric: 'volume', value: 2400, unit: 'kg' }])])).toEqual([]);
    // A provisional or voided record can still move or is gone: neither shows.
    expect(buildGroupRecordLines([
      { ...record('Squat', [{ metric: 'e1rm', value: 150, unit: 'kg' }]), provisional: true },
      { ...record('Deadlift', [{ metric: 'e1rm', value: 200, unit: 'kg' }]), voided: true },
    ])).toEqual([]);
  });

  it('counts only record values, not the leader or previous holders an event may carry', () => {
    const event: CompetitionEventWire = {
      ...record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }]),
      values: [
        { role: 'record', metric: 'e1rm', unit: 'kg', value: 120, unavailable: false, member: null },
        { role: 'previous', metric: 'e1rm', unit: 'kg', value: 110, unavailable: false, member: null },
      ],
    };
    expect(groupRecordBoards([event])).toHaveLength(1);
  });
});

describe('completedSessionsFromStream', () => {
  const session = (sessionId: string, status: 'completed' | 'active' | 'draft' = 'completed', startedAtMs = 1) => ({
    kind: 'session' as const, key: sessionId, sort_at_ms: 1, groups: [{ group_id: 'g1', name: 'Crew' }],
    session: { ...competitionSession.session, session_id: sessionId, status, started_at_ms: startedAtMs },
  });
  // A record that beat the member's best on 1RM and on Weight; `groupRecords` names the boards it took #1 on.
  const recordFor = (sessionId: string | null, overrides: Partial<CompetitionEventWire> = {}, groupRecords: CompetitionHistoricalMetric[] = ['e1rm']) => ({
    kind: 'competition' as const, key: `record-${sessionId}-${overrides.event_id ?? ''}`, sort_at_ms: 1,
    event: { ...competitionEvent, session_id: sessionId,
      values: [
        { role: 'record' as const, metric: 'e1rm' as const, unit: 'kg', value: 120, unavailable: false, member: null },
        { role: 'record' as const, metric: 'weight' as const, unit: 'kg', value: 110, unavailable: false, member: null },
      ], ...overrides },
    record: { performance: null, previous: [], group_record_metrics: groupRecords },
  });

  it('keeps completed sessions in stream order, counted as the stream card counts them, with their live group records', () => {
    const sessions = completedSessionsFromStream([
      session('live', 'active'),
      session('s2'),
      recordFor('s2', { event_id: 'kept' }),
      recordFor('s2', { event_id: 'voided', voided: true }),
      recordFor('s2', { event_id: 'lead', kind: 'lead_change' }),
      recordFor(null, { event_id: 'unplaced' }),
      session('draft', 'draft'),
      session('s1'),
    ]);

    expect(sessions.map((entry) => entry.session_id)).toEqual(['s2', 's1']);
    expect(sessions[0]).toMatchObject({ working_sets: 1, exercise_count: 1, duration_sec: 2_600, gym_name: 'Gym' });
    expect(sessions[0].group_records.map((event) => event.event_id)).toEqual(['kept']);
    expect(sessions[1]).toMatchObject({ group_records: [], personalRecords: 0 });
  });

  it('keeps only the boards a record took #1 on as GRs, and counts its other new bests as PRs', () => {
    const [mixed] = completedSessionsFromStream([
      session('s1'),
      recordFor('s1', { event_id: 'gr-and-pr' }, ['e1rm']),
      recordFor('s1', { event_id: 'pr-only' }, []),
      // Volume is not shown, so a Volume new best is neither a GR nor a PR.
      recordFor('s1', { event_id: 'volume', values: [{ role: 'record', metric: 'volume', unit: 'kg_reps', value: 900, unavailable: false, member: null }] }, ['volume']),
    ]);
    expect(mixed.group_records.map((event) => [event.event_id, event.values.map((value) => value.metric)])).toEqual([['gr-and-pr', ['e1rm']]]);
    expect(buildGroupRecordLines(mixed.group_records)).toEqual([{ key: 'gr-and-pr', exercise: competitionEvent.group_exercise.name, value: '1RM 120.0' }]);
    // `gr-and-pr`'s Weight and both of `pr-only`'s boards.
    expect(mixed.personalRecords).toBe(3);
  });
});

describe('buildLatestSessionRows', () => {
  const session = (sessionId: string, member: string, startedAtMs: number) => ({
    kind: 'session' as const, key: sessionId, sort_at_ms: startedAtMs, groups: [{ group_id: 'g1', name: 'Crew' }],
    session: { ...competitionSession.session, session_id: sessionId, member: { user_id: member, username: member }, started_at_ms: startedAtMs },
  });
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => session(id, id === 'b' ? ME : `m-${id}`, local(2026, 11, 10 - index, 9)));

  it('lists the five latest completed sessions with their sets', () => {
    const rows = buildLatestSessionRows(items, ME, 'DD-MM-YYYY');
    expect(rows.map((row) => [row.key, row.sessionId, row.name, row.exercise, row.when, row.value, row.record])).toEqual([
      ['a', 'a', 'm-a', null, '10 Nov 26', '1 set', false],
      ['b', 'b', 'You', null, '9 Nov 26', '1 set', false],
      ['c', 'c', 'm-c', null, '8 Nov 26', '1 set', false],
      ['d', 'd', 'm-d', null, '7 Nov 26', '1 set', false],
      ['e', 'e', 'm-e', null, '6 Nov 26', '1 set', false],
    ]);
    expect(rows[0].accessibilityLabel).toBe('m-a, 10-11-2026 09:00, 1 set');
  });
});

describe('buildLatestGroupRecordRows', () => {
  type Value = CompetitionEventWire['values'][number];
  const value = (metric: CompetitionHistoricalMetric, amount: number): Value =>
    ({ role: 'record', metric, unit: 'kg', value: amount, unavailable: false, member: null });
  const gr = (id: string, member: string, atMs: number, overrides: Partial<CompetitionEventWire> = {}, metrics: CompetitionHistoricalMetric[] = ['e1rm']) => ({
    kind: 'competition' as const, key: id, sort_at_ms: atMs,
    event: { ...competitionEvent, event_id: id, session_id: `s-${id}`, sort_at_ms: atMs, member: { user_id: member, username: member },
      group_exercise: { group_exercise_id: 'ge1', name: 'Deadlift' }, values: [value('e1rm', 213.3)], ...overrides },
    record: { performance: null, previous: [], group_record_metrics: metrics },
  });

  it('lists the five latest group records, newest first, each naming its exercise and opening its session', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => gr(id, id === 'b' ? ME : `m-${id}`, local(2026, 11, 5 + index, 9)));
    const rows = buildLatestGroupRecordRows(items, ME, 'DD-MM-YYYY');
    expect(rows.map((row) => [row.key, row.memberUserId, row.sessionId, row.name, row.exercise, row.when, row.value, row.record])).toEqual([
      ['f', 'm-f', 's-f', 'm-f', 'Deadlift', '10 Nov 26', '1RM 213.3', true],
      ['e', 'm-e', 's-e', 'm-e', 'Deadlift', '9 Nov 26', '1RM 213.3', true],
      ['d', 'm-d', 's-d', 'm-d', 'Deadlift', '8 Nov 26', '1RM 213.3', true],
      ['c', 'm-c', 's-c', 'm-c', 'Deadlift', '7 Nov 26', '1RM 213.3', true],
      ['b', ME, 's-b', 'You', 'Deadlift', '6 Nov 26', '1RM 213.3', true],
    ]);
    expect(rows[0].accessibilityLabel).toBe('m-f, group record, Deadlift 1RM 213.3, 10-11-2026 09:00');
  });

  it('joins a set’s GR boards and leaves out its PR boards', () => {
    const items = [gr('a', 'm', local(2026, 11, 10, 9), { values: [value('weight', 200), value('e1rm', 213.3)] }, ['weight', 'e1rm']),
      gr('b', 'm', local(2026, 11, 9, 9), { values: [value('weight', 190), value('e1rm', 210)] }, ['weight'])];
    expect(buildLatestGroupRecordRows(items, ME, 'DD-MM-YYYY').map((row) => row.value)).toEqual(['Weight 200.0 · 1RM 213.3', 'Weight 190.0']);
  });

  it('has no row for a PR-only, provisional, withdrawn or Volume-only record, a session-less one, or a stream session', () => {
    const at = local(2026, 11, 10, 9);
    const items = [
      gr('pr', 'm', at, {}, []),
      gr('provisional', 'm', at, { provisional: true }),
      gr('voided', 'm', at, { voided: true }),
      gr('volume', 'm', at, { values: [value('volume', 2400)] }, ['volume']),
      gr('no-session', 'm', at, { session_id: null }),
      gr('no-member', 'm', at, { member: null }),
      gr('withdrawal', 'm', at, { kind: 'record_voided' }),
      { kind: 'session' as const, key: 's1', sort_at_ms: at, groups: [{ group_id: 'g1', name: 'Crew' }], session: competitionSession.session },
    ];
    expect(buildLatestGroupRecordRows(items, ME, 'DD-MM-YYYY')).toEqual([]);
  });
});
