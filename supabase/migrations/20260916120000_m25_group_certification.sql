-- M25-T06: certification. Members certify each other's record sets; the
-- evaluator voids a certification when the set changes, and the Certified
-- boards rank only certified sets.
--
-- Contract: docs/specs/tech/groups-contract.md §2.12 (certifications), §2.11
-- (Certified entries, lead_change{certification}), §4.2 / §4.5 (certified on
-- the reads), §4.6 (the RPCs). Product P10–P13, D3–D5.
--
--   group_certify / _withdraw / _cancel ─▶ group_certifications
--     └─ failure-isolated target enqueue (cause `certification`) ─▶ group-eval
--          ─▶ group_eval_apply (group lock): void mismatched certifications,
--             recompute Certified entries, lead_change{certification}
--
-- Ground rules (contract §2): no `owner_user_id` column, no FK into the Sync v2
-- tables, RLS on with no policies and no anon/authenticated privileges.
-- Nothing here adds a trigger to, or writes, a Sync v2 table: sync_push is
-- untouched.

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------

-- One row per certification. An ended row is never reopened: re-certifying
-- inserts a new one (D4).
create table app_public.group_certifications (
  id                        uuid primary key default gen_random_uuid(),
  group_id                  uuid not null references app_public.groups (id) on delete cascade,
  group_exercise_id         uuid not null references app_public.group_exercises (id) on delete cascade,
  member_user_id            uuid not null references auth.users (id) on delete cascade,
  set_id                    text not null,
  session_id                text not null,
  certified_by              uuid null references auth.users (id) on delete set null,
  -- group_set_fingerprint of the live set row at certify time, and the raw
  -- values it attested.
  pinned_fingerprint        text not null,
  pinned_weight_value       text null,
  pinned_reps_value         text null,
  pinned_performance_status text null,
  -- The converted values the certifier was shown (the record set's entry or record).
  weight_kg                 numeric null,
  reps                      numeric null,
  e1rm_kg                   numeric null,
  certified_at              timestamptz not null default now(),
  ended_at                  timestamptz null,
  end_reason                text null,
  ended_by                  uuid null references auth.users (id) on delete set null,
  constraint group_certifications_not_self check (certified_by is distinct from member_user_id),
  constraint group_certifications_end_reason_valid check (end_reason in ('withdrawn', 'cancelled', 'voided')),
  constraint group_certifications_end_together check ((ended_at is null) = (end_reason is null)),
  constraint group_certifications_end_order check (ended_at is null or ended_at >= certified_at),
  constraint group_certifications_ended_by_shape check (
    ended_by is null or (ended_at is not null and end_reason <> 'voided')
  )
);

comment on table app_public.group_certifications is
  'M25 certification: a member''s attestation of another member''s record set, pinned to the set''s raw values (fingerprint). Ended by withdraw, admin cancel, or the evaluator (voided). Written only by the group_certif* RPCs and group_eval_apply. Server-only.';

-- At most one active certification per set per board target (P10).
create unique index group_certifications_active_uniq
  on app_public.group_certifications (group_exercise_id, member_user_id, set_id)
  where ended_at is null;
create index group_certifications_group
  on app_public.group_certifications (group_id);

alter table app_public.group_certifications enable row level security;
revoke all on table app_public.group_certifications from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_certifications to service_role;

-- The certification cause (contract §2.8).
alter table app_public.group_eval_queue
  drop constraint group_eval_queue_causes_valid,
  add constraint group_eval_queue_causes_valid check (
    cardinality(causes) > 0 and causes <@ array['set', 'link', 'load_mode', 'rules', 'certification']::text[]
  );

-- The target's active certification ids at the last apply: a difference means
-- a certification was given or ended (lead_change reason `certification`).
alter table app_public.group_board_state
  add column certification_ids uuid[] not null default '{}';

-- -----------------------------------------------------------------------------
-- 2. Board helpers
-- -----------------------------------------------------------------------------

-- T05's compute gains the Certified variant: null p_certification_ids is the
-- All board; otherwise the same rules restricted to counting sets holding one
-- of those certifications, pinned to the fact's fingerprint. The apply passes
-- the ids it read, so its entries and its certification_ids state agree even
-- when an RPC commits a certification mid-apply.
drop function app_public.group_board_compute(uuid, uuid, uuid);

create function app_public.group_board_compute(
  p_group_id uuid,
  p_member_user_id uuid,
  p_group_exercise_id uuid,
  p_certification_ids uuid[]
)
returns table (
  metric                 text,
  value_kg               numeric,
  weight_kg              numeric,
  reps                   numeric,
  e1rm_kg                numeric,
  entered_weight_kg      double precision,
  load_factor            numeric,
  set_id                 text,
  session_id             text,
  session_exercise_id    text,
  exercise_definition_id text,
  achieved_at_ms         bigint,
  exercise_order_index   integer,
  set_order_index        integer,
  fingerprint            text,
  set_created_at_ms      bigint
)
language sql
stable
set search_path = app_public, pg_temp
as $$
  with c as (
    select * from app_public.group_board_counting(p_group_id, p_member_user_id, p_group_exercise_id) x
     where p_certification_ids is null
        or exists (
          select 1 from app_public.group_certifications gc
           where gc.id = any(p_certification_ids)
             and gc.group_exercise_id = p_group_exercise_id and gc.member_user_id = p_member_user_id
             and gc.set_id = x.set_id and gc.pinned_fingerprint = x.fingerprint)
  ), candidates as (
    select 'weight'::text as metric, c.weight_kg as value_kg, c.* from c where c.weight_kg is not null
    union all
    select 'e1rm', c.e1rm_kg, c.* from c where c.e1rm_kg is not null
  )
  select distinct on (k.metric)
         k.metric, k.value_kg, coalesce(k.weight_kg, 0), k.reps, k.e1rm_kg, k.entered_weight_kg, k.load_factor,
         k.set_id, k.session_id, k.session_exercise_id, k.exercise_definition_id, k.achieved_at_ms,
         k.exercise_order_index, k.set_order_index, k.fingerprint, k.set_created_at_ms
    from candidates k
   order by k.metric, k.value_kg desc, k.achieved_at_ms, k.exercise_order_index, k.set_order_index, k.set_id;
$$;

-- The active certification of a set on a board target, pinned to the given
-- fingerprint, or a null row. A Certified entry is valid, and a BoardRow or
-- record item reads certified, only while this exists.
create function app_public.group_certification_matching(
  p_group_exercise_id uuid,
  p_member_user_id uuid,
  p_set_id text,
  p_fingerprint text
)
returns app_public.group_certifications
language sql
stable
set search_path = app_public, pg_temp
as $$
  select c.*
    from app_public.group_certifications c
   where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id
     and c.set_id = p_set_id and c.ended_at is null and c.pinned_fingerprint = p_fingerprint;
$$;

-- The `certification` field of a BoardRow or record item, or null.
create function app_public.group_certification_ref_json(p_row app_public.group_certifications)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select case when p_row.id is null then null else jsonb_build_object(
    'certification_id', p_row.id,
    'certified_by', case when p_row.certified_by is null then null
                         else app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms', floor(extract(epoch from p_row.certified_at) * 1000)::bigint
  ) end;
$$;

-- The RPCs' Certification shape (contract §4.6).
create function app_public.group_certification_json(p_row app_public.group_certifications)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'certification_id', p_row.id,
    'group_id', p_row.group_id,
    'group_exercise_id', p_row.group_exercise_id,
    'member', app_public.group_member_ref_json(p_row.member_user_id),
    'set_id', p_row.set_id,
    'session_id', p_row.session_id,
    'certified_by', case when p_row.certified_by is null then null
                         else app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms', floor(extract(epoch from p_row.certified_at) * 1000)::bigint,
    'pinned', jsonb_build_object(
      'weight_value', p_row.pinned_weight_value,
      'reps_value', p_row.pinned_reps_value,
      'performance_status', p_row.pinned_performance_status,
      'weight_kg', p_row.weight_kg,
      'reps', p_row.reps,
      'e1rm_kg', p_row.e1rm_kg),
    'ended_at_ms', case when p_row.ended_at is null then null
                        else floor(extract(epoch from p_row.ended_at) * 1000)::bigint end,
    'end_reason', p_row.end_reason,
    'ended_by', case when p_row.ended_by is null then null
                     else app_public.group_member_ref_json(p_row.ended_by) end
  );
