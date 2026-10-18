-- Local-only, rollback-only fixture. Run through the leased Postgres container.
-- Measures the capture pair; it does not include TypeScript scoring or provider delivery.
\set ON_ERROR_STOP on
begin;
set local client_min_messages=warning;
set local track_functions='all';
set local statement_timeout='60s';
select app_public.group_eval_set_url('') \gset
update app_public.notification_workout_epoch set started_at=now()-interval '2 hours';
create temporary table capture_fixture as
select subject_uuid as member,gen_random_uuid() as group_id,gen_random_uuid() as exercise_id,
  floor(extract(epoch from now())*1000)::bigint as stamp
from public.dev_fixture_principals where fixture_key='user_a';
select set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true)
from capture_fixture \gset
insert into app_public.groups(id,name,created_by)
select group_id,'Capture benchmark',member from capture_fixture;
insert into app_public.group_memberships(group_id,user_id,role,joined_at)
select group_id,member,'owner',now()-interval '90 days' from capture_fixture;
insert into app_public.group_exercises(id,group_id,name,load_input_mode,created_by)
select exercise_id,group_id,'Bench','total_load',member from capture_fixture;
insert into app_public.exercise_definitions(owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
select member,'capture-benchmark','Bench','total_load',stamp-600000,stamp-600000,stamp from capture_fixture;
insert into app_public.exercise_group_links(owner_user_id,id,exercise_definition_id,group_id,group_exercise_id,created_at,updated_at,client_updated_at_ms)
select member,group_id::text||':capture-benchmark','capture-benchmark',group_id::text,exercise_id::text,
  stamp-600000,stamp-600000,stamp from capture_fixture;
insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,created_at,updated_at,client_updated_at_ms)
select member,'capture-benchmark-'||n,case when n<=8 then 'active' else 'completed' end,
  stamp-case when n<=8 then 300000 else 86400000*30::bigint+n end,
  case when n>8 then stamp-86400000*30::bigint+n+60000 end,stamp,stamp,stamp
from capture_fixture cross join generate_series(1,108) n;
insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,order_index,name,created_at,updated_at,client_updated_at_ms)
select member,'capture-block-'||n,'capture-benchmark-'||n,'capture-benchmark',0,'Bench',stamp,stamp,stamp
from capture_fixture cross join generate_series(1,108) n;
insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,created_at,updated_at,client_updated_at_ms)
select member,'capture-set-'||n||'-'||s,'capture-block-'||n,s,'100','5','working',stamp,stamp,stamp
from capture_fixture cross join generate_series(1,108) n cross join generate_series(1,10) s;
insert into app_public.group_session_shares(group_id,member_user_id,session_id,session_started_at)
select f.group_id,s.owner_user_id,s.id,s.started_at from capture_fixture f
join app_public.sessions s on s.owner_user_id=f.member and s.id like 'capture-benchmark-%'
on conflict do nothing;
-- Joining a group can also share older fixture-account sessions; keep this
-- benchmark independent of whichever backend lane ran before it.
delete from app_public.group_session_shares sh using capture_fixture f
where sh.group_id=f.group_id and sh.session_id not like 'capture-benchmark-%';
create temporary table capture_samples(sample int,elapsed_ms numeric,graph_calls bigint);
do $$
declare f record; graph jsonb; started timestamptz; calls_before bigint; calls_after bigint;
begin
  select * into strict f from capture_fixture;
  graph:=app_public.group_metric_eval_source_graph(f.group_id,f.exercise_id);
  for sample in 0..5 loop
    select coalesce(sum(calls),0) into calls_before from pg_stat_xact_user_functions
      where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure;
    started:=clock_timestamp();
    perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,false,graph);
    perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,true,graph);
    select coalesce(sum(calls),0) into calls_after from pg_stat_xact_user_functions
      where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure;
    if sample>0 then
      insert into capture_samples values(sample,extract(epoch from clock_timestamp()-started)*1000,calls_after-calls_before);
    end if;
  end loop;
end $$;
select jsonb_build_object('workouts',8,'historical_sessions',100,
  'sets',(select jsonb_array_length(app_public.group_metric_eval_source_graph(group_id,exercise_id)->'sets') from capture_fixture),'samples',5,
  'median_ms',round((percentile_cont(0.5) within group(order by elapsed_ms))::numeric,3),
  'min_ms',round(min(elapsed_ms),3),'max_ms',round(max(elapsed_ms),3),
  'graph_calls_min',min(graph_calls),'graph_calls_max',max(graph_calls)) as capture_benchmark
