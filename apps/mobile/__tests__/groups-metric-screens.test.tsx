/* eslint-disable import/first */

/** Current Weight/1RM boards, revisions and attestations through the real
 * paging/cache hooks. Group RPCs are mocked; group_cache is real SQLite. */

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
let mockInitialOnline: boolean | null = null;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: MockNetInfoListener) => {
      mockNetInfoListeners.add(listener);
      if (mockInitialOnline !== null) listener({ isConnected: mockInitialOnline });
      return () => mockNetInfoListeners.delete(listener);
    },
  },
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: { Screen: ({ options }: { options?: { title?: string } }) => { void options; return null; } },
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
import type {
  GroupMetricBoardWire,
  GroupMetricCertificationWire,
  GroupMetricExerciseWire,
  GroupMetricHistoryWire,
  GroupMetricStreamItemWire,
  GroupPerformanceSnapshotWire,
} from '@/src/groups/metric-wire';
import { GroupMetricRecordSheet } from '@/components/groups/group-metric-record-sheet';
import GroupsTabRoute from '../app/(tabs)/groups';
import GroupBoardRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/index';
import GroupBoardHistoryRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/history';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const exercise: GroupMetricExerciseWire = {
  group_exercise_id: 'pull', name: 'Pull-up', bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1, load_input_mode: 'total_load', default_metric: 'e1rm',
  rules_revision: 2, published_revision: 2, rebuilding: false, legacy: false,
  source_exercise_id: null, archived_at_ms: null,
};
const performance: GroupPerformanceSnapshotWire = {
  session_id: 'session', session_exercise_id: 'session-exercise', exercise_definition_id: 'definition', set_id: 'set',
  weight_value: '20', reps_value: '5', reps: 5, performance_status: null,
  source_load_input_mode: 'total_load', achieved_at_ms: 1000, exercise_order_index: 0, set_order_index: 0,
};
const certificate: GroupMetricCertificationWire = {
  certification_id: 'certificate', certified_by: { user_id: 'me', username: 'Witness' },
  metric: 'e1rm', value: 112.5, unit: 'kg', rules_revision: 2, certified_at_ms: 2000,
  performance, ended_at_ms: null, end_reason: null,
};
const certifiedRow: GroupMetricBoardWire['entries'][number] = {
  rank: 1, member: { user_id: 'athlete', username: 'Athlete' }, former: false,
  metric: 'e1rm', value: 112.5, unit: 'kg', rules_revision: 2, achieved_at_ms: 1000,
  set_id: 'set', fingerprint: 'pin', performance, certified: true, certification_id: 'certificate',
};
const uncertifiedRow = { ...certifiedRow, certified: false, certification_id: null };
const board: GroupMetricBoardWire = {
  contract_version: 3, exercise, metric: 'e1rm', certified: true, rules_revision: 2,
  state: 'ready', entries: [certifiedRow], me: null, entry_count: 1, next_cursor: null,
};
const history: GroupMetricHistoryWire = {
  contract_version: 3, exercise, metric: 'e1rm', certified: true,
  revision: { rules: exercise, published_at_ms: 2000, retired_at_ms: null, reason: 'rules_change', legacy: false },
  events: [{ kind: 'rules_change', event_id: 'change', sequence: 3, group_exercise_id: 'pull',
    rules_revision: 2, sort_at_ms: 2000, member: null, previous_revision: 1, rules: exercise }],
  next_cursor: null,
};
const previous = { ...exercise, bodyweight_calculations_enabled: false, bodyweight_contribution: 0,
  default_metric: 'weight' as const, rules_revision: 1, published_revision: 1, legacy: true };

