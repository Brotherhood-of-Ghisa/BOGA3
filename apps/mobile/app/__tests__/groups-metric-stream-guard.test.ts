/**
 * The group stream item guard, kind by kind. `getGroupMetricStream` rejects the
 * whole page when one item of a rendered kind fails this guard, so every kind
 * gets a valid item and one rejection per check. Record context is covered in
 * `groups-metric-api.test.ts`.
 */

import { isGroupMetricStreamItem, isRenderedGroupMetricStreamKind } from '@/src/groups/metric-wire-guards';

const MEMBER = { user_id: 'athlete', username: 'Athlete' };
const GROUP = { group_id: 'group', name: 'Group' };
const RULES = {
  group_exercise_id: 'pull',
  name: 'Pull-up',
  bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1,
  load_input_mode: 'total_load',
  default_metric: 'e1rm',
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
  source_load_input_mode: 'total_load',
  achieved_at_ms: 1000,
  exercise_order_index: 0,
  set_order_index: 0,
};
const HOLDER = {
  metric: 'e1rm',
  value: 112.5,
  unit: 'kg',
  rules_revision: 2,
  member: MEMBER,
  former: false,
  achieved_at_ms: 1000,
  set_id: 'set',
};

type Item = Record<string, unknown>;

const session: Item = {
  kind: 'session',
  key: 'session',
  sort_at_ms: 1000,
  member: MEMBER,
  session_id: 'session',
  groups: [],
  exercises: [],
};
const membership: Item = { kind: 'membership', key: 'join', sort_at_ms: 1000, group: GROUP, member: MEMBER, event: 'joined' };

const legacyEnvelope: Item = {
  legacy: true,
  key: 'legacy',
  sort_at_ms: 1000,
  group: GROUP,
  group_exercise: { group_exercise_id: 'pull' },
  rules_revision: 1,
};
const legacyRecord: Item = { ...legacyEnvelope, kind: 'record', boards: [{ metric: 'weight', value_kg: 100 }] };

const metricEnvelope: Item = {
  metric_event: true,
  key: 'event',
  event_id: 'event',
  sequence: 2,
  sort_at_ms: 1000,
  group: GROUP,
  group_exercise: RULES,
  group_exercise_id: 'pull',
  rules_revision: 2,
  member: MEMBER,
};
const record: Item = {
  ...metricEnvelope,
  kind: 'record',
  session_id: 'session',
  set_id: 'set',
  provisional: false,
  voided: false,
  performance: PERFORMANCE,
  boards: [{ metric: 'e1rm', value: 112.5, unit: 'kg', previous_value: null, group_record: true, fingerprint: 'pin' }],
};
const recordVoided: Item = {
  ...metricEnvelope,
  kind: 'record_voided',
  related_event_id: 'record',
  reason: 'edited',
  performance: PERFORMANCE,
  leaders: [{ metric: 'e1rm', leader: HOLDER }, { metric: 'weight', leader: null }],
};
const link: Item = {
  ...metricEnvelope,
  kind: 'link',
  event: 'unlink',
  exercise_definition_ids: ['definition'],
  effects: [
    { metric: 'e1rm', before: null, after: { metric: 'e1rm', value: 112.5, unit: 'kg', rules_revision: 2, rank: 1 } },
  ],
};
const rulesChange: Item = {
  ...metricEnvelope,
  kind: 'rules_change',
  member: null,
  previous_revision: 1,
  rules: { ...RULES },
};

describe('stream item guard: valid items of every kind', () => {
  it.each<[string, Item]>([
    ['session', session],
    ['membership', membership],
    ['legacy record', legacyRecord],
    ['legacy record removed', { ...legacyEnvelope, kind: 'record_voided' }],
    ['legacy link', { ...legacyEnvelope, kind: 'link' }],
    ['record', record],
    ['record removed', recordVoided],
    ['link', link],
    ['rules change', rulesChange],
    ['membership left', { ...membership, event: 'left' }],
    ['link with no rank before or after', { ...link, event: 'link', effects: [{ metric: 'weight', before: null, after: null }] }],
  ])('accepts a %s', (_label, item) => {
    expect(isGroupMetricStreamItem(item)).toBe(true);
  });
});

