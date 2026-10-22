// The harness fixture, generated in SQL with generate_series (the shape of
// supabase/tests/group-metric-publish-benchmark.sql): M members in one group,
// H days of history each, all of it shared with the group, ~3.5 sessions a
// week of 15-25 sets over eight exercises, three of them linked to group
// exercises (one bodyweight-aware), and a weekly bodyweight reading. Rows go in with every trigger on, so
// shares, stream items, queue jobs and notification intake are the real ones.

export type FixtureSpec = {
  members: number;
  historyDays: number;
  /** Lowercase alphanumeric; namespaces emails and the group name. */
  tag: string;
};

export type FixtureExercise = { ex: number; name: string; linked: boolean; bodyweight: number; baseKg: number };

export const FIXTURE_EXERCISES: readonly FixtureExercise[] = [
  { ex: 0, name: 'Bench press', linked: true, bodyweight: 0, baseKg: 80 },
  { ex: 1, name: 'Back squat', linked: true, bodyweight: 0, baseKg: 110 },
  { ex: 2, name: 'Deadlift', linked: false, bodyweight: 0, baseKg: 140 },
  { ex: 3, name: 'Overhead press', linked: false, bodyweight: 0, baseKg: 50 },
  { ex: 4, name: 'Barbell row', linked: false, bodyweight: 0, baseKg: 70 },
  { ex: 5, name: 'Pull-up', linked: true, bodyweight: 1, baseKg: 0 },
  { ex: 6, name: 'Biceps curl', linked: false, bodyweight: 0, baseKg: 15 },
  { ex: 7, name: 'Leg press', linked: false, bodyweight: 0, baseKg: 180 },
];

/** Three rotating splits of five blocks: [split, block, exercise]. */
export const FIXTURE_SPLITS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0, 1, 3], [0, 2, 4], [0, 3, 6], [0, 4, 5],
  [1, 0, 1], [1, 1, 2], [1, 2, 7], [1, 3, 4], [1, 4, 6],
  [2, 0, 0], [2, 1, 1], [2, 2, 5], [2, 3, 3], [2, 4, 7],
];

export const definitionId = (ex: number): string => `perf-def-${ex}`;

export const validateFixtureSpec = (spec: FixtureSpec): FixtureSpec => {
  if (!Number.isInteger(spec.members) || spec.members < 1 || spec.members > 100) {
    throw new Error(`fixture members must be an integer 1-100, got ${spec.members}`);
  }
  if (!Number.isInteger(spec.historyDays) || spec.historyDays < 7 || spec.historyDays > 3650) {
    throw new Error(`fixture history must be an integer 7-3650 days, got ${spec.historyDays}`);
  }
  if (!/^[a-z0-9]{1,16}$/.test(spec.tag)) throw new Error(`fixture tag must be 1-16 lowercase alphanumerics: ${spec.tag}`);
  return spec;
};

/**
 * The statements that build one fixture, in order. They leave session temp
 * tables `perf_fx` (group, tag, clock), `perf_members` (idx, uid) and
 * `perf_group_exercises` (ex, id) for the runner. Sessions start every other
 * day per member (staggered by member), the newest 2-6 hours ago, so some are
 * still recent enough to notify ([[notifications.freshness]]).
 */