beforeEach(() => {
  jest.clearAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockInitialOnline = true;
  mockParams = { groupId: 'group', exerciseId: 'pull' };
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: 'me' } });
  api.listGroupExercises.mockResolvedValue({ exercises: [exercise] });
  api.listMyGroups.mockResolvedValue({ groups: [{ group_id: 'group', name: 'Crew', description: null,
    member_count: 2, my_role: 'member', bodyweight_calculations_enabled: true }] });
  api.getGroup.mockResolvedValue({ group: { group_id: 'group', name: 'Crew', description: null,
    member_count: 2, my_role: 'member', bodyweight_calculations_enabled: true }, members: [] });
  api.getGroupMetricBoard.mockResolvedValue(board);
  api.getGroupMetricRevisions.mockResolvedValue({ contract_version: 3, exercise, revisions: [history.revision,
    { rules: previous, legacy: true, published_at_ms: 1, retired_at_ms: 2000, reason: 'initial', legacy_entries: [] }] });
  api.getGroupMetricHistory.mockResolvedValue(history);
  api.certifyGroupMetric.mockResolvedValue({ contract_version: 3, certification: certificate });
  api.getGroupMetricCertification.mockResolvedValue({ contract_version: 3, certification: certificate });
  api.getGroupMetricStream.mockResolvedValue({ contract_version: 3, items: [], next_cursor: null, has_more: false });
  api.getGroupMetricPodiums.mockResolvedValue({ contract_version: 3, exercises: [] });
});
afterEach(() => fixture.close());

const settleReads = () => act(async () => {});

it('uses the ordinary Weight/1RM board presentation and scope controls', async () => {
  render(<GroupBoardRoute />);
  await settleReads();
  expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('112.5 kg');
  expect(api.getGroupMetricBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm', certified: true }));
  expect(screen.getByTestId('group-board-rules')).toHaveTextContent('Rules 2 · total Weight');

  const weightRow = { ...uncertifiedRow, metric: 'weight' as const, value: 20 };
  api.getGroupMetricBoard.mockResolvedValue({ ...board, metric: 'weight', certified: false,
    entries: [weightRow], me: null });
  fireEvent.press(screen.getByTestId('group-board-metric-weight'));
  await settleReads();
  expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('20.0 kg');
  fireEvent.press(screen.getByTestId('group-board-scope-all'));
  await settleReads();
  expect(api.getGroupMetricBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'weight', certified: false }));
  expect(api.getGroupBoard).not.toHaveBeenCalled();
});

it('does not show stale rows while a new revision rebuilds', async () => {
  api.getGroupMetricBoard.mockResolvedValue({ ...board,
    exercise: { ...exercise, rebuilding: true, published_revision: 1 },
    state: 'rebuilding', entries: [], me: null, entry_count: 0 });
  render(<GroupBoardRoute />);
  expect(await screen.findByTestId('group-board-rebuilding')).toHaveTextContent(/whole board will appear together/i);
  expect(screen.queryByTestId('group-board-row-1')).toBeNull();
});

it('shows the same raw Weight × reps detail and keeps bodyweight dependencies private', async () => {
  const onChanged = jest.fn().mockResolvedValue(undefined);
  render(<GroupMetricRecordSheet exercise={exercise} groupId="group" userId="me" myRole="member"
    row={uncertifiedRow} onClose={jest.fn()} onChanged={onChanged} />);
  expect(screen.getByTestId('group-metric-record-raw')).toHaveTextContent('As logged: Weight 20.0 kg × 5');
  expect(screen.queryByText(/body weight reading|effective resistance|external adjustment|added weight/i)).toBeNull();
  expect(screen.getByText('Rules 2 · total Weight')).toBeTruthy();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(() => expect(api.certifyGroupMetric).toHaveBeenCalledWith(expect.objectContaining({
    memberUserId: 'athlete', setId: 'set', metric: 'e1rm', expectedRevision: 2, expectedFingerprint: 'pin',
  })));
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/);
});

