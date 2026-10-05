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
  groupRecordBoards,
  joinNames,
  type GroupWeekBoardRow,
  type GroupWeekTrainingSession,
} from '@/src/groups';

import { competitionEvent } from './helpers/competition-fixtures';
import type { CompetitionEventWire,CompetitionHistoricalMetric,CompetitionWeekSummaryWire } from '@/src/groups/competition-wire';
type GroupWeekLatestSession = NonNullable<CompetitionWeekSummaryWire['latest_completed']>;
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
      stamp: 'Started 07:40',
      duration: null,
      gym: 'Iron Works',
      figures: '7 sets · 3 exercises',
      record: null,
      accessibilityLabel: 'maria, training now, Started 07:40, at Iron Works, 7 sets · 3 exercises',
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
          group_records: [record('Deadlift', [{ metric: 'e1rm', value: 213.3, unit: 'kg' }])],
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
      stamp: '10/16 06:10',
      duration: '52m',
      gym: 'Iron Works',
      figures: '18 sets · 4 exercises',
      record: { kind: 'one', lead: 'Deadlift 1RM 213.3 kg', note: 'group record' },
      accessibilityLabel:
        'dave, completed session on 10/16 06:10, 52m, at Iron Works, 18 sets · 4 exercises, Deadlift 1RM 213.3 kg · group record',
    });
  });

  it('derives a missing duration from the completion time, and shows none without either', () => {
    const derived = buildLatestActivity({ training_now: [], latest_completed: completed({ duration_sec: null }) }, ME, NOW);
    const bare = buildLatestActivity(
      { training_now: [], latest_completed: completed({ duration_sec: null, completed_at_ms: null, gym_name: null }) },
      ME,
      NOW,
    );

    expect(derived).toMatchObject({ duration: '52m' });
    expect(bare).toMatchObject({ stamp: '10/16 06:10', duration: null, gym: null, record: null });
    expect(bare?.accessibilityLabel).toBe('dave, completed session on 10/16 06:10, 18 sets · 4 exercises');
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

  it('names one group record and only counts several, one per board taken', () => {
    expect(buildGroupRecordLine([])).toBeNull();
    // A record that took no listed board (no `record` value) adds nothing.
    expect(buildGroupRecordLine([record('Squat', [])])).toBeNull();
    expect(buildGroupRecordLine([record('Bench', [{ metric: 'weight', value: 100, unit: 'kg' }])])).toEqual({
      kind: 'one',
      lead: 'Bench Weight 100.0 kg',
      note: 'group record',
    });
    expect(buildGroupRecordLine([record('Squat', []), record('Bench', [{ metric: 'e1rm', value: 120, unit: 'kg' }])]))
      .toEqual({ kind: 'one', lead: 'Bench 1RM 120.0 kg', note: 'group record' });
    // One set #1 on Weight and on 1RM is two group records.
    expect(buildGroupRecordLine([record('Deadlift', [{ metric: 'weight', value: 200, unit: 'kg' }, { metric: 'e1rm', value: 213.3, unit: 'kg' }])]))
      .toEqual({ kind: 'many', count: '2 group records' });
    expect(buildGroupRecordLine([
      record('Squat', [{ metric: 'e1rm', value: 150, unit: 'kg' }]),
      record('Bench', [{ metric: 'volume', value: 2400, unit: 'kg' }]),
    ])).toEqual({ kind: 'many', count: '2 group records' });
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