$$;

-- History's `related` for a certification lead change.
create function app_public.group_certification_related_json(p_certification_id uuid)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'kind', 'certification',
    'key', c.id,
    'event', coalesce(c.end_reason, 'certified'),
    'certified_by', case when c.certified_by is null then null
                         else app_public.group_member_ref_json(c.certified_by) end,
    'ended_by', case when c.ended_by is null then null else app_public.group_member_ref_json(c.ended_by) end,
    'set_id', c.set_id,
    'weight_kg', c.weight_kg,
    'reps', c.reps,
    'e1rm_kg', c.e1rm_kg)
    from app_public.group_certifications c
   where c.id = p_certification_id;
$$;

-- The #1 Certified entry as the apply sees it: stored entries, so an ended
-- certification still leads until its lifter's own apply writes the lead
-- change (exactly once). Another member's invalid entry is skipped when their
-- target is frozen (former member): that apply never runs, and the stale
-- entry would otherwise hide every lead change on the board.
create function app_public.group_board_certified_leader(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_metric text,
  p_member_user_id uuid
)
returns app_public.group_board_entries
language sql
stable
set search_path = app_public, pg_temp
as $$
  select e.*
    from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and e.certified
     and (e.member_user_id = p_member_user_id
          or (app_public.group_certification_matching(
                p_group_exercise_id, e.member_user_id, e.set_id, e.fingerprint)).id is not null
          or app_public.group_eval_target_is_live(e.member_user_id, p_group_id, p_group_exercise_id))
   order by e.value_kg desc, e.achieved_at_ms, e.member_user_id
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 3. The apply (contract §2.11): T05's recompute and diff, plus
--      0. snapshot the Certified #1 per metric (stored entries);
--      1. void active certifications whose set no longer matches the pin;
--      2. recompute the member's Certified entries;
--      3. one lead_change{certified} per Certified board whose #1 member moved.
--    Changes to the T05 body are marked `T06`.
-- -----------------------------------------------------------------------------

