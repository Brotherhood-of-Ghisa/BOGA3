-- Local-only, rollback-only fixture. Run through the leased Postgres container:
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -f - < this file
-- Measures the notification background with nobody training: one sweep and one
-- worker preparation, with 8 and then 32 recent, already-notified workouts of
-- members with linked history. notification-workout-events.sh asserts its
-- output: an idle sweep writes nothing and calls no worker, and preparation
-- work does not grow with recent workouts or history. Each sample reports
-- buffer pages (EXPLAIN BUFFERS, nested calls included), rows written, proof/graph
-- calls and worker posts. Server-wide WAL growth is diagnostic only. Accepted
-- pushes of the last 30 days stay ticketed until pruning, so the idle sweep is
-- measured again over 100 and then 1,000 of them. It touches
-- no admission internals, so it also measures schemas that predate them. A final positive control starts a workout, so that sweep
-- must call the worker. It empties the notification tables first, inside its
-- rolled-back transaction, so other fixtures' work cannot make the sweep due.
\set ON_ERROR_STOP on
begin;
set local client_min_messages=warning;
set local statement_timeout='120s';
set local track_functions='all';
select app_public.group_eval_set_url('') \gset
select vault.create_secret('http://127.0.0.1:9/idle-benchmark','notification_worker_url') \gset
select vault.create_secret('idle-benchmark','notification_worker_key') \gset
-- Other fixtures' in-flight notification work must not make this sweep due.
delete from app_public.notification_deliveries; delete from app_public.notification_intents;
delete from app_public.notification_workouts; delete from app_public.notification_workout_moments;
delete from app_public.notification_installations;
do $$ begin
  if to_regclass('app_public.notification_moment_queue') is not null then
    execute 'delete from app_public.notification_moment_queue'; end if;
end $$;
-- Recent workouts must postdate the cutover, as they do on hosted.
update app_public.notification_workout_epoch set started_at=now()-interval '30 days';
create temporary table idle_fixture as
select gen_random_uuid() as group_id,gen_random_uuid() as exercise_id,
  floor(extract(epoch from now())*1000)::bigint as stamp;
create temporary table idle_members as
select gen_random_uuid() as member,n from generate_series(1,4) n;
insert into auth.users(id,aud,role,email)
select member,'authenticated','authenticated',member::text||'@idle-benchmark.test' from idle_members;
insert into app_public.groups(id,name,created_by)
select f.group_id,'Idle benchmark',m.member from idle_fixture f join idle_members m on m.n=1;
insert into app_public.group_memberships(group_id,user_id,role,joined_at)
select f.group_id,m.member,case when m.n=1 then 'owner' else 'member' end,now()-interval '400 days'
from idle_fixture f cross join idle_members m;
insert into app_public.group_exercises(id,group_id,name,load_input_mode,created_by)
select f.exercise_id,f.group_id,'Bench','total_load',m.member from idle_fixture f join idle_members m on m.n=1;
insert into app_public.exercise_definitions(owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
select m.member,'idle-bench','Bench','total_load',f.stamp-600000,f.stamp-600000,f.stamp from idle_fixture f cross join idle_members m;
insert into app_public.exercise_group_links(owner_user_id,id,exercise_definition_id,group_id,group_exercise_id,created_at,updated_at,client_updated_at_ms)
select m.member,f.group_id::text||':idle-bench','idle-bench',f.group_id::text,f.exercise_id::text,f.stamp-600000,f.stamp-600000,f.stamp
from idle_fixture f cross join idle_members m;

-- p_count completed sessions of p_sets sets each, every member, starting p_from_ms
-- and p_step_ms apart. History is inserted as hosted holds it after earlier
-- prune passes (shared, tracked as ineligible, no moments) without triggers, so
-- the fixture leaves no dead rows that only autovacuum would clear.
create function pg_temp.add_sessions(p_prefix text,p_count int,p_from_ms bigint,p_step_ms bigint,p_sets int,
  p_history boolean default false) returns void language plpgsql as $$
begin
  if p_history then
    alter table app_public.sessions disable trigger user;
    alter table app_public.session_exercises disable trigger user;
    alter table app_public.exercise_sets disable trigger user;
  end if;
  insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,created_at,updated_at,client_updated_at_ms)
  select m.member,p_prefix||'-'||m.n||'-'||s,'completed',p_from_ms+p_step_ms*s,p_from_ms+p_step_ms*s+1800000,f.stamp,f.stamp,f.stamp
  from idle_fixture f cross join idle_members m cross join generate_series(1,p_count) s;
  insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,order_index,name,created_at,updated_at,client_updated_at_ms)
  select m.member,p_prefix||'-block-'||m.n||'-'||s,p_prefix||'-'||m.n||'-'||s,'idle-bench',0,'Bench',f.stamp,f.stamp,f.stamp
  from idle_fixture f cross join idle_members m cross join generate_series(1,p_count) s;
  insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,created_at,updated_at,client_updated_at_ms)
  select m.member,p_prefix||'-set-'||m.n||'-'||s||'-'||k,p_prefix||'-block-'||m.n||'-'||s,k,(60+(s+k)%40)::text,(3+k%8)::text,'working',f.stamp,f.stamp,f.stamp
  from idle_fixture f cross join idle_members m cross join generate_series(1,p_count) s cross join generate_series(1,p_sets) k;
  if p_history then
    insert into app_public.group_session_shares(group_id,member_user_id,session_id,session_started_at)
    select f.group_id,m.member,p_prefix||'-'||m.n||'-'||s,p_from_ms+p_step_ms*s
    from idle_fixture f cross join idle_members m cross join generate_series(1,p_count) s;
    insert into app_public.notification_workouts(member_user_id,session_id,completion_at,can_start,eligible)
    select m.member,p_prefix||'-'||m.n||'-'||s,to_timestamp((p_from_ms+p_step_ms*s+1800000)/1000.0),false,false
    from idle_members m cross join generate_series(1,p_count) s;
    set constraints all immediate;
    alter table app_public.sessions enable trigger user;
    alter table app_public.session_exercises enable trigger user;
    alter table app_public.exercise_sets enable trigger user;
  end if;