export const fixtureStatements = (input: FixtureSpec): string[] => {
  const { members, historyDays: days, tag } = validateFixtureSpec(input);
  const exercises = FIXTURE_EXERCISES.map(
    (e) => `(${e.ex},'${e.name}',${e.linked},${e.bodyweight}::double precision,${e.baseKg})`,
  ).join(',');
  const splits = FIXTURE_SPLITS.map(([split, block, ex]) => `(${split},${block},${ex})`).join(',');
  const joinedDays = days + 30;
  return [
    `drop table if exists perf_fx, perf_members, perf_exercises, perf_group_exercises, perf_splits, perf_sessions`,
    `create temporary table perf_fx as select '${tag}'::text as tag, gen_random_uuid() as group_id,
       floor(extract(epoch from now())*1000)::bigint as now_ms, ${days}::int as days`,
    `create temporary table perf_members as select n as idx, gen_random_uuid() as uid from generate_series(1,${members}) n`,
    `create temporary table perf_exercises(ex int, name text, linked boolean, bodyweight double precision, base numeric)`,
    `insert into perf_exercises values ${exercises}`,
    `create temporary table perf_group_exercises as select ex, gen_random_uuid() as id from perf_exercises where linked`,
    `create temporary table perf_splits(split int, block int, ex int)`,
    `insert into perf_splits values ${splits}`,
    `insert into auth.users(id,aud,role,email)
       select m.uid,'authenticated','authenticated','groups-perf-'||f.tag||'-'||m.idx||'@example.test'
       from perf_members m, perf_fx f`,
    `insert into app_public.user_profiles(id,username) select m.uid,'perf_'||f.tag||'_'||m.idx from perf_members m, perf_fx f`,
    `insert into app_public.groups(id,name,created_by,bodyweight_calculations_enabled)
       select f.group_id,'Groups perf '||f.tag,(select uid from perf_members where idx=1),true from perf_fx f`,
    `insert into app_public.group_memberships(group_id,user_id,role,joined_at)
       select f.group_id,m.uid,case when m.idx=1 then 'owner' else 'member' end,now()-interval '${joinedDays} days'
       from perf_fx f, perf_members m`,
    `insert into app_public.group_exercises(id,group_id,name,load_input_mode,created_by,bodyweight_contribution,default_metric)
       select ge.id,f.group_id,e.name,'total_load',(select uid from perf_members where idx=1),e.bodyweight,'e1rm'
       from perf_group_exercises ge join perf_exercises e using (ex), perf_fx f`,
    `insert into app_public.exercise_definitions(owner_user_id,id,name,load_input_mode,bodyweight_contribution,
       created_at,updated_at,client_updated_at_ms)
       select m.uid,'perf-def-'||e.ex,e.name,'total_load',e.bodyweight,t.at,t.at,t.at
       from perf_members m, perf_exercises e, perf_fx f, lateral (select f.now_ms-${joinedDays}::bigint*86400000 as at) t`,
    `insert into app_public.exercise_group_links(owner_user_id,id,exercise_definition_id,group_id,group_exercise_id,
       created_at,updated_at,client_updated_at_ms)
       select m.uid,f.group_id::text||':perf-def-'||ge.ex,'perf-def-'||ge.ex,f.group_id::text,ge.id::text,t.at,t.at,t.at
       from perf_members m, perf_group_exercises ge, perf_fx f,
         lateral (select f.now_ms-${joinedDays}::bigint*86400000 as at) t`,
    `insert into app_public.body_weight_measurements(owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
       select m.uid,'perf-bw-'||w,70+m.idx+(w%5)*0.3,t.at,t.at,t.at,t.at
       from perf_members m, perf_fx f, generate_series(0,${Math.floor(days / 7)}) w,
         lateral (select f.now_ms-w::bigint*7*86400000-3600000 as at) t`,
    `create temporary table perf_sessions as
       select m.uid,m.idx,d as day,(row_number() over (partition by m.idx order by d desc))::int as n,
         f.now_ms-d::bigint*86400000-(2+m.idx%5)::bigint*3600000 as started_at
       from perf_members m, perf_fx f, generate_series(0,${days - 1}) d where (d+m.idx)%2=0`,
    `insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,duration_sec,created_at,updated_at,client_updated_at_ms)
       select uid,'perf-s-'||n,'completed',started_at,started_at+4200000,4200,started_at,started_at+4200000,started_at+4200000
       from perf_sessions`,
    `insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,order_index,name,
       created_at,updated_at,client_updated_at_ms)
       select s.uid,'perf-s-'||s.n||'-b'||p.block,'perf-s-'||s.n,'perf-def-'||p.ex,p.block,e.name,
         s.started_at,s.started_at,s.started_at+4200000
       from perf_sessions s join perf_splits p on p.split=s.n%3 join perf_exercises e on e.ex=p.ex`,
    `insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
       created_at,updated_at,client_updated_at_ms)
       select s.uid,'perf-s-'||s.n||'-b'||p.block||'-x'||k,'perf-s-'||s.n||'-b'||p.block,k,
         (case when e.bodyweight>0 then case when k=0 then 0 else (s.n%3)*2.5 end
           else round(e.base*(0.75+0.25*(1-s.day::numeric/f.days))*(case when k=0 then 0.6 else 1 end)/2.5)*2.5 end)::text,
         (case when k=0 then 10 else 5+(s.n+k)%6 end)::text,
         case when k=0 then 'warm_up' else (array['rir_2','rir_1','unspecified'])[1+(s.n+k)%3] end,
         s.started_at+k*120000,s.started_at+k*120000,s.started_at+4200000
       from perf_sessions s join perf_splits p on p.split=s.n%3 join perf_exercises e on e.ex=p.ex, perf_fx f,
         generate_series(0,2+(s.n+p.block+s.idx)%3) k`,
  ];
};

/** Live sets the fixture holds (for the report): every member's sets, linked or not. */
export const FIXTURE_COUNTS_SQL = `select
  (select count(*) from perf_members)::int as members,
  (select count(*) from perf_sessions)::int as sessions,
  (select count(*) from app_public.exercise_sets es join perf_members m on m.uid=es.owner_user_id)::int as sets`;
