/* eslint-disable import/first */
/** Account-wide retirement is observable in mounted readers, even when disk
 * cleanup fails. Public policy from any endpoint retires earlier projections. */
import * as mockReact from 'react';
import { act,renderHook } from '@testing-library/react-native';
import { createInMemoryDatabase,type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionBoard,competitionExercise,competitionGroup,competitionSession,competitionStream,competitionWeek } from './helpers/competition-fixtures';
let mockFixture: InMemoryDatabaseFixture;
let mockBootstrapFailure=false;
jest.mock('@/src/data/bootstrap',()=>({ bootstrapLocalDataLayer:()=>mockBootstrapFailure
  ?Promise.reject(new Error('Disk unavailable')):Promise.resolve(mockFixture.database) }));
jest.mock('expo-router',()=>({ useFocusEffect:(callback: ()=>void|(()=>void))=>mockReact.useEffect(()=>callback(),[callback]) }));
jest.mock('@react-native-community/netinfo',()=>({ __esModule: true,default: { addEventListener:()=>()=>undefined } }));
const mockMineRead=jest.fn(),mockCatalogueRead=jest.fn();
jest.mock('@/src/groups/api',()=>({ ...jest.requireActual('@/src/groups/api'),listMyGroups:()=>mockMineRead(),listCompetitionExercises:()=>mockCatalogueRead() }));
import { useGroupExerciseLinking } from '@/src/groups/use-group-exercise-linking';
import { useGroupResource } from '@/src/groups/use-group-resource';
import { useGroupOnlinePages } from '@/src/groups/use-group-online-pages';
import { GroupApiError } from '@/src/groups/api';
import { getCompetitionCacheGeneration,groupCacheKeys,observeGroupCompetitionPolicy,readGroupCache,writeGroupCache } from '@/src/groups/cache';
import { groupCache } from '@/src/data/schema';
const pending=<T,>()=>{ let resolve!: (value: T)=>void;const promise=new Promise<T>(res=>{resolve=res;});return { promise,resolve }; };
const flush=()=>act(async()=>{});
let USER='retirement-user';let userSequence=0;
const put=(key: string,payload: unknown,userId=USER)=>writeGroupCache(mockFixture.database,{ cacheKey: key,userId,payload,fetchedAtMs: 1000 });
beforeEach(()=>{USER=`retirement-user-${++userSequence}`;mockFixture=createInMemoryDatabase();mockBootstrapFailure=false;mockMineRead.mockReset().mockResolvedValue({ groups: [competitionGroup] });mockCatalogueRead.mockReset();});
afterEach(()=>mockFixture.close());
it('unsupported protocol hides another mounted reader and fences its late response despite failed cleanup',async()=>{
  const mine={ groups: [competitionGroup] };
  const late=pending<typeof competitionStream>();
  const mineRead=jest.fn().mockResolvedValue(mine);
  const streamRead=jest.fn().mockResolvedValueOnce(competitionStream).mockReturnValue(late.promise);
  const { result }=renderHook(()=>({
    mine: useGroupResource({ userId: USER,cacheKey: groupCacheKeys.mine,fetcher: mineRead }),
    stream: useGroupResource<typeof competitionStream>({ userId: USER,cacheKey: groupCacheKeys.stream('g1'),fetcher: streamRead }),
  }));
  await flush();expect(result.current.stream.data).toEqual(competitionStream);
  let oldRequest!: Promise<void>;act(()=>{oldRequest=result.current.stream.refresh();});
  mockBootstrapFailure=true;mineRead.mockRejectedValue(new GroupApiError('UPDATE_REQUIRED','Update required'));
  await act(async()=>result.current.mine.refresh());
  expect(result.current.mine.error?.code).toBe('UPDATE_REQUIRED');expect(result.current.stream.data).toBeNull();
  expect(mockFixture.database.select().from(groupCache).all().length).toBeGreaterThan(0);
  expect(readGroupCache(mockFixture.database,groupCacheKeys.stream('g1'),USER)).toBeNull();
  await act(async()=>{late.resolve(competitionStream);await oldRequest;});expect(result.current.stream.data).toBeNull();
  // Only a fresh validated publication can remove quarantine and return data.
  mockBootstrapFailure=false;streamRead.mockResolvedValue({ ...competitionStream,items: [] });
  await act(async()=>result.current.stream.refresh());
  expect(result.current.stream.data?.items).toEqual([]);
  expect(readGroupCache(mockFixture.database,groupCacheKeys.mine,USER)).toBeNull();
});
it('a newly observed current board retires mounted Today and session caches before displaying its normalized result',async()=>{
  const off={ ...competitionExercise,rules: { ...competitionExercise.rules,bodyweight_calculations_enabled: false } };
  const ordinary={ ...competitionSession,session: { ...competitionSession.session,exercises: [{ ...competitionSession.session.exercises[0],
    visibility: 'ordinary',sets: [{ ...competitionSession.session.exercises[0].sets[0],weight_value: '20' }] }] } };
  put(groupCacheKeys.mine,{ groups: [{ ...competitionGroup,bodyweight_calculations_enabled: false }] });
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [off] });
  put(groupCacheKeys.session('g1','other','s1'),ordinary);
  put(groupCacheKeys.weekSummary('g1'),{ windowStartMs: 100,summary: competitionWeek });
  const never=new Promise<never>(()=>undefined);
  const weekRead=()=>never,sessionRead=()=>never;
  const { result }=renderHook(()=>({
    week: useGroupResource({ userId: USER,cacheKey: groupCacheKeys.weekSummary('g1'),fetcher: weekRead }),
    session: useGroupResource({ userId: USER,cacheKey: groupCacheKeys.session('g1','other','s1'),fetcher: sessionRead }),
  }));
  await flush();expect(result.current.session.data).toEqual(ordinary);expect(result.current.week.data).not.toBeNull();
  const generation=getCompetitionCacheGeneration(USER);
  act(()=>observeGroupCompetitionPolicy(mockFixture.database,'g1',USER,competitionBoard));
  expect(getCompetitionCacheGeneration(USER)).toBe(generation+1);
  expect(result.current.session.data).toBeNull();expect(result.current.week.data).toBeNull();
  expect(readGroupCache(mockFixture.database,groupCacheKeys.session('g1','other','s1'),USER)).toBeNull();
});
it('a delayed online page cannot restore a board after another endpoint changes the policy',async()=>{
  const late=pending<typeof competitionBoard>();
  const read=jest.fn().mockReturnValueOnce(late.promise).mockReturnValue(new Promise<never>(()=>undefined));
  const { result }=renderHook(()=>useGroupOnlinePages({ userId: USER,groupId: 'g1',viewKey: 'board',fetchPage: read,
    selectItems: (page: typeof competitionBoard)=>page.entries,selectCursor: (page: typeof competitionBoard)=>page.next_cursor,
    selectHasMore: (page: typeof competitionBoard)=>page.next_cursor!==null,itemKey: row=>row.member.user_id }));
  await flush();
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] });
  act(()=>observeGroupCompetitionPolicy(mockFixture.database,'g1',USER,{ ...competitionBoard,rules: { ...competitionBoard.rules,rules_revision: 3 } }));
  await act(async()=>late.resolve(competitionBoard));
  expect(result.current.firstPage).toBeNull();expect(result.current.items).toEqual([]);
});

