/**
 * M25-T09 board view model (card AC3, AC4, AC8; product E1.1–E1.3, P7): the
 * ordinal and date formats, route params, podium cards ("You: Nth", the empty
 * Certified label, archived), full-board rows (metric values, former, certified / uncertified on
 * All only), and every history sentence.
 */

import {
  buildBoardRow,
  buildPodiumCards,
  describeHistorySentence,
  formatBoardDate,
  formatBoardFigure,
  formatBoardViewLabel,
  formatOrdinal,
  groupBoardHistoryPath,
  groupBoardPath,
  parseBoardMetricParam,
  parseBoardScopeParam,
  type BoardHolder,
  type BoardRow,
  type GroupBoardHistoryItem,
  type GroupBoardPodiumExercise,
  type GroupExercise,
} from '@/src/groups';

const ME = 'user-me';
/** 12 Sep 2026, local noon. */
const NOW = new Date(2026, 8, 12, 12, 0).getTime();
const SEP_12 = new Date(2026, 8, 12, 9, 0).getTime();

const exercise = (id: string, name: string, archived = false): GroupExercise => ({
  group_exercise_id: id,
  name,
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: archived ? NOW : null,
});

const row = (rank: number, userId: string, username: string | null, overrides: Partial<BoardRow> = {}): BoardRow => ({
  rank,
  member: { user_id: userId, username },
  former: false,
  value_kg: 142.5,
  weight_kg: 140,
  reps: 1,
  e1rm_kg: 142.5,
  entered_weight_kg: 140,
  load_factor: 1,
  achieved_at_ms: SEP_12,
  session_id: `s-${userId}`,
  set_id: `set-${userId}`,
  exercise_name: 'Bench',
  certified: false,
  certification: null,
  ...overrides,
});

const podiumExercise = (overrides: Partial<GroupBoardPodiumExercise> = {}): GroupBoardPodiumExercise => ({
  exercise: exercise('ge1', 'Bench Press'),
  podium: [],
  me: null,
  entry_count: 0,
  all_entry_count: 0,
  ...overrides,
});

const cardFor = (entry: GroupBoardPodiumExercise) =>
  buildPodiumCards({ metric: 'e1rm', certified: true, exercises: [entry] }, ME, NOW)[0];

describe('formatting', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
  ])('formatOrdinal(%d) is %s', (value, expected) => {
    expect(formatOrdinal(value)).toBe(expected);
  });

  it('board figures carry no unit: 1RM to one decimal, Weight as the app\'s weight figure', () => {
    expect(formatBoardFigure('e1rm', 64.119)).toBe('64.1');
    expect(formatBoardFigure('e1rm', 138)).toBe('138.0');
    expect(formatBoardFigure('weight', 55)).toBe('55.0');
    expect(formatBoardFigure('weight', 51.25)).toBe('51.25');
  });

  it('dates read "12 Sep", with the year only outside the current year', () => {
    expect(formatBoardDate(SEP_12, NOW)).toBe('12 Sep');
    expect(formatBoardDate(new Date(2025, 6, 2, 9).getTime(), NOW)).toBe('2 Jul 2025');
  });

  it('view labels read 1RM (display copy only), and invalid params fall back to e1rm · Certified', () => {
    expect(formatBoardViewLabel('e1rm', 'certified')).toBe('Certified · 1RM');
    expect(formatBoardViewLabel('weight', 'all')).toBe('All · Weight');
    expect(parseBoardMetricParam('weight')).toBe('weight');
    expect(parseBoardMetricParam(['e1rm'])).toBe('e1rm');
    expect(parseBoardMetricParam('reps')).toBe('e1rm');
    expect(parseBoardMetricParam(undefined)).toBe('e1rm');
    expect(parseBoardScopeParam('all')).toBe('all');
    expect(parseBoardScopeParam('everything')).toBe('certified');
    expect(groupBoardPath('g1', 'ge1')).toBe('/group/g1/leaderboards/ge1');
    expect(groupBoardHistoryPath('g1', 'ge1', { metric: 'weight', scope: 'all' })).toBe(
      '/group/g1/leaderboards/ge1/history?metric=weight&scope=all',
    );
  });
});

