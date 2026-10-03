-- Contract-1 boards: Weight is the raw entered kg, a zero 1RM is no result, and
-- one predicate reads the facts' `working` (groups contract §2.9–§2.11, §4.7).
--
-- Weight always remains the raw entered kg value: the D6 load factor applies to
-- 1RM and its record detection only. A zero Weight or 1RM never ranks, so a
-- member whose only counting sets are 0 kg gets no entry instead of failing the
-- apply on group_board_entries' value_kg > 0 check. The evaluator also stores
-- no e1rm_kg at 0 kg from rules version 5; the boards guard it either way.
--
-- `working` is read one way everywhere: a fact counts as working unless it is
-- known not to be (`working is not false`). Rules version 5 re-normalizes every
-- older fact, so a null only lasts until the sweep reaches its session; until
-- then it counts, on the boards as in the week summary, and is never a warm-up
-- (group_set_is_warm_up reads `working is false`).
--
-- Forward only: this migration writes no stored result (entries, records,
-- events, certifications) and queues nothing. A board moves when its target is
-- next applied (the rules-version requeue makes that a silent recompute). When
-- a Weight entry stored under the old conversion falls back to its set's raw
-- value, the move is silent (attribution class `rules`): no lead change, no
-- void, no record. A stored Weight record of a converted value stands while
-- its set's raw value is unchanged; a set that beats the raw value is a record.
--
-- The contract-1 apply is patched in place at anchors (section 3).

-- 1. Weight as the raw value ---------------------------------------------------------

-- A Weight value as the raw entered kg: a value stored under the old D6
-- conversion (a factor other than 1, and the value is exactly the converted
-- entered kg) reads as the entered kg; any other value is already raw.
create function app_public.group_board_weight_as_raw(p_value numeric, p_entered double precision, p_factor numeric)
returns numeric
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case when p_factor is distinct from 1 and p_entered is not null
                   and p_value = app_public.group_board_kg(p_entered, p_factor)
              then app_public.group_board_kg(p_entered, 1)
              else p_value end;
$$;

-- A stored Weight entry (a group_board_entries row as jsonb) whose value is
-- the old conversion and whose set still counts at its raw value: the rule
-- moved it, not a lift.
create function app_public.group_board_weight_rule_moved(
  p_group_id uuid,
  p_member_user_id uuid,
  p_group_exercise_id uuid,
  p_entry jsonb
)
returns boolean
language sql
stable
set search_path = app_public, pg_temp
as $$
  select coalesce(p_entry ->> 'metric' = 'weight', false)
     and exists (
       select 1
         from app_public.group_board_counting(p_group_id, p_member_user_id, p_group_exercise_id) c
         cross join lateral (
           select app_public.group_board_weight_as_raw((p_entry ->> 'value_kg')::numeric,
                    (p_entry ->> 'entered_weight_kg')::double precision,
                    (p_entry ->> 'load_factor')::numeric) as raw
         ) r
        where c.set_id = p_entry ->> 'set_id'
          and c.weight_kg = r.raw
          and r.raw <> (p_entry ->> 'value_kg')::numeric);
$$;

revoke all on function app_public.group_board_weight_as_raw(numeric, double precision, numeric)
  from public, anon, authenticated, service_role;
