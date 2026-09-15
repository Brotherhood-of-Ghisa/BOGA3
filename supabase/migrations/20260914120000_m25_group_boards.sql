-- M25-T05: boards, record / void / link / lead-change events, board and
-- history reads, and the stream's new item kinds.
--
-- Contract: docs/specs/tech/groups-contract.md §2.6 (event kinds), §2.10 (the
-- apply), §2.11 (boards), §4.2 (stream), §4.5 (board reads). M25 design
-- decisions T6 (lead changes: history only), T7 (materialized boards, always
-- recomputed per member and diffed), T8 (in-progress records are provisional).
--
--   group-eval ─▶ group_eval_complete ─▶ group_eval_apply(group, member, group exercise, causes)
--     under a per-group advisory lock: recompute the member's entries from
--     group_set_facts, diff against group_board_entries, write events.
--
-- Ground rules (contract §2): no `owner_user_id` column, no FK into the Sync v2
-- tables, RLS on with no policies and no anon/authenticated privileges. Nothing
-- here writes a Sync v2 table; the only new trigger is on group_memberships.

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- One row per (group exercise, member, metric, certified): the member's best
-- counting set for that board, converted to the group exercise's load mode.
create table app_public.group_board_entries (
  group_id               uuid not null references app_public.groups (id) on delete cascade,
  group_exercise_id      uuid not null references app_public.group_exercises (id) on delete cascade,
  member_user_id         uuid not null references auth.users (id) on delete cascade,
  metric                 text not null,
  certified              boolean not null,
  -- The ranked value (converted weight or converted e1RM), exact numeric so
  -- comparisons and cursors never drift.
  value_kg               numeric not null,
  weight_kg              numeric not null,
  reps                   numeric not null,
  e1rm_kg                numeric null,
  entered_weight_kg      double precision not null,
  load_factor            numeric not null,
  set_id                 text not null,
  session_id             text not null,
  session_exercise_id    text not null,
  exercise_definition_id text not null,
  achieved_at_ms         bigint not null,
  exercise_order_index   integer not null,
  set_order_index        integer not null,
  fingerprint            text not null,
  updated_at             timestamptz not null default now(),
  constraint group_board_entries_pkey primary key (group_exercise_id, member_user_id, metric, certified),
  constraint group_board_entries_metric_valid check (metric in ('weight', 'e1rm')),
  constraint group_board_entries_load_factor_valid check (load_factor in (0.5, 1, 2)),
  constraint group_board_entries_value_positive check (value_kg > 0)
);

comment on table app_public.group_board_entries is
  'M25 boards: one row per (group exercise, member, metric, certified) holding the member''s best counting set, converted to the group exercise''s load mode (D6). Written only by group_eval_apply (recompute and diff). Server-only.';

-- The rank order (contract §2.11): value desc, earlier achieved_at_ms, member id.
create index group_board_entries_rank
  on app_public.group_board_entries (group_exercise_id, metric, certified, value_kg desc, achieved_at_ms, member_user_id);
create index group_board_entries_group
  on app_public.group_board_entries (group_id);

-- The member's live linked exercises at the last apply of a target: the diff
-- attributes a change to a link (P16: no record cards) or to a set.
create table app_public.group_board_state (
  group_id              uuid not null references app_public.groups (id) on delete cascade,
  group_exercise_id     uuid not null references app_public.group_exercises (id) on delete cascade,
  member_user_id        uuid not null references auth.users (id) on delete cascade,
  linked_definition_ids text[] not null,
  applied_at            timestamptz not null default now(),
  constraint group_board_state_pkey primary key (group_exercise_id, member_user_id)
);

comment on table app_public.group_board_state is
  'M25 boards: per (group exercise, member) target, the exercise ids linked at the last apply, for link attribution. Server-only.';

alter table app_public.group_board_entries enable row level security;
alter table app_public.group_board_state enable row level security;
revoke all on table app_public.group_board_entries from public, anon, authenticated;
revoke all on table app_public.group_board_state from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_board_entries to service_role;
grant select, insert, update, delete on table app_public.group_board_state to service_role;

-- -----------------------------------------------------------------------------
-- 2. group_events: the T05 kinds
-- -----------------------------------------------------------------------------