describe('podium cards (E1.1)', () => {
  it('keeps server order and tags archived exercises', () => {
    const cards = buildPodiumCards(
      {
        metric: 'e1rm',
        certified: true,
        exercises: [podiumExercise(), podiumExercise({ exercise: exercise('ge2', 'Old Squat', true) })],
      },
      ME,
      NOW,
    );
    expect(cards.map((card) => [card.name, card.archived, card.viewLabel])).toEqual([
      ['Bench Press', false, 'Certified · 1RM'],
      ['Old Squat', true, 'Certified · 1RM'],
    ]);
  });

  it('shows the top 3 with "You" on my own row and no You line while I am on the podium', () => {
    const me = row(3, ME, 'dino', { value_kg: 131 });
    const card = cardFor(
      podiumExercise({
        podium: [row(1, 'u1', 'Dave'), row(2, 'u2', null, { value_kg: 138 }), me],
        me,
        entry_count: 3,
        all_entry_count: 3,
      }),
    );
    expect(card.rows.map((r) => `${r.rank} ${r.memberLabel} ${r.valueLabel} ${r.dateLabel}`)).toEqual([
      '1 Dave 142.5 12 Sep',
      '2 Unnamed member 138.0 12 Sep',
      '3 You 131.0 12 Sep',
    ]);
    expect(card.rows[2].isMe).toBe(true);
    expect(card.youLabel).toBeNull();
    expect(card.emptyLabel).toBeNull();
  });

  it('"You: Nth" below the podium', () => {
    const card = cardFor(
      podiumExercise({
        podium: [row(1, 'u1', 'a'), row(2, 'u2', 'b'), row(3, 'u3', 'c')],
        me: row(11, ME, 'dino'),
        entry_count: 11,
        all_entry_count: 11,
      }),
    );
    expect(card.youLabel).toBe('You: 11th');
  });

  it('"You: not ranked" on a non-empty board I am not on', () => {
    const card = cardFor(podiumExercise({ podium: [row(1, 'u1', 'a')], me: null, entry_count: 1, all_entry_count: 4 }));
    expect(card.youLabel).toBe('You: not ranked');
  });

  it('an empty Certified podium reads "No certified sets yet · N uncertified", or "No sets yet" with nothing on All', () => {
    const uncertified = cardFor(podiumExercise({ entry_count: 0, all_entry_count: 3 }));
    expect(uncertified.emptyLabel).toBe('No certified sets yet · 3 uncertified');
    expect(uncertified.youLabel).toBeNull();
    expect(uncertified.rows).toEqual([]);

    expect(cardFor(podiumExercise({ entry_count: 0, all_entry_count: 0 })).emptyLabel).toBe('No sets yet');
  });

  it('the card accessibility label joins the name, archived, view, podium, and You line', () => {
    const card = buildPodiumCards(
      {
        metric: 'e1rm',
        certified: true,
        exercises: [podiumExercise({ exercise: exercise('ge9', 'Prowler Push', true), all_entry_count: 1 })],
      },
      ME,
      NOW,
    )[0];
    expect(card.accessibilityLabel).toBe('Prowler Push, archived, Certified · 1RM, No certified sets yet · 1 uncertified');
  });
});

describe('full board rows (E1.2)', () => {
  it('1RM shows the estimate with the set behind it; Weight shows the set; figures carry no unit', () => {
    const e1rm = buildBoardRow(row(1, 'u1', 'Dave'), 'e1rm', 'certified', ME, NOW);
    expect([e1rm.valueLabel, e1rm.detailLabel, e1rm.certification]).toEqual(['142.5', '140.0 × 1', null]);

    const weight = buildBoardRow(row(1, 'u1', 'Dave', { value_kg: 51.25, weight_kg: 51.25, reps: 5 }), 'weight', 'certified', ME, NOW);
    expect([weight.valueLabel, weight.detailLabel]).toEqual(['51.25 × 5', null]);
  });

  it('marks former members, my row, and certified / uncertified on All only', () => {
    const former = buildBoardRow(row(4, 'u4', 'Alex', { former: true, certified: true }), 'weight', 'all', ME, NOW);
    expect(former.memberLabel).toBe('Alex (former)');
    expect(former.certification).toBe('certified');
    expect(former.accessibilityLabel).toBe('4th, Alex (former), 140.0 × 1, 12 Sep, certified');

    const mine = buildBoardRow(row(3, ME, 'dino'), 'e1rm', 'all', ME, NOW);
    expect([mine.memberLabel, mine.isMe, mine.certification]).toEqual(['You', true, 'uncertified']);
    expect(mine.accessibilityLabel).toBe('3rd, You, 1RM 142.5, 140.0 × 1, 12 Sep, uncertified');
  });
});

