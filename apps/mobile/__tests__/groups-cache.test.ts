import { groupCache } from '@/src/data/schema';
import { competitionCacheKeys, evictCompetitionCache, evictGroup, groupCacheKeys, getCompetitionCacheGeneration,
  readGroupCache, writeGroupCache, observeGroupCompetitionPolicy, deleteGroupCacheEntry, wipeGroupCache } from '@/src/groups/cache';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionGroup, competitionGroupDetail, competitionExercise, competitionSession, competitionStream,
  competitionWeek, competitionBoard,competitionEvent } from './helpers/competition-fixtures';

let fixture: InMemoryDatabaseFixture;
const put = (key: string,payload: unknown,userId = 'u1',fetchedAtMs = 1000) =>
  writeGroupCache(fixture.database,{ cacheKey: key,payload,userId,fetchedAtMs });
const raw = (key: string,payload: unknown,userId = 'u1') => fixture.database.insert(groupCache)
  .values({ cacheKey: key,payloadJson: JSON.stringify(payload),userId,fetchedAtMs: 1 }).run();
const keys = () => fixture.database.select().from(groupCache).all().filter(row => !row.cacheKey.startsWith('group-policy:')).map(row => row.cacheKey).sort();
beforeEach(() => { fixture=createInMemoryDatabase(); });
afterEach(() => fixture.close());

it('uses generation five and binds sessions to the authorized group', () => {
  expect(groupCacheKeys).toBe(competitionCacheKeys);
  expect(groupCacheKeys.mine).toBe('groups:v5:mine');
  expect(groupCacheKeys.session('g1','other','s1')).toBe('session:v5:g1:other:s1');
  expect(groupCacheKeys.session('g2','other','s1')).not.toBe(groupCacheKeys.session('g1','other','s1'));
  expect(groupCacheKeys).not.toHaveProperty('streamAll');
});
it.each([
  [groupCacheKeys.mine,{ groups: [competitionGroup] }],
  [groupCacheKeys.group('g1'),competitionGroupDetail],
  [groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] }],
  [groupCacheKeys.boards('g1'),{ contract_version: 4,certified: false,podiums: [{ exercise: competitionExercise,board: competitionBoard }] }],
  [groupCacheKeys.stream('g1'),competitionStream],
  [groupCacheKeys.session('g1','other','s1'),competitionSession],
  [groupCacheKeys.weekSummary('g1'),{ windowStartMs: 100,summary: competitionWeek }],
])('round-trips a closed public payload: %s', (key,payload) => {
  put(key as string,payload);
  expect(readGroupCache(fixture.database,key as string,'u1')).toEqual({ payload,fetchedAtMs: 1000 });
  expect(readGroupCache(fixture.database,key as string,'u2')).toBeNull();
});
it('upserts owner and fetch time without exposing the earlier account', () => {
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  const payload={ groups: [] };
  put(groupCacheKeys.mine,payload,'u2',2000);
  expect(readGroupCache(fixture.database,groupCacheKeys.mine,'u1')).toBeNull();
  expect(readGroupCache(fixture.database,groupCacheKeys.mine,'u2')).toEqual({ payload,fetchedAtMs: 2000 });
});
it.each(['v1','v2','v3','v4'])('deletes prior generation %s before hydration', version => {
  raw(`stream:${version}:g1`,{ normalized_load_kg: 91 });
  raw(`stream:${version}:g2`,{ private_audit: true },'u2');
  expect(readGroupCache(fixture.database,groupCacheKeys.stream('g1'),'u1')).toBeNull();
  expect(keys()).toEqual([`stream:${version}:g2`]);
});
it('deletes malformed JSON without returning its contents as an error', () => {
  fixture.database.insert(groupCache).values({ cacheKey: groupCacheKeys.mine,payloadJson: '{ private: 80',userId: 'u1',fetchedAtMs: 1 }).run();
  expect(readGroupCache(fixture.database,groupCacheKeys.mine,'u1')).toBeNull();
  expect(keys()).toEqual([]);
});
it.each([
  ['unknown envelope field',{ ...competitionSession,private_audit: {} }],
  ['normalized raw load',{ ...competitionSession,session: { ...competitionSession.session,exercises: [{ ...competitionSession.session.exercises[0],sets: [{ ...competitionSession.session.exercises[0].sets[0],weight_value: '80' }] }] } }],
  ['wrong group',{ ...competitionSession,group_id: 'g2' }],
  ['wrong session',{ ...competitionSession,session: { ...competitionSession.session,session_id: 'other-session' } }],
  ['unknown version',{ ...competitionSession,contract_version: 9 }],
])('rejects and evicts unsafe disk data: %s', (_label,payload) => {
  const key=groupCacheKeys.session('g1','other','s1');
  raw(key,payload);
  expect(readGroupCache(fixture.database,key,'u1')).toBeNull();
  expect(keys()).toEqual([]);
  expect(() => put(key,payload)).toThrow('Unsafe group cache payload.');
});
it('an observed revision change retires all account projections and notifies mounted readers', () => {
  const catalogue={ contract_version: 4,exercises: [competitionExercise] };
  put(groupCacheKeys.groupExercises('g1'),catalogue);
  put(groupCacheKeys.stream('g1'),competitionStream);
  put(groupCacheKeys.session('g1','other','s1'),competitionSession);
  const generation=getCompetitionCacheGeneration('u1');
  put(groupCacheKeys.groupExercises('g1'),{ ...catalogue,exercises: [{ ...competitionExercise,published_revision: 3,rules: { ...competitionExercise.rules,rules_revision: 3 } }] });
  expect(keys()).toEqual([groupCacheKeys.groupExercises('g1')]);
  expect(getCompetitionCacheGeneration('u1')).toBe(generation+1);
});
it('switch changes from My groups invalidate projections even before opening the group', () => {
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  put(groupCacheKeys.stream('g1'),competitionStream);
  put(groupCacheKeys.mine,{ groups: [{ ...competitionGroup,bodyweight_calculations_enabled: false }] });
  expect(keys()).toEqual([groupCacheKeys.mine]);
});
it('access loss drops group projections and every session join; local links remain untouched', () => {
  put(groupCacheKeys.group('g1'),competitionGroupDetail);
  put(groupCacheKeys.stream('g1'),competitionStream);
  put(groupCacheKeys.session('g1','other','s1'),competitionSession);
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  evictGroup(fixture.database,'g1');
  expect(keys()).toEqual([groupCacheKeys.mine]);
});
it('account eviction, entry deletion and a wipe have distinct scopes', () => {
  put(groupCacheKeys.mine,{ groups: [] });
  put(groupCacheKeys.stream('g1'),competitionStream,'u2');
  evictCompetitionCache(fixture.database,'u1');
  expect(keys()).toEqual([groupCacheKeys.stream('g1')]);
  deleteGroupCacheEntry(fixture.database,groupCacheKeys.stream('g1'));
  expect(keys()).toEqual([]);
  put(groupCacheKeys.mine,{ groups: [] });
  wipeGroupCache(fixture.database);
  expect(keys()).toEqual([]);
});