alter table app_public.group_events
  add column seq               bigint generated always as identity,
  add column group_exercise_id uuid null references app_public.group_exercises (id) on delete cascade,
  add column set_id            text null,
  add column metric            text null,
  add column certified         boolean null,
  add column reason            text null,
  add column related_event_id  uuid null references app_public.group_events (id) on delete cascade,
  add column payload           jsonb null;

alter table app_public.group_events
  add constraint group_events_seq_key unique (seq),
  -- The M22 / T02 kinds carry none of the T05 columns.
  add constraint group_events_step1_shape_check check (
    kind not in ('session', 'joined', 'left', 'removed')
    or (group_exercise_id is null and set_id is null and metric is null and certified is null
        and reason is null and related_event_id is null and payload is null)
  ),
  add constraint group_events_record_shape_check check (
    kind <> 'record'
    or (group_exercise_id is not null and set_id is not null and session_id is not null
        and payload is not null and membership_id is null and actor_user_id is null
        and metric is null and certified is null and reason is null and related_event_id is null)
  ),
  add constraint group_events_record_voided_shape_check check (
    kind <> 'record_voided'
    or (group_exercise_id is not null and set_id is not null and session_id is not null
        and related_event_id is not null and reason in ('edited', 'deleted') and payload is not null
        and membership_id is null and actor_user_id is null and metric is null and certified is null)
  ),
  add constraint group_events_link_shape_check check (
    kind not in ('link', 'unlink')
    or (group_exercise_id is not null and payload is not null
        and set_id is null and session_id is null and membership_id is null and actor_user_id is null
        and metric is null and certified is null and reason is null and related_event_id is null)
  ),
  add constraint group_events_lead_change_shape_check check (
    kind <> 'lead_change'
    or (group_exercise_id is not null and metric in ('weight', 'e1rm') and certified is not null
        and reason in ('record', 'void', 'link', 'certification') and payload is not null
        and set_id is null and session_id is null and membership_id is null and actor_user_id is null)
  );

-- One void per record.
create unique index group_events_record_voided_uniq
  on app_public.group_events (related_event_id)
  where kind = 'record_voided';
-- A target's records and voids (the apply's reconciliation).
create index group_events_target_records_idx
  on app_public.group_events (group_exercise_id, member_user_id)
  where kind in ('record', 'record_voided');
-- A board's history, newest first.
create index group_events_history_idx
  on app_public.group_events (group_exercise_id, metric, certified, seq desc)
  where kind = 'lead_change';
create index group_events_related_idx
  on app_public.group_events (related_event_id)
  where related_event_id is not null;

comment on table app_public.group_events is
  'M25 persistent group stream: one row per stream item, written once when it happens (share trigger: session; membership trigger: joined/left/removed; group_eval_apply: record, record_voided, link, unlink, lead_change). lead_change rows are board history, never stream items. group_stream reads only this table; session card content is read live from the member''s Sync v2 rows. Direct client access denied.';

-- -----------------------------------------------------------------------------
-- 3. Board helpers (owner-only; the apply and the reads call them)
-- -----------------------------------------------------------------------------

-- D6: the factor from the member's entered load mode to the group exercise's.
create function app_public.group_board_load_factor(p_member_mode text, p_group_mode text)
returns numeric
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case
    when coalesce(p_member_mode, 'total_load') = p_group_mode then 1::numeric
    when p_group_mode = 'total_load' then 2::numeric
    else 0.5::numeric
  end;
$$;

-- A converted kg value: exact, 6 decimals, trailing zeros trimmed.
create function app_public.group_board_kg(p_value double precision, p_factor numeric)
returns numeric
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case when p_value is null then null
              else trim_scale(round((p_value * p_factor::double precision)::numeric, 6)) end;
$$;

-- Every counting set of a target (contract §2.11): a performed, live fact
-- whose Sync v2 set row still exists, whose session is shared into the group,
-- and whose exercise has a live link to (group, group exercise). Values are
-- converted; weight_kg is null at 0 kg (not "weight lifted"), e1rm_kg is null
-- when the fact has none.
create function app_public.group_board_counting(p_group_id uuid, p_member_user_id uuid, p_group_exercise_id uuid)
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

