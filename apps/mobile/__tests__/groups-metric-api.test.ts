/* eslint-disable import/first */
// The public group boundary exposes ordinary Weight/1RM values and raw set
// inputs. Bodyweight readings and evaluator-only dependencies stay private.
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: mockRpc }) }),
}));

import {
  certifyGroupMetric,
  createGroupComparison,
  getGroupMetricBoard,
  getGroupMetricHistory,
  getGroupMetricCertification,
  getGroupMetricStream,
} from '@/src/groups/api';
import {
  isGroupMetricBoardWire,
  isGroupMetricCertificationWire,
  isGroupMetricHistoryWire,
  isGroupMetricPodiumWire,
  isGroupMetricStreamItem,
} from '@/src/groups/metric-wire-guards';
import type {
  GroupMetricBoardWire,
  GroupMetricCertificationWire,
  GroupMetricEventWire,
  GroupMetricExerciseWire,
  GroupMetricHistoryWire,
  GroupMetricStreamItemWire,
  GroupPerformanceSnapshotWire,
} from '@/src/groups/metric-wire';

const exercise: GroupMetricExerciseWire = {
  group_exercise_id: 'pull',
  name: 'Pull-up',
  bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1,
  load_input_mode: 'total_load',
  default_metric: 'e1rm',
  rules_revision: 2,
  published_revision: 2,
  rebuilding: false,
  legacy: false,
  source_exercise_id: null,
  archived_at_ms: null,
};
const performance: GroupPerformanceSnapshotWire = {
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
const row: GroupMetricBoardWire['entries'][number] = {
  rank: 1,
  member: { user_id: 'athlete', username: 'Athlete' },
  former: false,
  metric: 'e1rm',
  value: 112.5,
  unit: 'kg',
  rules_revision: 2,
  achieved_at_ms: 1000,
  set_id: 'set',
  fingerprint: 'pin',
  performance,
  certified: false,
  certification_id: null,
};
const board: GroupMetricBoardWire = {
  contract_version: 3,
  exercise,
  metric: 'e1rm',
  certified: false,
  rules_revision: 2,
  state: 'ready',
  entries: [row],
  me: row,
  entry_count: 1,
  next_cursor: null,
};
const certificate: GroupMetricCertificationWire = {
  certification_id: 'certificate',
  certified_by: { user_id: 'witness', username: 'Witness' },
  metric: 'e1rm',
  value: 112.5,
  unit: 'kg',
  rules_revision: 2,
  certified_at_ms: 2000,
  performance,
  ended_at_ms: null,
  end_reason: null,
};
const change: GroupMetricEventWire = {
  kind: 'rules_change',
  event_id: 'event',
  sequence: 3,
  group_exercise_id: 'pull',
  rules_revision: 2,
  sort_at_ms: 2000,
  member: null,
  previous_revision: 1,
  rules: exercise,
};
const history: GroupMetricHistoryWire = {
  contract_version: 3,
  exercise,
  metric: 'e1rm',
  certified: false,
  revision: {
    rules: exercise,
    published_at_ms: 2000,
    retired_at_ms: null,
    reason: 'rules_change',
    legacy: false,
  },
  events: [change],
  next_cursor: null,
};
const record: GroupMetricStreamItemWire = {
  kind: 'record',
  metric_event: true,
  key: 'record',
  event_id: 'record',
  sequence: 2,
  group: { group_id: 'group', name: 'Group' },
  group_exercise: exercise,
  group_exercise_id: 'pull',
  rules_revision: 2,
  sort_at_ms: 1000,
  member: row.member,
  session_id: 'session',
  set_id: 'set',
  provisional: false,
  voided: false,
  performance,
  boards: [
    { metric: 'e1rm', value: 112.5, unit: 'kg', previous_value: null, group_record: true, fingerprint: 'pin' },
  ],
};
const view = { groupId: 'group', groupExerciseId: 'pull', metric: 'e1rm' as const, certified: false };
const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });

beforeEach(() => mockRpc.mockReset());