from capture_samples;
\if :{?check_reuse}
create temporary table capture_checks(stale_rejections int,midpass_rejections int,
  atomic_rejection boolean,standalone_rejection boolean,single_workout_graph_calls bigint,helpers_private boolean);
insert into capture_checks values(0,0,true,false,0,false);
do $$
declare f record; graph jsonb; target app_public.notification_workout_targets; after_phase boolean;
begin
  select * into strict f from capture_fixture;
  graph:=app_public.group_metric_eval_source_graph(f.group_id,f.exercise_id);
  select * into strict target from app_public.notification_workout_targets
    where member_user_id=f.member and session_id='capture-benchmark-1' and group_exercise_id=f.exercise_id;
  update app_public.exercise_sets set weight_value='101'
    where owner_user_id=f.member and id='capture-set-1-1';
  update capture_checks set standalone_rejection=app_public.notification_target_capture(target,graph,false) is null;
  foreach after_phase in array array[false,true] loop
    begin
      perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,after_phase,graph);
    exception when sqlstate 'P0001' then
      if sqlerrm<>'notification capture source moved' then raise; end if;
      update capture_checks set stale_rejections=stale_rejections+1;
    end;
  end loop;
  update app_public.exercise_sets set weight_value='100'
    where owner_user_id=f.member and id='capture-set-1-1';
end $$;

-- Move a raw input after graph validation and during a workout write. Both
-- capture phases must reject it and roll back every preceding snapshot write.
create function pg_temp.move_capture_source() returns trigger language plpgsql as $$
begin
  if current_setting('boga.capture_test_moved',true) is distinct from 'yes' then
    perform set_config('boga.capture_test_moved','yes',true);
    update app_public.exercise_sets set weight_value='102'
      where owner_user_id=(select member from capture_fixture) and id='capture-set-1-1';
  end if;
  return new;
end $$;
create trigger capture_test_source before update on app_public.notification_workout_targets
  for each row execute function pg_temp.move_capture_source();
do $$
declare f record; graph jsonb; before_targets jsonb; after_targets jsonb; after_phase boolean;
begin
  select * into strict f from capture_fixture;
  graph:=app_public.group_metric_eval_source_graph(f.group_id,f.exercise_id);
  select jsonb_agg(to_jsonb(t) order by session_id) into before_targets
    from app_public.notification_workout_targets t where group_exercise_id=f.exercise_id;
  foreach after_phase in array array[false,true] loop
    perform set_config('boga.capture_test_moved','no',true);
    begin
      perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,after_phase,graph);
    exception when sqlstate 'P0001' then
      if sqlerrm<>'notification capture source moved' then raise; end if;
      update capture_checks set midpass_rejections=midpass_rejections+1;
    end;
    select jsonb_agg(to_jsonb(t) order by session_id) into after_targets
      from app_public.notification_workout_targets t where group_exercise_id=f.exercise_id;
    update capture_checks set atomic_rejection=atomic_rejection and before_targets=after_targets
      and (select weight_value='100' from app_public.exercise_sets where owner_user_id=f.member and id='capture-set-1-1');
  end loop;
end $$;
drop trigger capture_test_source on app_public.notification_workout_targets;
do $$
declare f record; graph jsonb; calls_before bigint;
begin
  select * into strict f from capture_fixture;
  update app_public.notification_workouts set eligible=false where member_user_id=f.member
    and session_id like 'capture-benchmark-%' and session_id<>'capture-benchmark-1';
  graph:=app_public.group_metric_eval_source_graph(f.group_id,f.exercise_id);
  select calls into calls_before from pg_stat_xact_user_functions
    where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure;
  perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,false,graph);
  perform app_public.notification_capture_comparison(f.group_id,f.exercise_id,1,true,graph);
  update capture_checks set single_workout_graph_calls=(select calls-calls_before from pg_stat_xact_user_functions
    where funcid='app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure),
    helpers_private=not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
      cross join unnest(array[
        'app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb)',
        'app_public.notification_target_capture_from_graph(app_public.notification_workout_targets,jsonb,boolean)']) fn
      where has_function_privilege(role,fn,'execute'));
end $$;
select to_jsonb(capture_checks) from capture_checks;
\endif
rollback;
