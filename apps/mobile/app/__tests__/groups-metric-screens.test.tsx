/* eslint-disable import/first */

/** M27 metric boards, revisions and attestations through real paging/cache hooks.
 * Group RPCs are mocked; group_cache uses real migrated in-memory SQLite.
 * Legacy regression coverage remains in groups-leaderboards-screens.test.tsx.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

type MockNetInfoListener = (state: { isConnected: boolean | null }) => void;
const mockNetInfoListeners = new Set<MockNetInfoListener>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: MockNetInfoListener) => {
      mockNetInfoListeners.add(listener);
      // Tests that need "offline" from the first render set it before rendering.
      if (mockInitialOnline !== null) listener({ isConnected: mockInitialOnline });
      return () => {
        mockNetInfoListeners.delete(listener);
      };
    },
  },
}));
let mockInitialOnline: boolean | null = null;

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      void options;
      return null;
    },
  },
}));


const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => {
  const streamRead = jest.fn();
  return {
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  listMyGroups: jest.fn(),
  getGroupStream: streamRead,
  getGroupMetricStream: streamRead,
  listGroupExercises: jest.fn(),
  getGroupMetricPodiums: jest.fn(),
  getGroupBoard: jest.fn(),
  getGroupBoardHistory: jest.fn(),
  getGroupMetricBoard: jest.fn(),
  getGroupMetricRevisions: jest.fn(),
  getGroupMetricHistory: jest.fn(),
  certifyGroupMetric: jest.fn(),
  getGroupMetricCertification: jest.fn(),
  endGroupMetricCertification: jest.fn(),
  };
});

import * as groupsApi from '@/src/groups/api';
import { GroupApiError } from '@/src/groups/api';
import { buildGroupMetricPodiums } from '@/src/groups/metric-view-model';
import type { GroupMetricBoardWire, GroupMetricCertificationWire, GroupMetricExerciseWire, GroupMetricHistoryWire, GroupMetricStreamItemWire, GroupPerformanceSnapshotWire } from '@/src/groups/metric-wire';
import { GroupMetricRecordSheet } from '@/components/groups/group-metric-record-sheet';
import GroupsTabRoute from '../(tabs)/groups';
import GroupBoardRoute from '../group/[groupId]/leaderboards/[exerciseId]/index';
import GroupBoardHistoryRoute from '../group/[groupId]/leaderboards/[exerciseId]/history';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const exercise: GroupMetricExerciseWire = { group_exercise_id: 'pull', name: 'Strict pull-up', bodyweight_coefficient: 1,
  movement_standard: 'Strict pull-up', loading_method: 'Belt', load_input_mode: 'total_load', default_metric: 'relative_strength',
  rules_revision: 2, published_revision: 2, rebuilding: false, legacy: false, source_exercise_id: null, archived_at_ms: null };
const performance: GroupPerformanceSnapshotWire = { session_id: 'session', session_exercise_id: 'se', exercise_definition_id: 'def', set_id: 'set',
  weight_value: '20', weight_unit: 'kg', external_load_mode: 'added', reps_value: '5', reps: 5, performance_status: null,
  source_load_input_mode: 'total_load', movement_standard: 'Strict pull-up', loading_method: 'Belt', body_weight_status: 'known',
  body_weight_kg: 80, body_weight_source: 'historical_estimate', body_weight_measurement_id: 'reading', body_weight_measured_at_ms: 3000,
  achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0 };
const row: GroupMetricBoardWire['entries'][number] = { rank: 1, member: { user_id: 'athlete', username: 'Athlete' }, former: false,
  metric: 'relative_strength', value: 1.4, unit: 'x_bw', rules_revision: 2, achieved_at_ms: 1000, set_id: 'set', fingerprint: 'pin', performance,
  effective_resistance_kg: 100, external_adjustment_kg: 20, added_percent_bodyweight: 25, certified: false, certification_id: null };
const board: GroupMetricBoardWire = { contract_version: 2, exercise, metric: 'relative_strength', certified: true,
  rules_revision: 2, state: 'ready', entries: [row], me: null, entry_count: 1, next_cursor: null };
const certificate: GroupMetricCertificationWire = { certification_id: 'cert', certified_by: { user_id: 'me', username: 'Witness' },
  metric: 'relative_strength', value: 1.4, unit: 'x_bw', rules_revision: 2, certified_at_ms: 2000,
  performance, includes_body_weight: true, ended_at_ms: null, end_reason: null };
const history: GroupMetricHistoryWire = { contract_version: 2, exercise, metric: 'relative_strength', certified: true,
  revision: { rules: exercise, published_at_ms: 2000, retired_at_ms: null, reason: 'rules_change', legacy: false },
  events: [{ kind: 'rules_change', event_id: 'change', sequence: 3, group_exercise_id: 'pull', rules_revision: 2, sort_at_ms: 2000,
    member: null, previous_revision: 1, rules: exercise }], next_cursor: null };
const legacy = { ...exercise, bodyweight_coefficient: 0, default_metric: 'e1rm' as const, rules_revision: 1, legacy: true };

beforeEach(() => {
  jest.clearAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear(); mockInitialOnline = true;
  mockParams = { groupId: 'group', exerciseId: 'pull' };
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: 'me' } });
  api.listGroupExercises.mockResolvedValue({ exercises: [exercise] });
  api.listMyGroups.mockResolvedValue({ groups: [{ group_id: 'group', name: 'Crew', description: null, member_count: 2, my_role: 'member' }] });
  api.getGroup.mockResolvedValue({ group: { group_id: 'group', name: 'Crew', description: null, member_count: 2, my_role: 'member' }, members: [] });
  api.getGroupMetricBoard.mockResolvedValue(board);
  api.getGroupMetricRevisions.mockResolvedValue({ contract_version: 2, exercise, revisions: [history.revision,
    { rules: legacy, legacy: true, published_at_ms: 1, retired_at_ms: 2000, reason: 'initial', legacy_entries: [] }] });
  api.getGroupMetricHistory.mockResolvedValue(history);
  api.certifyGroupMetric.mockResolvedValue({ contract_version: 2, certification: certificate });
  api.getGroupMetricCertification.mockResolvedValue({ contract_version: 2, certification: certificate });
});
afterEach(() => fixture.close());

it('opens the declared default, switches units and scope, and never calls the kg-only board', async () => {
  render(<GroupBoardRoute />);
  expect(await screen.findByTestId('group-board-row-1-value')).toHaveTextContent('1.40 ×BW');
  expect(api.getGroupMetricBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'relative_strength', certified: true }));
  expect(api.getGroupBoard).not.toHaveBeenCalled();
  api.getGroupMetricBoard.mockResolvedValue({ ...board, metric: 'absolute_strength', entries: [{ ...row, metric: 'absolute_strength', unit: 'kg', value: 112 }] });
  fireEvent.press(screen.getByTestId('group-board-metric-absolute_strength'));
  expect(await screen.findByTestId('group-board-row-1-value')).toHaveTextContent('112.0 kg');
  fireEvent.press(screen.getByTestId('group-board-scope-all'));
  await waitFor(() => expect(api.getGroupMetricBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'absolute_strength', certified: false })));
});

it('does not show old rows while a complete new revision rebuilds', async () => {
  api.getGroupMetricBoard.mockResolvedValue({ ...board, exercise: { ...exercise, rebuilding: true, published_revision: 1 },
    state: 'rebuilding', entries: [], me: null, entry_count: 0 });
  render(<GroupBoardRoute />);
  expect(await screen.findByTestId('group-board-rebuilding')).toHaveTextContent(/whole board will appear together/);
  expect(screen.queryByTestId('group-board-row-1')).toBeNull();
});

it('shows estimated saved B and the exact strength dependencies before certifying', async () => {
  render(<GroupBoardRoute />);
  fireEvent.press(await screen.findByTestId('group-board-row-1'));
  expect(await screen.findByTestId('group-metric-record-weight')).toHaveTextContent(/80 kg.*Estimated from/i);
  expect(screen.getByTestId('group-metric-record-raw')).toHaveTextContent('As logged: Added 20 kg × 5');
  expect(screen.getByText(/25% of session body weight/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(api.certifyGroupMetric).toHaveBeenCalledWith(expect.objectContaining({
    memberUserId: 'athlete', setId: 'set', metric: 'relative_strength', expectedRevision: 2, expectedFingerprint: 'pin' })));
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/);
});

it('allows missing B on reps and states that the attestation excludes body weight', async () => {
  const missing = { ...performance, weight_value: '0', body_weight_status: 'missing' as const, body_weight_kg: null,
    body_weight_source: null, body_weight_measurement_id: null, body_weight_measured_at_ms: null };
  const repsExercise: GroupMetricExerciseWire = { ...exercise, default_metric: 'bodyweight_reps' };
  api.listGroupExercises.mockResolvedValue({ exercises: [repsExercise] });
  api.getGroupMetricBoard.mockResolvedValue({ ...board, exercise: { ...exercise, default_metric: 'bodyweight_reps' }, metric: 'bodyweight_reps',
    entries: [{ ...row, metric: 'bodyweight_reps', unit: 'reps', value: 5, performance: missing,
      effective_resistance_kg: null, external_adjustment_kg: null, added_percent_bodyweight: null }] });
  render(<GroupBoardRoute />);
  expect(await screen.findByTestId('group-board-row-1-value')).toHaveTextContent('5 reps');
  fireEvent.press(screen.getByTestId('group-board-row-1'));
  expect(await screen.findByTestId('group-metric-record-weight')).toHaveTextContent(/No usable weight saved/i);
  expect(screen.getByText(/not part of this metric’s certification/)).toBeTruthy();
  expect(screen.getByTestId('group-metric-record-certify')).toBeEnabled();
});

it.each(['self', 'former', 'archived'])('keeps %s performances read-only for new certification', async kind => {
  api.getGroupMetricBoard.mockResolvedValue({ ...board, exercise: { ...exercise, archived_at_ms: kind === 'archived' ? 4000 : null },
    entries: [{ ...row, member: { ...row.member, user_id: kind === 'self' ? 'me' : 'athlete' }, former: kind === 'former' }] });
  render(<GroupBoardRoute />);
  fireEvent.press(await screen.findByTestId('group-board-row-1'));
  expect(await screen.findByTestId('group-metric-record-sheet')).toBeTruthy();
  expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
});

it('keeps a stale-input refusal visible and does not retry certification automatically', async () => {
  api.certifyGroupMetric.mockRejectedValue(new GroupApiError('CONFLICT', 'Performance changed. Refresh and review.'));
  render(<GroupBoardRoute />); fireEvent.press(await screen.findByTestId('group-board-row-1'));
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-notice')).toHaveTextContent(/Performance changed/);
  expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
  expect(api.certifyGroupMetric).toHaveBeenCalledTimes(1);
  api.getGroupMetricBoard.mockResolvedValue({ ...board, entries: [{ ...row, fingerprint: 'corrected-pin', value: 1.3 }] });
  fireEvent.press(screen.getByTestId('group-metric-record-refresh'));
  await waitFor(() => expect(screen.getByTestId('group-metric-record-certify')).toBeEnabled());
  expect(api.certifyGroupMetric).toHaveBeenCalledTimes(1);
});

it('shows a revision-bound rules event and preserves original kg-only history and retirement scores', async () => {
  render(<GroupBoardHistoryRoute />);
  expect(await screen.findByTestId('group-board-history-item-3-sentence')).toHaveTextContent(/Rules changed from revision 1 to 2/);
  api.getGroupMetricHistory.mockResolvedValue({ ...history, exercise: legacy, metric: 'e1rm', revision: {
    ...history.revision, rules: legacy, legacy: true }, events: [{ legacy: true, event_id: 'old', sequence: 1,
      sort_at_ms: 1000, metric: 'e1rm', unit: 'kg', reason: 'record', payload: { leader: { member_user_id: 'athlete',
        member: row.member, value_kg: 25 } } }] });
  fireEvent.press(screen.getByTestId('group-history-revision-1'));
  expect(await screen.findByTestId('group-board-history-item-1-sentence')).toHaveTextContent(/25.0 kg.*Original kg-only rules/);
  expect(api.getGroupMetricHistory).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1, metric: 'e1rm' }));
  fireEvent.press(screen.getByTestId('group-history-view-scores'));
  expect(await screen.findByTestId('group-history-scores-empty')).toHaveTextContent('No scores in this revision');
  expect(api.getGroupMetricBoard).not.toHaveBeenCalled();
});

it('retains unit and revision on cached podium presentation and labels rebuilding separately', () => {
  const cards = buildGroupMetricPodiums({ contract_version: 2, exercises: [{ legacy: false, exercise,
    metric: 'relative_strength', certified: true, rules_revision: 2, state: 'ready', podium: [row], me: null, entry_count: 1, all_entry_count: 1 }] }, 'me');
  expect(cards[0].accessibilityLabel).toMatch(/Relative strength ×BW.*Rules 2.*1.40 ×BW/);
  expect(cards[0].rows[0].valueLabel).toBe('1.40 ×BW');
});


it('renders unit-aware records and rules events through the live stream hook and reopens cached events offline', async () => {
  const record: GroupMetricStreamItemWire = { kind: 'record', metric_event: true, key: 'metric-record', event_id: 'metric-record',
    sequence: 2, group: { group_id: 'group', name: 'Crew' }, group_exercise: exercise, group_exercise_id: 'pull', rules_revision: 2,
    sort_at_ms: 1000, member: row.member, session_id: 'session', set_id: 'set', provisional: false, voided: false, performance,
    boards: [{ metric: 'relative_strength', value: 1.4, unit: 'x_bw', previous_value: null, group_record: true, fingerprint: 'pin' }],
    record_context: { exercise, former: false, metrics: [{ metric: 'relative_strength', fingerprint: 'pin', eligible: true,
      effective_resistance_kg: 100, external_adjustment_kg: 20, added_percent_bodyweight: 25, certification: null }] } };
  const change: GroupMetricStreamItemWire = { kind: 'rules_change', metric_event: true, key: 'change', event_id: 'change', sequence: 3,
    group: record.group, group_exercise: exercise, group_exercise_id: 'pull', rules_revision: 2, sort_at_ms: 2000,
    member: null, previous_revision: 1, rules: exercise };
  api.getGroupMetricStream.mockResolvedValue({ contract_version: 2, items: [change, record], next_cursor: null, has_more: false });
  const first = render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/Relative strength.*1.40 ×BW/);
  expect(screen.getByTestId('group-metric-stream-change')).toHaveTextContent(/not a newly performed record/);
  fireEvent.press(screen.getByTestId('group-metric-stream-metric-record'));
  expect(await screen.findByTestId('group-metric-record-weight')).toHaveTextContent(/80 kg.*Estimated from/);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(api.certifyGroupMetric).toHaveBeenCalledWith(expect.objectContaining({ expectedFingerprint: 'pin', expectedRevision: 2 })));
  await waitFor(() => expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/));
  fireEvent.press(screen.getByTestId('group-metric-record-history'));
  expect(mockRouter.push).toHaveBeenCalledWith('/group/group/leaderboards/pull/history?metric=relative_strength&scope=all&revision=2');
  first.unmount();
  mockInitialOnline = false;
  api.getGroupMetricStream.mockRejectedValue(new GroupApiError('NETWORK', 'Offline'));
  render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/1.40 ×BW/);
  expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent(/Offline/);
});


it('does not restore a successful but superseded attestation when an older detail read finishes', async () => {
  let finishRead: (value: { contract_version: 2; certification: GroupMetricCertificationWire }) => void = () => {};
  api.getGroupMetricCertification.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  const props = { exercise, groupId: 'group', userId: 'me', myRole: 'member' as const,
    onClose: jest.fn(), onChanged: jest.fn().mockResolvedValue(undefined) };
  const view = render(<GroupMetricRecordSheet {...props} row={row} />);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/));
  await waitFor(() => expect(api.getGroupMetricCertification).toHaveBeenCalled());
  view.rerender(<GroupMetricRecordSheet {...props} row={{ ...row, fingerprint: 'corrected-pin', value: 1.3 }} />);
  await act(async () => { finishRead({ contract_version: 2, certification: certificate }); });
  expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent('Uncertified');
  expect(screen.getByTestId('group-metric-record-certify')).toBeEnabled();
});

it('retains a server-ended certification when connectivity changes after a successful write', async () => {
  const ended = { ...certificate, ended_at_ms: 3000, end_reason: 'cancelled' as const };
  api.getGroupMetricCertification.mockResolvedValue({ contract_version: 2, certification: ended });
  render(<GroupMetricRecordSheet exercise={exercise} groupId="group" userId="me" myRole="member" row={row}
    onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent('Certification cancelled'));
  act(() => { mockNetInfoListeners.forEach(listener => listener({ isConnected: false })); });
  expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent('Certification cancelled');
  expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
  expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
});

it('follows a replacement attestation on unchanged performance inputs', async () => {
  const ended = { ...certificate, ended_at_ms: 3000, end_reason: 'cancelled' as const };
  const replacement = { ...certificate, certification_id: 'replacement', certified_by: { user_id: 'other', username: 'New witness' } };
  api.getGroupMetricCertification.mockImplementation(async (_groupId, id) => ({
    contract_version: 2, certification: id === 'replacement' ? replacement : ended,
  }));
  const props = { exercise, groupId: 'group', userId: 'me', myRole: 'member' as const,
    onClose: jest.fn(), onChanged: jest.fn().mockResolvedValue(undefined) };
  const view = render(<GroupMetricRecordSheet {...props} row={row} />);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent('Certification cancelled'));
  view.rerender(<GroupMetricRecordSheet {...props} row={{ ...row, certified: true, certification_id: 'replacement' }} />);
  await waitFor(() => expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent(/Certified by New witness/));
  expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
});