it.each(['resource','online'])('%s access loss fences every mounted projection before failing disk cleanup',async(reader)=>{
  const streamRead=jest.fn().mockResolvedValue(competitionStream);
  const denied=jest.fn().mockReturnValue(new Promise<never>(()=>undefined));
  const { result }=renderHook(()=>({
    stream: useGroupResource<typeof competitionStream>({ userId: USER,cacheKey: groupCacheKeys.stream('g1'),fetcher: streamRead,evictGroupIdOnNotFound: 'g1' }),
    resource: useGroupResource({ userId: USER,cacheKey: groupCacheKeys.group('g1'),fetcher: denied,evictGroupIdOnNotFound: 'g1' }),
    online: useGroupOnlinePages({ userId: USER,groupId: 'g1',viewKey: 'board',fetchPage: denied,
      selectItems: (page: typeof competitionBoard)=>page.entries,selectCursor: (page: typeof competitionBoard)=>page.next_cursor,
      selectHasMore: (page: typeof competitionBoard)=>page.next_cursor!==null,itemKey: row=>row.member.user_id }),
  }));
  await flush();expect(result.current.stream.data).not.toBeNull();
  // Settle initial pending reads before making the explicit denied refresh.
  denied.mockRejectedValue(new GroupApiError('NOT_FOUND','group not found'));
  mockBootstrapFailure=true;
  if(reader==='resource') {
    // Mount a new resource identity whose initial read gets the denial.
    const deniedReader=renderHook(()=>useGroupResource({ userId: USER,cacheKey: groupCacheKeys.groupExercises('g1'),fetcher: denied,evictGroupIdOnNotFound: 'g1' }));
    await flush();expect(deniedReader.result.current.lostAccess).toBe(true);
  } else {
    const deniedReader=renderHook(()=>useGroupOnlinePages({ userId: USER,groupId: 'g1',viewKey: 'new-board',fetchPage: denied,
      selectItems: (page: typeof competitionBoard)=>page.entries,selectCursor: (page: typeof competitionBoard)=>page.next_cursor,
      selectHasMore: (page: typeof competitionBoard)=>page.next_cursor!==null,itemKey: row=>row.member.user_id }));
    await flush();expect(deniedReader.result.current.lostAccess).toBe(true);
  }
  expect(result.current.stream.data).toBeNull();
  expect(readGroupCache(mockFixture.database,groupCacheKeys.stream('g1'),USER)).toBeNull();
  const epoch=getCompetitionCacheGeneration(USER);
  await act(async()=>result.current.stream.refresh());
  expect(getCompetitionCacheGeneration(USER)).toBe(epoch);
});