create or replace function app_public.group_eval_apply(
  p_group_id uuid,
  p_member_user_id uuid,
  p_group_exercise_id uuid,
  p_causes text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _silent        boolean := coalesce(cardinality(p_causes) > 0 and p_causes <@ array['rules']::text[], false);
  _baseline_by   jsonb := '{}'::jsonb;
  _retract_prev  jsonb := '{}'::jsonb;
  _carry         jsonb := '[]'::jsonb;
  _delete_record boolean;
  _lc            record;
  _now_ms        bigint := floor(extract(epoch from now()) * 1000)::bigint;
  _metrics       text[] := array['weight', 'e1rm'];
  _metric        text;
  _group_mode    text;
  _prev_links    text[];
  _cur_links     text[];
  _old_by        jsonb;
  _new_by        jsonb;
  _old_leader_by jsonb := '{}'::jsonb;
  _old_rank_by   jsonb := '{}'::jsonb;
  _class_by      jsonb := '{}'::jsonb;
  _rollback_by   jsonb := '{}'::jsonb;
  _record_ids    jsonb := '{}'::jsonb;
  _void_ids      jsonb := '{}'::jsonb;
  _kept          uuid[] := '{}';
  _voids         jsonb := '[]'::jsonb;
  _o             jsonb;
  _n             jsonb;
  _class         text;
  _rec           record;
  _c             record;
  _counts        boolean;
  _boards        jsonb;
  _set_id        text;
  _id            uuid;
  _link_id       uuid;
  _unlink_id     uuid;
  _effects       jsonb;
  _before        jsonb;
  _after         jsonb;
  _reason        text;
  _related       uuid;
  -- T06
  _old_c_by        jsonb;
  _old_c_leader_by jsonb := '{}'::jsonb;
  _prev_certs      uuid[];
  _cur_certs       uuid[];
  _certs_changed   boolean;
  _cert_id         uuid;
begin
  perform pg_advisory_xact_lock(25005, hashtext(p_group_id::text));

  select ge.load_input_mode into _group_mode
    from app_public.group_exercises ge
   where ge.id = p_group_exercise_id and ge.group_id = p_group_id;
  if not found then
    return;
  end if;

  -- T06: the Certified boards before this apply (stored entries, as the All
  -- boards: a certification ended since the last apply still leads here, so
  -- its lead change is written by the lifter's own apply, exactly once).
  select coalesce(jsonb_object_agg(e.metric, to_jsonb(e)), '{}'::jsonb) into _old_c_by
    from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id and e.certified;
  foreach _metric in array _metrics loop
    _old_c_leader_by := _old_c_leader_by || jsonb_build_object(_metric,
      app_public.group_board_holder_json(
        app_public.group_board_certified_leader(p_group_id, p_group_exercise_id, _metric, p_member_user_id)));
  end loop;

  -- T06: void every active certification whose set no longer stands as pinned:
  -- the fact is missing or not live (a set or session tombstone), the Sync v2
  -- row is gone (hard delete), or the raw values changed (fingerprint). An
  -- unlink or a load-mode change voids nothing. Runs in silent applies too.
  update app_public.group_certifications c
     set ended_at = greatest(now(), c.certified_at), end_reason = 'voided'
   where c.group_exercise_id = p_group_exercise_id
     and c.member_user_id = p_member_user_id
     and c.ended_at is null
     and not exists (
       select 1
         from app_public.group_set_facts f
         join app_public.exercise_sets es on es.owner_user_id = f.member_user_id and es.id = f.set_id
        where f.member_user_id = c.member_user_id and f.set_id = c.set_id
          and f.live and f.fingerprint = c.pinned_fingerprint);

  select s.certification_ids into _prev_certs
    from app_public.group_board_state s
   where s.group_exercise_id = p_group_exercise_id and s.member_user_id = p_member_user_id;
  _prev_certs := coalesce(_prev_certs, '{}');
  select coalesce(array_agg(c.id order by c.id), '{}') into _cur_certs
    from app_public.group_certifications c
   where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id and c.ended_at is null;
  _certs_changed := _prev_certs is distinct from _cur_certs;

  select s.linked_definition_ids into _prev_links
    from app_public.group_board_state s
   where s.group_exercise_id = p_group_exercise_id and s.member_user_id = p_member_user_id;
  _prev_links := coalesce(_prev_links, '{}');

  select coalesce(array_agg(distinct l.exercise_definition_id order by l.exercise_definition_id), '{}')
    into _cur_links
    from app_public.exercise_group_links l
   where l.owner_user_id = p_member_user_id
     and l.deleted_at is null
     and app_public.group_eval_try_uuid(l.group_id) = p_group_id
     and app_public.group_eval_try_uuid(l.group_exercise_id) = p_group_exercise_id;

  select coalesce(jsonb_object_agg(e.metric, to_jsonb(e)), '{}'::jsonb) into _old_by
    from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id and not e.certified;

  foreach _metric in array _metrics loop
    _old_leader_by := _old_leader_by || jsonb_build_object(_metric,
      app_public.group_board_holder_json(app_public.group_board_leader(p_group_exercise_id, _metric, false)));
    _old_rank_by := _old_rank_by || jsonb_build_object(_metric,
      app_public.group_board_rank(p_group_exercise_id, _metric, false, p_member_user_id));
  end loop;

  select coalesce(jsonb_object_agg(c.metric, to_jsonb(c)), '{}'::jsonb) into _new_by
    from app_public.group_board_compute(p_group_id, p_member_user_id, p_group_exercise_id, null) c;

  if not _silent then
    -- 3. Provisional records.
    for _rec in
      select e.id, e.set_id, e.payload
        from app_public.group_events e
       where e.kind = 'record'
         and e.group_exercise_id = p_group_exercise_id
         and e.member_user_id = p_member_user_id
         and not exists (select 1 from app_public.group_events v
                          where v.kind = 'record_voided' and v.related_event_id = e.id)
         and exists (select 1 from app_public.sessions s
                      where s.owner_user_id = p_member_user_id and s.id = e.session_id and s.status = 'active')
    loop
      select * into _c
        from app_public.group_board_counting(p_group_id, p_member_user_id, p_group_exercise_id) c
       where c.set_id = _rec.set_id;
      _counts := found;

      _boards := '[]'::jsonb;
      if _counts then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'metric', b ->> 'metric', 'value_kg', x.v,
                 'previous_value_kg', b -> 'previous_value_kg', 'group_record', false)
                 order by b ->> 'metric'), '[]'::jsonb)
          into _boards
          from jsonb_array_elements(_rec.payload -> 'boards') b
          cross join lateral (
            select case b ->> 'metric' when 'weight' then _c.weight_kg else _c.e1rm_kg end as v
          ) x
         where x.v is not null
           and (jsonb_typeof(b -> 'previous_value_kg') = 'null' or x.v > (b ->> 'previous_value_kg')::numeric);
      end if;

      _delete_record := jsonb_array_length(_boards) = 0;

      -- Its lead changes go with the record, or when the member no longer
      -- leads that board at the corrected value. When one was the board's
      -- latest history row, "before" rolls back to that row's previous leader.
      for _lc in
        select lc.id, lc.metric, lc.seq, lc.payload
          from app_public.group_events lc
         where lc.kind = 'lead_change' and not lc.certified and lc.related_event_id = _rec.id
      loop
        if _delete_record or not app_public.group_board_would_lead(
             p_group_exercise_id, _lc.metric, p_member_user_id,
             (_new_by -> _lc.metric ->> 'value_kg')::numeric,
             (_new_by -> _lc.metric ->> 'achieved_at_ms')::bigint) then
          if _lc.seq = (select max(l2.seq) from app_public.group_events l2
                         where l2.kind = 'lead_change' and l2.group_exercise_id = p_group_exercise_id
                           and l2.metric = _lc.metric and not l2.certified) then
            _rollback_by := _rollback_by || jsonb_build_object(_lc.metric, _lc.payload -> 'previous');
          end if;
          delete from app_public.group_events where id = _lc.id;
        end if;
      end loop;

      if _delete_record then
        -- Record detection falls back to the best the record was set against.
        select _retract_prev || coalesce(jsonb_object_agg(b ->> 'metric', b -> 'previous_value_kg'), '{}'::jsonb)
          into _retract_prev
          from jsonb_array_elements(_rec.payload -> 'boards') b
         where _old_by -> (b ->> 'metric') ->> 'set_id' = _rec.set_id;
        delete from app_public.group_events where id = _rec.id;
      else
        update app_public.group_events
           set payload = payload || jsonb_build_object(
                 'boards', _boards, 'weight_kg', coalesce(_c.weight_kg, 0), 'reps', _c.reps,
                 'e1rm_kg', _c.e1rm_kg, 'entered_weight_kg', _c.entered_weight_kg,
                 'load_factor', _c.load_factor, 'fingerprint', _c.fingerprint,
                 'achieved_at_ms', _c.achieved_at_ms, 'session_exercise_id', _c.session_exercise_id,
                 'exercise_definition_id', _c.exercise_definition_id)
         where id = _rec.id;
        _kept := _kept || _rec.id;
      end if;
    end loop;

    -- 4. Final records whose set is gone or changed.
    for _rec in
      select e.id, e.set_id, e.session_id, e.payload, f.set_id as fact_set_id, f.live, f.performed,
             f.fingerprint as fact_fingerprint, es.id as row_id,
             case when f.weight_kg > 0 then app_public.group_board_kg(f.weight_kg, x.factor) end as cur_weight_kg,
             app_public.group_board_kg(f.e1rm_kg, x.factor) as cur_e1rm_kg
        from app_public.group_events e
        left join app_public.group_set_facts f
          on f.member_user_id = e.member_user_id and f.set_id = e.set_id
        left join app_public.exercise_sets es
          on es.owner_user_id = e.member_user_id and es.id = e.set_id
        left join app_public.exercise_definitions d
          on d.owner_user_id = f.member_user_id and d.id = f.exercise_definition_id
        cross join lateral (
          select app_public.group_board_load_factor(d.load_input_mode, _group_mode) as factor
        ) x
       where e.kind = 'record'
         and e.group_exercise_id = p_group_exercise_id
         and e.member_user_id = p_member_user_id
         and not exists (select 1 from app_public.group_events v
                          where v.kind = 'record_voided' and v.related_event_id = e.id)
         and not exists (select 1 from app_public.sessions s
                          where s.owner_user_id = p_member_user_id and s.id = e.session_id and s.status = 'active')
    loop
      -- Value-based: the lift no longer stands on a board the card lists. A
      -- raw edit that changes no listed value (whitespace, an equivalent
      -- status) voids nothing; a load-mode change moves every value.
      _reason := case
        when _rec.fact_set_id is null or _rec.row_id is null or not _rec.live then 'deleted'
        when not _rec.performed or exists (
          select 1 from jsonb_array_elements(_rec.payload -> 'boards') b
           where (case b ->> 'metric' when 'weight' then _rec.cur_weight_kg else _rec.cur_e1rm_kg end)
                 is distinct from (b ->> 'value_kg')::numeric) then 'edited'
      end;
      if _reason is not null then
        _voids := _voids || jsonb_build_array(jsonb_build_object(
          'id', _rec.id, 'set_id', _rec.set_id, 'session_id', _rec.session_id,
          'reason', _reason, 'payload', _rec.payload));
      elsif _rec.fact_fingerprint is distinct from _rec.payload ->> 'fingerprint' then
        -- T06: the record stands (no listed value changed) but its raw values
        -- did: keep its fingerprint current, so certify and the stream match
        -- the set as it is now.
        update app_public.group_events
           set payload = payload || jsonb_build_object('fingerprint', _rec.fact_fingerprint)
         where id = _rec.id;
      end if;
    end loop;

    -- 5. Attribute each All entry change.
    foreach _metric in array _metrics loop
      _o := _old_by -> _metric;
      _n := _new_by -> _metric;
      _class := null;
      -- The baseline a new winner must beat (here in _before, which the lead
      -- change step reuses): the old winner's value, or the previous best of
      -- a provisional record retracted in step 3.
      _before := case when _retract_prev ? _metric then _retract_prev -> _metric else _o -> 'value_kg' end;
      if _before is not null and jsonb_typeof(_before) = 'null' then
        _before := null;
      end if;
      _baseline_by := _baseline_by || jsonb_build_object(_metric, coalesce(_before, 'null'::jsonb));
      if _o is null and _n is null then
        _class := null;
      elsif _o is not null and _n is not null and _o ->> 'set_id' = _n ->> 'set_id'
            and (_o ->> 'value_kg')::numeric = (_n ->> 'value_kg')::numeric then
        _class := null;
      elsif _n is not null
            and not ((_n ->> 'exercise_definition_id') = any(_prev_links))
            and (_n ->> 'set_created_at_ms')::bigint < coalesce((
                  select max(l.updated_at) from app_public.exercise_group_links l
                   where l.owner_user_id = p_member_user_id
                     and l.exercise_definition_id = _n ->> 'exercise_definition_id'
                     and l.deleted_at is null
                     and app_public.group_eval_try_uuid(l.group_id) = p_group_id
                     and app_public.group_eval_try_uuid(l.group_exercise_id) = p_group_exercise_id),
                  9223372036854775807) then
        _class := 'link';
      elsif _o is not null and not ((_o ->> 'exercise_definition_id') = any(_cur_links)) then
        _class := 'unlink';
      elsif _n is not null and (_before is null or (_n ->> 'value_kg')::numeric > (_before #>> '{}')::numeric) then
        _class := 'record';
      else
        _class := 'void';
      end if;
      if _class is not null then
        _class_by := _class_by || jsonb_build_object(_metric, _class);
      end if;
    end loop;
  end if;

  -- 6. Entries and state.
  delete from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id and not e.certified;
  insert into app_public.group_board_entries (
    group_id, group_exercise_id, member_user_id, metric, certified, value_kg, weight_kg, reps, e1rm_kg,
    entered_weight_kg, load_factor, set_id, session_id, session_exercise_id, exercise_definition_id,
    achieved_at_ms, exercise_order_index, set_order_index, fingerprint, updated_at
  )
  select p_group_id, p_group_exercise_id, p_member_user_id, c.metric, false, c.value_kg, c.weight_kg, c.reps,
         c.e1rm_kg, c.entered_weight_kg, c.load_factor, c.set_id, c.session_id, c.session_exercise_id,
         c.exercise_definition_id, c.achieved_at_ms, c.exercise_order_index, c.set_order_index, c.fingerprint, now()
    from app_public.group_board_compute(p_group_id, p_member_user_id, p_group_exercise_id, null) c;

  -- T06: the Certified entries, from certified counting sets only.
  delete from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id and e.certified;
  insert into app_public.group_board_entries (
    group_id, group_exercise_id, member_user_id, metric, certified, value_kg, weight_kg, reps, e1rm_kg,
    entered_weight_kg, load_factor, set_id, session_id, session_exercise_id, exercise_definition_id,
    achieved_at_ms, exercise_order_index, set_order_index, fingerprint, updated_at
  )
  select p_group_id, p_group_exercise_id, p_member_user_id, c.metric, true, c.value_kg, c.weight_kg, c.reps,
         c.e1rm_kg, c.entered_weight_kg, c.load_factor, c.set_id, c.session_id, c.session_exercise_id,
         c.exercise_definition_id, c.achieved_at_ms, c.exercise_order_index, c.set_order_index, c.fingerprint, now()
    from app_public.group_board_compute(p_group_id, p_member_user_id, p_group_exercise_id, _cur_certs) c;

  insert into app_public.group_board_state as s (
    group_id, group_exercise_id, member_user_id, linked_definition_ids, certification_ids, applied_at)
  values (p_group_id, p_group_exercise_id, p_member_user_id, _cur_links, _cur_certs, now())
  on conflict (group_exercise_id, member_user_id)
  do update set linked_definition_ids = excluded.linked_definition_ids,
                certification_ids = excluded.certification_ids,
                applied_at = excluded.applied_at;

  if _silent then
    return;
  end if;

  -- Voids, with the leaders each voided record's boards now have.
  for _rec in select v from jsonb_array_elements(_voids) v loop
    insert into app_public.group_events (
      group_id, kind, member_user_id, session_id, set_id, group_exercise_id, reason, related_event_id,
      sort_at_ms, payload)
    values (
      p_group_id, 'record_voided', p_member_user_id, _rec.v ->> 'session_id', _rec.v ->> 'set_id',
      p_group_exercise_id, _rec.v ->> 'reason', (_rec.v ->> 'id')::uuid, _now_ms,
      jsonb_build_object(
        'record', jsonb_build_object(
          'weight_kg', _rec.v -> 'payload' -> 'weight_kg',
          'reps', _rec.v -> 'payload' -> 'reps',
          'e1rm_kg', _rec.v -> 'payload' -> 'e1rm_kg'),
        'leaders', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'metric', b ->> 'metric',
                   'leader', app_public.group_board_holder_json(
                               app_public.group_board_leader(p_group_exercise_id, b ->> 'metric', false)))
                   order by b ->> 'metric'), '[]'::jsonb)
            from jsonb_array_elements(_rec.v -> 'payload' -> 'boards') b)))
    returning id into _id;
    _void_ids := _void_ids || jsonb_build_object(_rec.v ->> 'set_id', _id);
  end loop;

  -- Records: one per new best set, listing the boards it beat against the
  -- baseline. A replacement for a record voided just now also lists that
  -- record's boards the set still holds at the same value (with their
  -- original previous best), so a reps-only edit keeps the Weight card. A
  -- surviving provisional record of the same set absorbs the board instead.
  select coalesce(jsonb_agg(jsonb_build_object(
           'set_id', v ->> 'set_id', 'metric', b ->> 'metric', 'previous_value_kg', b -> 'previous_value_kg')),
           '[]'::jsonb)
    into _carry
    from jsonb_array_elements(_voids) v
    cross join lateral jsonb_array_elements(v -> 'payload' -> 'boards') b
   where _new_by -> (b ->> 'metric') ->> 'set_id' = v ->> 'set_id'
     and (_new_by -> (b ->> 'metric') ->> 'value_kg')::numeric = (b ->> 'value_kg')::numeric
     and coalesce(_class_by ->> (b ->> 'metric'), '') <> 'record';

  for _set_id in
    select _new_by -> m ->> 'set_id' from unnest(_metrics) m where _class_by ->> m = 'record'
    union
    select c ->> 'set_id' from jsonb_array_elements(_carry) c
  loop
    select coalesce(jsonb_agg(x.board order by x.board ->> 'metric'), '[]'::jsonb)
      into _boards
      from (
        select jsonb_build_object(
                 'metric', m,
                 'value_kg', (_new_by -> m -> 'value_kg'),
                 'previous_value_kg', coalesce(_baseline_by -> m, 'null'::jsonb),
                 'group_record', (app_public.group_board_leader(p_group_exercise_id, m, false)).member_user_id
                                   = p_member_user_id) as board
          from unnest(_metrics) m
         where _class_by ->> m = 'record' and _new_by -> m ->> 'set_id' = _set_id
        union all
        select jsonb_build_object(
                 'metric', c ->> 'metric',
                 'value_kg', (_new_by -> (c ->> 'metric') -> 'value_kg'),
                 'previous_value_kg', c -> 'previous_value_kg',
                 'group_record', (app_public.group_board_leader(p_group_exercise_id, c ->> 'metric', false)).member_user_id
                                   = p_member_user_id)
          from jsonb_array_elements(_carry) c
         where c ->> 'set_id' = _set_id
      ) x;

    select e.id into _id
      from app_public.group_events e
     where e.kind = 'record' and e.group_exercise_id = p_group_exercise_id
       and e.member_user_id = p_member_user_id and e.set_id = _set_id
       and not exists (select 1 from app_public.group_events v
                        where v.kind = 'record_voided' and v.related_event_id = e.id)
     order by e.seq desc
     limit 1;

    if found then
      -- A board the record already lists keeps its previous best (the
      -- baseline it was set against); only its value and flag refresh. A
      -- board it doesn't list yet is appended.
      update app_public.group_events e
         set payload = e.payload || jsonb_build_object('boards', (
               select coalesce(jsonb_agg(all_boards.b order by all_boards.b ->> 'metric'), '[]'::jsonb)
                 from (
                   select case when l.nb is null then b
                               else b || jsonb_build_object('value_kg', l.nb -> 'value_kg',
                                                            'group_record', l.nb -> 'group_record') end as b
                     from jsonb_array_elements(e.payload -> 'boards') b
                     left join lateral (
                       select nb from jsonb_array_elements(_boards) nb where nb ->> 'metric' = b ->> 'metric'
                     ) l on true
                   union all
                   select nb from jsonb_array_elements(_boards) nb
                    where not exists (select 1 from jsonb_array_elements(e.payload -> 'boards') ob
                                       where ob ->> 'metric' = nb ->> 'metric')
                 ) all_boards))
       where e.id = _id;
    else
      _n := (select _new_by -> m from unnest(_metrics) m where _new_by -> m ->> 'set_id' = _set_id limit 1);
      insert into app_public.group_events (
        group_id, kind, member_user_id, session_id, set_id, group_exercise_id, sort_at_ms, payload)
      values (
        p_group_id, 'record', p_member_user_id, _n ->> 'session_id', _set_id, p_group_exercise_id,
        coalesce((select s.started_at from app_public.sessions s
                   where s.owner_user_id = p_member_user_id and s.id = _n ->> 'session_id'),
                 (_n ->> 'achieved_at_ms')::bigint),
        jsonb_build_object(
          'boards', _boards,
          'weight_kg', _n -> 'weight_kg',
          'reps', _n -> 'reps',
          'e1rm_kg', _n -> 'e1rm_kg',
          'entered_weight_kg', _n -> 'entered_weight_kg',
          'load_factor', _n -> 'load_factor',
          'fingerprint', _n -> 'fingerprint',
          'achieved_at_ms', _n -> 'achieved_at_ms',
          'session_exercise_id', _n -> 'session_exercise_id',
          'exercise_definition_id', _n -> 'exercise_definition_id'))
      returning id into _id;
    end if;

    select _record_ids || coalesce(jsonb_object_agg(m, _id), '{}'::jsonb) into _record_ids
      from unnest(_metrics) m
     where _class_by ->> m = 'record' and _new_by -> m ->> 'set_id' = _set_id;
  end loop;

  -- Surviving provisional records: refresh group-record flags and the leader
  -- snapshot of the lead changes they caused.
  if cardinality(_kept) > 0 then
    update app_public.group_events e
       set payload = jsonb_set(e.payload, '{boards}', (
             select coalesce(jsonb_agg(b || jsonb_build_object('group_record',
                      (app_public.group_board_leader(p_group_exercise_id, b ->> 'metric', false)).member_user_id
                        = p_member_user_id) order by b ->> 'metric'), '[]'::jsonb)
               from jsonb_array_elements(e.payload -> 'boards') b))
     where e.id = any(_kept);
    update app_public.group_events lc
       set payload = jsonb_set(lc.payload, '{leader}', app_public.group_board_holder_json(be))
      from app_public.group_events r, app_public.group_board_entries be
     where lc.kind = 'lead_change' and not lc.certified and lc.related_event_id = r.id and r.id = any(_kept)
       and be.group_exercise_id = p_group_exercise_id and be.member_user_id = p_member_user_id
       and be.metric = lc.metric and not be.certified and be.set_id = r.set_id;
  end if;

  -- Link / unlink items: one each when a link change moved an entry (P16).
  foreach _class in array array['link', 'unlink'] loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'metric', m,
             'before', case when _old_by ? m then jsonb_build_object(
                         'rank', _old_rank_by -> m, 'value_kg', _old_by -> m -> 'value_kg') end,
             'after', case when _new_by ? m then jsonb_build_object(
                         'rank', app_public.group_board_rank(p_group_exercise_id, m, false, p_member_user_id),
                         'value_kg', _new_by -> m -> 'value_kg') end)
             order by m), '[]'::jsonb)
      into _effects
      from unnest(_metrics) m
     where _class_by ->> m = _class;
    if jsonb_array_length(_effects) > 0 then
      insert into app_public.group_events (group_id, kind, member_user_id, group_exercise_id, sort_at_ms, payload)
      values (
        p_group_id, _class, p_member_user_id, p_group_exercise_id, _now_ms,
        jsonb_build_object(
          'exercise_definition_ids', to_jsonb(coalesce((
            select array_agg(d order by d) from unnest(
              case when _class = 'link' then _cur_links else _prev_links end) d
             where not (d = any(case when _class = 'link' then _prev_links else _cur_links end))), '{}'::text[])),
          'effects', _effects))
      returning id into _id;
      if _class = 'link' then _link_id := _id; else _unlink_id := _id; end if;
    end if;
  end loop;

  -- Lead changes (history only, T6): one per All board whose #1 member moved.
  foreach _metric in array _metrics loop
    _before := case when _rollback_by ? _metric then _rollback_by -> _metric else _old_leader_by -> _metric end;
    _after := app_public.group_board_holder_json(app_public.group_board_leader(p_group_exercise_id, _metric, false));
    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id') then
      _class := _class_by ->> _metric;
      _reason := case _class when 'void' then 'void' when 'link' then 'link' when 'unlink' then 'link' else 'record' end;
      _related := case _class
        when 'record' then (_record_ids ->> _metric)::uuid
        when 'void' then (_void_ids ->> (_old_by -> _metric ->> 'set_id'))::uuid
        when 'link' then _link_id
        when 'unlink' then _unlink_id
      end;
      insert into app_public.group_events (
        group_id, kind, member_user_id, group_exercise_id, metric, certified, reason, related_event_id,
        sort_at_ms, payload)
      values (
        p_group_id, 'lead_change', p_member_user_id, p_group_exercise_id, _metric, false, _reason, _related,
        _now_ms, jsonb_build_object('leader', coalesce(_after, 'null'::jsonb), 'previous', coalesce(_before, 'null'::jsonb)));
    end if;
  end loop;

  -- T06: lead changes on the Certified boards. `certification` when the
  -- target's active certifications changed since the last apply (given, ended,
  -- or voided above), naming the certification that moved #1; otherwise the
  -- All attribution for the metric (link / record / void), else `certification`.
  foreach _metric in array _metrics loop
    _before := _old_c_leader_by -> _metric;
    _after := app_public.group_board_holder_json(
      app_public.group_board_certified_leader(p_group_id, p_group_exercise_id, _metric, p_member_user_id));
    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id') then
      _class := _class_by ->> _metric;
      _cert_id := null;
      _related := null;
      if _certs_changed or _class is null then
        _reason := 'certification';
        if (_after ->> 'member_user_id')::uuid = p_member_user_id then
          _cert_id := (app_public.group_certification_matching(
                         p_group_exercise_id, p_member_user_id, _after ->> 'set_id',
                         (select e.fingerprint from app_public.group_board_entries e
                           where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id
                             and e.metric = _metric and e.certified))).id;
        elsif _old_c_by ? _metric then
          select c.id into _cert_id
            from app_public.group_certifications c
           where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id
             and c.set_id = _old_c_by -> _metric ->> 'set_id'
           order by c.certified_at desc, c.id
           limit 1;
        end if;
      else
        _reason := case _class when 'void' then 'void' when 'record' then 'record' else 'link' end;
        -- Never a record: a provisional record's retraction (step 3) owns only
        -- All history.
        _related := case _class
          when 'void' then (_void_ids ->> (_old_c_by -> _metric ->> 'set_id'))::uuid
          when 'link' then _link_id
          when 'unlink' then _unlink_id
        end;
      end if;
      insert into app_public.group_events (
        group_id, kind, member_user_id, group_exercise_id, metric, certified, reason, related_event_id,
        sort_at_ms, payload)
      values (
        p_group_id, 'lead_change', p_member_user_id, p_group_exercise_id, _metric, true, _reason, _related,
        _now_ms,
        jsonb_build_object('leader', coalesce(_after, 'null'::jsonb), 'previous', coalesce(_before, 'null'::jsonb))
          || case when _cert_id is null then '{}'::jsonb
                  else jsonb_build_object('certification_id', _cert_id) end);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Certification RPCs (contract §4.6). Each write locks the group row
