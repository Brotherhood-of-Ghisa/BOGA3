/* eslint-disable import/first */
/** Actual protocol-4 client RPCs and guards against the leased local endpoint.
 * The groups-api-live lane activates locally for this phase and restores pending
 * state on exit. Server arithmetic/privacy vectors remain in backend fixtures. */
import { readGroupsLiveEnv, signInLiveClient, type LiveClient } from './helpers/groups-live-endpoint';
let mockActiveClient: LiveClient['client'] | null = null;
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => {
  if (!mockActiveClient) throw new Error('No live client');
  return mockActiveClient;
} }));
import { archiveCompetitionExercise,certifyCompetition,createCompetitionExercise,createGroup,endCompetitionCertification,
  getCompetitionBoard,getCompetitionCertification,getCompetitionContract,getCompetitionHistory,getCompetitionPodiums,
  getCompetitionRevisions,getCompetitionSession,getCompetitionStream,getCompetitionWeek,getGroup,getGroupInviteCode,
  joinGroup,listCompetitionExercises,listMyGroups,updateCompetitionExercise,updateGroup } from '@/src/groups/api';

const env=readGroupsLiveEnv();
let owner: LiveClient;let member: LiveClient;
const as=async <T>(user: LiveClient,call: () => Promise<T>) => {
  mockActiveClient=user.client;
  try { return await call(); } finally { mockActiveClient=null; }
};
const poll=async <T>(read: () => Promise<T>,ready: (value: T) => boolean): Promise<T> => {
  const deadline=Date.now()+90_000;
  for (;;) {
    const value=await read();
    if (ready(value)) return value;
    if (Date.now()>deadline) throw new Error(`Not published: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve,250));
  }
};
beforeAll(async () => {
  owner=await signInLiveClient(env,env.ownerEmail);member=await signInLiveClient(env,env.memberEmail);
});
afterAll(async () => { await owner?.teardown();await member?.teardown(); });

async function pushPerformance(groupId: string,exerciseId: string,startedAt: number) {
  const stamp=Date.now();const sessionId=`competition-live-${env.runTag}`;
  const definitionId=`${sessionId}-def`;const sessionExerciseId=`${sessionId}-ex`;const setId=`${sessionId}-set`;
  const entity=(type: string,id: string,fields: Record<string,unknown>) => ({ type,id,client_updated_at_ms: stamp,
    fields: { created_at: stamp,updated_at: stamp,deleted_at: null,...fields } });
  const entities=[
    entity('exercise_definitions',definitionId,{ name: 'Pull-up',load_input_mode: 'total_load',bodyweight_contribution: 0 }),
    entity('body_weight_measurements',`${sessionId}-reading`,{ weight_kg: 80,measured_at: startedAt-1 }),
    entity('exercise_group_links',`${groupId}:${definitionId}`,{ exercise_definition_id: definitionId,
      group_id: groupId,group_exercise_id: exerciseId }),
    entity('sessions',sessionId,{ gym_id: null,status: 'completed',started_at: startedAt,
      completed_at: startedAt+60_000,duration_sec: 60 }),
    entity('session_exercises',sessionExerciseId,{ session_id: sessionId,exercise_definition_id: definitionId,
      order_index: 0,name: 'Pull-up',machine_name: null }),
    entity('exercise_sets',setId,{ session_exercise_id: sessionExerciseId,order_index: 0,weight_value: '20',reps_value: '5',
      set_type: 'working',performance_status: null,planned_weight_value: null,planned_reps_value: null,planned_set_type: null }),
  ];
  const pushed=await member.client.schema('app_public').rpc('sync_push',{ entities });
  expect(pushed.error).toBeNull();expect(pushed.data).toMatchObject({ ok: true });
  return { sessionId,setId };
}

it('matches every safe competition endpoint, normalized disclosure, and certification lifecycle', async () => {
  const { group_id: groupId }=await as(owner,() => createGroup({ name: 'Live competition',description: null }));
  const { code }=await as(owner,() => getGroupInviteCode(groupId));
  await as(member,() => joinGroup(code));
  expect(await as(member,() => getCompetitionContract(groupId))).toMatchObject({ activation_state: 'active',cache_version: 5 });
  await as(owner,() => updateGroup(groupId,{ name: 'Live competition',description: null,bodyweightCalculationsEnabled: true }));
  expect((await as(member,() => getGroup(groupId))).group.bodyweight_calculations_enabled).toBe(true);
  expect((await as(member,() => listMyGroups())).groups.some(group => group.group_id===groupId)).toBe(true);
  const { exercise }=await as(owner,() => createCompetitionExercise({ groupId,name: 'Pull-up',mode: 'total_load',contribution: 1,metric: 'volume' }));
  const exerciseId=exercise.group_exercise_id;
  expect((await as(member,() => listCompetitionExercises(groupId))).exercises[0].rules.default_metric).toBe('volume');
  const joined=(await as(member,() => getCompetitionStream(groupId))).items.find(item => item.kind==='membership' && item.member.user_id===member.userId);
  if (!joined) throw new Error('Member join missing');
  const { sessionId,setId }=await pushPerformance(groupId,exerciseId,joined.sort_at_ms+1);
  const readBoard=() => as(owner,() => getCompetitionBoard({ groupId,exerciseId,metric: 'volume',certified: false }));
  const board=await poll(readBoard,result => result.state==='ready' && result.entries.length===1);
  expect(board.entries[0]).toMatchObject({ unit: 'percent_bw_reps',value: 625,performance: { visibility: 'normalized',set_id: setId } });
  expect(board.entries[0].performance).not.toHaveProperty('weight_value');
  const rm=await as(owner,() => getCompetitionBoard({ groupId,exerciseId,metric: 'e1rm',certified: false }));
  expect(rm.entries[0].unit).toBe('percent_bw');
  const detail=await as(owner,() => getCompetitionSession(groupId,member.userId,sessionId));
  expect(detail.session.exercises[0].visibility).toBe('normalized');
  expect(detail.session.exercises[0].sets[0]).not.toHaveProperty('weight_value');
  const stream=await as(owner,() => getCompetitionStream(groupId));
  expect(stream.items.some(item => item.kind==='session' && item.session.session_id===sessionId)).toBe(true);
  expect(await as(owner,() => getCompetitionWeek(groupId,joined.sort_at_ms-1,joined.sort_at_ms+120_000))).toMatchObject({ contract_version: 4,group_id: groupId });
  expect((await as(owner,() => getCompetitionPodiums(groupId,false))).podiums[0].board.metric).toBe('volume');
  expect((await as(owner,() => getCompetitionRevisions(groupId,exerciseId))).revisions.length).toBeGreaterThan(0);
  expect(await as(owner,() => getCompetitionHistory({ groupId,exerciseId,metric: 'volume',certified: false }))).toMatchObject({ metric: 'volume',certified: false });
  const args={ groupId,exerciseId,memberId: member.userId,setId,metric: 'volume' as const,
    revision: board.rules.rules_revision,token: board.entries[0].write_token };
  const certified=await as(owner,() => certifyCompetition(args));
  const certId=certified.certification.certification_id;
  expect((await as(owner,() => getCompetitionCertification(groupId,certId,'volume'))).certification.ended_at_ms).toBeNull();
  expect((await as(owner,() => endCompetitionCertification(groupId,certId,'volume','withdraw'))).certification.end_reason).toBe('withdrawn');
  const refreshed=await readBoard();
  const recertified=await as(owner,() => certifyCompetition({ ...args,token: refreshed.entries[0].write_token }));
  expect((await as(owner,() => endCompetitionCertification(groupId,recertified.certification.certification_id,'volume','cancel'))).certification.end_reason).toBe('cancelled');
  const updated=await as(owner,() => updateCompetitionExercise({ groupId,exerciseId,revision: board.rules.rules_revision,
    name: 'Ordinary pull-up',mode: 'total_load',contribution: 0,metric: 'e1rm' }));
  const ordinary=await poll(readBoard,result => result.state==='ready' && result.rules.rules_revision===updated.exercise.rules.rules_revision && result.entries.length===1);
  expect(ordinary.entries[0]).toMatchObject({ unit: 'kg_reps',value: 100,performance: { visibility: 'ordinary',weight_value: '20' } });
  expect((await as(owner,() => archiveCompetitionExercise(groupId,exerciseId,true))).exercise.archived_at_ms).not.toBeNull();
  expect((await as(owner,() => archiveCompetitionExercise(groupId,exerciseId,false))).exercise.archived_at_ms).toBeNull();
},120_000);
