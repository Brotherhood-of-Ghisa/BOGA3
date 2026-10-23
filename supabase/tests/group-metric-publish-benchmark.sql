-- Local-only, rollback-only fixture. Run through the leased Postgres container:
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -f - < this file
-- Measures group_metric_eval_publish on one 2,600-score comparison: a first
-- publication, an unchanged republication and a one-set edit, then checks that
-- a source moving after publish built its graph still rejects the whole
-- publication, and last republishes next to a bodyweight-aware comparison.
-- notification-workout-events.sh asserts its output. It does not
-- include TypeScript scoring: the evaluation is built from the source graph.
-- Each sample reports row writes, WAL and how many times the source graph was
-- built (graph_calls) and how many times capture asked bodyweight disclosure
-- (redaction_calls); elapsed_ms swings by 30x once
-- repeated rolled-back runs leave planner statistics stale, so run
-- `vacuum analyze` (as supabase_admin) before comparing timings.
\set ON_ERROR_STOP on
begin;
set local client_min_messages=warning;
set local statement_timeout='120s';
set local track_functions='all';
select app_public.group_eval_set_url('') \gset
-- Two workouts in progress since the notification cutover: every capture pass
-- ranks each one without itself against the member's whole history.
update app_public.notification_workout_epoch set started_at=now()-interval '2 hours';
create temporary table publish_fixture as
select gen_random_uuid() as member,gen_random_uuid() as group_id,gen_random_uuid() as exercise_id,
  floor(extract(epoch from now())*1000)::bigint as stamp;
insert into auth.users(id,aud,role,email)
select member,'authenticated','authenticated',member::text||'@publish-benchmark.test' from publish_fixture;
insert into app_public.groups(id,name,created_by)
select group_id,'Publish benchmark',member from publish_fixture;
insert into app_public.group_memberships(group_id,user_id,role,joined_at)
select group_id,member,'owner',now()-interval '400 days' from publish_fixture;
insert into app_public.group_exercises(id,group_id,name,load_input_mode,created_by)
select exercise_id,group_id,'Bench','total_load',member from publish_fixture;
insert into app_public.exercise_definitions(owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
select member,'publish-benchmark','Bench','total_load',stamp-600000,stamp-600000,stamp from publish_fixture;
insert into app_public.exercise_group_links(owner_user_id,id,exercise_definition_id,group_id,group_exercise_id,created_at,updated_at,client_updated_at_ms)
select member,group_id::text||':publish-benchmark','publish-benchmark',group_id::text,exercise_id::text,
  stamp-600000,stamp-600000,stamp from publish_fixture;
insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,created_at,updated_at,client_updated_at_ms)
select member,'publish-benchmark-'||n,case when n<=2 then 'active' else 'completed' end,
  case when n<=2 then stamp-300000 else stamp-86400000::bigint*n end,
  case when n>2 then stamp-86400000::bigint*n+3600000 end,stamp,stamp,stamp
from publish_fixture cross join generate_series(1,130) n;
insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,order_index,name,created_at,updated_at,client_updated_at_ms)
select member,'publish-block-'||n,'publish-benchmark-'||n,'publish-benchmark',0,'Bench',stamp,stamp,stamp
from publish_fixture cross join generate_series(1,130) n;
insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,created_at,updated_at,client_updated_at_ms)
select member,'publish-set-'||n||'-'||s,'publish-block-'||n,s,(60+n%40)::text,(3+s%8)::text,'working',stamp,stamp,stamp
from publish_fixture cross join generate_series(1,130) n cross join generate_series(1,10) s;
insert into app_public.group_session_shares(group_id,member_user_id,session_id,session_started_at)
select f.group_id,s.owner_user_id,s.id,s.started_at from publish_fixture f
join app_public.sessions s on s.owner_user_id=f.member and s.id like 'publish-benchmark-%'
on conflict do nothing;
delete from app_public.group_session_shares sh using publish_fixture f
where sh.group_id=f.group_id and sh.session_id not like 'publish-benchmark-%';

-- An evaluation every publish accepts: each live set scores both metrics.
create function pg_temp.publish_evaluation(p_graph jsonb) returns jsonb language sql as $$
  select jsonb_build_object('contract_version',p_graph->'contract_version','source_token',p_graph->'source_token',
    'rules_revision',p_graph->'rules'->>'rules_revision','group_id',p_graph->>'group_id',
    'group_exercise_id',p_graph->>'group_exercise_id','baseline_scores','[]'::jsonb,
    'scores',coalesce(jsonb_agg(jsonb_build_object('member_user_id',r->>'member_user_id','set_id',r->>'set_id',
      'session_id',r->>'session_id','session_exercise_id',r->>'session_exercise_id',
      'exercise_definition_id',r->>'exercise_definition_id','metric',m,
      'unit',app_public.group_competition_unit(m,false),'working',true,
      'value',(r->>'weight_value')::numeric*case m when 'volume' then (r->>'reps_value')::numeric else 1 end,
      'fingerprint',r->'fingerprints'->>m)),'[]'::jsonb))
  from jsonb_array_elements(p_graph->'sets') r cross join unnest(array['volume','e1rm']) m
  where (r->>'live')::boolean