--    (group_require_member(…, true)) and enqueues the lifter's board target;
--    none takes the board advisory lock.
-- -----------------------------------------------------------------------------

-- Target job (cause `certification`) plus the kick, failure-isolated: the
-- certification write always commits; a failure writes one sanitized
-- group.eval_enqueue_failed row. The next job for the target repairs it.
create function app_public.group_certification_enqueue(p_row app_public.group_certifications)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued   boolean := false;
  _sqlstate text;
begin
  begin
    _queued := app_public.group_eval_enqueue_target(
      p_row.member_user_id, p_row.group_id, p_row.group_exercise_id, 'certification');
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', p_row.member_user_id,
      jsonb_build_object('table', 'group_certifications', 'row_id', p_row.id::text, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(p_row.member_user_id);
  end if;
end;
$$;

-- Certify a record set (P10, D3). Check order: preamble → membership (lock) →
-- input → group exercise → archived → lifter membership → record set →
-- idempotent → set unchanged → insert.
create function app_public.group_certify(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_member_user_id uuid,
  p_set_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _ge       app_public.group_exercises;
  _entry    app_public.group_board_entries;
  _record   app_public.group_events;
  _row      app_public.group_certifications;
  _set      app_public.exercise_sets;
  _fp       text;
  _session  text;
  _weight   numeric;
  _reps     numeric;
  _e1rm     numeric;
begin
  perform app_public.group_require_member(p_group_id, _uid, true);

  if p_member_user_id is null or p_set_id is null or p_set_id = '' then
    raise exception 'VALIDATION: p_member_user_id and p_set_id are required' using errcode = 'P0001';
  end if;
  if p_member_user_id = _uid then
    raise exception 'VALIDATION: you cannot certify your own set' using errcode = 'P0001';
  end if;

  _ge := app_public.group_board_require_exercise(p_group_id, p_group_exercise_id);
  if _ge.archived_at is not null then
    raise exception 'VALIDATION: an archived group exercise is read-only; unarchive it first' using errcode = 'P0001';
  end if;

  if app_public.group_active_role(p_group_id, p_member_user_id) is null then
    raise exception 'NOT_FOUND: member not found' using errcode = 'P0001';
  end if;

  -- D3: a current All entry, else a non-voided record.
  select e.* into _entry
    from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.member_user_id = p_member_user_id
     and e.set_id = p_set_id and not e.certified
   order by e.metric
   limit 1;
  if found then
    _fp := _entry.fingerprint;
    _session := _entry.session_id;
    _weight := _entry.weight_kg;
    _reps := _entry.reps;
    _e1rm := _entry.e1rm_kg;
  else
    select e.* into _record
      from app_public.group_events e
     where e.kind = 'record' and e.group_id = p_group_id and e.group_exercise_id = p_group_exercise_id
       and e.member_user_id = p_member_user_id and e.set_id = p_set_id
       and not exists (select 1 from app_public.group_events v
                        where v.kind = 'record_voided' and v.related_event_id = e.id)
     order by e.seq desc
     limit 1;
    if not found then
      raise exception 'NOT_FOUND: record set not found' using errcode = 'P0001';
    end if;
    _fp := _record.payload ->> 'fingerprint';
    _session := _record.session_id;
    _weight := (_record.payload ->> 'weight_kg')::numeric;
    _reps := (_record.payload ->> 'reps')::numeric;
    _e1rm := (_record.payload ->> 'e1rm_kg')::numeric;
  end if;

  -- One certification is enough (P10): an active one is returned as is.
  select c.* into _row
    from app_public.group_certifications c
   where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id
     and c.set_id = p_set_id and c.ended_at is null;
  if found then
    return jsonb_build_object('certification', app_public.group_certification_json(_row), 'created', false);
  end if;

  -- The certifier must attest what the boards show: the live row still
  -- carries the record set's fingerprint.
  select es.* into _set
    from app_public.exercise_sets es
   where es.owner_user_id = p_member_user_id and es.id = p_set_id;
  if not found or _fp is null or app_public.group_set_fingerprint(
       _set.weight_value, _set.reps_value, _set.performance_status, _set.deleted_at) <> _fp then
    raise exception 'CONFLICT: the set changed; refresh and try again' using errcode = 'P0001';
  end if;

  insert into app_public.group_certifications (
    group_id, group_exercise_id, member_user_id, set_id, session_id, certified_by, pinned_fingerprint,
    pinned_weight_value, pinned_reps_value, pinned_performance_status, weight_kg, reps, e1rm_kg)
  values (
    p_group_id, p_group_exercise_id, p_member_user_id, p_set_id, _session, _uid, _fp,
    _set.weight_value, _set.reps_value, _set.performance_status, _weight, _reps, _e1rm)
  returning * into _row;

  perform app_public.group_certification_enqueue(_row);
  return jsonb_build_object('certification', app_public.group_certification_json(_row), 'created', true);
end;
$$;

-- The group's certification, locked, or NOT_FOUND.
create function app_public.group_certification_require(p_group_id uuid, p_certification_id uuid)
returns app_public.group_certifications
language plpgsql
volatile
set search_path = app_public, pg_temp
as $$
declare
  _row app_public.group_certifications;
begin
  if p_certification_id is null then
    raise exception 'VALIDATION: p_certification_id is required' using errcode = 'P0001';
  end if;
  select c.* into _row
    from app_public.group_certifications c
   where c.id = p_certification_id and c.group_id = p_group_id
     for update;
  if not found then
    raise exception 'NOT_FOUND: certification not found' using errcode = 'P0001';
  end if;
  return _row;
end;
$$;

-- End an active certification (idempotent: the first end is kept) and enqueue.
create function app_public.group_certification_end(
  p_row app_public.group_certifications,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
volatile
set search_path = app_public, pg_temp
as $$
declare
  _row app_public.group_certifications := p_row;
begin
  if _row.ended_at is null then
    update app_public.group_certifications
       set ended_at = greatest(now(), certified_at), end_reason = p_reason, ended_by = p_actor
     where id = _row.id
    returning * into _row;
    perform app_public.group_certification_enqueue(_row);
  end if;
  return jsonb_build_object('certification', app_public.group_certification_json(_row));
end;
$$;

-- The certifier removes their own certification (P11).
create function app_public.group_certification_withdraw(p_group_id uuid, p_certification_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _row app_public.group_certifications;
begin
  perform app_public.group_require_member(p_group_id, _uid, true);
  _row := app_public.group_certification_require(p_group_id, p_certification_id);
  if _row.certified_by is distinct from _uid then
    raise exception 'FORBIDDEN: only the certifier can withdraw a certification' using errcode = 'P0001';
  end if;
  return app_public.group_certification_end(_row, 'withdrawn', _uid);
end;
$$;

-- The owner or an admin cancels any certification (P11, D5).
create function app_public.group_certification_cancel(p_group_id uuid, p_certification_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, true);
  _row  app_public.group_certifications;
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can cancel a certification' using errcode = 'P0001';
  end if;
  _row := app_public.group_certification_require(p_group_id, p_certification_id);
  return app_public.group_certification_end(_row, 'cancelled', _uid);
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. Reads (contract §4.2, §4.5): certified becomes real. A Certified entry
--    counts only while its certification is active and still pinned to the
--    entry's fingerprint, so a withdraw or cancel leaves the reads at once, on
--    live and frozen boards alike.
-- -----------------------------------------------------------------------------

-- A board's rows in rank order with absolute ranks (BoardRow, contract §4.5).
create or replace function app_public.group_board_ranked(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_metric text,
  p_certified boolean
)
returns table (rank integer, member_user_id uuid, value_kg numeric, achieved_at_ms bigint, row_json jsonb)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select r.rank, r.member_user_id, r.value_kg, r.achieved_at_ms,
         jsonb_build_object(
           'rank', r.rank,
           'member', app_public.group_member_ref_json(r.member_user_id),
           'former', not exists (
             select 1 from app_public.group_memberships m
              where m.group_id = p_group_id and m.user_id = r.member_user_id and m.ended_at is null),
           'value_kg', r.value_kg,
           'weight_kg', r.weight_kg,
           'reps', r.reps,
           'e1rm_kg', r.e1rm_kg,
           'entered_weight_kg', r.entered_weight_kg,
           'load_factor', r.load_factor,
           'achieved_at_ms', r.achieved_at_ms,
           'session_id', r.session_id,
           'set_id', r.set_id,
           'exercise_name', (
             select se.name from app_public.session_exercises se
              where se.owner_user_id = r.member_user_id and se.id = r.session_exercise_id),
           'certified', (r.cert).id is not null,
           'certification', app_public.group_certification_ref_json(r.cert))
    from (
      select v.*,
             row_number() over (order by v.value_kg desc, v.achieved_at_ms, v.member_user_id)::integer as rank
        from (
          select e.*,
                 app_public.group_certification_matching(
                   e.group_exercise_id, e.member_user_id, e.set_id, e.fingerprint) as cert
            from app_public.group_board_entries e
           where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and e.certified = p_certified
        ) v
       where not v.certified or (v.cert).id is not null
    ) r
   order by r.rank;
$$;

-- The Leaderboards page: every group exercise (active first) with its podium.
create or replace function app_public.group_board_podiums(
  p_group_id uuid,
  p_metric text default 'e1rm',
  p_certified boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  perform app_public.group_board_validate(p_metric, p_certified);

  return jsonb_build_object(
    'metric', p_metric,
    'certified', p_certified,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
               'exercise', app_public.group_exercise_json(ge),
               'podium', coalesce(b.podium, '[]'::jsonb),
               'me', b.me,
               'entry_count', b.entry_count,
               'all_entry_count', (
                 select count(*) from app_public.group_board_entries e
                  where e.group_exercise_id = ge.id and e.metric = p_metric and not e.certified))
               order by (ge.archived_at is not null), lower(ge.name), ge.name, ge.id)
        from app_public.group_exercises ge
        cross join lateral (
          select jsonb_agg(r.row_json order by r.rank) filter (where r.rank <= 3) as podium,
                 (array_agg(r.row_json) filter (where r.member_user_id = _uid))[1] as me,
                 count(*) as entry_count
            from app_public.group_board_ranked(p_group_id, ge.id, p_metric, p_certified) r
        ) b
       where ge.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

-- A board's history (E1.3): lead changes, newest first, keyset-paged by seq.
create or replace function app_public.group_board_history(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_metric text default 'e1rm',
  p_certified boolean default false,
  p_before jsonb default null,
  p_limit integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _limit    integer;
  _c_seq    bigint;
  _ge       app_public.group_exercises;
  _items    jsonb;
  _has_more boolean;
  _last     bigint;
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  perform app_public.group_board_validate(p_metric, p_certified);

  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50' using errcode = 'P0001';
  end if;

  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 1
       or jsonb_typeof(p_before -> 'seq') is distinct from 'number'
       or (p_before ->> 'seq') !~ '^[0-9]{1,18}$' then
      raise exception 'VALIDATION: p_before must be a cursor {seq} from next_cursor' using errcode = 'P0001';
    end if;
    _c_seq := (p_before ->> 'seq')::bigint;
  end if;

  _ge := app_public.group_board_require_exercise(p_group_id, p_group_exercise_id);

  with page as (
    select lc.*, row_number() over (order by lc.seq desc) as n
      from (
        select e.* from app_public.group_events e
         where e.kind = 'lead_change'
           and e.group_id = p_group_id
           and e.group_exercise_id = p_group_exercise_id
           and e.metric = p_metric
           and e.certified = p_certified
           and (_c_seq is null or e.seq < _c_seq)
         order by e.seq desc
         limit _limit + 1
      ) lc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', p.id,
           'seq', p.seq,
           'occurred_at_ms', floor(extract(epoch from p.occurred_at) * 1000)::bigint,
           'reason', p.reason,
           'leader', app_public.group_board_holder_with_member(p.payload -> 'leader'),
           'previous', app_public.group_board_holder_with_member(p.payload -> 'previous'),
           'related', case
             when p.related_event_id is not null then app_public.group_board_related_json(p.related_event_id)
             when p.payload ? 'certification_id'
               then app_public.group_certification_related_json((p.payload ->> 'certification_id')::uuid)
           end)
           order by p.seq desc) filter (where p.n <= _limit), '[]'::jsonb),
         count(*) > _limit,
         min(p.seq) filter (where p.n <= _limit)
    into _items, _has_more, _last
    from page p;

  return jsonb_build_object(
    'items', _items,
    'next_cursor', case when _has_more then jsonb_build_object('seq', _last) else null end,
    'has_more', _has_more
  );
end;
$$;

-- The wire item of one T05 event. lead_change is never a stream item.
create or replace function app_public.group_stream_event_json(p_event_id uuid, p_sort_at_ms bigint)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select case e.kind
    when 'record' then jsonb_build_object(
      'kind', 'record',
      'key', e.id::text,
      'sort_at_ms', p_sort_at_ms,
      'group', jsonb_build_object('group_id', g.id, 'name', g.name),
      'member', app_public.group_member_ref_json(e.member_user_id),
      'group_exercise', jsonb_build_object(
        'group_exercise_id', ge.id, 'name', ge.name, 'load_input_mode', ge.load_input_mode),
      'session_id', e.session_id,
      'set_id', e.set_id,
      'weight_kg', e.payload -> 'weight_kg',
      'reps', e.payload -> 'reps',
      'e1rm_kg', e.payload -> 'e1rm_kg',
      'entered_weight_kg', e.payload -> 'entered_weight_kg',
      'load_factor', e.payload -> 'load_factor',
      'achieved_at_ms', e.payload -> 'achieved_at_ms',
      'boards', e.payload -> 'boards',
      'provisional', exists (
        select 1 from app_public.sessions s
         where s.owner_user_id = e.member_user_id and s.id = e.session_id and s.status = 'active'),
      'voided', (
        select jsonb_build_object('key', v.id::text, 'reason', v.reason,
                                  'occurred_at_ms', floor(extract(epoch from v.occurred_at) * 1000)::bigint)
          from app_public.group_events v
         where v.kind = 'record_voided' and v.related_event_id = e.id),
      'certified', (c.cert).id is not null,
      'certification', app_public.group_certification_ref_json(c.cert))
    when 'record_voided' then jsonb_build_object(
      'kind', 'record_voided',
      'key', e.id::text,
      'sort_at_ms', p_sort_at_ms,
      'group', jsonb_build_object('group_id', g.id, 'name', g.name),
      'member', app_public.group_member_ref_json(e.member_user_id),
      'group_exercise', jsonb_build_object(
        'group_exercise_id', ge.id, 'name', ge.name, 'load_input_mode', ge.load_input_mode),
      'record_key', e.related_event_id::text,
      'reason', e.reason,
      'record', e.payload -> 'record',
      'leaders', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'metric', l ->> 'metric',
                 'leader', app_public.group_board_holder_with_member(l -> 'leader'))
                 order by l ->> 'metric'), '[]'::jsonb)
          from jsonb_array_elements(e.payload -> 'leaders') l))
    else jsonb_build_object(
      'kind', 'link',
      'key', e.id::text,
      'sort_at_ms', p_sort_at_ms,
      'event', e.kind,
      'group', jsonb_build_object('group_id', g.id, 'name', g.name),
      'member', app_public.group_member_ref_json(e.member_user_id),
      'group_exercise', jsonb_build_object(
        'group_exercise_id', ge.id, 'name', ge.name, 'load_input_mode', ge.load_input_mode),
      'exercises', app_public.group_board_link_exercises_json(e.member_user_id, e.payload -> 'exercise_definition_ids'),
      'effects', e.payload -> 'effects')
  end
    from app_public.group_events e
    join app_public.groups g on g.id = e.group_id
    join app_public.group_exercises ge on ge.id = e.group_exercise_id
    cross join lateral (
      select app_public.group_certification_matching(
               e.group_exercise_id, e.member_user_id, e.set_id, e.payload ->> 'fingerprint') as cert
    ) c
   where e.id = p_event_id;