revoke all on function app_public.group_board_weight_rule_moved(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- 2. Counting sets: raw Weight, no zero 1RM, one `working` predicate ---------------------

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
         -- Weight is the raw entered kg; only 1RM is converted (D6).
         case when f.weight_kg > 0 then app_public.group_board_kg(f.weight_kg, 1) end,
         case when f.e1rm_kg > 0 then app_public.group_board_kg(f.e1rm_kg, x.factor) end,
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
     -- Working unless known not to be: a fact not yet re-normalized counts.
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

-- 3. Patches: the contract-1 apply -------------------------------------------------------

-- Each row replaces one anchor in the function's current definition, in order.
-- The anchor must occur exactly once, or the migration fails.
do $migration$
declare
  _patch record;
  _definition text;
  _fn constant text := 'app_public.group_eval_apply_legacy(uuid,uuid,uuid,text[])';
begin
  for _patch in
    select * from (
      -- Step 4 (voids): the set's current values under the new rule.
      select 1 as step,
             $old$             case when f.weight_kg > 0 then app_public.group_board_kg(f.weight_kg, x.factor) end as cur_weight_kg,
             app_public.group_board_kg(f.e1rm_kg, x.factor) as cur_e1rm_kg$old$ as anchor,
             $new$             case when f.weight_kg > 0 then app_public.group_board_kg(f.weight_kg, 1) end as cur_weight_kg,
             case when f.e1rm_kg > 0 then app_public.group_board_kg(f.e1rm_kg, x.factor) end as cur_e1rm_kg$new$ as replacement
      union all
      -- Step 4: a listed Weight value stored under the old conversion is
      -- compared as its raw value, so the record stands while its set does.
      select 2,
             $old$           where (case b ->> 'metric' when 'weight' then _rec.cur_weight_kg else _rec.cur_e1rm_kg end)
                 is distinct from (b ->> 'value_kg')::numeric) then 'edited'$old$,
             $new$           where (case b ->> 'metric' when 'weight' then _rec.cur_weight_kg else _rec.cur_e1rm_kg end)
                 is distinct from (case b ->> 'metric'
                   when 'weight' then app_public.group_board_weight_as_raw((b ->> 'value_kg')::numeric,
                                        (_rec.payload ->> 'entered_weight_kg')::double precision,
                                        (_rec.payload ->> 'load_factor')::numeric)
                   else (b ->> 'value_kg')::numeric end)) then 'edited'$new$
      union all
      -- Step 5: the baseline a new Weight best must beat is the old best's raw value.
      select 3,
             $old$      _before := case when _retract_prev ? _metric then _retract_prev -> _metric else _o -> 'value_kg' end;$old$,
             $new$      _before := case when _retract_prev ? _metric then _retract_prev -> _metric
                      when _metric = 'weight' and _o is not null then
                        to_jsonb(app_public.group_board_weight_as_raw((_o ->> 'value_kg')::numeric,
                                   (_o ->> 'entered_weight_kg')::double precision, (_o ->> 'load_factor')::numeric))
                      else _o -> 'value_kg' end;$new$
      union all
      -- Step 5: a converted Weight best that falls to its raw value is a rules move.
      select 4,
             $old$        _class := 'rules';
      else
        _class := 'void';$old$,
             $new$        _class := 'rules';
      elsif app_public.group_board_weight_rule_moved(p_group_id, p_member_user_id, p_group_exercise_id, _o) then
        _class := 'rules';
      else
        _class := 'void';$new$
      union all
      -- Certified boards: nor does a certified Weight best the rule moved.
      select 5,
             $old$            or not app_public.group_set_is_warm_up(p_member_user_id, _old_c_by -> _metric ->> 'set_id')) then$old$,
             $new$            or not (app_public.group_set_is_warm_up(p_member_user_id, _old_c_by -> _metric ->> 'set_id')
                    or app_public.group_board_weight_rule_moved(
                         p_group_id, p_member_user_id, p_group_exercise_id, _old_c_by -> _metric))) then$new$
      union all
      -- A replacement for a record voided in this apply keeps a Weight board
      -- stored converted while the set holds its raw value (a reps-only edit
      -- keeps the Weight card).
      select 6,
             $old$     and (_new_by -> (b ->> 'metric') ->> 'value_kg')::numeric = (b ->> 'value_kg')::numeric$old$,
             $new$     and (_new_by -> (b ->> 'metric') ->> 'value_kg')::numeric
         = (case b ->> 'metric'
              when 'weight' then app_public.group_board_weight_as_raw((b ->> 'value_kg')::numeric,
                                   (v -> 'payload' ->> 'entered_weight_kg')::double precision,
                                   (v -> 'payload' ->> 'load_factor')::numeric)
              else (b ->> 'value_kg')::numeric end)$new$
    ) p
    order by p.step
  loop
    select pg_get_functiondef(_fn::regprocedure) into _definition;
    if (length(_definition) - length(replace(_definition, _patch.anchor, ''))) <> length(_patch.anchor) then
      raise exception 'raw-weight patch: anchor not found exactly once in %: %', _fn, left(_patch.anchor, 80);
    end if;
    execute replace(_definition, _patch.anchor, _patch.replacement);
  end loop;
end
$migration$;

-- 4. Week summary: the same `working` predicate as the boards ----------------------------

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
     and f.performed and f.live and f.working is not false;
$$;
