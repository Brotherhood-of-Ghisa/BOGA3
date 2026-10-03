-- Group results count working sets only, from now on (groups contract §2.9–§2.11,
-- §4.6, §4.7, §11.2).
--
-- A warm-up never ranks on a board, never makes a record and cannot be
-- certified. The set rule stays in TS: contract 1 reads the facts' `working`
-- (rules version 4, unchanged, so nothing is re-normalized); contract 2's graph
-- carries the raw `set_type` and the evaluator returns `working` per score.
--
-- Forward only: this migration writes no stored result (entries, records,
-- events, certifications, scores) and queues nothing. A board moves when its
-- target is next applied. When that drops a member's best because it was a
-- warm-up, the move is silent (attribution class `rules`): no lead change, no
-- void, no record. A warm-up record already stored stands.
--
-- The two apply functions, both certify RPCs and the contract-2 graph and
-- publish are patched in place at anchors (section 3).

-- 1. The rule as SQL reads it ---------------------------------------------------------

-- A performed, live set the evaluator marked not working: a warm-up under the
-- app's working-set rule. Facts cover every set of a shared session, for both
-- contracts.
create function app_public.group_set_is_warm_up(p_member_user_id uuid, p_set_id text)
returns boolean
language sql
stable
set search_path = app_public, pg_temp
as $$
  select exists (
    select 1 from app_public.group_set_facts f
     where f.member_user_id = p_member_user_id and f.set_id = p_set_id
       and f.performed and f.live and f.working is false);
$$;

revoke all on function app_public.group_set_is_warm_up(uuid, text) from public, anon, authenticated, service_role;

-- 2. Contract 1: counting sets are working sets ------------------------------------------

create or replace function app_public.group_board_counting(p_group_id uuid, p_member_user_id uuid, p_group_exercise_id uuid)
returns table (
  set_id                 text,
  session_id             text,
  session_exercise_id    text,
  exercise_definition_id text,
  achieved_at_ms         bigint,
  exercise_order_index   integer,
  set_order_index        integer,
  fingerprint            text,
  reps                   numeric,
  entered_weight_kg      double precision,
  load_factor            numeric,
  weight_kg              numeric,
  e1rm_kg                numeric,
  set_created_at_ms      bigint
)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select f.set_id, f.session_id, f.session_exercise_id, f.exercise_definition_id,
         f.achieved_at_ms, f.exercise_order_index, f.set_order_index, f.fingerprint,
         f.reps, f.weight_kg, x.factor,
         case when f.weight_kg > 0 then app_public.group_board_kg(f.weight_kg, x.factor) end,
         app_public.group_board_kg(f.e1rm_kg, x.factor),
         es.created_at
    from app_public.group_set_facts f
    join app_public.group_exercises ge on ge.id = p_group_exercise_id and ge.group_id = p_group_id
    join app_public.exercise_sets es on es.owner_user_id = f.member_user_id and es.id = f.set_id
    join app_public.exercise_definitions d
      on d.owner_user_id = f.member_user_id and d.id = f.exercise_definition_id
    cross join lateral (
      select app_public.group_board_load_factor(d.load_input_mode, ge.load_input_mode) as factor
    ) x
   where f.member_user_id = p_member_user_id
     and f.performed
     and f.live
     -- Unknown (a fact not yet re-normalized to rules version 4) still counts:
     -- only a known warm-up is excluded, as group_set_is_warm_up reads it.
     and f.working is not false
     and exists (
       select 1 from app_public.group_session_shares sh
        where sh.group_id = p_group_id and sh.member_user_id = f.member_user_id and sh.session_id = f.session_id)
     and exists (
       select 1 from app_public.exercise_group_links l
        where l.owner_user_id = f.member_user_id
          and l.exercise_definition_id = f.exercise_definition_id
          and l.deleted_at is null
          and app_public.group_eval_try_uuid(l.group_id) = p_group_id
          and app_public.group_eval_try_uuid(l.group_exercise_id) = p_group_exercise_id);
$$;

-- 3. Patches: the applies, both certify RPCs, the contract-2 graph and publish -------------

-- Each row replaces one anchor in the function's current definition, in order.
-- The anchor must occur exactly once, or the migration fails.
do $migration$
declare
  _patch record;
  _definition text;