describe('Weight/1RM group payloads', () => {
  it('accepts current and retained Weight/1RM payloads', () => {
    expect(isGroupMetricBoardWire(board)).toBe(true);
    expect(isGroupMetricBoardWire({ ...board, state: 'archived' })).toBe(true);
    expect(isGroupMetricCertificationWire({ ...certificate, certified_by: null })).toBe(true);
    const legacyExercise = { ...exercise, bodyweight_calculations_enabled: false, bodyweight_contribution: 0,
      default_metric: 'weight' as const, legacy: true };
    expect(isGroupMetricPodiumWire({ contract_version: 3,
      exercises: [{ legacy: true, exercise: legacyExercise, board: { podium: [] } }] })).toBe(true);
  });

  it.each([
    ['wrong unit', { ...row, unit: 'reps' }],
    ['another revision', { ...row, rules_revision: 1 }],
    ['nonfinite score', { ...row, value: Infinity }],
    ['nonpositive score', { ...row, value: 0 }],
    ['mismatched raw set', { ...row, performance: { ...performance, set_id: 'other' } }],
    ['private reading', { ...row, performance: { ...performance, body_weight_kg: 80 } }],
    ['private dependency digest', { ...row, performance: { ...performance, body_weight_dependency_digest: 'private' } }],
    ['false certification state', { ...row, certified: true }],
  ])('rejects %s', (_label, invalid) => {
    expect(isGroupMetricBoardWire({ ...board, entries: [invalid], me: null })).toBe(false);
  });

  it('requires a rebuilding response to be empty', () => {
    const rebuilding = { ...board, exercise: { ...exercise, published_revision: null, rebuilding: true },
      state: 'rebuilding', entries: [], me: null, entry_count: 0 };
    expect(isGroupMetricBoardWire(rebuilding)).toBe(true);
    expect(isGroupMetricBoardWire({ ...rebuilding, next_cursor: 'old' })).toBe(false);
    expect(isGroupMetricBoardWire({ ...rebuilding, entries: [row] })).toBe(false);
    expect(isGroupMetricBoardWire({ ...board, exercise: rebuilding.exercise })).toBe(false);
  });

  it('keeps history and record context bound to the same metric and revision', () => {
    expect(isGroupMetricHistoryWire(history)).toBe(true);
    expect(isGroupMetricHistoryWire({ ...history, events: [{ ...change, rules_revision: 1 }] })).toBe(false);
    expect(isGroupMetricHistoryWire({ ...history, events: [{ ...change, group_exercise_id: 'other' }] })).toBe(false);

    const context = { exercise, former: false, metrics: [{ metric: 'e1rm' as const, fingerprint: 'pin', eligible: true,
      certification: certificate }] };
    expect(isGroupMetricStreamItem({ ...record, record_context: context })).toBe(true);
    expect(isGroupMetricStreamItem({ ...record, record_context: { ...context,
      metrics: [{ ...context.metrics[0], write_fingerprint: 'current-score-pin' }] } })).toBe(true);
    for (const write_fingerprint of [null, 1, '']) {
      expect(isGroupMetricStreamItem({ ...record, record_context: { ...context,
        metrics: [{ ...context.metrics[0], write_fingerprint }] } })).toBe(false);
    }
    expect(isGroupMetricStreamItem({ ...record, record_context: { ...context, former: true } })).toBe(false);
    expect(isGroupMetricStreamItem({ ...record, record_context: { ...context,
      metrics: [{ ...context.metrics[0], fingerprint: 'other' }] } })).toBe(false);
    expect(isGroupMetricStreamItem({ ...record, record_context: { ...context,
      metrics: [{ ...context.metrics[0], certification: { ...certificate, metric: 'weight' } }] } })).toBe(false);
  });

  it('accepts both ordinary metrics and rejects any other metric at the wire boundary', () => {
    const weightRow = { ...row, metric: 'weight' as const, value: 20 };
    expect(isGroupMetricBoardWire({ ...board, metric: 'weight', entries: [weightRow], me: weightRow })).toBe(true);
    expect(isGroupMetricStreamItem(record)).toBe(true);
    expect(isGroupMetricStreamItem({ ...record, boards: [{ ...record.boards[0], metric: 'reps' }] })).toBe(false);
    expect(isGroupMetricStreamItem({ ...record, group_exercise: { ...exercise, rules_revision: 1 } })).toBe(false);
  });
});

