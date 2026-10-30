/* eslint-disable import/first */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/** Actual protocol-4 client RPCs and guards against this worktree's leased local
 * stack (supabase/tests/groups-competition-live.sh, lane groups-api-live), whose
 * baseline runs protocol 4. Server arithmetic/privacy vectors remain in
 * backend fixtures. */
import { readGroupsLiveEnv, signInLiveClient, type LiveClient } from './helpers/groups-live-endpoint';
let mockActiveClient: LiveClient['client'] | null = null;
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => {
  if (!mockActiveClient) throw new Error('No live client');
  return mockActiveClient;
} }));
import { archiveCompetitionExercise,certifyCompetition,createCompetitionExercise,createGroup,endCompetitionCertification,
  getCompetitionBoard,getCompetitionCertification,getCompetitionHistory,getCompetitionPodiums,
  getCompetitionPeriodTotals,getCompetitionRevisions,getCompetitionSession,getCompetitionSessionRecords,getCompetitionStream,getCompetitionWeek,getGroup,getGroupInviteCode,
  joinGroup,listCompetitionExercises,listMyGroups,updateCompetitionExercise,updateGroup,createCoW,getCoWCalendar,getCoWResults,getCoWSummary } from '@/src/groups/api';

const env=readGroupsLiveEnv();
let owner: LiveClient;let member: LiveClient;
const as=async <T>(user: LiveClient,call: () => Promise<T>) => {
  mockActiveClient=user.client;
  try { return await call(); } finally { mockActiveClient=null; }
};
const poll=async <T>(read: () => Promise<T>,ready: (value: T) => boolean): Promise<T> => {
  // A rebuild can rely on the five-minute cron sweep. Allow one
  // complete interval plus processing time rather than depending on its phase.
  const deadline=Date.now()+360_000;
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

it('reuses capture graphs without accepting stale sources or exposing private helpers', () => {
  const container=process.env.GROUPS_LIVE_DB_CONTAINER;
  if (!container) throw new Error('Run through ./boga test groups-api-live for the leased database container');
  const output=execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-Atq','-v','check_reuse=1'],{
    input: readFileSync(resolve(__dirname,'../../../supabase/tests/notification-capture-benchmark.sql')),
    encoding: 'utf8',timeout: 60000,
  });
  const [benchmark,checks]=output.trim().split('\n').map(line => JSON.parse(line));
  expect(benchmark).toMatchObject({ workouts: 8,sets: 1080,samples: 5,graph_calls_min: 4,graph_calls_max: 4 });
  expect(checks).toEqual({ stale_rejections: 2,midpass_rejections: 2,atomic_rejection: true,
    standalone_rejection: true,single_workout_graph_calls: 4,helpers_private: true });
},60000);

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
  expect(detail.session.exercises[0].sets[0]).toMatchObject({ normalized_metrics: {
    added_load_percent_bw: 25, volume_percent_bw_reps: 625, e1rm_percent_bw: rm.entries[0].value,
  } });
  expect(board.entries[0].performance).toMatchObject({ normalized_metrics: {
    added_load_percent_bw: 25, volume_percent_bw_reps: 625,
  } });
  const { records }=await as(owner,() => getCompetitionSessionRecords(groupId,member.userId,sessionId));
  expect(records).toHaveLength(1);
  expect(records[0].event).toMatchObject({ kind: 'record',set_id: setId,visibility: 'normalized' });
  expect(records[0].boards.map(b => [b.metric,b.leads,b.leader?.user_id])).toEqual([['e1rm',true,member.userId],['volume',true,member.userId]]);
  expect(records[0].event.values.every(value => value.unit==='percent_bw' || value.unit==='percent_bw_reps')).toBe(true);
  const stream=await as(owner,() => getCompetitionStream(groupId));
  expect(stream.items.some(item => item.kind==='session' && item.session.session_id===sessionId)).toBe(true);
  expect(await as(owner,() => getCompetitionWeek(groupId,joined.sort_at_ms-1,joined.sort_at_ms+120_000))).toMatchObject({ contract_version: 4,group_id: groupId });
  // At a glance: the windows come back in request order with every member's
  // counts (the session's one working set and its record on both boards).
  const windows=[{ start_ms: joined.sort_at_ms-1,end_ms: joined.sort_at_ms+120_000 },{ start_ms: 0,end_ms: 1 }];
  const totals=await as(owner,() => getCompetitionPeriodTotals(groupId,windows));
  expect(totals.periods.map(entry => [entry.start_ms,entry.end_ms])).toEqual(windows.map(entry => [entry.start_ms,entry.end_ms]));
  expect(totals.periods[0].members.find(row => row.member.user_id===member.userId)).toMatchObject({ working_sets: 1,group_records: 2 });
  expect(totals.periods[0].members.find(row => row.member.user_id===owner.userId)).toMatchObject({ working_sets: 0,group_records: 0 });
  expect(totals.periods[1].members.every(row => row.working_sets===0 && row.group_records===0)).toBe(true);
  expect((await as(owner,() => getCompetitionPodiums(groupId,false))).podiums[0].board.metric).toBe('volume');
  expect((await as(owner,() => getCompetitionRevisions(groupId,exerciseId))).revisions.length).toBeGreaterThan(0);
  expect(await as(owner,() => getCompetitionHistory({ groupId,exerciseId,metric: 'volume',certified: false }))).toMatchObject({ metric: 'volume',certified: false });
  const args={ groupId,exerciseId,memberId: member.userId,setId,metric: 'volume' as const,
    revision: board.rules.rules_revision,token: board.entries[0].write_token };
  const certified=await as(owner,() => certifyCompetition(args));
  const certId=certified.certification.certification_id;
  expect((await as(owner,() => getCompetitionCertification(groupId,certId,'volume'))).certification.ended_at_ms).toBeNull();
  expect((await as(owner,() => endCompetitionCertification(groupId,certId,'volume','withdraw'))).certification.end_reason).toBe('withdrawn');
  // The client passes the end action through unchanged, so 'cancel' adds no wire;
  // its end reason, and the ordinary board a rules update rebuilds, are proven
  // server-side in groups-competitions.sh and their values in the Jest
  // contract/evaluation suites. Here: the update call's own wire.
  const updated=await as(owner,() => updateCompetitionExercise({ groupId,exerciseId,revision: board.rules.rules_revision,
    name: 'Ordinary pull-up',mode: 'total_load',contribution: 0,metric: 'e1rm' }));
  expect(updated.exercise).toMatchObject({ name: 'Ordinary pull-up',
    rules: { bodyweight_contribution: 0,default_metric: 'e1rm' } });
  expect(updated.exercise.rules.rules_revision).toBeGreaterThan(board.rules.rules_revision);
  expect((await as(owner,() => archiveCompetitionExercise(groupId,exerciseId,true))).exercise.archived_at_ms).not.toBeNull();
  expect((await as(owner,() => archiveCompetitionExercise(groupId,exerciseId,false))).exercise.archived_at_ms).toBeNull();
},840_000);