-- The member's best counting set per metric (P7: highest value, then the
-- earlier achieved_at_ms, exercise order, set order, set id).
create function app_public.group_board_compute(p_group_id uuid, p_member_user_id uuid, p_group_exercise_id uuid)
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
    select * from app_public.group_board_counting(p_group_id, p_member_user_id, p_group_exercise_id)
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

-- Holder snapshot of an entry (contract §2.6 payloads).
create function app_public.group_board_holder_json(p_entry app_public.group_board_entries)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select case when p_entry.member_user_id is null then null else jsonb_build_object(
    'member_user_id', p_entry.member_user_id,
    'value_kg', p_entry.value_kg,
    'weight_kg', p_entry.weight_kg,
    'reps', p_entry.reps,
    'e1rm_kg', p_entry.e1rm_kg,
    'achieved_at_ms', p_entry.achieved_at_ms,
    'set_id', p_entry.set_id,
    'session_id', p_entry.session_id
  ) end;
$$;

-- A board's #1 entry (All or Certified), or a null row.
create function app_public.group_board_leader(p_group_exercise_id uuid, p_metric text, p_certified boolean)
returns app_public.group_board_entries
language sql
stable
set search_path = app_public, pg_temp
as $$
  select e.*
    from app_public.group_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and e.certified = p_certified
   order by e.value_kg desc, e.achieved_at_ms, e.member_user_id
   limit 1;
$$;

-- Would the member lead a board with this entry? Compared with every other
-- member's entry in the rank order (value desc, earlier achieved_at_ms,
-- member id). False when the member has no entry.
create function app_public.group_board_would_lead(
  p_group_exercise_id uuid,
  p_metric text,
  p_member_user_id uuid,
  p_value_kg numeric,
  p_achieved_at_ms bigint
)
returns boolean
language sql
stable
set search_path = app_public, pg_temp
as $$
  select p_value_kg is not null and not exists (
    select 1 from app_public.group_board_entries e
     where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and not e.certified
       and e.member_user_id <> p_member_user_id
       and (e.value_kg > p_value_kg
            or (e.value_kg = p_value_kg
                and (e.achieved_at_ms < p_achieved_at_ms
                     or (e.achieved_at_ms = p_achieved_at_ms and e.member_user_id < p_member_user_id)))));
$$;

-- A member's 1-based rank on a board, or null when unranked.
create function app_public.group_board_rank(p_group_exercise_id uuid, p_metric text, p_certified boolean, p_member_user_id uuid)
returns integer
language sql
stable
set search_path = app_public, pg_temp
as $$
  select r.rank from (
    select e.member_user_id,
           row_number() over (order by e.value_kg desc, e.achieved_at_ms, e.member_user_id)::integer as rank
      from app_public.group_board_entries e
     where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and e.certified = p_certified
  ) r where r.member_user_id = p_member_user_id;
$$;

-- -----------------------------------------------------------------------------
-- 4. The apply: recompute and diff (contract §2.10; design §5)
-- -----------------------------------------------------------------------------