end $$;
-- Brings the fixture to the hosted steady state: every moment admitted, recent
-- workouts confirmed by the app with their completion summaries enqueued.
create function pg_temp.settle() returns void language plpgsql as $$
begin
  for i in 1..10 loop perform app_public.notification_workout_prepare(20); end loop;
  update app_public.notification_workouts w set confirmed_at=now(),
    manifest_digest=app_public.notification_manifest_digest(w.member_user_id,w.session_id),
    context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id),
    enqueued_generation=w.generation
  where w.member_user_id in(select member from idle_members) and w.confirmed_at is null
    and w.completion_at+interval '24 hours'>now();
  -- Hosted autovacuum keeps statistics current; a fixture built in one transaction must do it itself.
  analyze app_public.notification_workouts,app_public.notification_workout_moments,app_public.notification_workout_targets,
    app_public.notification_intents,app_public.notification_deliveries,app_public.notification_installations;
end $$;

-- p_count accepted pushes from member 2 to member 1, one a day apart within
-- the last 30 days: receipts settled, ticket kept until the 30-day prune.
create function pg_temp.add_receipts(p_prefix text,p_count int) returns void language plpgsql as $$
begin
  insert into app_public.notification_installations(id,capability_hash,user_id,auth_session_id,encryption_key,token,
    environment,project_id,bundle_id,permission,opted_in)
  select gen_random_uuid(),'\x00',m.member,gen_random_uuid(),'idle-key','idle-token-'||m.member::text,
    'development',gen_random_uuid(),'idle.benchmark',true,true from idle_members m
  where m.n=1 and not exists(select 1 from app_public.notification_installations i where i.user_id=m.member);
  insert into app_public.notification_intents(recipient_user_id,lifter_user_id,session_id,kind,event_at,expires_at)
  select r.member,l.member,p_prefix||'-'||k,'completion',now()-make_interval(hours=>24+k*24*29/p_count),
    now()-make_interval(hours=>k*24*29/p_count)
  from idle_members r join idle_members l on l.n=2 cross join generate_series(1,p_count) k where r.n=1;
  insert into app_public.notification_deliveries(intent_id,installation_id,binding_id,generation,state,provider,ticket_id,ticket_at)
  select n.id,i.id,i.binding_id,1,'receipt_ok','local','ticket-'||n.id,n.event_at+interval '1 minute'
  from app_public.notification_intents n join idle_members r on r.member=n.recipient_user_id
  join app_public.notification_installations i on i.user_id=r.member where n.session_id like p_prefix||'-%';
  analyze app_public.notification_intents,app_public.notification_deliveries,app_public.notification_installations;
end $$;

