/* eslint-disable import/first */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/** Actual protocol-4 client RPCs and guards against this worktree's leased local
 * stack (supabase/tests/groups-competition-live.sh, lane groups-api-live), whose
 * baseline runs protocol 4. Server arithmetic/privacy vectors remain in
 * backend fixtures. */
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import { readGroupsLiveEnv, signInLiveClient, type LiveClient } from './helpers/groups-live-endpoint';
let mockActiveClient: LiveClient['client'] | null = null;
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => {
  if (!mockActiveClient) throw new Error('No live client');
  return mockActiveClient;
} }));
import { getPredictionBoard, getPredictionRanking, getPredictionSetting, getPredictionThread, listPredictionHistory, setPredictionSetting,
  getMeetLeaderboard, getMeetResults, listMeetTrophies, refreshMeetResults, createMeet, updateMeet, cancelMeet, getMeet, listMeets, saveMeetChallenge, removeMeetChallenge, setMeetJoined, archiveCompetitionExercise,certifyCompetition,createCompetitionExercise,createGroup,endCompetitionCertification,
  getCompetitionBoard,getCompetitionCertification,getCompetitionHistory,getCompetitionPodiums,getCompetitionRecordsHistory,
  getCompetitionPeriodTotals,getCompetitionRevisions,getCompetitionSession,getCompetitionSessionRecords,getCompetitionStream,getCompetitionWeek,getGroup,getGroupInviteCode,
  joinGroup,listCompetitionExercises,listMyGroups,updateCompetitionExercise,updateGroup,createCoW,getCoWCalendar,getCoWResults,getCoWSummary,getPreviousCoWSummary } from '@/src/groups/api';

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

async function pushPerformance(groupId: string,exerciseId: string,startedAt: number, hold = false,
  options: { suffix?: string; lifter?: LiveClient; seconds?: number; weight?: string; noReading?: boolean } = {}) {
  const stamp=Date.now();const sessionId=`competition-live-${env.runTag}${options.suffix ?? (hold ? '-hold' : '')}`;
  const definitionId=`${sessionId}-def`;const sessionExerciseId=`${sessionId}-ex`;const setId=`${sessionId}-set`;
  const entity=(type: string,id: string,fields: Record<string,unknown>) => ({ type,id,client_updated_at_ms: stamp,
    fields: { created_at: stamp,updated_at: stamp,deleted_at: null,...fields } });
  const entities=[
    entity('exercise_definitions',definitionId,{ name: hold ? 'Hollow Hold' : 'Pull-up',recording_mode: hold ? 'hold' : 'reps',load_input_mode: 'total_load',bodyweight_contribution: 0 }),
    ...options.noReading ? [] : [entity('body_weight_measurements',`${sessionId}-reading`,{ weight_kg: 80,measured_at: startedAt-1 })],
    entity('exercise_group_links',`${groupId}:${definitionId}`,{ exercise_definition_id: definitionId,
      group_id: groupId,group_exercise_id: exerciseId }),
    entity('sessions',sessionId,{ gym_id: null,status: 'completed',started_at: startedAt,
      completed_at: startedAt+60_000,duration_sec: 60 }),
    entity('session_exercises',sessionExerciseId,{ session_id: sessionId,exercise_definition_id: definitionId,
      order_index: 0,name: 'Pull-up',machine_name: null }),
    entity('exercise_sets',setId,{ session_exercise_id: sessionExerciseId,order_index: 0,weight_value: options.weight ?? (hold ? '5' : '20'),reps_value: hold ? '' : '5',
      recording_mode: hold ? 'hold' : 'reps',duration_sec: hold ? options.seconds ?? 38 : null,set_type: 'rir_0',performance_status: null,planned_weight_value: null,planned_reps_value: null,planned_set_type: null }),
  ];
  const pushed=await (options.lifter ?? member).client.schema('app_public').rpc('sync_push',{ entities });
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
  const log=await as(owner,() => getCompetitionRecordsHistory({ groupId,exerciseId,metric: 'volume',certified: false }));
  expect(log.items.some(item => item.event.kind === 'record' && item.event.member?.user_id === member.userId && item.record !== null)).toBe(true);
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
  const previous = await as(member, () => getPreviousCoWSummary(groupId));
  expect(previous).toMatchObject({ selection: 'previous', result: { cow: { cow_id: cowId, state: 'final' }, state: 'ready' } });
  expect(previous.result!.rankings).toEqual(summary.result!.rankings);
  expect(previous.week_start).toBe(current.week_start);
  expect(previous.valid_until_us).toBeGreaterThan(previous.observed_at_us);
});