describe('history sentences (E1.3)', () => {
  const holder = (userId: string, username: string | null, valueKg: number): BoardHolder => ({
    member_user_id: userId,
    member: { user_id: userId, username },
    value_kg: valueKg,
    weight_kg: valueKg,
    reps: 1,
    e1rm_kg: valueKg,
    achieved_at_ms: SEP_12,
    set_id: `set-${userId}`,
    session_id: `s-${userId}`,
  });
  const certification = (
    event: 'certified' | 'withdrawn' | 'cancelled' | 'voided',
    certifier: string | null,
  ): GroupBoardHistoryItem['related'] => ({
    kind: 'certification',
    key: 'c1',
    event,
    certified_by: certifier ? { user_id: `id-${certifier}`, username: certifier } : null,
    ended_by: null,
    set_id: 'set-u1',
    weight_kg: 140,
    reps: 1,
    e1rm_kg: 142.5,
  });
  const DAVE = holder('u1', 'Dave', 142.5);
  const SAM = holder('u2', 'Sam', 138);

  const item = (overrides: Partial<GroupBoardHistoryItem>): GroupBoardHistoryItem => ({
    key: 'e1',
    seq: 1,
    occurred_at_ms: SEP_12,
    reason: 'record',
    leader: DAVE,
    previous: null,
    related: null,
    ...overrides,
  });

  it.each<[string, Partial<GroupBoardHistoryItem>, string]>([
    ['the first record', { reason: 'record' }, 'Dave set the first record · 142.5 kg'],
    ['a record taking #1', { reason: 'record', previous: SAM }, 'Dave took #1 · 142.5 kg (from Sam, 138 kg)'],
    [
      'a link',
      {
        reason: 'link',
        previous: null,
        related: {
          kind: 'link',
          key: 'l1',
          event: 'link',
          exercises: [
            { exercise_definition_id: 'd1', name: 'Bench (hotel gym)' },
            { exercise_definition_id: 'd2', name: null },
          ],
        },
      },
      'Dave took #1 · 142.5 kg (linked Bench (hotel gym), an exercise)',
    ],
    [
      'an unlink',
      {
        reason: 'link',
        leader: SAM,
        previous: DAVE,
        related: { kind: 'link', key: 'l2', event: 'unlink', exercises: [{ exercise_definition_id: 'd1', name: 'Bench' }] },
      },
      'Sam took #1 · 138 kg (Dave unlinked Bench)',
    ],
    [
      'a void (edited)',
      {
        reason: 'void',
        leader: SAM,
        previous: DAVE,
        related: { kind: 'record_voided', key: 'v1', reason: 'edited', record: { weight_kg: 140, reps: 1, e1rm_kg: 140 } },
      },
      "Sam now #1 · 138 kg (Dave's 142.5 kg removed — set edited)",
    ],
    [
      'a void that empties the board',
      {
        reason: 'void',
        leader: null,
        previous: DAVE,
        related: { kind: 'record_voided', key: 'v2', reason: 'deleted', record: { weight_kg: 140, reps: 1, e1rm_kg: 140 } },
      },
      "No one holds #1 (Dave's 142.5 kg removed — set deleted)",
    ],
    ['a certification with no related event', { reason: 'certification', previous: SAM }, 'Dave took #1 · 142.5 kg (certified)'],
    [
      'a certification given',
      { reason: 'certification', previous: SAM, related: certification('certified', 'Kim') },
      'Dave took #1 · 142.5 kg (certified by Kim)',
    ],
    [
      'a certification withdrawn',
      { reason: 'certification', leader: SAM, previous: DAVE, related: certification('withdrawn', 'Kim') },
      "Sam now #1 · 138 kg (Dave's 142.5 kg certification withdrawn)",
    ],
    [
      'a voided certification that empties the Certified board',
      { reason: 'certification', leader: null, previous: DAVE, related: certification('voided', null) },
      "No one holds #1 (Dave's 142.5 kg certification voided)",
    ],
    ['an unknown reason', { reason: 'dispute', previous: SAM }, 'Dave took #1 · 142.5 kg'],
    ['a link with no related event', { reason: 'link', related: null }, 'Dave took #1 · 142.5 kg'],
  ])('%s', (_label, overrides, expected) => {
    expect(describeHistorySentence(item(overrides), ME)).toBe(expected);
  });

  it('speaks to me: "You", "you", "your"', () => {
    const mine = holder(ME, 'dino', 150);
    expect(describeHistorySentence(item({ reason: 'record', leader: mine, previous: DAVE }), ME)).toBe(
      'You took #1 · 150 kg (from Dave, 142.5 kg)',
    );
    expect(describeHistorySentence(item({ reason: 'record', leader: DAVE, previous: mine }), ME)).toBe(
      'Dave took #1 · 142.5 kg (from you, 150 kg)',
    );
    expect(
      describeHistorySentence(
        item({
          reason: 'void',
          leader: mine,
          previous: DAVE,
          related: { kind: 'record_voided', key: 'v', reason: 'edited', record: { weight_kg: 1, reps: 1, e1rm_kg: 1 } },
        }),
        ME,
      ),
    ).toBe("You're now #1 · 150 kg (Dave's 142.5 kg removed — set edited)");
    expect(describeHistorySentence(item({ reason: 'void', leader: DAVE, previous: mine, related: null }), ME)).toBe(
      'Dave now #1 · 142.5 kg (your 150 kg removed)',
    );
  });
});
