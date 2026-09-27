/* eslint-disable import/first */
// Metric boundary failures must never turn a ratio/reps value into kg or mix
// revisions in a displayed page. These are client/server contract vectors.
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: mockRpc }) }),
}));
import {
  createGroupComparison, getGroupMetricBoard, getGroupMetricHistory,
  getGroupMetricStream, certifyGroupMetric,
} from '@/src/groups/api';
import {
  isGroupMetricBoardWire, isGroupMetricCertificationWire, isGroupMetricHistoryWire,
  isGroupMetricPodiumWire, isGroupMetricStreamItem,
} from '@/src/groups/metric-wire-guards';
import type {
  GroupMetricBoardWire, GroupMetricCertificationWire, GroupMetricEventWire,
  GroupMetricExerciseWire, GroupMetricHistoryWire, GroupMetricStreamItemWire,
  GroupPerformanceSnapshotWire,
} from '@/src/groups/metric-wire';

const exercise: GroupMetricExerciseWire = {
  group_exercise_id: 'pull', name: 'Strict pull-up', bodyweight_coefficient: 1,
  movement_standard: 'strict_pullup', loading_method: 'belt', load_input_mode: 'total_load',
  default_metric: 'relative_strength', rules_revision: 2, published_revision: 2,
  rebuilding: false, legacy: false, source_exercise_id: null, archived_at_ms: null,
};
const performance: GroupPerformanceSnapshotWire = {
  session_id: 'session', session_exercise_id: 'se', exercise_definition_id: 'def', set_id: 'set',
  weight_value: '20', weight_unit: 'kg', external_load_mode: 'added', reps_value: '5', reps: 5,
  performance_status: null, source_load_input_mode: 'total_load', movement_standard: 'strict_pullup', loading_method: 'belt',
  body_weight_status: 'known', body_weight_kg: 80, body_weight_source: 'manual', body_weight_measurement_id: null,
  body_weight_measured_at_ms: null, achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0,
};
const row: GroupMetricBoardWire['entries'][number] = {
  rank: 1, member: { user_id: 'athlete', username: 'Athlete' }, former: false,
  metric: 'relative_strength', value: 1.4, unit: 'x_bw', rules_revision: 2,
  achieved_at_ms: 1000, set_id: 'set', fingerprint: 'pin', performance,
  effective_resistance_kg: 100, external_adjustment_kg: 20, added_percent_bodyweight: 25,
  certified: false, certification_id: null,
};
const board: GroupMetricBoardWire = {
  contract_version: 2, exercise, metric: 'relative_strength', certified: false,
  rules_revision: 2, state: 'ready', entries: [row], me: row, entry_count: 1, next_cursor: null,
};
const certificate: GroupMetricCertificationWire = {
  certification_id: 'cert', certified_by: { user_id: 'witness', username: 'Witness' },
  metric: 'relative_strength', value: 1.4, unit: 'x_bw', rules_revision: 2, certified_at_ms: 2000,
  performance, includes_body_weight: true, ended_at_ms: null, end_reason: null,
};
const change: GroupMetricEventWire = {
  kind: 'rules_change', event_id: 'event', sequence: 3, group_exercise_id: 'pull', rules_revision: 2,
  sort_at_ms: 2000, member: null, previous_revision: 1, rules: exercise,
};
const history: GroupMetricHistoryWire = {
  contract_version: 2, exercise, metric: 'relative_strength', certified: false,
  revision: { rules: exercise, published_at_ms: 2000, retired_at_ms: null, reason: 'rules_change', legacy: false },
  events: [change], next_cursor: null,
};
const record: GroupMetricStreamItemWire = {
  kind: 'record', metric_event: true, key: 'record', event_id: 'record', sequence: 2,
  group: { group_id: 'group', name: 'Group' }, group_exercise: exercise,
  group_exercise_id: 'pull', rules_revision: 2, sort_at_ms: 1000, member: row.member,
  session_id: 'session', set_id: 'set', provisional: false, voided: false, performance,
  boards: [{ metric: 'relative_strength', value: 1.4, unit: 'x_bw', previous_value: null, group_record: true, fingerprint: 'pin' }],
};
const view = { groupId: 'group', groupExerciseId: 'pull', metric: 'relative_strength' as const, certified: false };
const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });
beforeEach(() => mockRpc.mockReset());

