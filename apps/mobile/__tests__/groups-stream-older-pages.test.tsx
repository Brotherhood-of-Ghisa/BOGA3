/* eslint-disable import/first */
/** Older pages belong to one account, group and cache generation. The resource
 * is controlled to isolate older-page races; disk policy uses real SQLite. */
import { act,renderHook } from '@testing-library/react-native';
import { createInMemoryDatabase,type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionStream } from './helpers/competition-fixtures';
import type { CompetitionStreamWire } from '@/src/groups/competition-wire';
const mockRead=jest.fn();
let mockFixture: InMemoryDatabaseFixture;
let mockBootstrapFailure=false;
jest.mock('@/src/data/bootstrap',()=>({ bootstrapLocalDataLayer:()=>mockBootstrapFailure?Promise.reject(new Error('Disk unavailable')):Promise.resolve(mockFixture.database) }));
jest.mock('@/src/groups/api',()=>({ ...jest.requireActual('@/src/groups/api'),getCompetitionStream:(...args: unknown[])=>mockRead(...args) }));
const member={ user_id: 'athlete',username: 'Athlete' };
const page=(key: string,time: number,more=false): CompetitionStreamWire=>({ contract_version: 4,
  items: [{ kind: 'membership',key,sort_at_ms: time,event: 'joined',member,group: { group_id: 'group-a',name: 'Crew' } }],
  next_cursor: more?'opaque-first-page':null,has_more: more });
let mockFirstPage: CompetitionStreamWire|null;
const mockRefresh=jest.fn().mockResolvedValue(undefined);
jest.mock('@/src/groups/use-group-resource',()=>({ useGroupResource:()=>({ data: mockFirstPage,lastUpdatedAtMs: 1,
  refreshing: false,offline: false,error: null,lostAccess: false,refresh: mockRefresh }) }));
import { useGroupStream } from '@/src/groups/use-group-stream';
import { GroupApiError } from '@/src/groups/api';
import { groupCacheKeys,writeGroupCache } from '@/src/groups/cache';
const older=page('older',1000);
const renderStream=()=>renderHook(({ groupId,userId }: { groupId: string;userId: string })=>useGroupStream({ userId,groupId }),
  { initialProps: { groupId: 'group-a',userId: 'user-1' } });
beforeEach(()=>{ mockFixture=createInMemoryDatabase();mockBootstrapFailure=false;mockRead.mockReset();mockRefresh.mockClear();mockFirstPage=page('first',2000,true); });
afterEach(()=>mockFixture.close());
it.each(['group','account'])('drops a late older page after a %s change and starts a return empty',async(kind)=>{
  let resolve!: (value: CompetitionStreamWire)=>void;
  mockRead.mockReturnValueOnce(new Promise(res=>{resolve=res;}));
  const { result,rerender }=renderStream();let pending!: Promise<void>;
  act(()=>{pending=result.current.loadMore();});expect(result.current.loadingMore).toBe(true);
  rerender({ groupId: kind==='group'?'group-b':'group-a',userId: kind==='account'?'user-2':'user-1' });
  await act(async()=>{resolve(older);await pending;});
  rerender({ groupId: 'group-a',userId: 'user-1' });
  expect(result.current.items.map(item=>item.key)).toEqual(['first']);
  expect(result.current.loadingMore).toBe(false);expect(result.current.loadMoreError).toBeNull();
});
it('drops already-loaded older pages when returning to a group',async()=>{
  mockRead.mockResolvedValueOnce(older);const { result,rerender }=renderStream();
  await act(async()=>result.current.loadMore());expect(result.current.items.map(item=>item.key)).toEqual(['first','older']);
  expect(mockRead).toHaveBeenCalledWith('group-a','opaque-first-page');
  rerender({ groupId: 'group-b',userId: 'user-1' });rerender({ groupId: 'group-a',userId: 'user-1' });
  expect(result.current.items.map(item=>item.key)).toEqual(['first']);expect(result.current.hasMore).toBe(true);
});
it('keeps lost membership hidden until a newly authorized first page arrives',async()=>{
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.stream('group-a'),userId: 'user-1',fetchedAtMs: 1,payload: mockFirstPage });
  mockRead.mockRejectedValueOnce(new GroupApiError('NOT_FOUND','group not found'));
  const { result,rerender }=renderStream();await act(async()=>result.current.loadMore());
  expect(result.current.lostAccess).toBe(true);expect(result.current.items).toEqual([]);
  mockFirstPage=null;rerender({ groupId: 'group-a',userId: 'user-1' });
  expect(result.current.lostAccess).toBe(true);
  mockFirstPage=page('restored',3000);rerender({ groupId: 'group-a',userId: 'user-1' });
  expect(result.current.lostAccess).toBe(false);expect(result.current.items.map(item=>item.key)).toEqual(['restored']);
});
it('keeps a failed older page retryable without deleting the first page',async()=>{
  mockRead.mockRejectedValueOnce(new GroupApiError('NETWORK','Offline')).mockResolvedValueOnce(older);
  const { result }=renderStream();await act(async()=>result.current.loadMore());
  expect(result.current.loadMoreError?.code).toBe('NETWORK');expect(result.current.items.map(item=>item.key)).toEqual(['first']);
  await act(async()=>result.current.loadMore());expect(result.current.loadMoreError).toBeNull();
  expect(result.current.items.map(item=>item.key)).toEqual(['first','older']);
});

it('appends distinct normalized second and third pages without discarding earlier pages',async()=>{
  const item=competitionStream.items[0];
  if(item.kind!=='session') throw new Error('Expected session fixture');
  const normalized=(sessionId: string,time: number,more: boolean): CompetitionStreamWire=>({
    ...competitionStream,has_more: more,next_cursor: more?`cursor-${sessionId}`:null,
    items: [{ ...item,key: `other:${sessionId}`,sort_at_ms: time,
      groups: [{ group_id: 'group-a',name: 'Crew' }],session: { ...item.session,session_id: sessionId,
        exercises: [{ ...item.session.exercises[0],session_exercise_id: `se-${sessionId}` }] } }],
  });
  mockFirstPage=normalized('one',3000,true);
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.stream('group-a'),userId: 'user-1',fetchedAtMs: 1,payload: mockFirstPage });
  mockRead.mockResolvedValueOnce(normalized('two',2000,true)).mockResolvedValueOnce(normalized('three',1000,false));
  const { result }=renderStream();
  await act(async()=>result.current.loadMore());await act(async()=>result.current.loadMore());
  expect(result.current.items.map(item=>item.key)).toEqual(['other:one','other:two','other:three']);
  expect(mockRead.mock.calls).toEqual([['group-a','cursor-one'],['group-a','cursor-two']]);
  expect(mockRefresh).not.toHaveBeenCalled();expect(result.current.hasMore).toBe(false);
});
it('hides the entire feed on older-page access loss even when SQLite cleanup fails',async()=>{
  writeGroupCache(mockFixture.database,{ cacheKey: groupCacheKeys.stream('group-a'),userId: 'loss-user',fetchedAtMs: 1,payload: mockFirstPage });
  mockBootstrapFailure=true;mockRead.mockRejectedValueOnce(new GroupApiError('NOT_FOUND','group not found'));
  const { result }=renderHook(()=>useGroupStream({ userId: 'loss-user',groupId: 'group-a' }));
  await act(async()=>result.current.loadMore());
  expect(result.current.lostAccess).toBe(true);expect(result.current.items).toEqual([]);expect(result.current.hasMore).toBe(false);
});