-- Replaces T04's no-op seam. For one (group, member, group exercise) target:
--
--   1. lock the group (pg_advisory_xact_lock(25005, hashtext(group_id))): every
--      apply in a group is serialized, and a session job applies its targets
--      in group_id order, so locks are always taken in one order;
--   2. snapshot the old All entries, leaders, ranks, and the links linked at
--      the last apply; recompute the new entries and the live links;
--   3. provisional records (session row status 'active'): update in place
--      while the set still beats the record's previous value, else delete
--      (its lead_change rows cascade) — no void (T8);
--   4. final records whose set is gone or changed are voided;
--   5. per metric, attribute the entry change: link (the winning set's
--      exercise was not linked at the last apply, and the set predates the
--      link), unlink (the old winner's exercise is no longer linked), record
--      (the new winner beats the old), else a void fallback;
--   6. write entries and state, then the events: voids, records (one per new
--      best set, listing the boards it beat), link / unlink items, and one
--      lead_change per All board whose #1 member changed.
--
-- causes = {rules} exactly is a silent recompute: entries and state only.
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
begin
  perform pg_advisory_xact_lock(25005, hashtext(p_group_id::text));

  select ge.load_input_mode into _group_mode
    from app_public.group_exercises ge
   where ge.id = p_group_exercise_id and ge.group_id = p_group_id;
  if not found then
    return;
  end if;

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
    from app_public.group_board_compute(p_group_id, p_member_user_id, p_group_exercise_id) c;

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
         where lc.kind = 'lead_change' and lc.related_event_id = _rec.id
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
             es.id as row_id,
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
    from app_public.group_board_compute(p_group_id, p_member_user_id, p_group_exercise_id) c;

  insert into app_public.group_board_state as s (group_id, group_exercise_id, member_user_id, linked_definition_ids, applied_at)
  values (p_group_id, p_group_exercise_id, p_member_user_id, _cur_links, now())
  on conflict (group_exercise_id, member_user_id)
  do update set linked_definition_ids = excluded.linked_definition_ids, applied_at = excluded.applied_at;

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
     where lc.kind = 'lead_change' and lc.related_event_id = r.id and r.id = any(_kept)
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
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Catch-up enqueues (contract §2.10): apply what changed while a board was
--    frozen. Failure-isolated like the §2.10 triggers; cause `link`, so the
--    apply attributes the changes normally. Archive and leave enqueue nothing.
-- -----------------------------------------------------------------------------

-- Target jobs for every live link of p_member (or of every member, when null)
-- into (group, group exercise | any exercise of the group), plus every target
-- that already has board state there (a link removed while the board was
-- frozen must still be applied). Never raises.
create function app_public.group_board_enqueue_links(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_member_user_id uuid,
  p_table text,
  p_row_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued boolean := false;
  _link record;
  _sqlstate text;
begin
  begin
    for _link in
      select distinct l.owner_user_id, app_public.group_eval_try_uuid(l.group_exercise_id) as gx
        from app_public.exercise_group_links l
       where l.deleted_at is null
         and app_public.group_eval_try_uuid(l.group_id) = p_group_id
         and (p_member_user_id is null or l.owner_user_id = p_member_user_id)
         and (p_group_exercise_id is null or app_public.group_eval_try_uuid(l.group_exercise_id) = p_group_exercise_id)
      union
      select s.member_user_id, s.group_exercise_id
        from app_public.group_board_state s
       where s.group_id = p_group_id
         and (p_member_user_id is null or s.member_user_id = p_member_user_id)
         and (p_group_exercise_id is null or s.group_exercise_id = p_group_exercise_id)
    loop
      _queued := app_public.group_eval_enqueue_target(_link.owner_user_id, p_group_id, _link.gx, 'link') or _queued;
    end loop;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', p_member_user_id,
      jsonb_build_object('table', p_table, 'row_id', p_row_id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(p_member_user_id);
  end if;
end;
$$;

-- Rejoin: a new membership period re-applies the member's links into the
-- group (links changed and shared sessions edited while away).
create function app_public.group_board_on_membership()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
begin
  perform app_public.group_board_enqueue_links(new.group_id, null, new.user_id, 'group_memberships', new.id::text);
  return null;
end;
$$;

-- Not named `*group*eval_enqueue`: that pattern is the five Sync v2 triggers.
create trigger group_memberships_board_catch_up
  after insert on app_public.group_memberships
  for each row execute function app_public.group_board_on_membership();

-- Unarchive re-applies every live link into the exercise (sets logged while
-- archived become records, at their session start). Body as M25-T01 plus the
-- enqueue when the exercise actually leaves the archive.
create or replace function app_public.group_exercise_unarchive(p_group_id uuid, p_exercise_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _row  app_public.group_exercises := app_public.group_exercise_require(p_group_id, p_exercise_id);
begin
  if _row.archived_at is not null then
    update app_public.group_exercises
       set archived_at = null, updated_at = now()
     where id = _row.id
    returning * into _row;
    perform app_public.group_board_enqueue_links(p_group_id, _row.id, null, 'group_exercises', _row.id::text);
  end if;
  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Board reads (contract §4.5). Check order: preamble → membership
--    (NOT_FOUND: group not found) → VALIDATION → target (NOT_FOUND: group
--    exercise not found). Archived exercises are readable.
-- -----------------------------------------------------------------------------

create function app_public.group_board_validate(p_metric text, p_certified boolean)
returns void
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
begin
  if p_metric is null or p_metric not in ('weight', 'e1rm') then
    raise exception 'VALIDATION: p_metric must be weight or e1rm' using errcode = 'P0001';
  end if;
  if p_certified is null then
    raise exception 'VALIDATION: p_certified is required' using errcode = 'P0001';
  end if;
end;
$$;

-- The group's exercise (no lock), or NOT_FOUND; another group's looks nonexistent.
create function app_public.group_board_require_exercise(p_group_id uuid, p_group_exercise_id uuid)
returns app_public.group_exercises
language plpgsql
stable
set search_path = app_public, pg_temp
as $$
declare
  _row app_public.group_exercises;
begin
  select e.* into _row from app_public.group_exercises e
   where e.id = p_group_exercise_id and e.group_id = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: group exercise not found' using errcode = 'P0001';
  end if;
  return _row;
end;
$$;

-- A Holder plus `member { user_id, username }`, or null.
create function app_public.group_board_holder_with_member(p_holder jsonb)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select case when p_holder is null or jsonb_typeof(p_holder) = 'null' then null
              else p_holder || jsonb_build_object(
                'member', app_public.group_member_ref_json((p_holder ->> 'member_user_id')::uuid)) end;
$$;

-- `[{ exercise_definition_id, name }]`, names read live from the member's catalog.
create function app_public.group_board_link_exercises_json(p_member_user_id uuid, p_ids jsonb)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'exercise_definition_id', d.id,
           'name', (select ed.name from app_public.exercise_definitions ed
                     where ed.owner_user_id = p_member_user_id and ed.id = d.id))
           order by d.id), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) d(id);
$$;

-- History's `related` summary of the event a lead change points at.
create function app_public.group_board_related_json(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select case e.kind
    when 'record' then jsonb_build_object(
      'kind', 'record', 'key', e.id, 'set_id', e.set_id,
      'weight_kg', e.payload -> 'weight_kg', 'reps', e.payload -> 'reps', 'e1rm_kg', e.payload -> 'e1rm_kg')
    when 'record_voided' then jsonb_build_object(
      'kind', 'record_voided', 'key', e.id, 'reason', e.reason, 'record', e.payload -> 'record')
    else jsonb_build_object(
      'kind', 'link', 'key', e.id, 'event', e.kind,
      'exercises', app_public.group_board_link_exercises_json(e.member_user_id, e.payload -> 'exercise_definition_ids'))
  end
    from app_public.group_events e
   where e.id = p_event_id;
$$;

-- A board's rows in rank order with absolute ranks (BoardRow, contract §4.5).
create function app_public.group_board_ranked(
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
           'certified', r.certified)
    from (
      select e.*,
             row_number() over (order by e.value_kg desc, e.achieved_at_ms, e.member_user_id)::integer as rank
        from app_public.group_board_entries e
       where e.group_exercise_id = p_group_exercise_id and e.metric = p_metric and e.certified = p_certified
    ) r
   order by r.rank;
$$;

-- The Leaderboards page: every group exercise (active first) with its podium.
create function app_public.group_board_podiums(
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
               'podium', coalesce((
                 select jsonb_agg(r.row_json order by r.rank)
                   from app_public.group_board_ranked(p_group_id, ge.id, p_metric, p_certified) r
                  where r.rank <= 3), '[]'::jsonb),
               'me', (
                 select r.row_json
                   from app_public.group_board_ranked(p_group_id, ge.id, p_metric, p_certified) r
                  where r.member_user_id = _uid),
               'entry_count', (
                 select count(*) from app_public.group_board_entries e
                  where e.group_exercise_id = ge.id and e.metric = p_metric and e.certified = p_certified),
               'all_entry_count', (
                 select count(*) from app_public.group_board_entries e
                  where e.group_exercise_id = ge.id and e.metric = p_metric and not e.certified))
               order by (ge.archived_at is not null), lower(ge.name), ge.name, ge.id)
        from app_public.group_exercises ge
       where ge.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

-- One full board, keyset-paged by the rank triple.
create function app_public.group_board(
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_metric text default 'e1rm',
  p_certified boolean default false,
  p_after jsonb default null,
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
  _c_value  numeric;
  _c_at     bigint;
  _c_member uuid;
  _ge       app_public.group_exercises;
  _rows     jsonb;
  _has_more boolean;
  _last     jsonb;
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  perform app_public.group_board_validate(p_metric, p_certified);

  _limit := coalesce(p_limit, 50);
  if _limit < 1 or _limit > 100 then
    raise exception 'VALIDATION: p_limit must be between 1 and 100' using errcode = 'P0001';
  end if;

  if p_after is not null and jsonb_typeof(p_after) <> 'null' then
    if jsonb_typeof(p_after) <> 'object'
       or (select count(*) from jsonb_object_keys(p_after)) <> 3
       or jsonb_typeof(p_after -> 'value_kg') is distinct from 'number'
       or jsonb_typeof(p_after -> 'achieved_at_ms') is distinct from 'number'
       or (p_after ->> 'achieved_at_ms') !~ '^-?[0-9]{1,18}$'
       or jsonb_typeof(p_after -> 'member_user_id') is distinct from 'string'
       or (p_after ->> 'member_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION: p_after must be a cursor {value_kg, achieved_at_ms, member_user_id} from next_cursor'
        using errcode = 'P0001';
    end if;
    _c_value  := (p_after ->> 'value_kg')::numeric;
    _c_at     := (p_after ->> 'achieved_at_ms')::bigint;
    _c_member := (p_after ->> 'member_user_id')::uuid;
  end if;

  _ge := app_public.group_board_require_exercise(p_group_id, p_group_exercise_id);

  with page as (
    select r.*
      from app_public.group_board_ranked(p_group_id, p_group_exercise_id, p_metric, p_certified) r
     where _c_value is null
        or r.value_kg < _c_value
        or (r.value_kg = _c_value and (r.achieved_at_ms > _c_at
                                       or (r.achieved_at_ms = _c_at and r.member_user_id > _c_member)))
     order by r.rank
     limit _limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.rank) as n from page p
  )
  select coalesce(jsonb_agg(n.row_json order by n.rank) filter (where n.n <= _limit), '[]'::jsonb),
         count(*) > _limit,
         (array_agg(jsonb_build_object('value_kg', n.value_kg, 'achieved_at_ms', n.achieved_at_ms,
                                       'member_user_id', n.member_user_id)
                    order by n.rank desc) filter (where n.n <= _limit))[1]
    into _rows, _has_more, _last
    from numbered n;

  return jsonb_build_object(
    'exercise', app_public.group_exercise_json(_ge),
    'metric', p_metric,
    'certified', p_certified,
    'rows', _rows,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$$;

-- A board's history (E1.3): lead changes, newest first, keyset-paged by seq.
create function app_public.group_board_history(
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
           'related', app_public.group_board_related_json(p.related_event_id))
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

-- -----------------------------------------------------------------------------
-- 7. group_stream: the record, record_voided and link items (contract §4.2)
-- -----------------------------------------------------------------------------

-- The wire item of one T05 event. lead_change is never a stream item.
create function app_public.group_stream_event_json(p_event_id uuid, p_sort_at_ms bigint)
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
      'certified', false)
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
   where e.id = p_event_id;
$$;

-- As M25-T02, plus the T05 kinds. Order unchanged: sort_at_ms desc, kind
-- asc, key desc ("C"). A record sorts at its session's live started_at while
-- the row exists (tombstoned included — a voided record card stays), else at
-- its stored position; record_voided and link items at the time they happened.
create or replace function app_public.group_stream(
  p_group_id uuid default null,
  p_before   jsonb default null,
  p_limit    integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _scope    uuid[];
  _limit    integer;
  _c_sort   bigint;
  _c_kind   text;
  _c_key    text;
  _items    jsonb;
  _has_more boolean;
  _last     jsonb;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[])
      into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid
       and m.ended_at is null;
  end if;

  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50'
      using errcode = 'P0001';
  end if;

  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'session')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor'
        using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  with session_rows as (
    -- One card per (member, session) in scope, deduplicated across groups.
    select e.member_user_id,
           e.session_id,
           s.started_at,
           jsonb_agg(
             jsonb_build_object('group_id', g.id, 'name', g.name)
             order by lower(g.name), g.name, g.id
           ) as groups
      from app_public.group_events e
      join app_public.groups g on g.id = e.group_id and g.deleted_at is null
      join app_public.sessions s
        on s.owner_user_id = e.member_user_id
       and s.id = e.session_id
       and s.deleted_at is null
     where e.group_id = any(_scope)
       and e.kind = 'session'
     group by e.member_user_id, e.session_id, s.started_at
  ),
  items as (
    select 'session'::text as kind,
           r.member_user_id::text || ':' || r.session_id as key,
           r.started_at as sort_at_ms,
           r.member_user_id as user_id,
           r.session_id,
           r.groups,
           null::text as event,
           null::uuid as group_id,
           null::uuid as event_id
      from session_rows r
    union all
    select 'membership',
           e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end,
           e.sort_at_ms,
           e.member_user_id, null, null, e.kind, e.group_id, null
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('joined', 'left', 'removed')
    union all
    select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms),
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
      left join app_public.sessions s
        on s.owner_user_id = e.member_user_id and s.id = e.session_id
     where e.group_id = any(_scope)
       and e.kind = 'record'
    union all
    select case when e.kind = 'record_voided' then 'record_voided' else 'link' end,
           e.id::text, e.sort_at_ms,
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('record_voided', 'link', 'unlink')
  ),
  page as (
    select i.*,
           row_number() over (
             order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
           ) as rn
      from items i
     where _c_sort is null
        or i.sort_at_ms < _c_sort
        or (i.sort_at_ms = _c_sort
            and (i.kind collate "C" > _c_kind
                 or (i.kind = _c_kind and i.key collate "C" < _c_key)))
     order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
     limit _limit + 1
  )
  select coalesce(
           jsonb_agg(
             case
               when p.kind = 'session' then
                 app_public.group_session_card_json(p.user_id, p.session_id, p.groups)
               when p.kind = 'membership' then
                 jsonb_build_object(
                   'kind', 'membership',
                   'key', p.key,
                   'sort_at_ms', p.sort_at_ms,
                   'event', p.event,
                   'group', (
                     select jsonb_build_object('group_id', g.id, 'name', g.name)
                       from app_public.groups g
                      where g.id = p.group_id
                   ),
                   'member', app_public.group_member_ref_json(p.user_id)
                 )
               else
                 app_public.group_stream_event_json(p.event_id, p.sort_at_ms)
             end
             order by p.rn
           ) filter (where p.rn <= _limit),
           '[]'::jsonb
         ),
         count(*) > _limit,
         (array_agg(
            jsonb_build_object('sort_at_ms', p.sort_at_ms, 'kind', p.kind, 'key', p.key)
            order by p.rn desc
          ) filter (where p.rn <= _limit))[1]
    into _items, _has_more, _last
    from page p;

  return jsonb_build_object(
    'items', _items,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Function privileges
-- -----------------------------------------------------------------------------

do $grants$
declare
  _sig text;
begin
  -- Internal: owner (postgres) only.
  foreach _sig in array array[
    'group_eval_apply(uuid, uuid, uuid, text[])',
    'group_board_load_factor(text, text)',
    'group_board_kg(double precision, numeric)',
    'group_board_counting(uuid, uuid, uuid)',
    'group_board_compute(uuid, uuid, uuid)',
    'group_board_holder_json(app_public.group_board_entries)',
    'group_board_leader(uuid, text, boolean)',
    'group_board_rank(uuid, text, boolean, uuid)',
    'group_board_would_lead(uuid, text, uuid, numeric, bigint)',
    'group_board_enqueue_links(uuid, uuid, uuid, text, text)',
    'group_board_on_membership()',
    'group_board_validate(text, boolean)',
    'group_board_require_exercise(uuid, uuid)',
    'group_board_holder_with_member(jsonb)',
    'group_board_link_exercises_json(uuid, jsonb)',
    'group_board_related_json(uuid)',
    'group_board_ranked(uuid, uuid, text, boolean)',
    'group_stream_event_json(uuid, bigint)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public, anon, authenticated, service_role', _sig);
  end loop;

  -- Client RPCs: anon is granted so the function itself emits AUTH_REQUIRED
  -- (same posture as every group RPC, contract §3).
  foreach _sig in array array[
    'group_board_podiums(uuid, text, boolean)',
    'group_board(uuid, uuid, text, boolean, jsonb, integer)',
    'group_board_history(uuid, uuid, text, boolean, jsonb, integer)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public', _sig);
    execute format('grant execute on function app_public.%s to anon, authenticated, service_role', _sig);
  end loop;
end
$grants$;