it.each(['self', 'former', 'archived'])('keeps %s performances read-only for new certification', kind => {
  const row = { ...uncertifiedRow, member: { ...uncertifiedRow.member, user_id: kind === 'self' ? 'me' : 'athlete' },
    former: kind === 'former' };
  const currentExercise = { ...exercise, archived_at_ms: kind === 'archived' ? 4000 : null };
  render(<GroupMetricRecordSheet exercise={currentExercise} groupId="group" userId="me" myRole="member"
    row={row} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />);
  expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
});

it('keeps a stale-input refusal visible and waits for explicit review', async () => {
  api.certifyGroupMetric.mockRejectedValue(new GroupApiError('CONFLICT', 'Performance changed. Refresh and review.'));
  render(<GroupMetricRecordSheet exercise={exercise} groupId="group" userId="me" myRole="member"
    row={uncertifiedRow} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-notice')).toHaveTextContent(/Performance changed/);
  expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
  expect(api.certifyGroupMetric).toHaveBeenCalledTimes(1);
});

it('shows revision-bound Weight/1RM history', async () => {
  render(<GroupBoardHistoryRoute />);
  expect(await screen.findByTestId('group-board-history-item-3-sentence')).toHaveTextContent(/Rules changed from revision 1 to 2/);
  fireEvent.press(screen.getByTestId('group-history-metric-weight'));
  api.getGroupMetricHistory.mockResolvedValue({ ...history, exercise: previous, metric: 'weight',
    revision: { ...history.revision, rules: previous, legacy: true },
    events: [{ legacy: true, event_id: 'old', sequence: 1, sort_at_ms: 1000, metric: 'weight', unit: 'kg',
      reason: 'record', payload: { leader: { member_user_id: 'athlete', member: certifiedRow.member, value_kg: 20 } } }] });
  fireEvent.press(screen.getByTestId('group-history-revision-1'));
  expect(await screen.findByTestId('group-board-history-item-1-sentence')).toHaveTextContent(/20.0 kg.*Original kg-only rules/);
  expect(api.getGroupMetricHistory).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1, metric: 'weight' }));
});

it('labels current podiums with ordinary Weight/1RM names and kg values', () => {
  const cards = buildGroupMetricPodiums({ contract_version: 3, exercises: [{ legacy: false, exercise,
    metric: 'e1rm', certified: true, rules_revision: 2, state: 'ready', podium: [certifiedRow],
    me: null, entry_count: 1, all_entry_count: 1 }] }, 'me');
  expect(cards[0].accessibilityLabel).toMatch(/1RM kg.*Rules 2.*112.5 kg/);
  expect(cards[0].rows[0].valueLabel).toBe('112.5 kg');
});

it('renders and reopens a cached Weight/1RM record without private bodyweight context', async () => {
  const record: GroupMetricStreamItemWire = {
    kind: 'record', metric_event: true, key: 'metric-record', event_id: 'metric-record', sequence: 2,
    group: { group_id: 'group', name: 'Crew' }, group_exercise: exercise, group_exercise_id: 'pull',
    rules_revision: 2, sort_at_ms: 1000, member: certifiedRow.member, session_id: 'session', set_id: 'set',
    provisional: false, voided: false, performance,
    boards: [{ metric: 'e1rm', value: 112.5, unit: 'kg', previous_value: null, group_record: true, fingerprint: 'pin' }],
    record_context: { exercise, former: false,
      metrics: [{ metric: 'e1rm', fingerprint: 'pin', eligible: true, certification: null }] },
  };
  api.getGroupMetricStream.mockResolvedValue({ contract_version: 3, items: [record], next_cursor: null, has_more: false });
  const first = render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/1RM.*112.5 kg/);
  fireEvent.press(screen.getByTestId('group-metric-stream-metric-record'));
  expect(await screen.findByTestId('group-metric-record-raw')).toHaveTextContent('As logged: Weight 20.0 kg × 5');
  first.unmount();

  mockInitialOnline = false;
  api.getGroupMetricStream.mockRejectedValue(new GroupApiError('NETWORK', 'Offline'));
  render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/112.5 kg/);
  expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent(/Offline/);
});
