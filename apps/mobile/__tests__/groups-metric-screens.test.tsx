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
  // The header's title and right button render in place, so tests can read and press them.
  Stack: { Screen: ({ options }: { options?: { headerTitle?: () => mockReact.ReactNode; headerRight?: () => mockReact.ReactNode } }) =>
    mockReact.createElement(mockReact.Fragment, null, options?.headerTitle?.() ?? null, options?.headerRight?.() ?? null) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  listMyGroups: jest.fn(),
  getCompetitionStream: jest.fn(),
  listCompetitionExercises: jest.fn(),
  getCompetitionPodiums: jest.fn(),
  getCompetitionBoard: jest.fn(),
  getCompetitionRevisions: jest.fn(),
  getCompetitionHistory: jest.fn(),
  getCompetitionRecordsHistory: jest.fn(),
  certifyCompetition: jest.fn(),
  getCompetitionCertification: jest.fn(),
  endCompetitionCertification: jest.fn(),
}));

import * as groupsApi from '@/src/groups/api';
import { GroupApiError } from '@/src/groups/api';
import { buildCompetitionPodiums } from '@/src/groups/competition-view-model';
import type { CompetitionEventWire,CompetitionExerciseWire,CompetitionHistoryWire,CompetitionRecordsHistoryItemWire,CompetitionRecordsHistoryWire } from '@/src/groups/competition-wire';
import { competitionExercise,competitionRow,competitionBoard,competitionCertification,competitionEvent } from './helpers/competition-fixtures';
import { GroupMetricRecordSheet } from '@/components/groups/group-metric-record-sheet';
import GroupsTabRoute from '../app/(tabs)/groups';
import GroupBoardRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/index';
import GroupBoardHistoryRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/history';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const exercise: CompetitionExerciseWire = { ...competitionExercise,group_exercise_id: 'pull' };
const uncertifiedRow = { ...competitionRow,member: { user_id: 'athlete',username: 'Athlete' } };
const certificate = { ...competitionCertification,certified_by: { user_id: 'me',username: 'Witness' } };
const certifiedRow = { ...uncertifiedRow,certification: certificate };
const board = { ...competitionBoard,group_exercise_id: 'pull',certified: true,entries: [certifiedRow] };
const history: CompetitionHistoryWire = { contract_version: 4,exercise,metric: 'e1rm',certified: true,
  revision: { rules_revision: 2,representation_version: 4,rules: { bodyweight_calculations_enabled: true,
    bodyweight_contribution: 1,load_input_mode: 'total_load',default_metric: 'e1rm' },
    published_at_ms: 2000,retired_at_ms: null,reason: 'rules_change',legacy: false },
  events: [{ ...competitionEvent,kind: 'rules_change',event_id: 'change',sequence: 3,values: [],record_context: null }],next_cursor: null };
const member = (user_id: string, username: string) => ({ user_id,username });
const pct = (role: 'record' | 'previous' | 'leader', value: number, who: { user_id: string; username: string }) =>
  ({ role,metric: 'e1rm' as const,unit: 'percent_bw',value,added_e1rm_percent_bw: value - 100,unavailable: false,member: who });
const recordItem = (id: string, sequence: number, who: { user_id: string; username: string }, value: number,
  { lead = false, previousBest = null as number | null, passed = null as { user_id: string; username: string } | null, revision = 2 } = {}): CompetitionRecordsHistoryItemWire => {
  const event: CompetitionEventWire = { ...competitionEvent,event_id: id,sequence,member: who,rules_revision: revision,
    sort_at_ms: Date.UTC(2026,10,sequence),values: [pct('record',value,who)] };
  return { event,previous_best: previousBest === null ? null : pct('previous',previousBest,who),
    record: { performance: competitionRow.performance,group_record_metrics: lead ? ['e1rm'] : [],
      previous: passed ? [{ value: pct('previous',value - 5,passed),performance: null }] : [] } };
};
const rulesItem: CompetitionRecordsHistoryItemWire = { record: null,previous_best: null,
  event: { ...competitionEvent,kind: 'rules_change',event_id: 'change',sequence: 3,member: null,metric: null,
    sort_at_ms: Date.UTC(2026,10,3),values: [],record_context: null } };
const recordsLog: CompetitionRecordsHistoryWire = { contract_version: 4,exercise,metric: 'e1rm',certified: false,next_cursor: null,items: [
  recordItem('took',6,member('me','Me'),216,{ lead: true,passed: member('other','Duca') }),
  recordItem('raised',5,member('other','Duca'),200.3,{ previousBest: 196.2 }),
  rulesItem,
  recordItem('first',2,member('rival','Jem'),170.1,{ revision: 1 })] };
const previous = { ...history.revision,rules_revision: 1,representation_version: 3 as const,legacy: true,
  retired_at_ms: 2000,rules: { ...history.revision.rules,bodyweight_calculations_enabled: false,
    bodyweight_contribution: 0,default_metric: 'weight' as const } };
