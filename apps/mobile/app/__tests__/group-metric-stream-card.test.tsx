/**
 * One group stream event card per metric-event kind: the record card (group or
 * personal record, in progress, removed, and each certification status) and the
 * compact rows for a removed record, a link change, a rules change and a lead
 * change. Pins the visible text, the accessibility label and where a tap goes.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import type { GroupMetricCertificationWire, GroupMetricStreamItemWire } from '@/src/groups/metric-wire';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

/** 12 Sep 2026, local noon. */
const NOW = new Date(2026, 8, 12, 12, 0).getTime();
const SEP_10 = new Date(2026, 8, 10, 9, 0).getTime();
const ME = 'athlete';

beforeEach(() => {
  mockPush.mockReset();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

const RULES = {
  group_exercise_id: 'pull',
  name: 'Pull-up',
  bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1,
  load_input_mode: 'total_load' as const,
  default_metric: 'e1rm' as const,
  rules_revision: 2,
};
const PERFORMANCE = {
  session_id: 'session',
  session_exercise_id: 'session-exercise',
  exercise_definition_id: 'definition',
  set_id: 'set',
  weight_value: '20',
  reps_value: '5',
  reps: 5,
  performance_status: null,
  source_load_input_mode: 'total_load' as const,
  achieved_at_ms: SEP_10,
  exercise_order_index: 0,
  set_order_index: 0,
};
const ENVELOPE = {
  metric_event: true as const,
  key: 'event',
  event_id: 'event',
  sequence: 2,
  sort_at_ms: SEP_10,
  group: { group_id: 'group', name: 'Lifters' },
  group_exercise: RULES,
  group_exercise_id: 'pull',
  rules_revision: 2,
  member: { user_id: 'dave', username: 'Dave' },
};

const certification = (over: Partial<GroupMetricCertificationWire> = {}): GroupMetricCertificationWire => ({
  certification_id: 'cert',
  certified_by: { user_id: 'kim', username: 'Kim' },
  metric: 'e1rm',
  value: 23.3,
  unit: 'kg',
  rules_revision: 2,
  certified_at_ms: SEP_10,
  performance: PERFORMANCE,
  ended_at_ms: null,
  end_reason: null,
  ...over,
});

type RecordItem = Extract<GroupMetricStreamItemWire, { kind: 'record' }>;
const BOARDS: RecordItem['boards'] = [
  { metric: 'e1rm', value: 23.3, unit: 'kg', previous_value: 20, group_record: true, fingerprint: 'pin-1rm' },
  { metric: 'weight', value: 20, unit: 'kg', previous_value: null, group_record: false, fingerprint: 'pin-w' },
];
const record = (over: Partial<RecordItem> = {}): GroupMetricStreamItemWire => ({
  ...ENVELOPE,
  kind: 'record',
  session_id: 'session',
  set_id: 'set',
  provisional: false,
  voided: false,
  performance: PERFORMANCE,
  boards: BOARDS,
  ...over,
});
const context = (
  e1rm: GroupMetricCertificationWire | null,
  weight: GroupMetricCertificationWire | null = null,
): RecordItem['record_context'] => ({
  exercise: { ...RULES, published_revision: 2, rebuilding: false, legacy: false, source_exercise_id: null, archived_at_ms: null },
  former: false,
  metrics: [
    { metric: 'e1rm', fingerprint: 'pin-1rm', eligible: true, certification: e1rm },
    { metric: 'weight', fingerprint: 'pin-w', eligible: true, certification: weight },
  ],
});

const HOLDER = { metric: 'e1rm' as const, value: 25, unit: 'kg' as const, rules_revision: 2, member: { user_id: 'sam', username: 'Sam' }, former: false, achieved_at_ms: SEP_10, set_id: 'set-s' };
const recordVoided: GroupMetricStreamItemWire = {
  ...ENVELOPE,
  kind: 'record_voided',
  related_event_id: 'record',
  reason: 'deleted',
  performance: PERFORMANCE,
  leaders: [{ metric: 'e1rm', leader: HOLDER }, { metric: 'weight', leader: null }],
};
const link = (event: 'link' | 'unlink', ids: string[]): GroupMetricStreamItemWire => ({
  ...ENVELOPE,
  kind: 'link',
  event,
  exercise_definition_ids: ids,
  effects: [
    { metric: 'e1rm', before: null, after: { metric: 'e1rm', value: 25, unit: 'kg', rules_revision: 2, rank: 1 } },
    { metric: 'weight', before: { metric: 'weight', value: 20, unit: 'kg', rules_revision: 2, rank: 2 }, after: null },
  ],
});
const rulesChange: GroupMetricStreamItemWire = {
  ...ENVELOPE,
  kind: 'rules_change',
  member: null,
  previous_revision: 1,
  rules: { ...RULES, bodyweight_contribution: 0.5, default_metric: 'weight' },
};
const leadChange: GroupMetricStreamItemWire = {
  ...ENVELOPE,
  kind: 'lead_change',
  metric: 'weight',
  certified: false,
  reason: 'record',
  related_event_id: null,
  certification_id: null,
  leader: null,
  previous: null,
};

type CardProps = Partial<Omit<Parameters<typeof GroupMetricStreamCard>[0], 'item'>>;

const renderCard = (item: GroupMetricStreamItemWire, props: CardProps = {}) => {
  render(<GroupMetricStreamCard item={item} showGroupName={false} userId={ME} {...props} />);
  const card = screen.getByTestId(`group-metric-stream-${item.key}`);
  const texts = screen.UNSAFE_getAllByType(Text).map((node) => [node.props.children].flat().join(''));
  return { card, label: card.props.accessibilityLabel as string, texts };
};

const HISTORY = '/group/group/leaderboards/pull/history?scope=all&revision=2';

describe('record card', () => {
  it('shows a group record with each board, the raw set and the date, and opens its 1RM history', () => {
    const { card, label, texts } = renderCard(record());
    expect(texts).toEqual([
      'Dave — group record',
      'Pull-up · Rules 2',
      '1RM',
      '23.3 kg',
      'Refresh to check certification',
      'Weight',
      '20.0 kg',
      'Refresh to check certification',
      '1RM · group record',
      'Weight',
      'As logged: Weight 20 kg × 5',
      '10 Sep · View rules history',
    ]);
    expect(label).toBe(
      'Dave — group record, Pull-up · Rules 2, 1RM 23.3 kg, Refresh to check certification, Weight 20.0 kg, ' +
        'Refresh to check certification, As logged: Weight 20 kg × 5, 10 Sep',
    );
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/group/group/leaderboards/pull/history?metric=e1rm&scope=all&revision=2');
  });

  it('calls my own record "You" and a record with no group-record board a personal record', () => {
    const boards = BOARDS.map((board) => ({ ...board, group_record: false }));
    const { texts } = renderCard(record({ member: { user_id: ME, username: 'me' }, boards }));
    expect(texts[0]).toBe('You — personal record');
    expect(texts).toContain('1RM');
    expect(texts).not.toContain('1RM · group record');
  });

  it('names an unnamed member', () => {
    const { texts } = renderCard(record({ member: null }));
    expect(texts[0]).toBe('Unnamed member — group record');
  });

  it('says a session is still in progress', () => {
    const { texts } = renderCard(record({ provisional: true }));
    expect(texts).toContain('Session in progress');
  });

  it.each<[string, RecordItem['record_context'], string, string]>([
    ['certified by another member and by me', context(certification(), certification({ metric: 'weight', certified_by: { user_id: ME, username: 'me' } })), 'Certified by Kim', 'Certified by you'],
    ['uncertified', context(null), 'Uncertified', 'Uncertified'],
    ['certified by an unknown or unnamed member', context(certification({ certified_by: null }), certification({ metric: 'weight', certified_by: { user_id: 'x', username: null } })), 'Certified by a group member', 'Certified by a group member'],
    ['a certification that has ended', context(certification({ ended_at_ms: SEP_10, end_reason: 'withdrawn' })), 'Uncertified', 'Uncertified'],
  ])('shows each board as %s', (_label, recordContext, e1rmStatus, weightStatus) => {
    const { label, texts } = renderCard(record({ record_context: recordContext }));
    expect(texts.slice(2, 8)).toEqual(['1RM', '23.3 kg', e1rmStatus, 'Weight', '20.0 kg', weightStatus]);
    expect(label).toContain(`1RM 23.3 kg, ${e1rmStatus}, Weight 20.0 kg, ${weightStatus}`);
  });

  it('greys out a removed record and drops its band and certification statuses', () => {
    const { label, texts } = renderCard(record({ voided: true, record_context: context(certification()) }));
    expect(texts).toEqual([
      'Record removed',
      'Pull-up · Rules 2',
      '1RM',
      '23.3 kg',
      'Weight',
      '20.0 kg',
      '1RM · group record',
      'Weight',
      'As logged: Weight 20 kg × 5',
      'This performance no longer counts. Its original event remains in history.',
      '10 Sep · View rules history',
    ]);
    expect(label).toBe(
      'Record removed, Pull-up · Rules 2, 1RM 23.3 kg, Record removed, Weight 20.0 kg, Record removed, ' +
        'As logged: Weight 20 kg × 5, This performance no longer counts. Its original event remains in history., 10 Sep',
    );
  });

  it('on Today: names the group, uses the press hint and its own handler instead of history', () => {
    const onPress = jest.fn();
    const { card, label, texts } = renderCard(record(), { showGroupName: true, onPress, pressHint: 'Opens the group' });
    expect(texts.slice(-2)).toEqual(['Lifters', '10 Sep · Opens the group']);
    expect(label.startsWith('Lifters, Dave — group record, ')).toBe(true);
    expect(label.endsWith(', 10 Sep, Opens the group')).toBe(true);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('offers "View record" when it has a handler but no press hint', () => {
    const { texts } = renderCard(record(), { onPress: jest.fn() });
    expect(texts[texts.length - 1]).toBe('10 Sep · View record');
  });
});

describe('compact event rows', () => {
  it.each<[string, GroupMetricStreamItemWire, string[]]>([
    [
      'a removed record, with the leader per metric',
      recordVoided,
      [
        'Record removed · Pull-up · Rules 2',
        'The set was deleted. Its original record no longer counts.',
        '1RM · Sam leads with 25.0 kg',
        'Weight · no current leader',
      ],
    ],
    [
      'a corrected record',
      { ...recordVoided, reason: 'edited', leaders: [] } as GroupMetricStreamItemWire,
      ['Record removed · Pull-up · Rules 2', 'The set was corrected. Its original record no longer counts.'],
    ],
    [
      'an unlink of one exercise',
      link('unlink', ['a']),
      [
        'Dave unlinked 1 exercise · Pull-up · Rules 2',
        'The comparison changed after linking. This is not a newly performed set.',
        '1RM: not ranked → 25.0 kg',
        'Weight: 20.0 kg → not ranked',
      ],
    ],
    [
      'a link of two exercises',
      link('link', ['a', 'b']),
      [
        'Dave linked 2 exercises · Pull-up · Rules 2',
        'The comparison changed after linking. This is not a newly performed set.',
        '1RM: not ranked → 25.0 kg',
        'Weight: 20.0 kg → not ranked',
      ],
    ],
    [
      'a rules change',
      rulesChange,
      [
        'Group rules changed · Pull-up · Rules 2',
        'Rules 1 → 2. The whole board was recalculated; this is not a newly performed record.',
        'Rules 2 · total Weight',
      ],
    ],
    ['a lead change', leadChange, ['Leaderboard changed · Pull-up · Rules 2']],
    [
      'an event of a kind this build does not know',
      { ...ENVELOPE, kind: 'future_event' } as unknown as GroupMetricStreamItemWire,
      ['Leaderboard changed · Pull-up · Rules 2'],
    ],
  ])('shows %s and opens the revision history', (_label, item, lines) => {
    const { card, label, texts } = renderCard(item);
    expect(texts).toEqual([...lines, '10 Sep · View rules history']);
    const [head, ...details] = lines;
    expect(label).toBe([head.replace(' · Pull-up', ', Pull-up'), ...details, '10 Sep'].join(', '));
    expect(card.props.accessibilityHint).toBe('Opens this rules revision in history');
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith(HISTORY.replace('?', '?metric=e1rm&'));
  });

  it('on Today: names the group and uses the press hint and handler', () => {
    const onPress = jest.fn();
    const { card, label, texts } = renderCard(rulesChange, { showGroupName: true, onPress, pressHint: 'Opens the group' });
    expect(texts[0]).toBe('Lifters');
    expect(texts[texts.length - 1]).toBe('10 Sep · Opens the group');
    expect(label.startsWith('Lifters, Group rules changed, ')).toBe(true);
    expect(label.endsWith(', 10 Sep')).toBe(true);
    expect(card.props.accessibilityHint).toBe('Opens the group');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