it('decodes stored CoW pages, independent podium units, fallback and empty current precedence with the real client', async () => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name: 'CoW wire results', description: null, timeZone: 'UTC' }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId));
  await as(member, () => joinGroup(code));
  await as(owner, () => updateGroup(groupId, { name: 'CoW wire results', description: null, bodyweightCalculationsEnabled: true }));
  const exercise = await as(owner, () => createCompetitionExercise({ groupId, name: 'CoW wire target', mode: 'total_load', contribution: 1, metric: 'e1rm' }));
  const calendar = await as(owner, () => getCoWCalendar(groupId));
  const cowId = randomUUID();
  const input = { cowId, groupExerciseId: exercise.exercise.group_exercise_id, metrics: ['e1rm', 'volume', 'improvement'] as const,
    calendarRevision: calendar.revision, weekStart: calendar.next_week_start! };
  await as(owner, () => createCoW(groupId, { ...input, metrics: [...input.metrics] }));
  const container = process.env.GROUPS_LIVE_DB_CONTAINER;
  if (!container) throw new Error('Missing leased database container');
  const sql = (input: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000 });
  // The backend lane proves scoring; this fixture isolates exact public decoding.
  sql(`insert into app_public.group_cow_participants select '${cowId}',user_id,id,null from app_public.group_memberships where group_id='${groupId}' and ended_at is null;
    update app_public.group_cows set starts_at=clock_timestamp()-interval '7 days',ends_at=clock_timestamp()-interval '1 second',
      week_start=app_public.group_cow_week('UTC',clock_timestamp())-7,start_context=jsonb_build_object('available',true,'normalized',true),
      publication_id=extensions.gen_random_uuid(),finalized_at=clock_timestamp(),final_outcome='ready',final_rankings='${JSON.stringify([
        { metric: 'e1rm', unit: 'percent_bw', unavailableMemberIds: [], entries: [{ memberId: owner.userId, rank: 1, value: 150 }, { memberId: member.userId, rank: 2, value: 140 }] },
        { metric: 'volume', unit: 'percent_bw_reps', unavailableMemberIds: [], entries: [{ memberId: member.userId, rank: 1, value: 600 }, { memberId: owner.userId, rank: 2, value: 500 }] },
        { metric: 'improvement', unit: 'percent', unavailableMemberIds: [], entries: [{ memberId: owner.userId, rank: 1, value: -5 }] },
      ])}'::jsonb where id='${cowId}';`);
  const summary = await as(member, () => getCoWSummary(groupId));
  expect(summary).toMatchObject({ selection: 'previous_final', result: { cow: { cow_id: cowId, state: 'final' }, state: 'ready', normalized: true } });
  expect(summary.result!.rankings.map(row => [row.metric, row.unit, row.entries.map(entry => entry.member.user_id)])).toEqual([
    ['e1rm', 'percent_bw', [owner.userId, member.userId]], ['improvement', 'percent', [owner.userId]], ['volume', 'percent_bw_reps', [member.userId, owner.userId]],
  ]);
  const first = await as(member, () => getCoWResults(groupId, cowId, 'e1rm', null, 1));
  expect(first.rankings[0].entries).toHaveLength(1);
  const second = await as(member, () => getCoWResults(groupId, cowId, 'e1rm', first.rankings[0].next_cursor, 1));
  expect(second.rankings[0].entries[0]).toMatchObject({ rank: 2, member: { user_id: member.userId } });
  const nextId = randomUUID();
  await as(owner, () => createCoW(groupId, { ...input, cowId: nextId, metrics: [...input.metrics] }));
  sql(`update app_public.group_cows set starts_at=clock_timestamp()-interval '1 second',ends_at=clock_timestamp()+interval '1 day',
    week_start=app_public.group_cow_week('UTC',clock_timestamp()),available_at=clock_timestamp()+interval '1 day' where id='${nextId}';`);
  const current = await as(member, () => getCoWSummary(groupId));
  expect(current).toMatchObject({ selection: 'current', result: { cow: { cow_id: nextId }, state: 'pending' } });
  expect(current.result!.rankings.every(row => row.entries.length === 0)).toBe(true);
});
