-- A set's group bodyweight is bound when the set is scored, not looked up
-- again on every evaluation.
--
-- Before: every source-graph build resolved each set's as-of reading
-- (session_weight_as_of), and any reading add/edit/delete/restore requeued
-- every enabled positive-contribution comparison of every later shared session,
-- rescoring sets and ending certifications whose selected reading changed.
--
-- Now: the first publication of an enabled positive comparison that includes
-- a set stores the reading context it used, keyed by the set's raw values and
-- session start. Later builds reuse it while that key matches, so a reading
-- change never moves a published score, record or certification; editing the
-- set (or its session start) binds again on its next publication. A set bound
-- with no applicable reading stays without a normalized score until edited.
-- Off/zero comparisons still never resolve a reading. Every set an enabled
-- positive comparison already published is bound below, before the reading
-- triggers go, with the context its last publication used.

create table app_public.group_set_body_weight_bindings (
  member_user_id uuid not null references auth.users (id) on delete cascade,
  set_id text not null,
  source_key text not null,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  bound_at timestamptz not null default now(),
  constraint group_set_body_weight_bindings_pkey primary key (member_user_id, set_id)
);

comment on table app_public.group_set_body_weight_bindings is
  'Group scoring: the private as-of reading context bound to a set when an enabled positive-contribution comparison first scored it, valid while source_key (raw set values + session start) matches. Written only by group_metric_eval_publish. Server-only.';

alter table app_public.group_set_body_weight_bindings enable row level security;
revoke all on app_public.group_set_body_weight_bindings from public, anon, authenticated, service_role;

-- The raw values a binding depends on: an edit or a session start change binds again.
create function app_public.group_set_body_weight_key(p_set app_public.exercise_sets, p_started_at bigint)
returns text language sql immutable set search_path = app_public, pg_temp as $$
  select app_public.group_legacy_set_fingerprint(p_set) || ':' || coalesce(p_set.set_type, '') || ':'
         || coalesce(p_started_at::text, '');
$$;

-- Stores the context a published graph scored each set with, for an enabled
-- positive-contribution comparison only (any other graph resolved none). Only
-- unbound or edited sets are written, in key order: a publication never locks
-- a binding it reuses.
create function app_public.group_set_body_weight_bind(p_graph jsonb)
returns void language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if not coalesce((p_graph->'rules'->>'bodyweight_calculations_enabled')::boolean, false)
     or coalesce((p_graph->'rules'->>'bodyweight_contribution')::double precision, 0) <= 0 then
    return;
  end if;
  insert into app_public.group_set_body_weight_bindings as b (member_user_id, set_id, source_key, context)
  select es.owner_user_id, es.id, app_public.group_set_body_weight_key(es, s.started_at),
         jsonb_build_object('body_weight_kg', r->'body_weight_kg', 'body_weight_source', r->'body_weight_source',
           'body_weight_measurement_id', r->'body_weight_measurement_id',
           'body_weight_measured_at', r->'body_weight_measured_at_ms')
    from jsonb_array_elements(p_graph->'sets') r
    join app_public.exercise_sets es
      on es.owner_user_id = (r->>'member_user_id')::uuid and es.id = r->>'set_id'
    join app_public.session_exercises se on se.owner_user_id = es.owner_user_id and se.id = es.session_exercise_id
    join app_public.sessions s on s.owner_user_id = se.owner_user_id and s.id = se.session_id
   where not exists (select 1 from app_public.group_set_body_weight_bindings x
                      where x.member_user_id = es.owner_user_id and x.set_id = es.id
                        and x.source_key = app_public.group_set_body_weight_key(es, s.started_at))
   order by es.owner_user_id, es.id
  on conflict (member_user_id, set_id) do update
    set source_key = excluded.source_key, context = excluded.context, bound_at = now()
    where b.source_key is distinct from excluded.source_key;
end;
$$;

revoke all on function app_public.group_set_body_weight_key(app_public.exercise_sets, bigint),
  app_public.group_set_body_weight_bind(jsonb) from public, anon, authenticated, service_role;

-- Exact-anchor patches of the final definitions: each anchor must occur once.
do $patch$
declare _definition text; _anchor text;
begin
  -- The source graph reuses a matching binding before resolving the reading.
  _definition := pg_get_functiondef('app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure);
  _anchor := $a$        then app_public.session_weight_as_of(s.owner_user_id,s.started_at) end as context$a$;
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_metric_eval_source_graph: reading anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor,
    $n$        then coalesce((select b.context from app_public.group_set_body_weight_bindings b
          where b.member_user_id=s.owner_user_id and b.set_id=es.id
            and b.source_key=app_public.group_set_body_weight_key(es,s.started_at)),
          app_public.session_weight_as_of(s.owner_user_id,s.started_at)) end as context$n$);

  -- A completed publication binds what it scored, before its source recheck
  -- (which then rebuilds from the same bindings).
  _definition := pg_get_functiondef('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure);
  _anchor := $a$  -- Every capture and score row came from g: a source that moved since it was$a$;
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_metric_eval_publish: recheck anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor,
    $n$  if (result->>'completed')::boolean and g is not null then
    perform group_set_body_weight_bind(g);
  end if;
$n$ || _anchor);

  -- Wiping a member's data removes the reading contexts bound to their sets.
  _definition := pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  _anchor := $a$  delete from app_public.body_weight_measurements where owner_user_id = _uid;$a$;
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'dev_wipe_my_data: reading anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor,
    $n$  delete from app_public.group_set_body_weight_bindings where member_user_id = _uid;

$n$ || _anchor);
end
$patch$;

-- Bind what the enabled positive comparisons last published: the readings as
-- they stand now, which any queued evaluation would also have used.
insert into app_public.group_set_body_weight_bindings (member_user_id, set_id, source_key, context)
select distinct on (es.owner_user_id, es.id)
       es.owner_user_id, es.id, app_public.group_set_body_weight_key(es, s.started_at),
       app_public.session_weight_as_of(es.owner_user_id, s.started_at)
  from app_public.group_session_shares sh
  join app_public.groups g on g.id = sh.group_id and g.deleted_at is null and g.bodyweight_calculations_enabled
  join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
  join app_public.session_exercises se on se.owner_user_id = s.owner_user_id and se.session_id = s.id
  join app_public.exercise_sets es on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
 where exists (select 1 from app_public.group_exercises ge
                where ge.group_id = g.id and ge.archived_at is null and ge.bodyweight_contribution > 0)
 order by es.owner_user_id, es.id
on conflict (member_user_id, set_id) do nothing;

-- A reading change no longer reaches any group comparison.
drop trigger body_weight_readings_group_eval_insert on app_public.body_weight_measurements;
drop trigger body_weight_readings_group_eval_update on app_public.body_weight_measurements;
drop function app_public.group_eval_on_body_weight_reading();