it('a normalized stream observation retires a cached ordinary full session for the same exercise', () => {
  const ordinary={ ...competitionSession,session: { ...competitionSession.session,exercises: [{
    ...competitionSession.session.exercises[0],visibility: 'ordinary',sets: [{ ...competitionSession.session.exercises[0].sets[0],weight_value: '20' }]
  }] } };
  put(groupCacheKeys.session('g1','other','s1'),ordinary);
  put(groupCacheKeys.stream('g1'),competitionStream);
  expect(readGroupCache(fixture.database,groupCacheKeys.session('g1','other','s1'),'u1')).toBeNull();
  expect(keys()).toEqual([groupCacheKeys.stream('g1')]);
});
it('first observed normalized catalogue retires unproven session disclosure even with no earlier catalogue key', () => {
  put(groupCacheKeys.session('g1','other','s1'),competitionSession);
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] });
  expect(keys()).toEqual([groupCacheKeys.groupExercises('g1')]);
});
it('matching standards from a second reader do not repeatedly evict compatible projections', () => {
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] });
  put(groupCacheKeys.stream('g1'),competitionStream);
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] });
  put(groupCacheKeys.boards('g1'),{ contract_version: 4,certified: false,podiums: [{ exercise: competitionExercise,board: competitionBoard }] });
  expect(keys()).toEqual([groupCacheKeys.boards('g1'),groupCacheKeys.groupExercises('g1'),groupCacheKeys.stream('g1')].sort());
});