it('shares timed activity and counts while keeping normalized kg and strength boards absent', async () => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name: 'Hold activity', description: null }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId));
  await as(member, () => joinGroup(code));
  await as(owner, () => updateGroup(groupId, { name: 'Hold activity', description: null, bodyweightCalculationsEnabled: true }));
  const { exercise } = await as(owner, () => createCompetitionExercise({ groupId, name: 'Hollow Hold', mode: 'total_load', contribution: 1, metric: 'e1rm' }));
  const started = Date.now();
  const { sessionId, setId } = await pushPerformance(groupId, exercise.group_exercise_id, started, true);
  const detail = await poll(() => as(owner, () => getCompetitionSession(groupId, member.userId, sessionId)),
    value => value.session.exercises[0]?.sets[0]?.performed === true);
  const set = detail.session.exercises[0].sets[0];
  expect(set).toMatchObject({ recording_mode: 'hold', duration_sec: 38, reps_value: '', performed: true });
  expect(set).not.toHaveProperty('weight_value');
  expect(set).not.toHaveProperty('normalized_metrics');
  expect(buildCompetitionSession(detail.session)).toMatchObject({ setCount: 1, volume: '—', cards: [{ rows: [{ weightReps: '38 s' }] }] });
  for (const metric of ['e1rm', 'volume'] as const) {
    const board = await poll(() => as(owner, () => getCompetitionBoard({ groupId, exerciseId: exercise.group_exercise_id, metric, certified: false })),
      value => value.state === 'ready');
    expect(board.entries).toEqual([]);
  }
  const totals = await poll(() => as(owner, () => getCompetitionPeriodTotals(groupId, [{ start_ms: started - 1000, end_ms: started + 120000 }])),
    value => value.periods[0].members.some(row => row.member.user_id === member.userId && row.working_sets === 1));
  expect(totals.periods[0].members.find(row => row.member.user_id === member.userId)).toMatchObject({ working_sets: 1, group_records: 0 });
  const stream = await as(owner, () => getCompetitionStream(groupId));
  const item = stream.items.find(item => item.kind === 'session' && item.session.session_id === sessionId);
  expect(item?.kind === 'session' && item.session.exercises[0].sets[0]).toMatchObject({ set_id: setId, duration_sec: 38 });
  await as(owner, () => updateGroup(groupId, { name: 'Hold activity', description: null, bodyweightCalculationsEnabled: false }));
  const ordinary = await as(owner, () => getCompetitionSession(groupId, member.userId, sessionId));
  expect(ordinary.session.exercises[0].sets[0]).toMatchObject({ recording_mode: 'hold', duration_sec: 38, weight_value: '5' });
  expect(buildCompetitionSession(ordinary.session)).toMatchObject({ setCount: 1, volume: '—', cards: [{ rows: [{ weightReps: '5.0 × 38 s' }] }] });
}, 840000);