it.each(['observed_set_pin', 'reading_pin', 'current_fingerprint', 'legacy_certification_id', 'rule_rescore_baseline', 'source_rules_only'])(
  'rejects the internal %s before a board or attestation reaches UI/cache', key => {
    expect(isGroupMetricBoardWire({ ...board, entries: [{ ...row, [key]: 'internal' }] })).toBe(false);
    expect(isGroupMetricCertificationWire({ ...certificate, [key]: 'internal' })).toBe(false);
    expect(isGroupMetricStreamItem({ ...record, [key]: 'internal' })).toBe(false);
  },
);

describe('versioned group API', () => {
  it('reads the selected metric of a shared legacy witness and rejects a different metric', async () => {
    respond({ contract_version: 3, certification: certificate });
    await expect(getGroupMetricCertification('group', certificate.certification_id, 'e1rm')).resolves.toMatchObject({ certification: certificate });
    expect(mockRpc).toHaveBeenCalledWith('group_metric_certification_get', {
      p_group_id: 'group', p_certification_id: certificate.certification_id, p_metric: 'e1rm',
    });
    respond({ contract_version: 3, certification: certificate });
    await expect(getGroupMetricCertification('group', certificate.certification_id, 'weight')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('passes the opaque cursor and selected revision unchanged', async () => {
    respond(board);
    await expect(getGroupMetricBoard({ ...view, after: 'opaque', revision: 2, limit: 3 })).resolves.toEqual(board);
    expect(mockRpc).toHaveBeenCalledWith('group_metric_board', {
      p_group_id: 'group', p_group_exercise_id: 'pull', p_metric: 'e1rm', p_certified: false,
      p_revision: 2, p_after: 'opaque', p_limit: 3,
    });
  });

  it.each([
    { ...board, exercise: { ...exercise, group_exercise_id: 'other' } },
    { ...board, certified: true, entries: [], me: null, entry_count: 0 },
    { ...board, metric: 'weight', entries: [], me: null, entry_count: 0 },
  ])('refuses a valid response for another view', async payload => {
    respond(payload);
    await expect(getGroupMetricBoard(view)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('rejects a response for another explicit revision', async () => {
    respond(board);
    await expect(getGroupMetricBoard({ ...view, revision: 1 })).rejects.toMatchObject({ code: 'INTERNAL' });
    respond(history);
    await expect(getGroupMetricHistory({ ...view, revision: 1 })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('certifies the selected metric with its revision and fingerprint', async () => {
    respond({ contract_version: 3, certification: certificate, created: true });
    await certifyGroupMetric({ ...view, memberUserId: 'athlete', setId: 'set',
      expectedRevision: 2, expectedFingerprint: 'pin' });
    expect(mockRpc).toHaveBeenCalledWith('group_metric_certify', {
      p_group_id: 'group', p_group_exercise_id: 'pull', p_member_user_id: 'athlete',
      p_set_id: 'set', p_metric: 'e1rm', p_expected_revision: 2, p_expected_fingerprint: 'pin',
    });
  });

  it('rejects invalid contribution before a comparison write', async () => {
    await expect(createGroupComparison('group', { name: 'Pull-up', loadInputMode: 'total_load',
      bodyweightCalculationsEnabled: true, bodyweightContribution: 1.2, defaultMetric: 'e1rm',
      sourceExerciseId: null })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('drops unknown future stream kinds but retains the server cursor', async () => {
    const cursor = { key: 'future', kind: 'future_event', sort_at_ms: 2000 };
    respond({ contract_version: 3, items: [record, { kind: 'future_event' }], has_more: true, next_cursor: cursor });
    await expect(getGroupMetricStream({ groupId: 'group' })).resolves.toEqual({
      contract_version: 3, items: [record], has_more: true, next_cursor: cursor,
    });
  });

  it('does not silently drop a malformed known stream item', async () => {
    respond({ contract_version: 3,
      items: [{ ...record, boards: [{ ...record.boards[0], metric: 'reps' }] }],
      has_more: false, next_cursor: null });
    await expect(getGroupMetricStream({ groupId: 'group' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