create temporary table idle_samples(step text,sessions int,recent int,pages bigint,temp_pages bigint,
  rows_written bigint,wal_kb numeric,worker_posts bigint,proof_calls bigint,graph_calls bigint);
create function pg_temp.measure(p_step text,p_sql text) returns void language plpgsql as $$
declare plan json; lsn pg_lsn; written_before bigint; posts_before bigint; proofs_before bigint; graphs_before bigint;
begin
  select coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) into written_before from pg_stat_xact_user_tables;
  select count(*) into posts_before from net.http_request_queue;
  select coalesce(sum(calls),0) into proofs_before from pg_stat_xact_user_functions
    where funcid='app_public.notification_workout_ready(uuid,text)'::regprocedure;
  select coalesce(sum(calls),0) into graphs_before from pg_stat_xact_user_functions
    where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure;
  lsn:=pg_current_wal_insert_lsn();
  -- Fixture tables are a few pages, where the planner prefers sequential scans;
  -- disabling them measures the plans hosted-sized tables get.
  perform set_config('enable_seqscan','off',true);
  execute 'explain (analyze, buffers, format json) '||p_sql into plan;
  perform set_config('enable_seqscan','on',true);
  insert into idle_samples select p_step,
    (select count(*) from app_public.sessions where owner_user_id in(select member from idle_members)),
    (select count(*) from app_public.sessions where owner_user_id in(select member from idle_members)
      and completed_at>=floor(extract(epoch from now()-interval '24 hours')*1000)),
    (plan->0->'Plan'->>'Shared Hit Blocks')::bigint+(plan->0->'Plan'->>'Shared Read Blocks')::bigint,
    (plan->0->'Plan'->>'Temp Written Blocks')::bigint,
    (select coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) from pg_stat_xact_user_tables)-written_before,
    round(pg_wal_lsn_diff(pg_current_wal_insert_lsn(),lsn)/1024.0,1),
    (select count(*) from net.http_request_queue)-posts_before,
    (select coalesce(sum(calls),0) from pg_stat_xact_user_functions
      where funcid='app_public.notification_workout_ready(uuid,text)'::regprocedure)-proofs_before,
    (select coalesce(sum(calls),0) from pg_stat_xact_user_functions
      where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure)-graphs_before;
end $$;

-- Linked history outside the alert window, about the hosted size (~1.2k sets).
select pg_temp.add_sessions('history',60,(select stamp from idle_fixture)-86400000::bigint*400,86400000::bigint*6,5,true);
select pg_temp.add_sessions('recent-a',2,(select stamp from idle_fixture)-86400000::bigint*20/24,3600000,5);
select pg_temp.settle();
select pg_temp.measure('sweep','select app_public.notification_sweep()');
select pg_temp.measure('prepare','select app_public.notification_workout_prepare(20)');
select pg_temp.add_sessions('recent-b',6,(select stamp from idle_fixture)-86400000::bigint*19/24,3600000,5);
select pg_temp.settle();
select pg_temp.measure('sweep','select app_public.notification_sweep()');
select pg_temp.measure('prepare','select app_public.notification_workout_prepare(20)');
-- Three times the history: the idle background must not read more.
select pg_temp.add_sessions('history-b',120,(select stamp from idle_fixture)-86400000::bigint*399,86400000::bigint*3,5,true);
select pg_temp.settle();
select pg_temp.measure('sweep','select app_public.notification_sweep()');
select pg_temp.measure('prepare','select app_public.notification_workout_prepare(20)');
-- A month of accepted pushes, then ten times as many: the idle sweep must not
-- read more. Each is measured warm, so a few pages of growth are not lost in
-- the catalog reloads the fixture's analyze causes.
select pg_temp.add_receipts('receipts-a',100);
select app_public.notification_sweep();
select pg_temp.measure('receipts_sweep','select app_public.notification_sweep()');
select pg_temp.add_receipts('receipts-b',900);
select app_public.notification_sweep();
select pg_temp.measure('receipts_sweep','select app_public.notification_sweep()');
-- Positive control: a workout starting now makes the next sweep call the worker.
insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
select m.member,'starting-now','active',f.stamp,f.stamp,f.stamp,f.stamp from idle_fixture f join idle_members m on m.n=2;
select pg_temp.measure('due_sweep','select app_public.notification_sweep()');
select jsonb_agg(to_jsonb(s) order by s.ctid) as idle_benchmark from idle_samples s;
rollback;