beforeEach(() => {
  jest.clearAllMocks();fixture=createInMemoryDatabase();mockNetInfoListeners.clear();mockInitialOnline=true;
  mockParams={ groupId: 'group',exerciseId: 'pull' };mockUseAuth.mockReturnValue({ isConfigured: true,user: { id: 'me' } });
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4,exercises: [exercise] });
  const group={ group_id: 'group',name: 'Crew',description: null,member_count: 2,my_role: 'member' as const,bodyweight_calculations_enabled: true };
  api.listMyGroups.mockResolvedValue({ groups: [group] });api.getGroup.mockResolvedValue({ group,members: [] });
  api.getCompetitionBoard.mockResolvedValue(board);
  api.getCompetitionRevisions.mockResolvedValue({ contract_version: 4,exercise,revisions: [history.revision,previous] });
  api.getCompetitionHistory.mockResolvedValue(history);
  api.getCompetitionRecordsHistory.mockResolvedValue(recordsLog);
  api.certifyCompetition.mockResolvedValue({ contract_version: 4,certification: certificate,created: true });
  api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: certificate });
  api.getCompetitionStream.mockResolvedValue({ contract_version: 4,items: [],next_cursor: null,has_more: false });
  api.getCompetitionPodiums.mockResolvedValue({ contract_version: 4,certified: false,podiums: [] });
});
afterEach(() => fixture.close());
const settleReads=()=>act(async()=>{});
it('shows normalized 1RM and Volume with explicit units and independent Certified/All controls',async()=>{
  mockParams={ ...mockParams,scope: 'certified' };
  render(<GroupBoardRoute />);await settleReads();
  expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('45.7 %BW');
  expect(api.getCompetitionBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm',certified: true }));
  expect(screen.queryByTestId('group-board-rules')).toBeNull();
  expect(screen.queryByText(/Rules \d|contribution|Bodyweight scoring|Scores use|Ineligible/)).toBeNull();
  api.getCompetitionBoard.mockResolvedValue({ ...board,metric: 'volume',certified: false,
    entries: [{ ...uncertifiedRow,metric: 'volume',unit: 'percent_bw_reps',value: 650 }] });
  expect(screen.getByTestId('group-board-title-view')).toHaveTextContent('1RM %BW leaderboard');
  expect(screen.getByTestId('group-board-scope')).toHaveTextContent('Certified');
  fireEvent.press(screen.getByTestId('group-board-metric'));await settleReads();
  expect(screen.getByTestId('group-board-metric')).toHaveTextContent('Volume');
  expect(screen.getByTestId('group-board-title-view')).toHaveTextContent('Volume %BW leaderboard');
  expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('650.0 %BW');
  fireEvent.press(screen.getByTestId('group-board-scope'));await settleReads();
  expect(screen.getByTestId('group-board-scope')).toHaveTextContent('All sets');
  expect(api.getCompetitionBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'volume',certified: false }));
});
it('hides rows while a new revision rebuilds',async()=>{
  api.getCompetitionBoard.mockResolvedValue({ ...board,state: 'rebuilding',entries: [],entry_count: 0 });
  render(<GroupBoardRoute />);
  expect(await screen.findByTestId('group-board-rebuilding')).toHaveTextContent(/whole board will appear together/i);
  expect(screen.queryByTestId('group-board-row-1')).toBeNull();
});
it('normalized record details show reps and certify the random server token',async()=>{
  render(<GroupMetricRecordSheet exercise={exercise} groupId="group" userId="me" myRole="member"
    row={uncertifiedRow} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />);
  expect(screen.getByTestId('group-metric-record-raw')).toHaveTextContent('5 reps');
  expect(screen.queryByText(/Weight .*kg|body weight reading|effective resistance/i)).toBeNull();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({
    memberId: 'athlete',setId: 'set1',metric: 'e1rm',revision: 2,token: 'server-random-token' })));
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/);
});
it.each(['self','former','archived'])('keeps %s performances read-only',kind=>{
  const row={ ...uncertifiedRow,member: { ...uncertifiedRow.member,user_id: kind==='self'?'me':'athlete' },former: kind==='former' };
  render(<GroupMetricRecordSheet exercise={{ ...exercise,archived_at_ms: kind==='archived'?4000:null }}
    groupId="group" userId="me" myRole="member" row={row} onClose={jest.fn()} onChanged={jest.fn()} />);
  expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
});
it('holds a stale-input refusal for explicit review',async()=>{
  api.certifyCompetition.mockRejectedValue(new GroupApiError('CONFLICT','Performance changed. Refresh and review.'));
  render(<GroupMetricRecordSheet exercise={exercise} groupId="group" userId="me" myRole="member"
    row={uncertifiedRow} onClose={jest.fn()} onChanged={jest.fn()} />);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-notice')).toHaveTextContent(/The score changed/);
  expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();expect(api.certifyCompetition).toHaveBeenCalledTimes(1);
});
it('board options: History keeps the view; Exercise rules only for owners and admins',async()=>{
  render(<GroupBoardRoute />);await settleReads();
  fireEvent.press(screen.getByTestId('group-board-options-button'));
  expect(screen.queryByTestId('group-board-rules-button')).toBeNull();
  fireEvent.press(screen.getByTestId('group-board-history-button'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/group/group/leaderboards/pull/history?metric=e1rm&scope=all');
  const admin={ group_id: 'group',name: 'Crew',description: null,member_count: 2,my_role: 'admin' as const,bodyweight_calculations_enabled: true };
  api.getGroup.mockResolvedValue({ group: admin,members: [] });
  render(<GroupBoardRoute />);await settleReads();
  fireEvent.press(screen.getAllByTestId('group-board-options-button').at(-1)!);
  fireEvent.press(screen.getByTestId('group-board-rules-button'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/group/group/exercises/pull/edit');
});
it('history: a records log across rules revisions, with two cycle filters',async()=>{
  render(<GroupBoardHistoryRoute />);
  expect(await screen.findByTestId('group-board-history-item-took')).toBeTruthy();
  expect(api.getCompetitionRecordsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm',certified: false }));
  expect(screen.getByTestId('group-history-title-view')).toHaveTextContent('1RM %BW history');
  expect(screen.getByTestId('group-board-history-item-took-lead')).toBeTruthy();
  expect(screen.getByTestId('group-board-history-item-took')).toHaveProp('accessibilityLabel',
    expect.stringMatching(/^New number one, You took #1, 116.0 %BW, 5 reps · passed Duca, 06-11-2026$/));
  expect(screen.getByTestId('group-board-history-item-raised-best')).toBeTruthy();
  expect(screen.getByTestId('group-board-history-item-raised-detail')).toHaveTextContent('5 reps · +4.1 %BW on best');
  expect(screen.getByTestId('group-board-history-item-change')).toHaveProp('accessibilityLabel','Rules changed · 03-11-2026');
  expect(screen.getByTestId('group-board-history-item-first')).toHaveProp('accessibilityLabel',expect.stringMatching(/first entry.*earlier rules$/));
  expect(screen.queryByTestId('group-history-view')).toBeNull();
  api.getCompetitionRecordsHistory.mockResolvedValue({ ...recordsLog,metric: 'volume',items: [] });
  fireEvent.press(screen.getByTestId('group-history-metric'));await settleReads();
  expect(screen.getByTestId('group-history-metric')).toHaveTextContent('Volume');
  expect(api.getCompetitionRecordsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'volume',certified: false }));
  expect(mockRouter.setParams).toHaveBeenLastCalledWith({ metric: 'volume',scope: 'all' });
  expect(screen.getByTestId('group-board-history-empty')).toHaveTextContent('No records yet');
  api.getCompetitionRecordsHistory.mockResolvedValue({ ...recordsLog,metric: 'volume',certified: true,items: [] });
  fireEvent.press(screen.getByTestId('group-history-scope'));await settleReads();
  expect(screen.getByTestId('group-history-scope')).toHaveTextContent('Certified');
  expect(api.getCompetitionRecordsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'volume',certified: true }));
  expect(screen.getByTestId('group-board-history-empty')).toHaveTextContent('No certified #1 yet');
});
it('history: a deep link with an unknown metric opens the comparison default',async()=>{
  mockParams={ groupId: 'group',exerciseId: 'pull',metric: 'weight',scope: 'all' };
  render(<GroupBoardHistoryRoute />);await settleReads();
  expect(api.getCompetitionRecordsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm',certified: false }));
  expect(screen.getByTestId('group-history-scope')).toHaveTextContent('All sets');
});
it('labels podiums with normalized units',()=>{
  const cards=buildCompetitionPodiums({ contract_version: 4,certified: true,podiums: [{ exercise,board }] },'me', 'DD-MM-YYYY');
  expect(cards[0].accessibilityLabel).toMatch(/1RM %BW.*45.7 %BW/);
  expect(cards[0].viewLabel).toBe('Certified · 1RM %BW');
});
it('reopens the closed cached stream offline without private context',async()=>{
  const event={ ...competitionEvent,event_id: 'metric-record',group: { group_id: 'group',name: 'Crew' },
    group_exercise: { group_exercise_id: 'pull',name: 'Pull-up' },
    record_context: { ...competitionEvent.record_context!,exercise } };
  api.getCompetitionStream.mockResolvedValue({ contract_version: 4,items: [{ kind: 'competition',key: 'metric-record',sort_at_ms: 2000,event }],next_cursor: null,has_more: false });
  const first=render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/1RM.*45.7 %BW/);
  fireEvent.press(screen.getByTestId('group-metric-stream-metric-record'));
  expect(await screen.findByTestId('group-metric-record-set')).toHaveTextContent('5 reps');first.unmount();
  mockInitialOnline=false;api.getCompetitionStream.mockRejectedValue(new GroupApiError('NETWORK','Offline'));
  render(<GroupsTabRoute />);
  expect(await screen.findByTestId('group-metric-stream-metric-record')).toHaveTextContent(/45.7 %BW/);
  expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent(/Offline/);
});