describe('unit and revision-aware group payloads', () => {
  it('accepts current and explicitly retired boards without inferring B from a current reading', () => {
    expect(isGroupMetricBoardWire(board)).toBe(true);
    expect(isGroupMetricBoardWire({ ...board, state: 'archived' })).toBe(true);
    expect(isGroupMetricCertificationWire({ ...certificate, certified_by: null })).toBe(true);
  });
  it.each([
    ['ratio labelled kg', { ...row, unit: 'kg' }],
    ['row from another revision', { ...row, rules_revision: 1 }],
    ['nonfinite score', { ...row, value: Infinity }],
    ['nonpositive score', { ...row, value: 0 }],
    ['mismatched raw set', { ...row, performance: { ...performance, set_id: 'other' } }],
    ['fabricated positive B without provenance', { ...row, performance: { ...performance, body_weight_source: null } }],
    ['false certification state', { ...row, certified: true }],
    ['strength without B', { ...row, performance: { ...performance, body_weight_status: 'missing', body_weight_kg: null, body_weight_source: null } }],
  ])('rejects %s', (_label, invalid) => {
    expect(isGroupMetricBoardWire({ ...board, entries: [invalid], me: null })).toBe(false);
  });
  it('requires rebuilding to contain no rows, rank, or pagination cursor', () => {
    const rebuilding = { ...board, exercise: { ...exercise, published_revision: null, rebuilding: true },
      state: 'rebuilding', entries: [], me: null, entry_count: 0 };
    expect(isGroupMetricBoardWire(rebuilding)).toBe(true);
    expect(isGroupMetricBoardWire({ ...rebuilding, next_cursor: 'old' })).toBe(false);
    expect(isGroupMetricBoardWire({ ...rebuilding, entries: [row] })).toBe(false);
    expect(isGroupMetricBoardWire({ ...board, exercise: rebuilding.exercise })).toBe(false);
  });
  it('reps can omit B and their certificates explicitly exclude B', () => {
    const missing = { ...performance, weight_value: '0', body_weight_status: 'missing' as const,
      body_weight_kg: null, body_weight_source: null };
    const reps = { ...row, metric: 'bodyweight_reps', value: 5, unit: 'reps', performance: missing,
      effective_resistance_kg: null, external_adjustment_kg: null, added_percent_bodyweight: null };
    expect(isGroupMetricBoardWire({ ...board, metric: 'bodyweight_reps', entries: [reps], me: null })).toBe(true);
    expect(isGroupMetricCertificationWire({ ...certificate, metric: 'bodyweight_reps', value: 5, unit: 'reps',
      performance: missing, includes_body_weight: false })).toBe(true);
    expect(isGroupMetricCertificationWire({ ...certificate, includes_body_weight: false })).toBe(false);
    expect(isGroupMetricBoardWire({ ...board, metric: 'bodyweight_reps', entries: [{ ...reps, value: 5.5 }], me: null })).toBe(false);
  });
  it('retains estimated provenance without making it a verified weigh-in', () => {
    const estimated = { ...performance, body_weight_source: 'historical_estimate', body_weight_measurement_id: 'reading',
      body_weight_measured_at_ms: 3000 };
    expect(isGroupMetricCertificationWire({ ...certificate, performance: estimated })).toBe(true);
    expect(isGroupMetricCertificationWire({ ...certificate, performance: { ...estimated, body_weight_measurement_id: null } })).toBe(false);
  });
  it('preserves the original kg-only family with an explicit legacy tag', () => {
    const legacyExercise = { ...exercise, bodyweight_coefficient: 0, default_metric: 'e1rm', legacy: true };
    expect(isGroupMetricBoardWire({ ...board, exercise: legacyExercise })).toBe(false);
    expect(isGroupMetricPodiumWire({ contract_version: 2,
      exercises: [{ legacy: true, exercise: legacyExercise, board: { podium: [] } }] })).toBe(true);
    expect(isGroupMetricPodiumWire({ contract_version: 2,
      exercises: [{ legacy: true, exercise, board: { podium: [] } }] })).toBe(false);
  });
  it('history keeps rules changes separate and rejects a cross-revision event', () => {
    expect(isGroupMetricHistoryWire(history)).toBe(true);
    expect(isGroupMetricHistoryWire({ ...history, events: [{ ...change, rules_revision: 1 }] })).toBe(false);
    expect(isGroupMetricHistoryWire({ ...history, events: [{ ...change, group_exercise_id: 'other' }] })).toBe(false);
    expect(isGroupMetricHistoryWire({ ...history, revision: { ...history.revision, legacy: true } })).toBe(false);
  });
  it('stream records and rule changes retain their value units and identities', () => {
    expect(isGroupMetricStreamItem(record)).toBe(true);
    expect(isGroupMetricStreamItem({ ...record, boards: [{ ...record.boards[0], unit: 'kg' }] })).toBe(false);
    expect(isGroupMetricStreamItem({ ...record, group_exercise: { ...exercise, rules_revision: 1 } })).toBe(false);
    expect(isGroupMetricStreamItem({ ...change, metric_event: true, key: 'event', group: record.group, group_exercise: exercise })).toBe(true);
  });
});

