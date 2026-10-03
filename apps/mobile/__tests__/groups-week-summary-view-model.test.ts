/**
 * Today's group card rules over a `group_week_summary` payload: the top three
 * and the caller's own line, the bars, and the three latest-activity forms.
 * Pure; the suite runs in Europe/London (jest.config.js).
 */

import {
  buildLatestActivity,
  buildWeekBoard,
  buildGroupRecordLine,
  formatTrainingStart,
  joinNames,
  type GroupWeekBoardRow,
  type GroupWeekLatestSession,
  type GroupWeekRecord,
  type GroupWeekTrainingSession,
} from '@/src/groups';

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

const record = (name: string, boards: GroupWeekRecord['boards']): GroupWeekRecord => ({
  key: `${name}-record`,
  group_exercise: { group_exercise_id: `${name}-id`, name },
  set_id: `${name}-set`,
  boards,
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
  it('keeps the top three and adds my line, at my shared rank, when I am outside them', () => {
    const board = buildWeekBoard(
      [row('dave', 1, 58, 3), row('maria', 2, 39, 1), row('sam', 3, 35, 2), row(ME, 4, 21), row('tom', 5, 3)],
      ME,
    );

    expect(board.rows.map((entry) => [entry.rank, entry.name, entry.workingSets, entry.groupRecords])).toEqual([
      [1, 'dave', 58, 3],
      [2, 'maria', 39, 1],
      [3, 'sam', 35, 2],
    ]);
    expect(board.me).toEqual({ rankLabel: '4th', workingSets: 21, groupRecords: 0 });
  });

  it('names me You inside the three, with no extra line', () => {
    const board = buildWeekBoard([row('dave', 1, 58), row(ME, 2, 42, 2), row('maria', 3, 39)], ME);

    expect(board.rows[1]).toMatchObject({ name: 'You', isMe: true });
    expect(board.me).toBeNull();
  });

  it('finds me by user id when a tie at third pushes me to the fourth row', () => {
    const board = buildWeekBoard([row('dave', 1, 30), row('maria', 2, 20), row('sam', 3, 10), row(ME, 3, 10)], ME);

    expect(board.rows.map((entry) => entry.userId)).toEqual(['dave', 'maria', 'sam']);
    expect(board.me).toEqual({ rankLabel: '3rd', workingSets: 10, groupRecords: 0 });
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
});

describe('buildLatestActivity', () => {
  it('shows one member training now, opening their session', () => {
    const activity = buildLatestActivity({ training_now: [training('maria')], latest_completed: completed() }, ME, NOW);

    expect(activity).toEqual({
      kind: 'training',
      memberUserId: 'maria',
      sessionId: 'maria-live',
      name: 'maria',
      context: 'Started 07:40 · Iron Works',
      figures: '7 W/sets · 3 exercises',
      accessibilityLabel: 'maria, training now, Started 07:40 · Iron Works, 7 W/sets · 3 exercises',
    });
  });

  it('collapses several training now into one row with their names and gyms', () => {
    const activity = buildLatestActivity(
      {
        training_now: [
          training('maria'),
          training(ME, { gym_name: 'Canal Street Gym' }),
          training('tom', { gym_name: ' Iron Works ' }),
          training('sam', { gym_name: null }),
        ],
        latest_completed: null,
      },
      ME,
      NOW,
    );

    expect(activity).toEqual({
      kind: 'several',
      count: 4,
      names: 'maria, You, tom and sam',
      gyms: 'Iron Works · Canal Street Gym',
      accessibilityLabel: '4 training now: maria, You, tom and sam, Iron Works · Canal Street Gym',
    });
  });

  it('falls back to the latest completed session with its group record', () => {
    const activity = buildLatestActivity(
      {
        training_now: [],
        latest_completed: completed({
          group_records: [record('Deadlift', [{ metric: 'weight', value: 200, unit: 'kg' }, { metric: 'e1rm', value: 213.3, unit: 'kg' }])],
        }),
      },
      ME,
      NOW,
    );

    expect(activity).toEqual({
      kind: 'completed',
      memberUserId: 'dave',
      sessionId: 'dave-done',
      name: 'dave',
      status: 'Completed · 52m',
      context: '10/16 06:10 · Iron Works',
      figures: '18 W/sets · 4 exercises',
      record: { lead: 'Deadlift 1RM 213.3', note: 'group record' },
      accessibilityLabel: 'dave, Completed · 52m, 10/16 06:10 · Iron Works, 18 W/sets · 4 exercises, Deadlift 1RM 213.3 · group record',
    });
  });

  it('derives a missing duration from the completion time, and reads plain Completed without either', () => {
    const derived = buildLatestActivity({ training_now: [], latest_completed: completed({ duration_sec: null }) }, ME, NOW);
    const bare = buildLatestActivity(
      { training_now: [], latest_completed: completed({ duration_sec: null, completed_at_ms: null, gym_name: null }) },
      ME,
      NOW,
    );

    expect(derived).toMatchObject({ status: 'Completed · 52m' });
    expect(bare).toMatchObject({ status: 'Completed', context: '10/16 06:10', record: null });
  });

  it('is null for a group with no live or completed session', () => {
    expect(buildLatestActivity({ training_now: [], latest_completed: null }, ME, NOW)).toBeNull();
  });
});

describe('formatting', () => {
  it('names a start time today by the clock, and an earlier day by its date', () => {
    expect(formatTrainingStart(local(2026, 10, 16, 7, 40), NOW)).toBe('Started 07:40');
    expect(formatTrainingStart(local(2026, 10, 15, 23, 10), NOW)).toBe('Started 10/15 23:10');
  });

  it('joins names the way the line reads them', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['a'])).toBe('a');
    expect(joinNames(['a', 'b'])).toBe('a and b');
  });

  it('leads a record line with its first record and counts the rest', () => {
    expect(buildGroupRecordLine([])).toBeNull();
    expect(buildGroupRecordLine([record('Bench', [{ metric: 'weight', value: 100, unit: 'kg' }])])).toEqual({
      lead: 'Bench Weight 100.0',
      note: 'group record',
    });
    expect(
      buildGroupRecordLine([record('Squat', []), record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }])]),
    ).toEqual({ lead: 'Squat', note: '2 group records' });
  });
});