it('ranks and certifies Holds by seconds, ignores weight for ties, and retains duration history safely', async () => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name: 'Seconds only', description: null }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId));
  await as(member, () => joinGroup(code));
  await as(owner, () => updateGroup(groupId, { name: 'Seconds only', description: null, bodyweightCalculationsEnabled: true }));
  const { exercise } = await as(owner, () => createCompetitionExercise({ groupId, name: 'Plank', mode: 'total_load', contribution: 1, metric: 'seconds' }));
  const exerciseId = exercise.group_exercise_id;
  const readBoard = () => as(owner, () => getCompetitionBoard({ groupId, exerciseId, metric: 'seconds', certified: false }));
  await poll(readBoard, result => result.state === 'ready');
  const started = Date.now();
  const unweighted = await pushPerformance(groupId, exerciseId, started, true,
    { suffix: '-seconds-bw', lifter: owner, seconds: 30, weight: '', noReading: true });
  const weighted = await pushPerformance(groupId, exerciseId, started + 1, true,
    { suffix: '-seconds-loaded', seconds: 29, weight: '24', noReading: true });
  const board = await poll(readBoard, result => result.entries.length === 2);
  expect(board.entries.map(row => [row.member.user_id, row.value, row.unit])).toEqual([
    [owner.userId, 30, 'seconds'], [member.userId, 29, 'seconds']]);
  expect(board.entries[0].performance).toMatchObject({ recording_mode: 'hold', duration_sec: 30, reps: null });
  expect(board.entries[0].performance).not.toHaveProperty('weight_value');
  expect(board.entries[0].performance).not.toHaveProperty('normalized_metrics');
  const contextParity = execFileSync('docker', ['exec', '-i', process.env.GROUPS_LIVE_DB_CONTAINER!, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq'], {
    input: `with full_graph as (select app_public.group_metric_eval_source_graph('${groupId}','${exerciseId}') g),
      context as (select app_public.notification_context_source('${groupId}','${exerciseId}','${owner.userId}','${unweighted.sessionId}') c)
      select jsonb_build_object('same_sets',c->'sets'=(select jsonb_agg(s order by s->>'member_user_id',s->>'set_id')
        from jsonb_array_elements(g->'sets') s where s->>'member_user_id'='${owner.userId}' and s->>'session_id'='${unweighted.sessionId}'),
        'seconds_pin',c->'sets'->0->'fingerprints' ? 'seconds',
        'no_reading',c->'sets'->0->>'body_weight_kg' is null and c->'sets'->0->>'reading_pin' is null)
      from full_graph,context;`, encoding: 'utf8',
  });
  expect(JSON.parse(contextParity)).toEqual({ same_sets: true, seconds_pin: true, no_reading: true });
  await pushPerformance(groupId, exerciseId, started + 1, true,
    { suffix: '-seconds-loaded', seconds: 30, weight: '24', noReading: true });
  const tied = await poll(readBoard, result => result.entries[1]?.value === 30);
  expect(tied.entries.map(row => row.member.user_id)).toEqual([owner.userId, member.userId]);
  const { certification } = await as(member, () => certifyCompetition({ groupId, exerciseId, memberId: owner.userId,
    setId: unweighted.setId, metric: 'seconds', revision: tied.rules.rules_revision, token: tied.entries[0].write_token }));
  const readCertified = () => as(member, () => getCompetitionBoard({ groupId, exerciseId, metric: 'seconds', certified: true }));
  const certified = await poll(readCertified, result => result.entries.length === 1);
  expect(certified.entries[0].certification?.certification_id).toBe(certification.certification_id);
  const log = await as(owner, () => getCompetitionRecordsHistory({ groupId, exerciseId, metric: 'seconds', certified: false }));
  expect(log.items.some(item => item.event.values.some(value => value.metric === 'seconds' && value.value === 30))).toBe(true);
  const stream = await as(owner, () => getCompetitionStream(groupId));
  expect(stream.items.some(item => item.kind === 'competition' && item.event.values.some(value => value.metric === 'seconds'))).toBe(true);
  expect((await as(owner, () => getCompetitionSessionRecords(groupId, owner.userId, unweighted.sessionId))).records.length).toBeGreaterThan(0);
  const readLegacy = () => fetch(`${env.url}/rest/v1/rpc/group_competition_exercise_list`, { method: 'POST',
    headers: { apikey: env.anonKey, Authorization: `Bearer ${owner.session.access_token}`, 'Content-Type': 'application/json',
      'Content-Profile': 'app_public', 'x-boga-group-contract': '4' }, body: JSON.stringify({ p_group_id: groupId }) });
  expect((await (await readLegacy()).json()).message).toMatch(/^UPDATE_REQUIRED:/);
  const calendar = await as(owner, () => getCoWCalendar(groupId));
  const cowInput = { cowId: randomUUID(), groupExerciseId: exerciseId, metrics: ['e1rm' as const],
    calendarRevision: calendar.revision, weekStart: calendar.next_week_start! };
  await expect(as(owner, () => createCoW(groupId, cowInput))).rejects.toMatchObject({ code: 'VALIDATION' });
  await pushPerformance(groupId, exerciseId, started, true,
    { suffix: '-seconds-bw', lifter: owner, seconds: 28, weight: '', noReading: true });
  await poll(readBoard, result => result.entries[0]?.member.user_id === member.userId);
  await poll(readCertified, result => result.entries.length === 0);
  expect((await as(member, () => getCompetitionCertification(groupId, certification.certification_id, 'seconds'))).certification.end_reason).toBe('voided');
  const switched = await as(owner, () => updateCompetitionExercise({ groupId, exerciseId, revision: exercise.rules.rules_revision,
    name: 'Plank', mode: 'total_load', contribution: 1, metric: 'e1rm' }));
  expect(switched.exercise.rules.rules_revision).toBe(exercise.rules.rules_revision + 1);
  const retained = await as(owner, () => getCompetitionRecordsHistory({ groupId, exerciseId, metric: 'seconds', certified: false }));
  expect(retained.items.some(item => item.event.values.some(value => value.unit === 'seconds'))).toBe(true);
  expect((await (await readLegacy()).json()).message).toMatch(/^UPDATE_REQUIRED:/);
  await as(owner, () => createCoW(groupId, cowInput));
  await as(owner, () => updateCompetitionExercise({ groupId, exerciseId, revision: switched.exercise.rules.rules_revision,
    name: 'Plank', mode: 'total_load', contribution: 1, metric: 'seconds' }));
  const context = execFileSync('docker', ['exec', '-i', process.env.GROUPS_LIVE_DB_CONTAINER!, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq'], {
    input: `select app_public.group_cow_context(c) from app_public.group_cows c where id='${cowInput.cowId}';`, encoding: 'utf8',
  });
  expect(JSON.parse(context)).toMatchObject({ available: false, normalized: false, bodyweight_calculations_enabled: false });
  expect(weighted.setId).not.toBe(unweighted.setId);
}, 840000);

