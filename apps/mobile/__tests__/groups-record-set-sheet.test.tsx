/* eslint-disable import/first */
/** Stream and board certification paths over real SQLite. Historical values
 * keep original units; writes use the current public standard and random token. */
import * as mockReact from 'react';
import { Alert,type AlertButton } from 'react-native';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react-native';
import { createInMemoryDatabase,type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionGroup,competitionGroupDetail,competitionExercise,competitionEvent,competitionBoard,
  competitionRow,competitionCertification } from './helpers/competition-fixtures';
import type { CompetitionEventWire } from '@/src/groups/competition-wire';
let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap',()=>({ bootstrapLocalDataLayer:()=>Promise.resolve(mockFixture.database) }));
let mockOnline: boolean|null=true;
jest.mock('@react-native-community/netinfo',()=>({ __esModule: true,default: {
  addEventListener:(listener: (value: { isConnected: boolean|null })=>void)=>{listener({ isConnected: mockOnline });return ()=>undefined;} } }));
const mockRouter={ push: jest.fn(),setParams: jest.fn() };
let mockParams: Record<string,string>={};
jest.mock('expo-router',()=>({ useRouter:()=>mockRouter,useLocalSearchParams:()=>mockParams,
  useFocusEffect:(callback: ()=>void|(()=>void))=>mockReact.useEffect(()=>callback(),[callback]),Stack: { Screen:()=>null } }));
const mockUseAuth=jest.fn();
jest.mock('@/src/auth',()=>({ useAuth:()=>mockUseAuth() }));
jest.mock('@/src/groups/api',()=>({ ...jest.requireActual('@/src/groups/api'),listMyGroups: jest.fn(),getGroup: jest.fn(),
  listCompetitionExercises: jest.fn(),getCompetitionStream: jest.fn(),getCompetitionBoard: jest.fn(),
  certifyCompetition: jest.fn(),getCompetitionCertification: jest.fn(),endCompetitionCertification: jest.fn() }));
import * as groupsApi from '@/src/groups/api';
import { GroupApiError } from '@/src/groups/api';
import { groupCacheKeys,writeGroupCache } from '@/src/groups/cache';
import { setLastViewedGroupId } from '@/src/groups';
import GroupsTabRoute from '../app/(tabs)/groups';
import GroupBoardRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/index';
const api=groupsApi as jest.Mocked<typeof groupsApi>;
const page=(event: CompetitionEventWire=competitionEvent)=>({ contract_version: 4 as const,
  items: [{ kind: 'competition' as const,key: event.event_id,sort_at_ms: event.sort_at_ms,event }],next_cursor: null,has_more: false });