describe('versioned group API', () => {
  it('passes the opaque cursor and selected revision without interpreting or rewriting either', async () => {
    respond(board);
    await expect(getGroupMetricBoard({ ...view, after: 'opaque', revision: 2, limit: 3 })).resolves.toEqual(board);
    expect(mockRpc).toHaveBeenCalledWith('group_metric_board', {
      p_group_id: 'group', p_group_exercise_id: 'pull', p_metric: 'relative_strength', p_certified: false,
      p_revision: 2, p_after: 'opaque', p_limit: 3,
    });
  });
  it.each([
    { ...board, exercise: { ...exercise, group_exercise_id: 'other' } },
    { ...board, certified: true, entries: [], me: null, entry_count: 0 },
    { ...board, metric: 'absolute_strength', entries: [], me: null, entry_count: 0 },
  ])('refuses a structurally valid response belonging to a different view', async payload => {
    respond(payload);
    await expect(getGroupMetricBoard(view)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('rejects a response for a different explicit revision', async () => {
    respond(board);
    await expect(getGroupMetricBoard({ ...view, revision: 1 })).rejects.toMatchObject({ code: 'INTERNAL' });
    respond(history);
    await expect(getGroupMetricHistory({ ...view, revision: 1 })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('certifies the selected metric with both observed version and raw fingerprint', async () => {
    respond({ contract_version: 2, certification: certificate, created: true });
    await certifyGroupMetric({ ...view, memberUserId: 'athlete', setId: 'set', expectedRevision: 2, expectedFingerprint: 'pin' });
    expect(mockRpc).toHaveBeenCalledWith('group_metric_certify', {
      p_group_id: 'group', p_group_exercise_id: 'pull', p_member_user_id: 'athlete', p_set_id: 'set', p_metric: 'relative_strength',
      p_expected_revision: 2, p_expected_fingerprint: 'pin',
    });
  });
  it('rejects incompatible rules before a write', async () => {
    await expect(createGroupComparison('group', { name: 'Pull', loadInputMode: 'total_load', bodyweightCoefficient: 1,
      movementStandard: null, loadingMethod: null, defaultMetric: 'e1rm', sourceExerciseId: null })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('drops unknown future stream kinds but retains the server cursor', async () => {
    const cursor = { key: 'future', kind: 'future_event', sort_at_ms: 2000 };
    respond({ contract_version: 2, items: [record, { kind: 'future_event' }], has_more: true, next_cursor: cursor });
    await expect(getGroupMetricStream({ groupId: 'group' })).resolves.toEqual({
      contract_version: 2, items: [record], has_more: true, next_cursor: cursor,
    });
  });
  it('does not silently drop malformed known stream items', async () => {
    respond({ contract_version: 2, items: [{ ...record, boards: [{ metric: 'bodyweight_reps', value: 8, unit: 'kg' }] }],
      has_more: false, next_cursor: null });
    await expect(getGroupMetricStream({ groupId: 'group' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