it('decodes real meet scheduling, roster, challenges and v7 stream through the typed client', async () => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name: 'Meet wire', description: null, timeZone: 'Europe/London' }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId)); await as(member, () => joinGroup(code));
  const { exercise } = await as(owner, () => createCompetitionExercise({ groupId, name: 'Meet squat', mode: 'total_load' }));
  const meetId = randomUUID(); const starts = Date.now() + 86400_000;
  const fields = { title: 'Lifting day', starts_at_ms: starts, ends_at_ms: starts + 10800_000, venue_name: 'Town gym', address: 'High Street', latitude: 51, longitude: -1, entry_note: 'Side entrance' };
  const created = await as(owner, () => createMeet(groupId, meetId, fields));
  expect(created.meet).toMatchObject({ meet_id: meetId, time_zone: 'Europe/London', version: 1 });
  const changed = await as(owner, () => updateMeet(groupId, meetId, 1, { ...fields, title: 'Updated lifts' }));
  await expect(as(owner, () => updateMeet(groupId, meetId, 1, fields))).rejects.toMatchObject({ code: 'CONFLICT' });
  await as(member, () => setMeetJoined(groupId, meetId, true));
  expect((await as(member, () => getMeet(groupId, meetId))).viewer).toEqual({ role: 'member', joined: true });
  const challengeId = randomUUID(); const input = { groupId, meetId, challengeId, exerciseId: exercise.group_exercise_id, metric: 'weight' as const, version: null };
  const challenge = await as(member, () => saveMeetChallenge(input));
  expect(challenge.challenge.author?.user_id).toBe(member.userId);
  await expect(as(owner, () => saveMeetChallenge({ ...input, challengeId: randomUUID() }))).rejects.toMatchObject({ code: 'DUPLICATE' });
  const edited = await as(member, () => saveMeetChallenge({ ...input, metric: 'reps', version: challenge.challenge.version }));
  const scheduled = await as(member, () => getMeetResults(groupId, meetId));
  expect(scheduled.results.state).toBe('scheduled'); expect(scheduled.challenges.map(c => [c.challenge.challenge_id, c.standings])).toEqual([[challengeId, []]]);
  expect((await as(member, () => getMeetLeaderboard(groupId))).rows).toEqual([]);
  expect(await as(member, () => listMeetTrophies(groupId, member.userId))).toEqual({ trophies: [], next_cursor: null });
  await expect(as(member, () => refreshMeetResults(groupId, meetId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await as(owner, () => removeMeetChallenge(groupId, meetId, challengeId, edited.challenge.version));
  await as(member, () => setMeetJoined(groupId, meetId, false));
  expect((await as(member, () => listMeets(groupId))).upcoming.map(m => m.meet_id)).toContain(meetId);
  await as(owner, () => cancelMeet(groupId, meetId, changed.meet.version));
  const stream = await as(member, () => getCompetitionStream(groupId));
  expect(stream.items.filter(item => item.kind === 'meet').map(item => item.event)).toEqual(['cancelled', 'scheduled']);
  expect((await as(member, () => getMeet(groupId, meetId))).meet.state).toBe('cancelled');
  expect((await as(member, () => getMeetResults(groupId, meetId))).results.state).toBe('cancelled');
}, 60000);

it('decodes the real prediction readers through the typed client: setting, board, thread, ranking and history', async () => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name: 'Predictions wire', description: null, timeZone: 'UTC' }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId)); await as(member, () => joinGroup(code));
  const psql = (input: string) => execFileSync('docker', ['exec', '-i', process.env.GROUPS_LIVE_DB_CONTAINER!, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
    '-Atq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
  // Off by default: every reader refuses like a missing group, and a plain member cannot turn it on.
  expect(await as(member, () => getPredictionSetting(groupId))).toEqual({ group_id: groupId, enabled: false });
  await expect(as(member, () => getPredictionBoard(groupId))).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'group not found' });
  await expect(as(member, () => setPredictionSetting(groupId, true))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await as(owner, () => setPredictionSetting(groupId, true))).toEqual({ group_id: groupId, enabled: true });
  expect(await as(member, () => getPredictionSetting(groupId))).toEqual({ group_id: groupId, enabled: true });
  const empty = await as(member, () => getPredictionBoard(groupId));
  expect(empty).toMatchObject({ group_id: groupId, time_zone: 'UTC', this_week: { state: 'closed', markets: [] }, next_week: { state: 'open', markets: [] } });
  expect(await as(member, () => getPredictionRanking(groupId))).toEqual({ group_id: groupId, week_start: null, rows: [] });
  expect(await as(member, () => listPredictionHistory(groupId))).toEqual({ group_id: groupId, weeks: [], next_cursor: null });
  const week = psql("select (app_public.group_cow_week('UTC', clock_timestamp()) + 7)::text;");
  const post = (user: string, client: string, side: string, price: number, stake: number, extra: string, line = 3) => `select app_public.agent_group_prediction_post_at(
    clock_timestamp(), '${user}', '${client}', '${groupId}', '${week}', 'records_line', '{"line":${line}}', '${side}', ${price}, ${stake}, ${extra});`;
  psql(`update app_public.group_memberships set joined_at = joined_at - interval '1 day' where group_id = '${groupId}';
    ${post(owner.userId, 'live-a', 'yes', 60, 10, "70, 'Quiet week', null")}
    ${post(member.userId, 'live-b', 'no', 50, 4, "null, 'Busy week', null")}`);
  const board = await as(member, () => getPredictionBoard(groupId));
  expect(board.next_week!.markets).toHaveLength(1);
  const [row] = board.next_week!.markets;
  expect(row).toMatchObject({ open_offers: 1, best_yes: 60, best_no: null, open_stake: 4, matched_bets: 1, last_price: 60 });
  expect(row.market).toMatchObject({ template: 'records_line', parameters: { line: 3 }, outcome: null });
  const thread = await as(member, () => getPredictionThread(groupId, row.market.market_id));
  expect(thread.offers.map(o => o.note)).toEqual(['Quiet week', 'Busy week']);
  expect(thread.matches).toMatchObject([{ price: 60, yes_stake: 6, no_stake: 4, via: 'cross', winner: null }]);
  expect(JSON.stringify([board, thread])).not.toContain('walk_away');
  // A resting offer that expires at the close and one that is withdrawn: the guards see both states on real payloads.
  psql(post(member.userId, 'live-b', 'yes', 40, 2, 'null, null, null', 7));
  const withdrawnOffer = psql(`select (${post(owner.userId, 'live-a', 'no', 80, 3, "null, 'Changed my mind', null", 9).replace(/;$/, '')})->'offer'->>'offer_id';`);
  psql(`select app_public.agent_group_prediction_withdraw_at(clock_timestamp(), '${owner.userId}', 'live-a', '${groupId}', '${withdrawnOffer}');`);
  const marketOf = (line: number) => psql(`select id from app_public.group_prediction_markets where group_id = '${groupId}' and week_start = '${week}' and line = ${line};`);
  const resting = await as(member, () => getPredictionBoard(groupId));
  expect(resting.next_week!.markets.map(m => [m.market.parameters.line, m.open_offers])).toEqual([[3, 1], [7, 1]]);
  expect((await as(member, () => getPredictionThread(groupId, marketOf(9)))).offers).toMatchObject([{ state: 'withdrawn', released: 3, note: 'Changed my mind' }]);
  await expect(as(member, () => getPredictionThread(groupId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'market not found' });
  // Settle the week with a moved clock: the figures are read from the group's sessions (none here).
  expect(psql(`delete from app_public.group_eval_queue where group_id = '${groupId}';
    select app_public.group_prediction_settle_at(upper(app_public.group_cow_bounds('UTC', '${week}')) + interval '1 hour', '${groupId}', '${week}');`)).toBe('t');
  const ranking = await as(owner, () => getPredictionRanking(groupId));
  expect(ranking.week_start).toBe(week);
  expect(ranking.rows.map(r => [r.bettor.member.user_id, r.week_profit, r.all_time_profit, r.matched])).toEqual([[member.userId, 6, 6, 1], [owner.userId, -6, -6, 1]]);
  expect(ranking.rows[0].head_to_head).toMatchObject([{ opponent: { member: { user_id: owner.userId } }, wins: 1, profit: 6 }]);
  const settled = await as(member, () => getPredictionThread(groupId, row.market.market_id));
  expect(settled).toMatchObject({ week: { state: 'settled' }, market: { outcome: 'no', result_value: 0, result_unit: 'records' }, matches: [{ winner: 'no' }] });
  expect((await as(member, () => getPredictionThread(groupId, marketOf(7)))).offers).toMatchObject([{ state: 'expired', released: 2, live: false }]);
  expect((await as(member, () => getPredictionBoard(groupId))).next_week!.markets.map(m => m.market.parameters.line)).toEqual([3]);
  const history = await as(member, () => listPredictionHistory(groupId));
  expect(history.weeks.map(w => w.week_start)).toEqual([week]);
  expect(history.weeks[0].markets[0]).toMatchObject({ market: { outcome: 'no', result_value: 0, result_unit: 'records' }, bets: [{ winner: 'no' }] });
  await as(owner, () => setPredictionSetting(groupId, false));
  await expect(as(owner, () => listPredictionHistory(groupId))).rejects.toMatchObject({ code: 'NOT_FOUND' });
}, 120000);