it('a denied linking catalogue fences another mounted stream even when SQLite is unavailable',async()=>{
  const streamRead=jest.fn().mockResolvedValue(competitionStream);
  const stream=renderHook(()=>useGroupResource<typeof competitionStream>({ userId: USER,cacheKey: groupCacheKeys.stream('g1'),fetcher: streamRead }));
  await flush();expect(stream.result.current.data).not.toBeNull();
  mockBootstrapFailure=true;mockCatalogueRead.mockRejectedValue(new GroupApiError('NOT_FOUND','group not found'));
  renderHook(()=>useGroupExerciseLinking({ userId: USER }));await flush();
  expect(stream.result.current.data).toBeNull();expect(readGroupCache(mockFixture.database,groupCacheKeys.stream('g1'),USER)).toBeNull();
});

it.each(['UPDATE_REQUIRED','INTERNAL'] as const)('linking preserves %s protocol failure when hydration fails',async(code)=>{
  mockBootstrapFailure=true;mockCatalogueRead.mockRejectedValue(new GroupApiError(code,'Unsafe response',code==='INTERNAL'));
  const { result }=renderHook(()=>useGroupExerciseLinking({ userId: USER }));await flush();
  expect(result.current.error?.code).toBe(code);expect(result.current.error?.invalidPayload).toBe(code==='INTERNAL');
  expect(result.current.catalogs).toBeNull();
});

it('a policy retirement DELETE failure quarantines mounted ordinary projections before returning an error',async()=>{
  const ordinary={ ...competitionSession,session: { ...competitionSession.session,exercises: [{
    ...competitionSession.session.exercises[0],visibility: 'ordinary',sets: [{ ...competitionSession.session.exercises[0].sets[0],weight_value: '20' }]
  }] } };
  put(groupCacheKeys.session('g1','other','s1'),ordinary);
  const never=new Promise<never>(()=>undefined),fetcher=()=>never;
  const session=renderHook(()=>useGroupResource({ userId: USER,cacheKey: groupCacheKeys.session('g1','other','s1'),fetcher }));
  await flush();expect(session.result.current.data).toEqual(ordinary);
  const epoch=getCompetitionCacheGeneration(USER);
  const deletion=jest.spyOn(mockFixture.database,'delete').mockImplementation(()=>{throw new Error('DELETE unavailable');});
  act(()=>expect(()=>observeGroupCompetitionPolicy(mockFixture.database,'g1',USER,competitionStream)).toThrow('DELETE unavailable'));
  expect(getCompetitionCacheGeneration(USER)).toBe(epoch+1);expect(session.result.current.data).toBeNull();
  expect(readGroupCache(mockFixture.database,groupCacheKeys.session('g1','other','s1'),USER)).toBeNull();
  deletion.mockRestore();
});