describe('stream item guard: rejections', () => {
  it.each<[string, unknown]>([
    // Envelope
    ['a non-object', 'record'],
    ['an array', [record]],
    ['a missing key', { ...record, key: undefined }],
    ['a fractional sort time', { ...record, sort_at_ms: 1.5 }],
    // Session
    ['a session without a member', { ...session, member: null }],
    ['a session with a malformed member', { ...session, member: { user_id: 1, username: null } }],
    ['a session without a session id', { ...session, session_id: 7 }],
    ['a session without groups', { ...session, groups: null }],
    ['a session without exercises', { ...session, exercises: {} }],
    // Group reference
    ['an item without a group', { ...membership, group: null }],
    ['a group without an id', { ...membership, group: { name: 'Group' } }],
    ['a group without a name', { ...membership, group: { group_id: 'group' } }],
    // Membership
    ['a membership without a member', { ...membership, member: undefined }],
    ['a membership with an unknown event', { ...membership, event: 'banned' }],
    // Group exercise reference
    ['an exercise event without a group exercise', { ...record, group_exercise: null }],
    ['a group exercise without an id', { ...record, group_exercise: { ...RULES, group_exercise_id: 3 } }],
    // Legacy items
    ['a legacy item with a fractional revision', { ...legacyRecord, rules_revision: 1.5 }],
    ['a legacy item of an unrendered kind', { ...legacyEnvelope, kind: 'rules_change' }],
    ['a legacy record without boards', { ...legacyRecord, boards: undefined }],
    ['a legacy record board that is not an object', { ...legacyRecord, boards: [null] }],
    ['a legacy record board of another metric', { ...legacyRecord, boards: [{ metric: 'reps', value_kg: 100 }] }],
    ['a legacy record board with a zero value', { ...legacyRecord, boards: [{ metric: 'e1rm', value_kg: 0 }] }],
    ['a legacy record board with a non-finite value', { ...legacyRecord, boards: [{ metric: 'e1rm', value_kg: Infinity }] }],
    // Metric event envelope
    ['an event not marked as a metric event', { ...record, metric_event: false }],
    ['an event without an event id', { ...record, event_id: null }],
    ['an event with a fractional sequence', { ...record, sequence: 2.5 }],
    ['an event with a fractional sort time in the base', { ...record, sort_at_ms: Number.NaN }],
    ['an event without a group exercise id', { ...record, group_exercise_id: undefined }],
    ['an event at revision zero', { ...record, rules_revision: 0, group_exercise: { ...RULES, rules_revision: 0 } }],
    ['an event with a malformed member', { ...record, member: { user_id: 'athlete' } }],
    ['an event whose rules are invalid', { ...record, group_exercise: { ...RULES, bodyweight_contribution: 2 } }],
    ['an event whose rules carry a private calculation field', { ...record, group_exercise: { ...RULES, body_weight_kg: 80 } }],
    ['an event at another revision than its rules', { ...record, rules_revision: 3 }],
    ['an event for another exercise than its rules', { ...record, group_exercise_id: 'squat' }],
    ['an event of an unknown kind', { ...record, kind: 'lead_change' }],
    ['an event whose kind is an inherited object name', { ...record, kind: 'toString' }],
    ['an event whose kind is not a string', { ...record, kind: ['record'] }],
    // Record
    ['a record without a member', { ...record, member: null }],
    ['a record with malformed record context', { ...record, record_context: null }],
    ['a record without a session id', { ...record, session_id: null }],
    ['a record without a set id', { ...record, set_id: null }],
    ['a record without a provisional flag', { ...record, provisional: 'no' }],
    ['a record without a voided flag', { ...record, voided: undefined }],
    ['a record with a malformed performance', { ...record, performance: { ...PERFORMANCE, reps: 0 } }],
    ['a record whose performance is another set', { ...record, performance: { ...PERFORMANCE, set_id: 'other' } }],
    ['a record whose performance is another session', { ...record, performance: { ...PERFORMANCE, session_id: 'other' } }],
    ['a record without boards', { ...record, boards: null }],
    ['a record with no boards', { ...record, boards: [] }],
    ['a record board with a private field', { ...record, boards: [{ ...(record.boards as Item[])[0], body_weight_kg: 80 }] }],
    ['a record board with a non-numeric previous value', { ...record, boards: [{ ...(record.boards as Item[])[0], previous_value: '1' }] }],
    ['a record board without a group-record flag', { ...record, boards: [{ ...(record.boards as Item[])[0], group_record: 1 }] }],
    ['a record board without a fingerprint', { ...record, boards: [{ ...(record.boards as Item[])[0], fingerprint: null }] }],
    // Record removed
    ['a removal without the removed event id', { ...recordVoided, related_event_id: null }],
    ['a removal with an unknown reason', { ...recordVoided, reason: 'merged' }],
    ['a removal with a malformed performance', { ...recordVoided, performance: null }],
    ['a removal without leaders', { ...recordVoided, leaders: null }],
    ['a removal leader entry that is not an object', { ...recordVoided, leaders: ['e1rm'] }],
    ['a removal leader of an unknown metric', { ...recordVoided, leaders: [{ metric: 'reps', leader: null }] }],
    ['a removal leader for another metric', { ...recordVoided, leaders: [{ metric: 'weight', leader: HOLDER }] }],
    ['a removal leader at another revision', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, rules_revision: 1 } }] }],
    ['a removal leader without a member', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, member: null } }] }],
    ['a removal leader without a former flag', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, former: null } }] }],
    ['a removal leader without an achieved time', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, achieved_at_ms: '1000' } }] }],
    ['a removal leader without a set id', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, set_id: 4 } }] }],
    ['a removal leader with a zero value', { ...recordVoided, leaders: [{ metric: 'e1rm', leader: { ...HOLDER, value: 0 } }] }],
    // Link
    ['a link with an unknown event', { ...link, event: 'relink' }],
    ['a link without exercise ids', { ...link, exercise_definition_ids: 'definition' }],
    ['a link with a non-string exercise id', { ...link, exercise_definition_ids: [1] }],
    ['a link without effects', { ...link, effects: undefined }],
    ['a link effect that is not an object', { ...link, effects: [1] }],
    ['a link effect of an unknown metric', { ...link, effects: [{ metric: 'reps', before: null, after: null }] }],
    [
      'a link rank for another metric',
      { ...link, effects: [{ metric: 'weight', before: null, after: { metric: 'e1rm', value: 1, unit: 'kg', rules_revision: 2, rank: 1 } }] },
    ],
    [
      'a link rank at another revision',
      { ...link, effects: [{ metric: 'e1rm', before: { metric: 'e1rm', value: 1, unit: 'kg', rules_revision: 1, rank: 1 }, after: null }] },
    ],
    [
      'a link rank of zero',
      { ...link, effects: [{ metric: 'e1rm', before: null, after: { metric: 'e1rm', value: 1, unit: 'kg', rules_revision: 2, rank: 0 } }] },
    ],
    [
      'a link rank that is not a metric value',
      { ...link, effects: [{ metric: 'e1rm', before: null, after: { metric: 'e1rm', value: 1, unit: 'lb', rules_revision: 2, rank: 1 } }] },
    ],
    // Rules change
    ['a rules change without a previous revision', { ...rulesChange, previous_revision: null }],
    ['a rules change that does not move forward', { ...rulesChange, previous_revision: 2 }],
    ['a rules change with invalid rules', { ...rulesChange, rules: { ...RULES, default_metric: 'reps' } }],
    ['a rules change whose rules are another revision', { ...rulesChange, rules: { ...RULES, rules_revision: 3 } }],
  ])('rejects %s', (_label, item) => {
    expect(isGroupMetricStreamItem(item)).toBe(false);
  });
});

describe('rendered stream kinds', () => {
  it.each(['session', 'membership', 'record', 'record_voided', 'link', 'rules_change'])('renders %s', (kind) => {
    expect(isRenderedGroupMetricStreamKind(kind)).toBe(true);
  });

  it.each(['lead_change', 'future_event', undefined])('does not render %s', (kind) => {
    expect(isRenderedGroupMetricStreamKind(kind)).toBe(false);
  });
});