begin
  for _patch in
    select * from (
      -- Both applies. Attribution: the old best's set is now a warm-up, its
      -- record is not voided in this apply, and the new best does not beat it,
      -- so the rule moved the entry, not a lift. Contract 1 ranks `value_kg`,
      -- contract 2 `value`.
      select a.fn, 1 as step,
             format($old$      elsif _n is not null and (_before is null or (_n ->> '%1$s')::numeric > (_before #>> '{}')::numeric) then
        _class := 'record';
      else
        _class := 'void';$old$, a.value_key) as anchor,
             format($new$      elsif _n is not null and (_before is null or (_n ->> '%1$s')::numeric > (_before #>> '{}')::numeric) then
        _class := 'record';
      elsif _o is not null and app_public.group_set_is_warm_up(p_member_user_id, _o ->> 'set_id')
            and not exists (select 1 from jsonb_array_elements(_voids) v where v ->> 'set_id' = _o ->> 'set_id') then
        _class := 'rules';
      else
        _class := 'void';$new$, a.value_key) as replacement
        from (values ('app_public.group_eval_apply_legacy(uuid,uuid,uuid,text[])', 'value_kg'),
                     ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)', 'value')) a(fn, value_key)
      union all
      -- All boards: a `rules` move writes no lead change.
      select a.fn, 2,
             $old$    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id') then
      _class := _class_by ->> _metric;
      _reason := case _class$old$,
             $new$    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id')
       and (_class_by ->> _metric) is distinct from 'rules' then
      _class := _class_by ->> _metric;
      _reason := case _class$new$
        from (values ('app_public.group_eval_apply_legacy(uuid,uuid,uuid,text[])'),
                     ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)')) a(fn)
      union all
      -- Certified boards: nor does a certified best that was a warm-up, unless a
      -- certification changed too.
      select a.fn, 3,
             $old$    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id') then
      _class := _class_by ->> _metric;
      _cert_id := null;$old$,
             $new$    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id')
       and (_certs_changed
            or not app_public.group_set_is_warm_up(p_member_user_id, _old_c_by -> _metric ->> 'set_id')) then
      _class := _class_by ->> _metric;
      _cert_id := null;$new$
        from (values ('app_public.group_eval_apply_legacy(uuid,uuid,uuid,text[])'),
                     ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)')) a(fn)
      union all
      -- Certification: a warm-up is not a record set.
      select 'app_public.group_certify(uuid,uuid,uuid,text)', 4,
             $old$  select c.* into _row from app_public.group_certifications c
    where c.group_exercise_id=p_group_exercise_id and c.member_user_id=p_member_user_id$old$,
             $new$  if app_public.group_set_is_warm_up(p_member_user_id,p_set_id) then
    raise exception 'NOT_FOUND: record set not found' using errcode='P0001';
  end if;
  select c.* into _row from app_public.group_certifications c
    where c.group_exercise_id=p_group_exercise_id and c.member_user_id=p_member_user_id$new$
      union all
      select 'app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)', 5,
             $old$  if not found or not (
    exists (select 1 from app_public.group_metric_board_entries e$old$,
             $new$  if not found or app_public.group_set_is_warm_up(p_member_user_id,p_set_id) or not (
    exists (select 1 from app_public.group_metric_board_entries e$new$
      union all
      -- Contract 2: the graph carries the raw set_type for the evaluator.
      select 'app_public.group_metric_eval_source_graph(uuid,uuid)', 6,
             $old$      'performance_status',es.performance_status,$old$,
             $new$      'performance_status',es.performance_status,'set_type',es.set_type,$new$
      union all
      -- A score keeps its row either way (a stored warm-up record is checked
      -- against it and stands), but counts only when the evaluator marks it
      -- working. An evaluation without `working` (an older evaluator) fails the job.
      select 'app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)', 7,
             $old$      or jsonb_typeof(x->'value') is distinct from 'number'$old$,
             $new$      or jsonb_typeof(x->'working') is distinct from 'boolean'
      or jsonb_typeof(x->'value') is distinct from 'number'$new$
      union all
      select 'app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)', 8,
             $old$    (r->>'counting')::boolean,(r->>'achieved_at_ms')::bigint,$old$,
             $new$    (r->>'counting')::boolean and (x->>'working')::boolean,(r->>'achieved_at_ms')::bigint,$new$
    ) p
    order by p.step, p.fn
  loop
    select pg_get_functiondef(_patch.fn::regprocedure) into _definition;
    if (length(_definition) - length(replace(_definition, _patch.anchor, ''))) <> length(_patch.anchor) then
      raise exception 'working-set patch: anchor not found exactly once in %: %', _patch.fn, left(_patch.anchor, 80);
    end if;
    execute replace(_definition, _patch.anchor, _patch.replacement);
  end loop;
end
$migration$;

-- 4. Week summary: an exercise counts once it has a working set --------------------------------

-- Working sets and exercises of one session from its facts: performed, live,
-- working facts whose Sync v2 set and exercise rows still exist untombstoned,
-- so a delete of either kind counts at once, before the evaluator re-drains.
-- An exercise with only warm-ups adds nothing.
create or replace function app_public.group_week_session_counts(p_member uuid, p_session_id text)
returns table (working_sets integer, exercise_count integer)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select (count(*))::integer,
         (count(distinct f.session_exercise_id))::integer
    from app_public.group_set_facts f
    join app_public.exercise_sets es
      on es.owner_user_id = f.member_user_id and es.id = f.set_id and es.deleted_at is null
    join app_public.session_exercises se
      on se.owner_user_id = es.owner_user_id and se.id = es.session_exercise_id and se.deleted_at is null
   where f.member_user_id = p_member and f.session_id = p_session_id
     and f.performed and f.live and f.working;
$$;
