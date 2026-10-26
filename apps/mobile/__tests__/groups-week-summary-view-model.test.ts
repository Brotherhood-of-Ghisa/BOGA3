/**
 * Today's group card rules over a `group_competition_week_summary` payload: the top five
 * and the caller's own line, the bars, and up to four sessions, live first.
 * Pure; the suite runs in Europe/London (jest.config.js).
 */

import {
  GROUP_SESSIONS_SHOWN,
  buildGroupSessions,
  buildWeekBoard,
  buildGroupRecordLine,
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
    const { live, recent } = buildGroupSessions({ training_now: [training('maria')], latest_completed: null }, [], ME, NOW);

    expect(recent).toEqual([]);
    expect(live).toEqual([{
      memberUserId: 'maria',
      sessionId: 'maria-live',
      name: 'maria',
      when: 'Started 07:40',
      live: true,
      gym: 'Iron Works',
      figures: '3 exercises · 7 sets so far',
      record: null,
      accessibilityLabel: 'maria, training now, Started 07:40, at Iron Works, 3 exercises · 7 sets so far',
    }]);
  });

  it("draws a completed session by its start in Today's format, naming one group record", () => {
    const { recent } = buildGroupSessions(
      {
        training_now: [],
        latest_completed: completed({ group_records: [record('Deadlift', [{ metric: 'e1rm', value: 213.3, unit: 'kg' }])] }),
      },
      [],
      ME,
      NOW,
    );

    expect(recent).toEqual([{
      memberUserId: 'dave',
      sessionId: 'dave-done',
      name: 'dave',
      when: '16 Oct 26 06:10',
      live: false,
      gym: 'Iron Works',
      figures: '4 exercises · 18 sets',
      record: { kind: 'one', lead: 'Deadlift 1RM 213.3', note: 'group record' },
      accessibilityLabel: 'dave, completed session on 16 Oct 26 06:10, at Iron Works, 4 exercises · 18 sets, Deadlift 1RM 213.3 · group record',
    }]);
  });

  it('shows four in all, live first, then the latest completed and the stream, each session once', () => {
    const stream = [
      completed({ session_id: 'dave-done' }),
      completed({ session_id: 'maria-live' }),
      completed({ session_id: 'older-1', gym_name: null }),
      completed({ session_id: 'older-2' }),
      completed({ session_id: 'older-3' }),
    ];
    const sessions = buildGroupSessions(
      { training_now: [training('maria'), training(ME)], latest_completed: completed() },
      stream,
      ME,
      NOW,
    );

    expect(GROUP_SESSIONS_SHOWN).toBe(4);
    expect(sessions.live.map((session) => [session.sessionId, session.name])).toEqual([['maria-live', 'maria'], ['me-live', 'You']]);
    expect(sessions.recent.map((session) => session.sessionId)).toEqual(['dave-done', 'older-1']);
    expect(sessions.recent[1]).toMatchObject({ gym: null, accessibilityLabel: 'dave, completed session on 16 Oct 26 06:10, 4 exercises · 18 sets' });
  });

  it('gives every slot to live sessions when four or more are training', () => {
    const live = ['a', 'b', 'c', 'd', 'e'].map((id) => training(id));
    const sessions = buildGroupSessions({ training_now: live, latest_completed: completed() }, [], ME, NOW);
    expect(sessions.live).toHaveLength(4);
    expect(sessions.recent).toEqual([]);
  });

  it('is empty for a group with no live or completed session', () => {
    expect(buildGroupSessions({ training_now: [], latest_completed: null }, [], ME, NOW)).toEqual({ live: [], recent: [] });
  });
});

describe('formatting', () => {
  it('names a start time today by the clock, and an earlier day by its date', () => {
    expect(formatTrainingStart(local(2026, 10, 16, 7, 40), NOW)).toBe('Started 07:40');
    expect(formatTrainingStart(local(2026, 10, 15, 23, 10), NOW)).toBe('Started 15 Oct 26 23:10');
  });

  it('names one group record and only counts several, one per board taken', () => {
    expect(buildGroupRecordLine([])).toBeNull();
    // A record that took no listed board (no `record` value) adds nothing.
    expect(buildGroupRecordLine([record('Squat', [])])).toBeNull();
    expect(buildGroupRecordLine([record('Bench', [{ metric: 'weight', value: 100, unit: 'kg' }])])).toEqual({
      kind: 'one',
      lead: 'Bench Weight 100.0',
      note: 'group record',
    });
    expect(buildGroupRecordLine([record('Squat', []), record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }])]))
      .toEqual({ kind: 'one', lead: 'Bench 1RM 120.0', note: 'group record' });
    // One set #1 on Weight and on 1RM is two group records.
    expect(buildGroupRecordLine([record('Deadlift', [{ metric: 'weight', value: 200, unit: 'kg' }, { metric: 'e1rm', value: 213.3, unit: 'kg' }])]))
      .toEqual({ kind: 'many', count: '2 group records' });
  });

  it('counts the boards the session view shows: no Volume, no provisional or voided record', () => {
    // A record that took 1RM and Volume is one group record here and one row
    // on the session's Group records card, which never shows Volume.
    expect(buildGroupRecordLine([record('Squat', [{ metric: 'e1rm', value: 150, unit: 'kg' }, { metric: 'volume', value: 2400, unit: 'kg' }])]))
      .toEqual({ kind: 'one', lead: 'Squat 1RM 150.0', note: 'group record' });
    // A Volume-only record shows nowhere on the session, so it does not count.
    expect(buildGroupRecordLine([record('Bench', [{ metric: 'volume', value: 2400, unit: 'kg' }])])).toBeNull();
    // A provisional or voided record can still move or is gone: the session
    // view hides both, so neither counts.
    expect(buildGroupRecordLine([
      record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }]),
      { ...record('Squat', [{ metric: 'e1rm', value: 150, unit: 'kg' }]), provisional: true },
      { ...record('Deadlift', [{ metric: 'e1rm', value: 200, unit: 'kg' }]), voided: true },
    ])).toEqual({ kind: 'one', lead: 'Bench 1RM 120.0', note: 'group record' });
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
  const session = (sessionId: string, status: 'completed' | 'active' | 'draft' = 'completed') => ({
    kind: 'session' as const, key: sessionId, sort_at_ms: 1, groups: [{ group_id: 'g1', name: 'Crew' }],
    session: { ...competitionSession.session, session_id: sessionId, status },
  });
  const recordFor = (sessionId: string | null, overrides: Partial<CompetitionEventWire> = {}) => ({
    kind: 'competition' as const, key: `record-${sessionId}-${overrides.event_id ?? ''}`, sort_at_ms: 1,
    event: { ...competitionEvent, session_id: sessionId, ...overrides },
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
    expect(sessions[1].group_records).toEqual([]);
  });
});