$$;
create temporary table publish_samples(step text,scores int,elapsed_ms numeric,wal_kb numeric,
  inserted bigint,updated bigint,deleted bigint,graph_calls bigint,redaction_calls bigint,completed boolean,rejected text);
create function pg_temp.publish_once(p_step text) returns void language plpgsql as $$
declare f record; job jsonb; graph jsonb; evaluation jsonb; result jsonb; started timestamptz; lsn pg_lsn;
  before record; after record; calls_before bigint; redactions_before bigint; rejected text;
begin
  select * into strict f from publish_fixture;
  -- Enqueue and claim this fixture's job only, as the enqueue triggers and
  -- group_metric_eval_claim would.
  insert into app_public.group_metric_eval_queue(group_id,group_exercise_id,causes)
    values(f.group_id,f.exercise_id,array['set']) on conflict do nothing;
  update app_public.group_metric_eval_queue set claim_id=gen_random_uuid(),claimed_until=now()+interval '5 minutes'
    where group_exercise_id=f.exercise_id
    returning jsonb_build_object('job_id',id,'generation',generation,'claim_id',claim_id) into strict job;
  graph:=app_public.group_metric_eval_source_graph(f.group_id,f.exercise_id);
  evaluation:=pg_temp.publish_evaluation(graph);
  select n_tup_ins,n_tup_upd,n_tup_del into before from pg_stat_xact_user_tables
    where relid='app_public.group_metric_set_scores'::regclass;
  select coalesce(sum(calls),0) into calls_before from pg_stat_xact_user_functions
    where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure;
  select coalesce(sum(calls),0) into redactions_before from pg_stat_xact_user_functions
    where funcid='app_public.group_competition_redacts_exercise(uuid[],uuid,text)'::regprocedure;
  lsn:=pg_current_wal_insert_lsn();
  started:=clock_timestamp();
  begin
    result:=app_public.group_metric_eval_publish((job->>'job_id')::bigint,(job->>'generation')::bigint,
      (job->>'claim_id')::uuid,evaluation);
  exception when others then rejected:=sqlstate||' '||sqlerrm;
  end;
  select n_tup_ins,n_tup_upd,n_tup_del into after from pg_stat_xact_user_tables
    where relid='app_public.group_metric_set_scores'::regclass;
  insert into publish_samples values(p_step,jsonb_array_length(evaluation->'scores'),
    round((extract(epoch from clock_timestamp()-started)*1000)::numeric,1),
    round(pg_wal_lsn_diff(pg_current_wal_insert_lsn(),lsn)/1024.0,1),
    after.n_tup_ins-before.n_tup_ins,after.n_tup_upd-before.n_tup_upd,after.n_tup_del-before.n_tup_del,
    (select coalesce(sum(calls),0) from pg_stat_xact_user_functions
      where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure)-calls_before,
    (select coalesce(sum(calls),0) from pg_stat_xact_user_functions
      where funcid='app_public.group_competition_redacts_exercise(uuid[],uuid,text)'::regprocedure)-redactions_before,
    (result->>'completed')::boolean,rejected);
end $$;
select pg_temp.publish_once('first');
-- A republish with nothing changed (a coalesced kick, a rules-version drain).
select pg_temp.publish_once('unchanged');
-- One set edited, as its owner.
select set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true)
from publish_fixture \gset
update app_public.exercise_sets set weight_value='150',client_updated_at_ms=client_updated_at_ms+1
where owner_user_id=(select member from publish_fixture) and id='publish-set-1-1';
select pg_temp.publish_once('one_set_edited');
-- Another set moves while publish writes the scores of an earlier edit, after
-- it built its graph: the publication must roll back as a whole.
update app_public.exercise_sets set weight_value='151',client_updated_at_ms=client_updated_at_ms+1
where owner_user_id=(select member from publish_fixture) and id='publish-set-1-2';
create function pg_temp.move_source() returns trigger language plpgsql as $$
begin
  update app_public.exercise_sets set weight_value='152',client_updated_at_ms=client_updated_at_ms+1
  where owner_user_id=(select member from publish_fixture) and id='publish-set-2-1';
  return null;
end $$;
create trigger publish_benchmark_move_source after update on app_public.group_metric_set_scores
  for each statement execute function pg_temp.move_source();
select pg_temp.publish_once('source_moved');
drop trigger publish_benchmark_move_source on app_public.group_metric_set_scores;
-- A bodyweight-aware sibling makes capture of this ordinary comparison ask
-- disclosure, once per score row it ranks unless answers are shared.
update app_public.groups set bodyweight_calculations_enabled=true where id=(select group_id from publish_fixture);
insert into app_public.group_exercises(group_id,name,load_input_mode,bodyweight_contribution,created_by)
select group_id,'Pull-up','total_load',1,member from publish_fixture;
select pg_temp.publish_once('disclosure');
select jsonb_agg(to_jsonb(s) order by s.ctid) as publish_benchmark from publish_samples s;
rollback;