const mine={ ...competitionCertification,certified_by: { user_id: 'me',username: 'Me' },observed_rules_revision: 2 };
const role=(my_role: 'owner'|'admin'|'member')=>{
  api.listMyGroups.mockResolvedValue({ groups: [{ ...competitionGroup,my_role }] });
  api.getGroup.mockResolvedValue({ ...competitionGroupDetail,group: { ...competitionGroup,my_role } });
};
const openRecord=async()=>{render(<GroupsTabRoute />);fireEvent.press(await screen.findByTestId('group-metric-stream-event1'));await screen.findByTestId('group-metric-record-sheet');};
const confirm=async(spy: jest.SpyInstance)=>{
  const buttons=spy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async()=>buttons.find(button=>button.style==='destructive')?.onPress?.());
};
beforeEach(()=>{
  jest.clearAllMocks();mockFixture=createInMemoryDatabase();mockOnline=true;mockParams={ groupId: 'g1',exerciseId: 'ge1',scope: 'all' };
  mockUseAuth.mockReturnValue({ isConfigured: true,user: { id: 'me' } });setLastViewedGroupId(null);role('member');
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4,exercises: [competitionExercise] });
  api.getCompetitionStream.mockResolvedValue(page());api.getCompetitionBoard.mockResolvedValue(competitionBoard);
  api.certifyCompetition.mockResolvedValue({ contract_version: 4,certification: mine,created: true });
  api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: mine });
  api.endCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: { ...mine,ended_at_ms: 3000,end_reason: 'withdrawn' } });
});
afterEach(()=>{mockFixture.close();jest.restoreAllMocks();});
const sheet=()=>within(screen.getByTestId('group-metric-record-sheet'));
it('shows the new record, its set and both links, with no explanatory or rules text',async()=>{
  await openRecord();
  expect(sheet().getByText('New record')).toBeTruthy();
  expect(screen.getByTestId('group-metric-record-e1rm-value')).toHaveTextContent('145.7 %BW');
  expect(screen.getByTestId('group-metric-record-set')).toHaveTextContent('5 reps');
  expect(screen.getByTestId('group-metric-record-who')).toHaveTextContent(/^Friend · /);
  expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent('Not certified');
  expect(sheet().queryByText(/Rules|rules|As logged|attests|Historical|retain|unit/)).toBeNull();
  expect(screen.queryByTestId('group-metric-record-metric-row')).toBeNull();
  expect(screen.queryByText(/Weight .*kg|bodyweight reading|digest/i)).toBeNull();
  fireEvent.press(screen.getByTestId('group-metric-record-session'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/group-session/other/s1?groupId=g1');
  fireEvent.press(await screen.findByTestId('group-metric-stream-event1'));
  fireEvent.press(await screen.findByTestId('group-metric-record-board'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/group/g1/leaderboards/ge1?metric=e1rm&scope=all');
});
it('lists every record metric, 1RM first, under one certification for the set',async()=>{
  const context=competitionEvent.record_context!;
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,
    values: [{ ...competitionEvent.values[0],metric: 'volume',unit: 'percent_bw_reps',value: 650 },competitionEvent.values[0]],
    record_context: { ...context,metrics: [{ ...context.metrics[0],metric: 'volume',write_token: 'volume-token' },...context.metrics] } }));
  await openRecord();
  const metrics=sheet().getAllByTestId(/^group-metric-record-(e1rm|volume)$/).map(node=>node.props.testID);
  expect(metrics).toEqual(['group-metric-record-e1rm','group-metric-record-volume']);
  expect(screen.getByTestId('group-metric-record-volume-value')).toHaveTextContent('650.0 %BW·reps');
  expect(sheet().getAllByTestId('group-metric-record-status')).toHaveLength(1);
  expect(sheet().getAllByTestId('group-metric-record-certify')).toHaveLength(1);
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({ metric: 'e1rm',token: competitionRow.write_token })));
  expect(api.certifyCompetition).toHaveBeenCalledTimes(1);
});
it('shows the set as logged and the group previous #1 from the record stream',async()=>{
  const ordinary={ visibility: 'ordinary' as const,session_id: 's1',session_exercise_id: 'se1',exercise_definition_id: 'd1',set_id: 'set1',
    reps: 5,performance_status: null,source_load_input_mode: 'total_load' as const,achieved_at_ms: 1,exercise_order_index: 0,set_order_index: 0,weight_value: '120' };
  const event={ ...competitionEvent,visibility: 'ordinary' as const,values: [{ ...competitionEvent.values[0],unit: 'kg',value: 140 }] };
  api.getCompetitionStream.mockResolvedValue({ contract_version: 4,next_cursor: null,has_more: false,items: [{ kind: 'competition',
    key: event.event_id,sort_at_ms: event.sort_at_ms,event,record: { performance: ordinary,previous: [{
      value: { role: 'previous',metric: 'e1rm',unit: 'kg',value: 130,unavailable: false,member: { user_id: 'sam',username: 'Sam' } },
      performance: { ...ordinary,set_id: 'set0',weight_value: '110' } }] } }] });
  await openRecord();
  expect(screen.getByTestId('group-metric-record-set')).toHaveTextContent('120.0 × 5');
  expect(screen.getByTestId('group-metric-record-previous-e1rm')).toHaveTextContent(/1RM.*130\.0 kg.*Sam · 110\.0 × 5/);
});
it('keeps historical kg values distinct from the current normalized standard',async()=>{
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,representation_version: 3,visibility: 'ordinary',rules_revision: 1,
    values: [{ ...competitionEvent.values[0],unit: 'kg',value: 112.5 }] }));
  await openRecord();expect(screen.getByTestId('group-metric-record-e1rm-value')).toHaveTextContent('112.5 kg');
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({ revision: 2,token: competitionRow.write_token })));
});
it('certifies from the stream sheet and refreshes the selected group',async()=>{
  await openRecord();const reads=api.getCompetitionStream.mock.calls.length;
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent(/Certified by you/);
  await waitFor(()=>expect(api.getCompetitionStream.mock.calls.length).toBeGreaterThan(reads));
  expect(api.certifyCompetition).toHaveBeenCalledTimes(1);
});
it.each(['self','former','ineligible','archive','voided','rebuild'])('keeps %s stream performances read-only',async(kind)=>{
  const context=competitionEvent.record_context!;
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,member: kind==='self'?{ user_id: 'me',username: 'Me' }:competitionEvent.member,
    voided: kind==='voided',record_context: { ...context,former: kind==='former',
      exercise: { ...context.exercise,archived_at_ms: kind==='archive'?3000:null,rebuilding: kind==='rebuild',published_revision: kind==='rebuild'?1:context.exercise.published_revision },
      metrics: context.metrics.map(metric=>({ ...metric,eligible: kind!=='ineligible' })) } }));
  await openRecord();expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
  if(kind==='voided') expect(screen.getByTestId('group-metric-record-e1rm-value')).toHaveTextContent('Score unavailable');
});
it('keeps an event with no current context readable without a certification control',async()=>{
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,record_context: null,reps: null }));await openRecord();
  expect(screen.getByTestId('group-metric-record-e1rm-value')).toHaveTextContent('145.7 %BW');
  expect(screen.queryByTestId('group-metric-record-set')).toBeNull();
  expect(screen.queryByTestId('group-metric-record-status')).toBeNull();
});
it('offline reopens the closed cache with no certification write',async()=>{
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.mine,userId: 'me',payload: { groups: [competitionGroup] },fetchedAtMs: 1000 });
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.stream('g1'),userId: 'me',payload: page(),fetchedAtMs: 1000 });
  mockOnline=false;await openRecord();expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));expect(api.certifyCompetition).not.toHaveBeenCalled();
});
it('a stale-token refusal swaps Certify for Refresh until it is reviewed',async()=>{
  api.certifyCompetition.mockRejectedValue(new GroupApiError('CONFLICT','Performance changed. Refresh and review.'));
  await openRecord();fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-notice')).toHaveTextContent(/The score changed/);
  expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
  const reads=api.getCompetitionStream.mock.calls.length;
  fireEvent.press(screen.getByTestId('group-metric-record-refresh'));
  await waitFor(()=>expect(api.getCompetitionStream.mock.calls.length).toBeGreaterThan(reads));
});
const certifiedEvent=(certificate=mine): CompetitionEventWire=>({ ...competitionEvent,record_context: {
  ...competitionEvent.record_context!,metrics: [{ ...competitionEvent.record_context!.metrics[0],certification: certificate }] } });