it.each(['catalogue','board','record'])('zero-contribution %s does not infer global Off in an On group',reader=>{
  const zero={ ...competitionExercise,rules: { ...competitionExercise.rules,bodyweight_contribution: 0,bodyweight_calculations_enabled: false } };
  const ordinaryBoard={ ...competitionBoard,rules: zero.rules,entries: [{ ...competitionBoard.entries[0],unit: 'kg',
    performance: { ...competitionBoard.entries[0].performance,visibility: 'ordinary',weight_value: '20' } }] };
  const key=reader==='catalogue'?groupCacheKeys.groupExercises('g1'):reader==='board'?groupCacheKeys.boards('g1'):groupCacheKeys.stream('g1');
  const projection=reader==='catalogue'?{ contract_version: 4,exercises: [zero] }
    :reader==='board'?{ contract_version: 4,certified: false,podiums: [{ exercise: zero,board: ordinaryBoard }] }
    :{ ...competitionStream,items: [{ kind: 'competition',key: competitionEvent.event_id,sort_at_ms: 2000,event: {
      ...competitionEvent,record_context: { ...competitionEvent.record_context!,exercise: zero } } }] };
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  const generation=getCompetitionCacheGeneration('u1');
  for(let cycle=0;cycle<3;cycle++){
    put(key,projection);put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  }
  expect(getCompetitionCacheGeneration('u1')).toBe(generation);
  expect(readGroupCache(fixture.database,key,'u1')?.payload).toEqual(projection);
});
it('mixed positive and zero standards infer the preference only from positive comparisons',()=>{
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  const generation=getCompetitionCacheGeneration('u1');
  const zero={ ...competitionExercise,group_exercise_id: 'zero',rules: { ...competitionExercise.rules,bodyweight_contribution: 0,bodyweight_calculations_enabled: false } };
  const catalogue={ contract_version: 4,exercises: [zero,competitionExercise] };
  put(groupCacheKeys.groupExercises('g1'),catalogue);put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  // One new positive standard may conservatively retire unknown projections; repeated evidence is compatible.
  const known=getCompetitionCacheGeneration('u1');expect(known).toBeGreaterThanOrEqual(generation);
  put(groupCacheKeys.groupExercises('g1'),catalogue);put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  expect(getCompetitionCacheGeneration('u1')).toBe(known);
});

it('new normalized source evidence retires another ordinary session despite unchanged On rules and known normalized content',()=>{
  put(groupCacheKeys.mine,{ groups: [competitionGroup] });
  put(groupCacheKeys.groupExercises('g1'),{ contract_version: 4,exercises: [competitionExercise] });
  put(groupCacheKeys.stream('g1'),competitionStream);
  const ordinary={ ...competitionSession,session: { ...competitionSession.session,session_id: 'absolute-session',exercises: [{
    ...competitionSession.session.exercises[0],session_exercise_id: 'absolute-exercise',visibility: 'ordinary',
    sets: [{ ...competitionSession.session.exercises[0].sets[0],weight_value: '20' }]
  }] } };
  const key=groupCacheKeys.session('g1','other','absolute-session');put(key,ordinary);
  const epoch=getCompetitionCacheGeneration('u1');
  const normalized={ ...competitionSession,session: { ...competitionSession.session,session_id: 'new-normalized-session',exercises: [{
    ...competitionSession.session.exercises[0],session_exercise_id: 'new-normalized-exercise'
  }] } };
  observeGroupCompetitionPolicy(fixture.database,'g1','u1',normalized);
  expect(getCompetitionCacheGeneration('u1')).toBe(epoch+1);expect(readGroupCache(fixture.database,key,'u1')).toBeNull();
  const compatible={ ...normalized,session: { ...normalized.session,session_id: 'next-normalized-session' } };
  observeGroupCompetitionPolicy(fixture.database,'g1','u1',compatible);
  expect(getCompetitionCacheGeneration('u1')).toBe(epoch+1);
});
it('online-only absolute boards keep the disclosure flag until projection retirement',()=>{
  const absolute={ ...competitionBoard,rules: { ...competitionBoard.rules,bodyweight_calculations_enabled: false },entries: [{
    ...competitionBoard.entries[0],unit: 'kg',performance: { ...competitionBoard.entries[0].performance,visibility: 'ordinary',weight_value: '20' }
  }] };
  observeGroupCompetitionPolicy(fixture.database,'g1','u1',absolute);
  const epoch=getCompetitionCacheGeneration('u1');
  observeGroupCompetitionPolicy(fixture.database,'g1','u1',competitionStream);
  expect(getCompetitionCacheGeneration('u1')).toBe(epoch+1);
  observeGroupCompetitionPolicy(fixture.database,'g1','u1',{ ...competitionSession,session: { ...competitionSession.session,session_id: 'next' } });
  expect(getCompetitionCacheGeneration('u1')).toBe(epoch+1);
});
