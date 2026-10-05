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
it('opens safe stream detail with original units, reps, current rules and group-scoped navigation',async()=>{
  await openRecord();expect(within(screen.getByTestId('group-metric-record-sheet')).getByText('1RM 145.7 %BW')).toBeTruthy();expect(within(screen.getByTestId('group-metric-record-sheet')).getByText('As logged: 5 reps')).toBeTruthy();
  expect(screen.getByText(/Recorded under rules 2/)).toBeTruthy();expect(screen.queryByText(/Weight .*kg|bodyweight reading|digest/i)).toBeNull();
  fireEvent.press(screen.getByTestId('group-metric-record-session'));
  expect(mockRouter.push).toHaveBeenCalledWith('/group-session/other/s1?groupId=g1');
});
it('keeps historical kg values distinct from the current normalized standard',async()=>{
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,representation_version: 3,visibility: 'ordinary',rules_revision: 1,
    values: [{ ...competitionEvent.values[0],unit: 'kg',value: 112.5 }] }));
  await openRecord();expect(within(screen.getByTestId('group-metric-record-sheet')).getByText('1RM 112.5 kg')).toBeTruthy();expect(screen.getByText(/Recorded under rules 1/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({ revision: 2,token: competitionRow.write_token })));
});
it('certifies from the stream sheet and refreshes the selected group',async()=>{
  await openRecord();const reads=api.getCompetitionStream.mock.calls.length;
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent(/Certified by Me/);
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
});
it('keeps an event with no current context readable without inventing a performance',async()=>{
  api.getCompetitionStream.mockResolvedValue(page({ ...competitionEvent,record_context: null }));await openRecord();
  expect(screen.getByText(/Score unavailable. Refresh the stream/)).toBeTruthy();expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
});
it('offline reopens the closed cache with no certification write',async()=>{
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.mine,userId: 'me',payload: { groups: [competitionGroup] },fetchedAtMs: 1000 });
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.stream('g1'),userId: 'me',payload: page(),fetchedAtMs: 1000 });
  mockOnline=false;await openRecord();expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));expect(api.certifyCompetition).not.toHaveBeenCalled();
});
it('a stale-token refusal disables retry until explicit review',async()=>{
  api.certifyCompetition.mockRejectedValue(new GroupApiError('CONFLICT','Performance changed. Refresh and review.'));
  await openRecord();fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(await screen.findByTestId('group-metric-record-notice')).toHaveTextContent(/The score changed/);
  expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
});
const certifiedEvent=(certificate=mine): CompetitionEventWire=>({ ...competitionEvent,record_context: {
  ...competitionEvent.record_context!,metrics: [{ ...competitionEvent.record_context!.metrics[0],certification: certificate }] } });
it('withdrawal confirms first and leaves the ended result visible',async()=>{
  const spy=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);api.getCompetitionStream.mockResolvedValue(page(certifiedEvent()));
  const ended={ ...mine,ended_at_ms: 3000,end_reason: 'withdrawn' as const };
  await openRecord();api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: ended });fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
  expect(api.endCompetitionCertification).not.toHaveBeenCalled();await confirm(spy);
  expect(api.endCompetitionCertification).toHaveBeenCalledWith('g1',mine.certification_id,'e1rm','withdraw');
  expect(await screen.findByTestId('group-metric-record-status')).toHaveTextContent('Certification ended');
});
it.each(['member','admin','owner'] as const)('%s cancellation controls follow the server witness and role',async(myRole)=>{
  role(myRole);const certificate={ ...mine,certified_by: { user_id: 'witness',username: 'Witness' } };
  api.getCompetitionCertification.mockResolvedValue({ contract_version: 4,certification: certificate });
  api.getCompetitionStream.mockResolvedValue(page(certifiedEvent(certificate)));await openRecord();
  expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
  if(myRole==='member'){expect(screen.queryByTestId('group-metric-record-cancel')).toBeNull();return;}
  const spy=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);
  fireEvent.press(screen.getByTestId('group-metric-record-cancel'));expect(api.endCompetitionCertification).not.toHaveBeenCalled();
  await confirm(spy);expect(api.endCompetitionCertification).toHaveBeenCalledWith('g1',certificate.certification_id,'e1rm','cancel');
});
it('removes an open sheet when the refreshed stream no longer contains the record',async()=>{
  await openRecord();api.getCompetitionStream.mockResolvedValue({ contract_version: 4,items: [],next_cursor: null,has_more: false });
  await act(async()=>screen.getByTestId('groups-stream-list').props.refreshControl.props.onRefresh());
  expect(screen.queryByTestId('group-metric-record-sheet')).toBeNull();
});
it('opens a board row, certifies it and refreshes the first page',async()=>{
  render(<GroupBoardRoute />);fireEvent.press(await screen.findByTestId('group-board-row-1'));
  expect(await screen.findByTestId('group-metric-record-raw')).toHaveTextContent('As logged: 5 reps');
  const reads=api.getCompetitionBoard.mock.calls.length;fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  await waitFor(()=>expect(api.getCompetitionBoard.mock.calls.length).toBeGreaterThan(reads));
  expect(api.certifyCompetition).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'other',metric: 'e1rm',setId: 'set1' }));
});