$$;

-- -----------------------------------------------------------------------------
-- 6. Function privileges
-- -----------------------------------------------------------------------------

do $grants$
declare
  _sig text;
begin
  -- Internal: owner (postgres) only.
  foreach _sig in array array[
    'group_board_compute(uuid, uuid, uuid, uuid[])',
    'group_board_certified_leader(uuid, uuid, text, uuid)',
    'group_certification_matching(uuid, uuid, text, text)',
    'group_certification_ref_json(app_public.group_certifications)',
    'group_certification_json(app_public.group_certifications)',
    'group_certification_related_json(uuid)',
    'group_certification_enqueue(app_public.group_certifications)',
    'group_certification_require(uuid, uuid)',
    'group_certification_end(app_public.group_certifications, text, uuid)',
    'group_eval_apply(uuid, uuid, uuid, text[])',
    'group_board_ranked(uuid, uuid, text, boolean)',
    'group_stream_event_json(uuid, bigint)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public, anon, authenticated, service_role', _sig);
  end loop;

  -- Client RPCs: anon is granted so the function itself emits AUTH_REQUIRED
  -- (same posture as every group RPC, contract §3).
  foreach _sig in array array[
    'group_certify(uuid, uuid, uuid, text)',
    'group_certification_withdraw(uuid, uuid)',
    'group_certification_cancel(uuid, uuid)',
    'group_board_podiums(uuid, text, boolean)',
    'group_board_history(uuid, uuid, text, boolean, jsonb, integer)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public', _sig);
    execute format('grant execute on function app_public.%s to anon, authenticated, service_role', _sig);
  end loop;
end
$grants$;