it('withdrawal confirms first and leaves the ended result visible',async()=>{
  const spy=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);api.getCompetitionStream.mockResolvedValue(page(certifiedEvent()));
  const ended={ ...mine,ended_at_ms: 3000,end_reason: 'withdrawn' as const };
  await openRecord();api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: ended });fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
  expect(api.endCompetitionCertification).not.toHaveBeenCalled();await confirm(spy);
  expect(api.endCompetitionCertification).toHaveBeenCalledWith('g1',mine.certification_id,'e1rm','withdraw');
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent('Not certified');
});
it.each(['member','admin','owner'] as const)("%s sees another witness's certification with no end control",async(myRole)=>{
  role(myRole);const certificate={ ...mine,certified_by: { user_id: 'witness',username: 'Witness' } };
  api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: certificate });
  api.getCompetitionStream.mockResolvedValue(page(certifiedEvent(certificate)));await openRecord();
  expect(screen.getByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Witness/);
  expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
  expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
});
it('removes an open sheet when the refreshed stream no longer contains the record',async()=>{
  await openRecord();api.getCompetitionStream.mockResolvedValue({ contract_version: 4,items: [],next_cursor: null,has_more: false });
  await act(async()=>screen.getByTestId('groups-stream-list').props.refreshControl.props.onRefresh());
  expect(screen.queryByTestId('group-metric-record-sheet')).toBeNull();
});
it('opens a board row, certifies it and refreshes the first page',async()=>{
  render(<GroupBoardRoute />);fireEvent.press(await screen.findByTestId('group-board-row-1'));
  expect(await screen.findByTestId('group-metric-record-raw')).toHaveTextContent('5 reps');
  const reads=api.getCompetitionBoard.mock.calls.length;fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.getCompetitionBoard.mock.calls.length).toBeGreaterThan(reads));
  expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'other',metric: 'e1rm',setId: 'set1' }));
});
