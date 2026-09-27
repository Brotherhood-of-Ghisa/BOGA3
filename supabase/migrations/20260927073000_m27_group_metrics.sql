-- M27 versioned group comparisons, publication, certification and compatible readers.

-- Rules.
-- Versioned comparison rules, with coherent publication and legacy readers.
-- No new table is in Sync v2 or directly readable by a client.

-- Match the shared JavaScript validator, including UTF-16 string length.
create function app_public.group_exercise_valid_description(p_value text)
returns boolean language sql immutable set search_path = app_public, pg_temp as $$
  select p_value is null or (
    p_value=app_public.group_exercise_trim(p_value)
    and char_length(p_value)+char_length(regexp_replace(p_value,'[^\U00010000-\U0010FFFF]','','g')) between 1 and 120
    and p_value !~ '[\u0001-\u001f\u007f]');
$$;
revoke all on function app_public.group_exercise_valid_description(text) from public,anon,authenticated,service_role;

alter table app_public.group_exercises
  add column bodyweight_coefficient double precision not null default 0,
  add column movement_standard text,
  add column loading_method text,
  add column default_metric text not null default 'e1rm',
  add column rules_revision bigint not null default 1,
  add column published_rules_revision bigint default 1,
  add constraint group_exercises_coefficient_valid check (
    bodyweight_coefficient between 0 and 1),
  add constraint group_exercises_standard_valid check (
    app_public.group_exercise_valid_description(movement_standard)),
  add constraint group_exercises_method_valid check (
    app_public.group_exercise_valid_description(loading_method)),
  add constraint group_exercises_bodyweight_identity check (
    bodyweight_coefficient = 0 or (movement_standard is not null and loading_method is not null)),
  add constraint group_exercises_default_metric_valid check (
    (bodyweight_coefficient = 0 and default_metric in ('weight', 'e1rm')) or
    (bodyweight_coefficient > 0 and default_metric in ('bodyweight_reps', 'relative_strength', 'absolute_strength'))),
  add constraint group_exercises_revision_valid check (
    rules_revision > 0 and (published_rules_revision is null or published_rules_revision between 1 and rules_revision));

create table app_public.group_rule_revisions (
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null references app_public.group_exercises(id) on delete cascade,
  revision bigint not null check (revision > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  reason text not null check (reason in ('initial', 'activation', 'rules_change')),
  legacy boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  -- Initial kg-only rows are copied without changing their scores or history.
  -- New revisions retain normalized generic entries by revision instead.
  legacy_entries jsonb not null default '[]' check (jsonb_typeof(legacy_entries) = 'array'),
  primary key (group_exercise_id, revision)
);
create index group_rule_revisions_group on app_public.group_rule_revisions(group_id, group_exercise_id, revision desc);
alter table app_public.group_rule_revisions enable row level security;
revoke all on app_public.group_rule_revisions from public, anon, authenticated, service_role;

create function app_public.group_metric_unit(p_metric text)
returns text language sql immutable set search_path = app_public, pg_temp as $$
  select case p_metric when 'weight' then 'kg' when 'e1rm' then 'kg'
    when 'absolute_strength' then 'kg' when 'relative_strength' then 'x_bw'
    when 'bodyweight_reps' then 'reps' end;
$$;

create function app_public.group_exercise_rules_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('name', p_row.name, 'load_input_mode', p_row.load_input_mode,
    'bodyweight_coefficient', p_row.bodyweight_coefficient,
    'movement_standard', p_row.movement_standard, 'loading_method', p_row.loading_method,
    'default_metric', p_row.default_metric, 'rules_revision', p_row.rules_revision);
$$;

create function app_public.group_exercise_json_v2(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_exercise_json(p_row) || app_public.group_exercise_rules_json(p_row) ||
    jsonb_build_object('published_revision', p_row.published_rules_revision,
      'rebuilding', p_row.published_rules_revision is distinct from p_row.rules_revision,
      'legacy',exists (select 1 from app_public.group_rule_revisions r
        where r.group_exercise_id=p_row.id and r.revision=p_row.rules_revision and r.legacy));
$$;

insert into app_public.group_rule_revisions (
  group_id, group_exercise_id, revision, rules, reason, legacy, created_by, created_at, published_at)
select ge.group_id, ge.id, 1, app_public.group_exercise_rules_json(ge), 'initial', true,
       ge.created_by, ge.created_at, now()
  from app_public.group_exercises ge;

-- Fields supplied by a v2 caller are explicit. This helper validates only rules,
-- not source performance. It cannot confer link compatibility or permission.
create function app_public.group_exercise_validate_rules(
  p_coefficient double precision, p_standard text, p_method text, p_default_metric text
)
returns jsonb language plpgsql immutable set search_path = app_public, pg_temp as $$
declare
  _standard text := nullif(app_public.group_exercise_trim(p_standard), '');
  _method text := nullif(app_public.group_exercise_trim(p_method), '');
begin
  if p_coefficient is null or not (p_coefficient between 0 and 1) then
    raise exception 'VALIDATION: bodyweight contribution must be between 0 and 1' using errcode = 'P0001';
  end if;
  if not app_public.group_exercise_valid_description(_standard)
    or not app_public.group_exercise_valid_description(_method) then
    raise exception 'VALIDATION: use a single line of at most 120 characters for movement and loading descriptions' using errcode = 'P0001';
  end if;
  if p_coefficient > 0 and (_standard is null or _method is null) then
    raise exception 'VALIDATION: bodyweight comparisons require explicit movement and loading standards' using errcode = 'P0001';
  end if;
  if p_default_metric is null or not (
    (p_coefficient = 0 and p_default_metric in ('weight', 'e1rm')) or
    (p_coefficient > 0 and p_default_metric in ('bodyweight_reps', 'relative_strength', 'absolute_strength'))
  ) then
    raise exception 'VALIDATION: default metric is incompatible with the exercise rules' using errcode = 'P0001';
  end if;
  return jsonb_build_object('coefficient', p_coefficient, 'standard', _standard,
    'method', _method, 'default_metric', p_default_metric);
end;
$$;

create function app_public.group_exercise_list_v2(p_group_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user();
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  return jsonb_build_object('contract_version', 2, 'exercises', coalesce((
    select jsonb_agg(app_public.group_exercise_json_v2(ge)
      order by (ge.archived_at is not null), lower(ge.name), ge.name, ge.id)
    from app_public.group_exercises ge where ge.group_id = p_group_id), '[]'::jsonb));
end;
$$;

create function app_public.group_exercise_create_v2(
  p_group_id uuid, p_name text, p_load_input_mode text, p_source_exercise_id text,
  p_bodyweight_coefficient double precision, p_movement_standard text,
  p_loading_method text, p_default_metric text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _name text := app_public.group_exercise_validate_name(p_name);
  _mode text := app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _source text := app_public.group_exercise_validate_source_id(p_source_exercise_id);
  _rules jsonb := app_public.group_exercise_validate_rules(p_bodyweight_coefficient,
    p_movement_standard, p_loading_method, p_default_metric);
  _row app_public.group_exercises;
begin
  perform pg_advisory_xact_lock(25005, hashtext(p_group_id::text));
  insert into app_public.group_exercises (group_id, name, load_input_mode, source_exercise_id,
    bodyweight_coefficient, movement_standard, loading_method, default_metric, created_by)
  values (p_group_id, _name, _mode, _source, p_bodyweight_coefficient,
    _rules ->> 'standard', _rules ->> 'method', p_default_metric, _uid)
  returning * into _row;
  -- A new identity has no links or old entries: its empty initial board is ready.
  insert into app_public.group_rule_revisions (group_id, group_exercise_id, revision, rules,
    reason, legacy, created_by, published_at)
  values (p_group_id, _row.id, 1, app_public.group_exercise_rules_json(_row), 'initial', false, _uid, now())
  on conflict (group_exercise_id,revision) do update set legacy=false,rules=excluded.rules;
  return jsonb_build_object('contract_version', 2, 'exercise', app_public.group_exercise_json_v2(_row));
end;
$$;

-- Compare-and-set applies only to this server-authoritative rules row. It says
-- nothing about concurrent Sync v2 LWW input corrections. Name/default changes
-- are presentation edits; only changes to calculation inputs rebuild a board.
create function app_public.group_exercise_update_v2(
  p_group_id uuid, p_exercise_id uuid, p_expected_revision bigint,
  p_name text, p_load_input_mode text, p_bodyweight_coefficient double precision,
  p_movement_standard text, p_loading_method text, p_default_metric text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _name text := app_public.group_exercise_validate_name(p_name);
  _mode text := app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _rules jsonb := app_public.group_exercise_validate_rules(p_bodyweight_coefficient,
    p_movement_standard, p_loading_method, p_default_metric);
  _old app_public.group_exercises;
  _row app_public.group_exercises;
  _rebuild boolean;
begin
  perform pg_advisory_xact_lock(25005, hashtext(p_group_id::text));
  select * into _old from app_public.group_exercises ge
    where ge.id = p_exercise_id and ge.group_id = p_group_id for update;
  if not found then raise exception 'NOT_FOUND: group exercise not found' using errcode = 'P0001'; end if;
  if _old.archived_at is not null then
    raise exception 'VALIDATION: unarchive the group exercise before editing its rules' using errcode = 'P0001';
  end if;
  if p_expected_revision is distinct from _old.rules_revision then
    raise exception 'CONFLICT: group exercise rules changed; reload before saving' using errcode = 'P0001';
  end if;
  if _old.movement_standard is not null and _old.movement_standard is distinct from (_rules ->> 'standard') then
    raise exception 'VALIDATION: create a new group exercise for a different movement standard' using errcode = 'P0001';
  end if;
  _rebuild := row(_old.load_input_mode, _old.bodyweight_coefficient, _old.movement_standard, _old.loading_method)
    is distinct from row(_mode, p_bodyweight_coefficient, _rules ->> 'standard', _rules ->> 'method');
  if _rebuild then
    -- Copy legacy entries only at retirement; copying on migration would miss
    -- performances logged between server deployment and client activation.
    update app_public.group_rule_revisions r set retired_at = now(),
      legacy_entries = case when r.legacy then coalesce((
        select jsonb_agg(to_jsonb(e)||jsonb_build_object('member',app_public.group_member_ref_json(e.member_user_id),
            'unit','kg','rules_revision',_old.rules_revision) order by e.member_user_id, e.metric, e.certified)
          from app_public.group_board_entries e where e.group_exercise_id = _old.id), '[]'::jsonb)
        else r.legacy_entries end
      where r.group_exercise_id = _old.id and r.revision = _old.rules_revision;
  end if;
  update app_public.group_exercises set name = _name, load_input_mode = _mode,
    bodyweight_coefficient = p_bodyweight_coefficient, movement_standard = _rules ->> 'standard',
    loading_method = _rules ->> 'method', default_metric = p_default_metric,
    rules_revision = _old.rules_revision + case when _rebuild then 1 else 0 end,
    updated_at = now() where id = _old.id returning * into _row;
  if _rebuild then
    insert into app_public.group_rule_revisions (group_id, group_exercise_id, revision, rules,
      reason, legacy, created_by)
    values (p_group_id, _row.id, _row.rules_revision, app_public.group_exercise_rules_json(_row),
      case when _old.bodyweight_coefficient = 0 and p_bodyweight_coefficient > 0 then 'activation'
        else 'rules_change' end, false, _uid);
    perform app_public.group_metric_eval_enqueue(p_group_id,_row.id,'rules');
    perform app_public.group_eval_kick_once(_uid);
  end if;
  return jsonb_build_object('contract_version', 2, 'exercise', app_public.group_exercise_json_v2(_row));
end;
$$;

revoke all on function app_public.group_metric_unit(text) from public, anon, authenticated, service_role;
revoke all on function app_public.group_exercise_rules_json(app_public.group_exercises) from public, anon, authenticated, service_role;
revoke all on function app_public.group_exercise_json_v2(app_public.group_exercises) from public, anon, authenticated, service_role;
revoke all on function app_public.group_exercise_validate_rules(double precision, text, text, text) from public, anon, authenticated, service_role;
-- Follow the existing group RPC posture: anon reaches the explicit AUTH_REQUIRED
-- guard; OAuth client credentials are rejected by group_require_app_user.
do $grants$
declare _sig text;
begin
  foreach _sig in array array[
    'group_exercise_list_v2(uuid)',
    'group_exercise_create_v2(uuid, text, text, text, double precision, text, text, text)',
    'group_exercise_update_v2(uuid, uuid, bigint, text, text, double precision, text, text, text)'
  ] loop
    execute format('revoke all on function app_public.%s from public', _sig);
    execute format('grant execute on function app_public.%s to anon, authenticated, service_role', _sig);
  end loop;
end
$grants$;



-- Queue.
-- Whole-exercise evaluation queue with generation and claim fencing.
-- Source and rule changes feed this queue; the existing sweep drains it.

create table app_public.group_metric_eval_queue (
  id bigint generated always as identity primary key,
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null references app_public.group_exercises(id) on delete cascade,
  causes text[] not null check (cardinality(causes) > 0 and causes <@
    array['set', 'link', 'load_mode', 'compatibility', 'rules', 'certification', 'membership']::text[]),
  generation bigint not null default 1 check (generation > 0),
  attempts integer not null default 0 check (attempts >= 0),
  enqueued_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  claimed_until timestamptz,
  claim_id uuid,
  last_sqlstate text,
  unique (group_exercise_id),
  check ((claimed_until is null) = (claim_id is null))
);
create index group_metric_eval_queue_available
  on app_public.group_metric_eval_queue(available_at, id);
alter table app_public.group_metric_eval_queue enable row level security;
revoke all on app_public.group_metric_eval_queue from public, anon, authenticated, service_role;

-- Owner-only primitive. The caller supplies failure isolation where personal
-- sync/certification commits must survive an enqueue error. No group/advisory
-- lock here: source writes can enqueue while a publisher holds the group lock.
create function app_public.group_metric_eval_enqueue(
  p_group_id uuid, p_group_exercise_id uuid, p_cause text
)
returns boolean language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if p_cause is null or not (p_cause = any(array[
    'set', 'link', 'load_mode', 'compatibility', 'rules', 'certification', 'membership'])) then
    raise exception 'VALIDATION: invalid group evaluation cause' using errcode = 'P0001';
  end if;
  if not exists (select 1 from app_public.group_exercises ge
    join app_public.groups g on g.id = ge.group_id
    where ge.id = p_group_exercise_id and ge.group_id = p_group_id
      and ge.archived_at is null and g.deleted_at is null) then
    return false;
  end if;
  insert into app_public.group_metric_eval_queue as q (group_id, group_exercise_id, causes)
  values (p_group_id, p_group_exercise_id, array[p_cause])
  on conflict (group_exercise_id) do update set
    generation = q.generation + 1,
    causes = (select array_agg(distinct c order by c) from unnest(q.causes || excluded.causes) c),
    attempts = 0, available_at = now(), last_sqlstate = null;
  -- Preserve an in-flight claim. Its stale completion will release the lease;
  -- if that worker vanished the bounded lease permits another worker to claim.
  return true;
end;
$$;

create function app_public.group_metric_eval_claim(p_limit integer)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _jobs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'VALIDATION: claim limit must be between 1 and 20' using errcode = 'P0001';
  end if;
  with picked as (
    select q.id from app_public.group_metric_eval_queue q
    where q.available_at <= now() and (q.claimed_until is null or q.claimed_until < now())
    order by q.available_at, q.id limit p_limit for update skip locked
  ), claimed as (
    update app_public.group_metric_eval_queue q
      set claimed_until = now() + interval '2 minutes', claim_id = gen_random_uuid()
      from picked where q.id = picked.id returning q.*
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'job_id', id, 'group_id', group_id, 'group_exercise_id', group_exercise_id,
      'generation', generation, 'claim_id', claim_id, 'causes', to_jsonb(causes)) order by id), '[]'::jsonb)
    into _jobs from claimed;
  return jsonb_build_object('jobs', _jobs);
end;
$$;

-- Fenced failures cannot reset a newer worker's lease. A source change since
-- this claim deserves an immediate fresh snapshot, not an old error's backoff.
create function app_public.group_metric_eval_fail(
  p_job_id bigint, p_generation bigint, p_claim_id uuid, p_sqlstate text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _job app_public.group_metric_eval_queue;
  _code text := case when p_sqlstate ~ '^[0-9A-Z]{5}$' then p_sqlstate else 'EVALX' end;
begin
  select * into _job from app_public.group_metric_eval_queue where id = p_job_id for update;
  if not found or _job.claim_id is distinct from p_claim_id or p_claim_id is null then
    return jsonb_build_object('job_id', p_job_id, 'accepted', false);
  end if;
  if _job.generation is distinct from p_generation then
    update app_public.group_metric_eval_queue set claimed_until = null, claim_id = null,
      available_at = now() where id = _job.id;
    return jsonb_build_object('job_id', p_job_id, 'accepted', true, 'requeued', true);
  end if;
  update app_public.group_metric_eval_queue set attempts = attempts + 1,
    claimed_until = null, claim_id = null,
    available_at = now() + make_interval(secs => least(300, power(2, least(attempts + 1, 9)))),
    last_sqlstate = _code where id = _job.id;
  perform app_public.group_eval_log_failure('group.eval_failed', null,
    jsonb_build_object('job_id', _job.id, 'kind', 'exercise', 'group_id', _job.group_id,
      'group_exercise_id', _job.group_exercise_id, 'sqlstate', _code));
  return jsonb_build_object('job_id', p_job_id, 'accepted', true, 'requeued', false,
    'attempts', _job.attempts + 1);
end;
$$;

revoke all on function app_public.group_metric_eval_enqueue(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app_public.group_metric_eval_claim(integer) from public, anon, authenticated, service_role;
revoke all on function app_public.group_metric_eval_fail(bigint, bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app_public.group_metric_eval_claim(integer),
  app_public.group_metric_eval_fail(bigint, bigint, uuid, text) to service_role;

-- Publication lock and consistency contract (implemented below):
-- 1. Read job group identity without a row lock.
-- 2. Lock group row, then advisory25005, then the queue row. Recheck identity,
--    claim_id, generation, live group/exercise and rules revision under locks.
-- 3. Re-read deterministic full raw graph (live membership, source sets, links,
--    source load/movement/method, frozen session B tuple, per-metric pins).
--    Its source_token must equal the worker's prepare token; otherwise release
--    only the same claim for immediate retry without touching any projections.
-- 4. Lock relevant certification rows; compute validity from raw per-metric
--    pins. Apply every affected live member and publish the revision in ONE
--    transaction. Keep frozen former/archived entries under their old revision.
-- 5. Delete only this same claimed job. Concurrent source enqueues blocked by
--    its row lock will insert/bump a subsequent generation after publication.
-- 6. Rule-only rebuilding creates a rules-change history item, no performed
--    record/void events. Ordinary jobs preserve the full existing event model.


-- Pins.
-- M27 certification dependency primitive. It is raw serialization,
-- never a second implementation of load or Wathan mathematics. Graph preparation,
-- publication and certification share this serialization.
create function app_public.group_metric_performance_pin(
  p_metric text,
  p_set app_public.exercise_sets,
  p_session_exercise app_public.session_exercises,
  p_session app_public.sessions,
  p_definition app_public.exercise_definitions
)
returns text language sql immutable set search_path = app_public, pg_temp as $$
  select case when p_metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')
    then encode(extensions.digest(jsonb_build_object(
      'pin_version', 2, 'metric', p_metric,
      'source', jsonb_build_array(p_set.owner_user_id, p_set.id,
        p_session_exercise.id, p_session.id, p_definition.id),
      'external', jsonb_build_array(p_set.weight_value, p_set.weight_unit, p_set.external_load_mode),
      'performance', jsonb_build_array(p_set.reps_value, p_set.performance_status),
      'presence', jsonb_build_array(p_set.deleted_at, p_session_exercise.deleted_at, p_session.deleted_at),
      'convention', jsonb_build_array(p_definition.load_input_mode,
        p_definition.movement_standard, p_definition.loading_method),
      'body_weight', case when p_metric in ('relative_strength', 'absolute_strength')
        then jsonb_build_array(p_session.body_weight_kg, p_session.body_weight_source,
          p_session.body_weight_measurement_id, p_session.body_weight_measured_at)
        else 'null'::jsonb end
    )::text,'sha256'),'hex') end;
$$;
revoke all on function app_public.group_metric_performance_pin(text, app_public.exercise_sets,
  app_public.session_exercises, app_public.sessions, app_public.exercise_definitions)
  from public, anon, authenticated, service_role;

-- Intentionally absent from the pin:
-- * personal bodyweight coefficient (has no group authority);
-- * group calculation coefficient/revision/display distribution (rules-only
--   rescoring does not claim the observed performance changed);
-- * Settings reading history (a later weigh-in cannot edit this snapshot);
-- * link/membership state (stops counting without falsifying the observation);
-- * session active/completed and sort timestamps (same observed set).
-- New certification rows must have an explicit metric coverage set. A legacy
-- attestation cannot acquire bodyweight coverage merely by sharing a set ID.


-- Projections.
-- Generic score projections and metric-specific attestations.

-- All mathematically eligible observations for a prepared target. Counting is
-- separate, so unlinks cannot masquerade as edits during event reconciliation.
create table app_public.group_metric_set_scores (
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null,
  rules_revision bigint not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid not null references app_public.group_memberships(id) on delete cascade,
  set_id text not null, session_id text not null, session_exercise_id text not null,
  exercise_definition_id text not null,
  metric text not null check (metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')),
  value numeric not null check (value > 0 and value < 'Infinity'::numeric),
  unit text not null check (unit in ('kg', 'reps', 'x_bw')),
  counting boolean not null,
  achieved_at_ms bigint not null,
  exercise_order_index integer not null check (exercise_order_index >= 0),
  set_order_index integer not null check (set_order_index >= 0),
  set_created_at_ms bigint not null,
  fingerprint text not null,
  performance jsonb not null check (jsonb_typeof(performance) = 'object'),
  effective_resistance_kg double precision,
  external_adjustment_kg double precision,
  added_percent_bodyweight double precision,
  evaluated_at timestamptz not null default now(),
  primary key (group_exercise_id, rules_revision, member_user_id, set_id, metric),
  foreign key (group_exercise_id, rules_revision)
    references app_public.group_rule_revisions(group_exercise_id, revision) on delete cascade,
  check (unit = app_public.group_metric_unit(metric)),
  check (metric <> 'bodyweight_reps' or trunc(value) = value)
);
create index group_metric_set_scores_best on app_public.group_metric_set_scores
  (group_exercise_id, rules_revision, member_user_id, metric, value desc,
   achieved_at_ms, exercise_order_index, set_order_index, set_id) where counting;
create index group_metric_set_scores_group on app_public.group_metric_set_scores(group_id);

-- One explicitly attested metric per row. A B-only correction ends strength
-- rows independently; it does not end a separate unweighted-reps attestation.
create table app_public.group_metric_certifications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  set_id text not null, session_id text not null,
  metric text not null check (metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')),
  observed_rules_revision bigint not null,
  observed_value numeric not null check (observed_value > 0 and observed_value < 'Infinity'::numeric),
  unit text not null check (unit in ('kg', 'reps', 'x_bw')),
  pinned_fingerprint text not null,
  performance jsonb not null check (jsonb_typeof(performance) = 'object'),
  certified_by uuid references auth.users(id) on delete set null,
  certified_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('withdrawn', 'cancelled', 'voided')),
  ended_by uuid references auth.users(id) on delete set null,
  foreign key (group_exercise_id, observed_rules_revision)
    references app_public.group_rule_revisions(group_exercise_id, revision) on delete cascade,
  check (certified_by is distinct from member_user_id),
  check (unit = app_public.group_metric_unit(metric)),
  check (metric <> 'bodyweight_reps' or trunc(observed_value) = observed_value),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= certified_at),
  check (ended_by is null or (ended_at is not null and end_reason <> 'voided'))
);
create unique index group_metric_certifications_active on app_public.group_metric_certifications
  (group_exercise_id, member_user_id, set_id, metric) where ended_at is null;
create index group_metric_certifications_group on app_public.group_metric_certifications(group_id);

create table app_public.group_metric_board_entries (
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null,
  rules_revision bigint not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid not null references app_public.group_memberships(id) on delete cascade,
  metric text not null check (metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')),
  certified boolean not null,
  value numeric not null check (value > 0 and value < 'Infinity'::numeric),
  unit text not null check (unit in ('kg', 'reps', 'x_bw')),
  set_id text not null, session_id text not null, session_exercise_id text not null,
  exercise_definition_id text not null,
  achieved_at_ms bigint not null,
  exercise_order_index integer not null, set_order_index integer not null,
  set_created_at_ms bigint not null,
  fingerprint text not null,
  performance jsonb not null check (jsonb_typeof(performance) = 'object'),
  effective_resistance_kg double precision,
  external_adjustment_kg double precision,
  added_percent_bodyweight double precision,
  certification_id uuid references app_public.group_metric_certifications(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_exercise_id, rules_revision, member_user_id, metric, certified),
  foreign key (group_exercise_id, rules_revision)
    references app_public.group_rule_revisions(group_exercise_id, revision) on delete cascade,
  check (unit = app_public.group_metric_unit(metric)),
  check (metric <> 'bodyweight_reps' or trunc(value) = value)
);
create index group_metric_board_entries_rank on app_public.group_metric_board_entries
  (group_exercise_id, rules_revision, metric, certified, value desc, achieved_at_ms, member_user_id);
create index group_metric_board_entries_group on app_public.group_metric_board_entries(group_id);

create table app_public.group_metric_board_state (
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null,
  rules_revision bigint not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid not null references app_public.group_memberships(id) on delete cascade,
  linked_definition_ids text[] not null,
  certification_ids uuid[] not null,
  applied_at timestamptz not null default now(),
  primary key (group_exercise_id, rules_revision, member_user_id),
  foreign key (group_exercise_id, rules_revision)
    references app_public.group_rule_revisions(group_exercise_id, revision) on delete cascade
);
create index group_metric_board_state_group on app_public.group_metric_board_state(group_id);

alter table app_public.group_metric_set_scores enable row level security;
alter table app_public.group_metric_certifications enable row level security;
alter table app_public.group_metric_board_entries enable row level security;
alter table app_public.group_metric_board_state enable row level security;
revoke all on app_public.group_metric_set_scores, app_public.group_metric_certifications,
  app_public.group_metric_board_entries, app_public.group_metric_board_state
  from public, anon, authenticated, service_role;

-- One persistence precision; zero after rounding does not become a ranked set.
-- No load mathematics here: the shared TS scorer supplies finite raw values.
create function app_public.group_metric_rank_value(p_value double precision)
returns numeric language sql immutable set search_path = app_public, pg_temp as $$
  select case when p_value > 0 and p_value < 'Infinity'::double precision
    then nullif(trim_scale(round(p_value::numeric, 6)), 0) end;
$$;
revoke all on function app_public.group_metric_rank_value(double precision)
  from public, anon, authenticated, service_role;


-- Legacy-dispatch dependency for graph preparation.
create function app_public.group_metric_is_legacy(p_exercise uuid)
returns boolean language sql stable set search_path = app_public, pg_temp as $$
  select coalesce((select r.legacy from app_public.group_exercises ge
    join app_public.group_rule_revisions r on r.group_exercise_id=ge.id and r.revision=ge.rules_revision
    where ge.id=p_exercise),false);
$$;

-- Graph.
-- Full shared-performance graph prepared for the TypeScript evaluator.
-- Only the frozen tuple on a shared session is read: never reading history.

create function app_public.group_metric_eval_source_graph(p_group_id uuid, p_group_exercise_id uuid)
returns jsonb language sql stable security definer set search_path = app_public, pg_temp as $$
  with target as (
    select ge.* from app_public.group_exercises ge
    join app_public.groups g on g.id = ge.group_id
    where ge.id = p_group_exercise_id and ge.group_id = p_group_id
      and g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  ), members as (
    select gm.user_id as member_user_id, gm.id as membership_id
    from app_public.group_memberships gm, target t
    where gm.group_id = t.group_id and gm.ended_at is null
  ), links as (
    select l.owner_user_id as member_user_id, l.exercise_definition_id, l.updated_at
    from app_public.exercise_group_links l, target t
    where l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id) = t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id) = t.id
      and exists (select 1 from members m where m.member_user_id = l.owner_user_id)
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id', s.owner_user_id, 'session_id', s.id,
      'session_exercise_id', se.id, 'exercise_definition_id', se.exercise_definition_id,
      'set_id', es.id, 'weight_value', es.weight_value, 'weight_unit', es.weight_unit,
      'external_load_mode', es.external_load_mode, 'reps_value', es.reps_value,
      'performance_status', es.performance_status,
      'live', s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null,
      'counting', exists (select 1 from links l where l.member_user_id = s.owner_user_id
        and l.exercise_definition_id = se.exercise_definition_id),
      'source_load_input_mode', ed.load_input_mode,
      'movement_standard', ed.movement_standard, 'loading_method', ed.loading_method,
      'body_weight_kg', s.body_weight_kg, 'body_weight_source', s.body_weight_source,
      'body_weight_measurement_id', s.body_weight_measurement_id,
      'body_weight_measured_at_ms', s.body_weight_measured_at,
      'achieved_at_ms', s.started_at, 'exercise_order_index', se.order_index,
      'set_order_index', es.order_index, 'set_created_at_ms', es.created_at,
      -- Publication/event reconciliation also needs active/completed transitions
      -- in its source token, even though scoring does not depend on that status.
      'session_status', s.status,
      'fingerprints', jsonb_build_object(
        'weight', app_public.group_metric_performance_pin('weight', es, se, s, ed),
        'e1rm', app_public.group_metric_performance_pin('e1rm', es, se, s, ed),
        'bodyweight_reps', app_public.group_metric_performance_pin('bodyweight_reps', es, se, s, ed),
        'relative_strength', app_public.group_metric_performance_pin('relative_strength', es, se, s, ed),
        'absolute_strength', app_public.group_metric_performance_pin('absolute_strength', es, se, s, ed))
      ) as row, s.owner_user_id as member_user_id, es.id as set_id
    from target t
    join app_public.group_session_shares sh on sh.group_id = t.group_id
    join members m on m.member_user_id = sh.member_user_id
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
    join app_public.session_exercises se on se.owner_user_id = s.owner_user_id and se.session_id = s.id
    join app_public.exercise_sets es on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id = se.owner_user_id and ed.id = se.exercise_definition_id
    -- Include unlinked shared sets: unlinking affects counting, not whether the
    -- observed set still stands for final-record/certification reconciliation.
  ), graph as (
    select jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.id,
      'name', t.name, 'rules', app_public.group_exercise_rules_json(row(t.*)::app_public.group_exercises),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
        'member_user_id', m.member_user_id, 'membership_id', m.membership_id,
        'links', coalesce((select jsonb_agg(jsonb_build_object(
          'exercise_definition_id', l.exercise_definition_id, 'updated_at_ms', l.updated_at)
          order by l.exercise_definition_id) from links l where l.member_user_id = m.member_user_id), '[]'::jsonb))
        order by m.member_user_id) from members m), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(ss.row order by ss.member_user_id, ss.set_id)
        from source_sets ss), '[]'::jsonb)) as value
    from target t
  ) select value || jsonb_build_object('source_token', encode(extensions.digest(value::text,'sha256'),'hex')) from graph;
$$;

-- Service-only worker read. Claim UUID fences a slow worker after lease expiry;
-- the publisher MUST repeat every check under ordered locks before any writes.
create function app_public.group_metric_eval_prepare(
  p_job_id bigint, p_generation bigint, p_claim_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = app_public, pg_temp as $$
declare _job app_public.group_metric_eval_queue; _graph jsonb;
begin
  select * into _job from app_public.group_metric_eval_queue where id = p_job_id;
  if not found or p_claim_id is null or _job.claim_id is distinct from p_claim_id
    or _job.generation is distinct from p_generation then
    return jsonb_build_object('prepared', false);
  end if;
  _graph := app_public.group_metric_eval_source_graph(_job.group_id, _job.group_exercise_id);
  return jsonb_build_object('prepared', true, 'frozen', _graph is null,
    'job_id', _job.id, 'generation', _job.generation, 'claim_id', _job.claim_id,
    'graph', _graph);
end;
$$;
revoke all on function app_public.group_metric_eval_source_graph(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app_public.group_metric_eval_prepare(bigint, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function app_public.group_metric_eval_prepare(bigint, bigint, uuid) to service_role;


-- Event schema.
-- Same durable event log, explicit contracts at every read boundary.
alter table app_public.group_events
  alter column member_user_id drop not null,
  add constraint group_events_subject_shape check (kind = 'rules_change' or member_user_id is not null),
  add column contract_version integer not null default 1 check (contract_version in (1,2)),
  add column rules_revision bigint,
  drop constraint group_events_kind_check,
  drop constraint group_events_lead_change_shape_check,
  add constraint group_events_kind_check check (kind in (
    'session','joined','left','removed','record','record_voided','link','unlink','lead_change','rules_change')),
  add constraint group_events_revision_shape check (
    (contract_version = 1 and rules_revision is null and kind <> 'rules_change') or
    (contract_version = 2 and rules_revision is not null and rules_revision > 0 and group_exercise_id is not null
      and kind in ('record','record_voided','link','unlink','lead_change','rules_change'))),
  add constraint group_events_lead_change_shape_check check (
    kind <> 'lead_change' or (group_exercise_id is not null
      and ((contract_version = 1 and metric in ('weight','e1rm')) or
        (contract_version = 2 and metric in ('weight','e1rm','bodyweight_reps','relative_strength','absolute_strength')))
      and certified is not null and reason in ('record','void','link','certification') and payload is not null
      and set_id is null and session_id is null and membership_id is null and actor_user_id is null)),
  add constraint group_events_rules_shape check (kind <> 'rules_change' or (
    contract_version = 2 and group_exercise_id is not null and rules_revision > 1 and payload is not null
    and set_id is null and session_id is null and membership_id is null
    and metric is null and certified is null and reason is null and related_event_id is null));
alter table app_public.group_events add constraint group_events_revision_fk
  foreign key (group_exercise_id,rules_revision)
  references app_public.group_rule_revisions(group_exercise_id,revision) on delete cascade;
create index group_events_revision_history on app_public.group_events
  (group_exercise_id,rules_revision,metric,certified,seq desc) where contract_version = 2;
create unique index group_events_rule_publication on app_public.group_events
  (group_exercise_id,rules_revision) where kind = 'rules_change';


-- Helpers.
-- Generic board helpers; only the shared TS scorer supplies maths.
create function app_public.group_metric_names(p_coefficient double precision)
returns text[] language sql immutable set search_path = app_public, pg_temp as $$
  select case when p_coefficient = 0 then array['weight','e1rm']
    else array['bodyweight_reps','relative_strength','absolute_strength'] end;
$$;

-- Old membership periods stay frozen. A rejoin with a new period hides its old
-- entry until the new period's complete source graph has been published.
create function app_public.group_metric_entries(
  p_exercise uuid, p_revision bigint, p_metric text, p_certified boolean
)
returns setof app_public.group_metric_board_entries
language sql stable set search_path = app_public, pg_temp as $$
  select e.* from app_public.group_metric_board_entries e
  join app_public.group_exercises ge on ge.id=e.group_exercise_id
  left join app_public.group_memberships m on m.group_id = e.group_id
    and m.user_id = e.member_user_id and m.ended_at is null
  where e.group_exercise_id = p_exercise and e.rules_revision = p_revision
    and e.metric = p_metric and e.certified = p_certified
    and (p_revision <> ge.rules_revision or m.id is null or m.id = e.membership_id);
$$;

create function app_public.group_metric_leader(
  p_exercise uuid, p_revision bigint, p_metric text, p_certified boolean
)
returns app_public.group_metric_board_entries
language sql stable set search_path = app_public, pg_temp as $$
  select e.* from app_public.group_metric_entries(p_exercise,p_revision,p_metric,p_certified) e
  order by e.value desc, e.achieved_at_ms, e.member_user_id limit 1;
$$;

create function app_public.group_metric_holder_json(p_entry app_public.group_metric_board_entries)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select case when p_entry.member_user_id is null then null else jsonb_build_object(
    'member_user_id',p_entry.member_user_id,'metric',p_entry.metric,'value',p_entry.value,
    'unit',p_entry.unit,'rules_revision',p_entry.rules_revision,
    'achieved_at_ms',p_entry.achieved_at_ms,'set_id',p_entry.set_id,
    'session_id',p_entry.session_id,'performance',p_entry.performance) end;
$$;

create function app_public.group_metric_rank(
  p_exercise uuid, p_revision bigint, p_metric text, p_certified boolean, p_member uuid
)
returns integer language sql stable set search_path = app_public, pg_temp as $$
  select r.rank from (select e.member_user_id,
    row_number() over (order by e.value desc,e.achieved_at_ms,e.member_user_id)::integer as rank
    from app_public.group_metric_entries(p_exercise,p_revision,p_metric,p_certified) e
  ) r where r.member_user_id = p_member;
$$;

create function app_public.group_metric_would_lead(
  p_exercise uuid, p_revision bigint, p_metric text, p_member uuid, p_value numeric, p_achieved bigint
)
returns boolean language sql stable set search_path = app_public, pg_temp as $$
  select p_value is not null and not exists (
    select 1 from app_public.group_metric_entries(p_exercise,p_revision,p_metric,false) e
    where e.member_user_id <> p_member and (e.value > p_value or
      (e.value = p_value and (e.achieved_at_ms < p_achieved or
        (e.achieved_at_ms = p_achieved and e.member_user_id < p_member)))));
$$;

create function app_public.group_metric_certification_matching(
  p_exercise uuid,p_member uuid,p_set text,p_metric text,p_fingerprint text
)
returns app_public.group_metric_certifications
language sql stable set search_path = app_public, pg_temp as $$
  select c.* from app_public.group_metric_certifications c
  where c.group_exercise_id = p_exercise and c.member_user_id = p_member
    and c.set_id = p_set and c.metric = p_metric and c.pinned_fingerprint = p_fingerprint
    and c.ended_at is null order by c.certified_at,c.id limit 1;
$$;

-- Null certification ids means All; an empty array means an empty Certified
-- candidate set. Certification matching is per metric, never all metrics of a set.
create function app_public.group_metric_compute(
  p_exercise uuid,p_revision bigint,p_member uuid,p_certification_ids uuid[]
)
returns setof app_public.group_metric_board_entries
language sql stable set search_path = app_public, pg_temp as $$
  with candidates as (
    select s.*,c.id as certification_id,
      row_number() over (partition by s.metric order by s.value desc,s.achieved_at_ms,
        s.exercise_order_index,s.set_order_index,s.set_id collate "C") as n
    from app_public.group_metric_set_scores s
    left join app_public.group_metric_certifications c on c.group_exercise_id = s.group_exercise_id
      and c.member_user_id = s.member_user_id and c.set_id = s.set_id and c.metric = s.metric
      and c.pinned_fingerprint = s.fingerprint and c.ended_at is null
    where s.group_exercise_id = p_exercise and s.rules_revision = p_revision
      and s.member_user_id = p_member and s.counting
      and (p_certification_ids is null or c.id = any(p_certification_ids))
  ) select (jsonb_populate_record(null::app_public.group_metric_board_entries,
      to_jsonb(c) || jsonb_build_object('certified',p_certification_ids is not null,'updated_at',now()))).*
    from candidates c where c.n = 1;
$$;

-- Immediate withdrawal/correction visibility for other members, while the
-- current apply compares its own previously stored Certified entry for history.
create function app_public.group_metric_certified_leader(
  p_exercise uuid,p_revision bigint,p_metric text,p_applying_member uuid
)
returns app_public.group_metric_board_entries
language sql stable set search_path = app_public, pg_temp as $$
  select e.* from app_public.group_metric_entries(p_exercise,p_revision,p_metric,true) e
  where e.member_user_id = p_applying_member
    or exists (select 1 from app_public.group_metric_certifications c
      where c.id = e.certification_id and c.ended_at is null and c.pinned_fingerprint = e.fingerprint)
  order by e.value desc,e.achieved_at_ms,e.member_user_id limit 1;
$$;

-- Helpers are owner-only, reached through checked readers or service publisher.
do $privileges$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname = any(array[
      'group_metric_names','group_metric_entries','group_metric_leader','group_metric_holder_json',
      'group_metric_rank','group_metric_would_lead','group_metric_certification_matching',
      'group_metric_compute','group_metric_certified_leader'])
  loop execute format('revoke all on function %s from public, anon, authenticated, service_role',f.signature); end loop;
end
$privileges$;


-- Events.
-- Metric-aware M25 provisional/final event reconciliation.
create function app_public.group_metric_apply_member(
  p_group_id uuid,
  p_member_user_id uuid,
  p_group_exercise_id uuid,
  p_rules_revision bigint,
  p_graph jsonb,
  p_silent boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _membership_id uuid;
  _baseline_by   jsonb := '{}'::jsonb;
  _retract_prev  jsonb := '{}'::jsonb;
  _carry         jsonb := '[]'::jsonb;
  _delete_record boolean;
  _lc            record;
  _now_ms        bigint := floor(extract(epoch from now()) * 1000)::bigint;
  _metrics       text[];
  _metric        text;

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
  _source jsonb;
begin
  -- The publisher holds group -> advisory -> queue locks and has checked the
  -- complete graph token. Do not acquire source-row locks in this member loop.
  select (m ->> 'membership_id')::uuid into _membership_id
    from jsonb_array_elements(p_graph -> 'members') m
    where m ->> 'member_user_id' = p_member_user_id::text;
  if _membership_id is null then return; end if;
  _metrics := app_public.group_metric_names((p_graph -> 'rules' ->> 'bodyweight_coefficient')::double precision);

  -- T06: the Certified boards before this apply (stored entries, as the All
  -- boards: a certification ended since the last apply still leads here, so
  -- its lead change is written by the lifter's own apply, exactly once).
  select coalesce(jsonb_object_agg(e.metric, to_jsonb(e)), '{}'::jsonb) into _old_c_by
    from app_public.group_metric_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision and e.member_user_id = p_member_user_id and e.certified;
  foreach _metric in array _metrics loop
    _old_c_leader_by := _old_c_leader_by || jsonb_build_object(_metric,
      app_public.group_metric_holder_json(
        app_public.group_metric_certified_leader(p_group_exercise_id, p_rules_revision, _metric, p_member_user_id)));
  end loop;

  -- Raw metric pins validate the observation even if the current target rule
  -- makes that metric ineligible. A coefficient-only change never voids a pin.
  update app_public.group_metric_certifications c
    set ended_at = greatest(now(),c.certified_at),end_reason = 'voided'
    where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id
      and c.ended_at is null and not exists (
        select 1 from jsonb_array_elements(p_graph -> 'sets') r
        where r ->> 'member_user_id' = c.member_user_id::text and r ->> 'set_id' = c.set_id
          and (r ->> 'live')::boolean and r -> 'fingerprints' ->> c.metric = c.pinned_fingerprint);

  select s.certification_ids into _prev_certs
    from app_public.group_metric_board_state s
   where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision and s.member_user_id = p_member_user_id;
  _prev_certs := coalesce(_prev_certs, '{}');
  select coalesce(array_agg(c.id order by c.id), '{}') into _cur_certs
    from app_public.group_metric_certifications c
   where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id and c.ended_at is null;
  _certs_changed := _prev_certs is distinct from _cur_certs;

  select s.linked_definition_ids into _prev_links
    from app_public.group_metric_board_state s
   where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision and s.member_user_id = p_member_user_id;
  _prev_links := coalesce(_prev_links, '{}');

  select coalesce(array_agg(l ->> 'exercise_definition_id' order by l ->> 'exercise_definition_id'),'{}')
    into _cur_links from jsonb_array_elements(p_graph -> 'members') m
    cross join lateral jsonb_array_elements(m -> 'links') l
    where m ->> 'member_user_id' = p_member_user_id::text;

  select coalesce(jsonb_object_agg(e.metric, to_jsonb(e)), '{}'::jsonb) into _old_by
    from app_public.group_metric_board_entries e
   where e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision and e.member_user_id = p_member_user_id and not e.certified;

  foreach _metric in array _metrics loop
    _old_leader_by := _old_leader_by || jsonb_build_object(_metric,
      app_public.group_metric_holder_json(app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, _metric, false)));
    _old_rank_by := _old_rank_by || jsonb_build_object(_metric,
      app_public.group_metric_rank(p_group_exercise_id, p_rules_revision, _metric, false, p_member_user_id));
  end loop;

  select coalesce(jsonb_object_agg(c.metric, to_jsonb(c)), '{}'::jsonb) into _new_by
    from app_public.group_metric_compute(p_group_exercise_id, p_rules_revision, p_member_user_id, null) c;

  if not p_silent then
    -- 3. Provisional records.
    for _rec in
      select e.id, e.set_id, e.payload
        from app_public.group_events e
       where e.kind = 'record'
         and e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision
         and e.member_user_id = p_member_user_id
         and not exists (select 1 from app_public.group_events v
                          where v.kind = 'record_voided' and v.related_event_id = e.id)
         and exists (select 1 from jsonb_array_elements(p_graph -> 'sets') r
           where r ->> 'member_user_id' = p_member_user_id::text and r ->> 'set_id' = e.set_id
             and r ->> 'session_status' = 'active')
    loop
      select * into _c from app_public.group_metric_set_scores s
        where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision
          and s.member_user_id = p_member_user_id and s.set_id = _rec.set_id and s.counting
        order by s.metric limit 1;
      _counts := found;
      _boards := '[]'::jsonb;
      if _counts then
        select coalesce(jsonb_agg(b || jsonb_build_object(
          'value',s.value,'unit',s.unit,'fingerprint',s.fingerprint,'group_record',false)
          order by b ->> 'metric'),'[]'::jsonb) into _boards
        from jsonb_array_elements(_rec.payload -> 'boards') b
        join app_public.group_metric_set_scores s on s.group_exercise_id = p_group_exercise_id
          and s.rules_revision = p_rules_revision and s.member_user_id = p_member_user_id
          and s.set_id = _rec.set_id and s.metric = b ->> 'metric' and s.counting
        where jsonb_typeof(b -> 'previous_value') = 'null' or s.value > (b ->> 'previous_value')::numeric;
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
        if _delete_record or not app_public.group_metric_would_lead(
             p_group_exercise_id, p_rules_revision, _lc.metric, p_member_user_id,
             (_new_by -> _lc.metric ->> 'value')::numeric,
             (_new_by -> _lc.metric ->> 'achieved_at_ms')::bigint) then
          if _lc.seq = (select max(l2.seq) from app_public.group_events l2
                         where l2.kind = 'lead_change' and l2.group_exercise_id = p_group_exercise_id and l2.rules_revision = p_rules_revision
                           and l2.metric = _lc.metric and not l2.certified) then
            _rollback_by := _rollback_by || jsonb_build_object(_lc.metric, _lc.payload -> 'previous');
          end if;
          delete from app_public.group_events where id = _lc.id;
        end if;
      end loop;

      if _delete_record then
        -- Record detection falls back to the best the record was set against.
        select _retract_prev || coalesce(jsonb_object_agg(b ->> 'metric', b -> 'previous_value'), '{}'::jsonb)
          into _retract_prev
          from jsonb_array_elements(_rec.payload -> 'boards') b
         where _old_by -> (b ->> 'metric') ->> 'set_id' = _rec.set_id;
        delete from app_public.group_events where id = _rec.id;
      else
        update app_public.group_events
           set payload = payload || jsonb_build_object(
                 'boards', _boards, 'performance', _c.performance,
                 'achieved_at_ms', _c.achieved_at_ms, 'session_exercise_id', _c.session_exercise_id,
                 'exercise_definition_id', _c.exercise_definition_id)
         where id = _rec.id;
        _kept := _kept || _rec.id;
      end if;
    end loop;

    -- Final cards stand by their listed values, not by link eligibility.
    -- An equivalent raw edit refreshes the pins but still voids its attestation.
    for _rec in select e.* from app_public.group_events e
      where e.kind = 'record' and e.contract_version = 2
        and e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision
        and e.member_user_id = p_member_user_id
        and not exists (select 1 from app_public.group_events v
          where v.kind = 'record_voided' and v.related_event_id = e.id)
        and not exists (select 1 from jsonb_array_elements(p_graph -> 'sets') r
          where r ->> 'member_user_id' = p_member_user_id::text and r ->> 'set_id' = e.set_id
            and r ->> 'session_status' = 'active')
    loop
      select r into _source from jsonb_array_elements(p_graph -> 'sets') r
        where r ->> 'member_user_id' = p_member_user_id::text and r ->> 'set_id' = _rec.set_id;
      _reason := case when _source is null or not (_source ->> 'live')::boolean then 'deleted'
        when exists (select 1 from jsonb_array_elements(_rec.payload -> 'boards') b
          where not exists (select 1 from app_public.group_metric_set_scores s
            where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision
              and s.member_user_id = p_member_user_id and s.set_id = _rec.set_id
              and s.metric = b ->> 'metric' and s.value = (b ->> 'value')::numeric)) then 'edited' end;
      if _reason is not null then
        _voids := _voids || jsonb_build_array(jsonb_build_object(
          'id',_rec.id,'set_id',_rec.set_id,'session_id',_rec.session_id,'reason',_reason,'payload',_rec.payload));
      else
        select s.* into _c from app_public.group_metric_set_scores s
          where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision
            and s.member_user_id = p_member_user_id and s.set_id = _rec.set_id
          order by s.metric limit 1;
        update app_public.group_events set payload = payload || jsonb_build_object(
          'performance',_c.performance,'boards',(
            select jsonb_agg(b || jsonb_build_object('fingerprint',_source -> 'fingerprints' ->> (b ->> 'metric'))
              order by b ->> 'metric') from jsonb_array_elements(_rec.payload -> 'boards') b))
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
      _before := case when _retract_prev ? _metric then _retract_prev -> _metric else _o -> 'value' end;
      if _before is not null and jsonb_typeof(_before) = 'null' then
        _before := null;
      end if;
      _baseline_by := _baseline_by || jsonb_build_object(_metric, coalesce(_before, 'null'::jsonb));
      if _o is null and _n is null then
        _class := null;
      elsif _o is not null and _n is not null and _o ->> 'set_id' = _n ->> 'set_id'
            and (_o ->> 'value')::numeric = (_n ->> 'value')::numeric then
        _class := null;
      elsif _n is not null
            and not ((_n ->> 'exercise_definition_id') = any(_prev_links))
            and (_n ->> 'set_created_at_ms')::bigint < coalesce((
                  select max((l ->> 'updated_at_ms')::bigint)
                    from jsonb_array_elements(p_graph -> 'members') m
                    cross join lateral jsonb_array_elements(m -> 'links') l
                    where m ->> 'member_user_id' = p_member_user_id::text
                      and l ->> 'exercise_definition_id' = _n ->> 'exercise_definition_id'),
                  9223372036854775807) then
        _class := 'link';
      elsif _o is not null and not ((_o ->> 'exercise_definition_id') = any(_cur_links)) then
        _class := 'unlink';
      elsif _n is not null and (_before is null or (_n ->> 'value')::numeric > (_before #>> '{}')::numeric) then
        _class := 'record';
      else
        _class := 'void';
      end if;
      if _class is not null then
        _class_by := _class_by || jsonb_build_object(_metric, _class);
      end if;
    end loop;
  end if;

  -- Replace both scopes atomically. Other members of this revision are
  -- replaced in this same publisher transaction before any reader can see it.
  delete from app_public.group_metric_board_entries e
    where e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision
      and e.member_user_id = p_member_user_id;
  insert into app_public.group_metric_board_entries
    select * from app_public.group_metric_compute(p_group_exercise_id,p_rules_revision,p_member_user_id,null);
  insert into app_public.group_metric_board_entries
    select * from app_public.group_metric_compute(p_group_exercise_id,p_rules_revision,p_member_user_id,_cur_certs);
  insert into app_public.group_metric_board_state (
    group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    linked_definition_ids,certification_ids,applied_at)
  values (p_group_id,p_group_exercise_id,p_rules_revision,p_member_user_id,_membership_id,_cur_links,_cur_certs,now())
  on conflict (group_exercise_id,rules_revision,member_user_id) do update set
    membership_id = excluded.membership_id,linked_definition_ids = excluded.linked_definition_ids,
    certification_ids = excluded.certification_ids,applied_at = excluded.applied_at;

  if p_silent then
    return;
  end if;

  -- Voids, with the leaders each voided record's boards now have.
  for _rec in select v from jsonb_array_elements(_voids) v loop
    insert into app_public.group_events (
      contract_version, rules_revision,
      group_id, kind, member_user_id, session_id, set_id, group_exercise_id, reason, related_event_id,
      sort_at_ms, payload)
    values (
      2, p_rules_revision, p_group_id, 'record_voided', p_member_user_id, _rec.v ->> 'session_id', _rec.v ->> 'set_id',
      p_group_exercise_id, _rec.v ->> 'reason', (_rec.v ->> 'id')::uuid, _now_ms,
      jsonb_build_object(
        'performance', _rec.v -> 'payload' -> 'performance',
        'leaders', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'metric', b ->> 'metric',
                   'leader', app_public.group_metric_holder_json(
                               app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, b ->> 'metric', false)))
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
           'set_id', v ->> 'set_id', 'metric', b ->> 'metric', 'previous_value', b -> 'previous_value')),
           '[]'::jsonb)
    into _carry
    from jsonb_array_elements(_voids) v
    cross join lateral jsonb_array_elements(v -> 'payload' -> 'boards') b
   where _new_by -> (b ->> 'metric') ->> 'set_id' = v ->> 'set_id'
     and (_new_by -> (b ->> 'metric') ->> 'value')::numeric = (b ->> 'value')::numeric
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
                 'value', (_new_by -> m -> 'value'),
                 'unit', _new_by -> m -> 'unit', 'fingerprint', _new_by -> m -> 'fingerprint',
                 'previous_value', coalesce(_baseline_by -> m, 'null'::jsonb),
                 'group_record', (app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, m, false)).member_user_id
                                   = p_member_user_id) as board
          from unnest(_metrics) m
         where _class_by ->> m = 'record' and _new_by -> m ->> 'set_id' = _set_id
        union all
        select jsonb_build_object(
                 'metric', c ->> 'metric',
                 'value', (_new_by -> (c ->> 'metric') -> 'value'),
                 'unit', _new_by -> (c ->> 'metric') -> 'unit',
                 'fingerprint', _new_by -> (c ->> 'metric') -> 'fingerprint',
                 'previous_value', c -> 'previous_value',
                 'group_record', (app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, c ->> 'metric', false)).member_user_id
                                   = p_member_user_id)
          from jsonb_array_elements(_carry) c
         where c ->> 'set_id' = _set_id
      ) x;

    select e.id into _id
      from app_public.group_events e
     where e.kind = 'record' and e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision
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
                               else b || jsonb_build_object('value', l.nb -> 'value', 'unit',l.nb -> 'unit', 'fingerprint',l.nb -> 'fingerprint',
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
      contract_version, rules_revision,
        group_id, kind, member_user_id, session_id, set_id, group_exercise_id, sort_at_ms, payload)
      values (
        2, p_rules_revision, p_group_id, 'record', p_member_user_id, _n ->> 'session_id', _set_id, p_group_exercise_id,
        (_n ->> 'achieved_at_ms')::bigint,
        jsonb_build_object(
          'boards', _boards,
          'performance', _n -> 'performance',
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
                      (app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, b ->> 'metric', false)).member_user_id
                        = p_member_user_id) order by b ->> 'metric'), '[]'::jsonb)
               from jsonb_array_elements(e.payload -> 'boards') b))
     where e.id = any(_kept);
    update app_public.group_events lc
       set payload = jsonb_set(lc.payload, '{leader}', app_public.group_metric_holder_json(be))
      from app_public.group_events r, app_public.group_metric_board_entries be
     where lc.kind = 'lead_change' and not lc.certified and lc.related_event_id = r.id and r.id = any(_kept)
       and be.group_exercise_id = p_group_exercise_id and be.rules_revision = p_rules_revision and be.member_user_id = p_member_user_id
       and be.metric = lc.metric and not be.certified and be.set_id = r.set_id;
  end if;

  -- Link / unlink items: one each when a link change moved an entry (P16).
  foreach _class in array array['link', 'unlink'] loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'metric', m,
             'before', case when _old_by ? m then jsonb_build_object(
                         'rank', _old_rank_by -> m, 'value', _old_by -> m -> 'value',
                         'metric',m,'unit',app_public.group_metric_unit(m),'rules_revision',p_rules_revision) end,
             'after', case when _new_by ? m then jsonb_build_object(
                         'rank', app_public.group_metric_rank(p_group_exercise_id, p_rules_revision, m, false, p_member_user_id),
                         'value', _new_by -> m -> 'value','metric',m,
                         'unit',app_public.group_metric_unit(m),'rules_revision',p_rules_revision) end)
             order by m), '[]'::jsonb)
      into _effects
      from unnest(_metrics) m
     where _class_by ->> m = _class;
    if jsonb_array_length(_effects) > 0 then
      insert into app_public.group_events (contract_version, rules_revision, group_id, kind, member_user_id, group_exercise_id, sort_at_ms, payload)
      values (
        2, p_rules_revision, p_group_id, _class, p_member_user_id, p_group_exercise_id, _now_ms,
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
    _after := app_public.group_metric_holder_json(app_public.group_metric_leader(p_group_exercise_id, p_rules_revision, _metric, false));
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
      contract_version, rules_revision,
        group_id, kind, member_user_id, group_exercise_id, metric, certified, reason, related_event_id,
        sort_at_ms, payload)
      values (
        2, p_rules_revision, p_group_id, 'lead_change', p_member_user_id, p_group_exercise_id, _metric, false, _reason, _related,
        _now_ms, jsonb_build_object('leader', coalesce(_after, 'null'::jsonb), 'previous', coalesce(_before, 'null'::jsonb)));
    end if;
  end loop;

  -- T06: lead changes on the Certified boards. `certification` when the
  -- target's active certifications changed since the last apply (given, ended,
  -- or voided above), naming the certification that moved #1; otherwise the
  -- All attribution for the metric (link / record / void), else `certification`.
  foreach _metric in array _metrics loop
    _before := _old_c_leader_by -> _metric;
    _after := app_public.group_metric_holder_json(
      app_public.group_metric_certified_leader(p_group_exercise_id, p_rules_revision, _metric, p_member_user_id));
    if (_before ->> 'member_user_id') is distinct from (_after ->> 'member_user_id') then
      _class := _class_by ->> _metric;
      _cert_id := null;
      _related := null;
      if _certs_changed or _class is null then
        _reason := 'certification';
        if (_after ->> 'member_user_id')::uuid = p_member_user_id then
          _cert_id := (app_public.group_metric_certification_matching(
                         p_group_exercise_id, p_member_user_id, _after ->> 'set_id', _metric,
                         (select e.fingerprint from app_public.group_metric_board_entries e
                           where e.group_exercise_id = p_group_exercise_id and e.rules_revision = p_rules_revision and e.member_user_id = p_member_user_id
                             and e.metric = _metric and e.certified))).id;
        elsif _old_c_by ? _metric then
          select c.id into _cert_id
            from app_public.group_metric_certifications c
           where c.group_exercise_id = p_group_exercise_id and c.member_user_id = p_member_user_id
             and c.set_id = _old_c_by -> _metric ->> 'set_id' and c.metric = _metric
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
      contract_version, rules_revision,
        group_id, kind, member_user_id, group_exercise_id, metric, certified, reason, related_event_id,
        sort_at_ms, payload)
      values (
        2, p_rules_revision, p_group_id, 'lead_change', p_member_user_id, p_group_exercise_id, _metric, true, _reason, _related,
        _now_ms,
        jsonb_build_object('leader', coalesce(_after, 'null'::jsonb), 'previous', coalesce(_before, 'null'::jsonb))
          || case when _cert_id is null then '{}'::jsonb
                  else jsonb_build_object('certification_id', _cert_id) end);
    end if;
  end loop;
end;
$$;

revoke all on function app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean) from public,anon,authenticated,service_role;


-- Publisher.
-- A complete target is published once, under one revision and graph.
create function app_public.group_metric_eval_publish(
  p_job_id bigint,p_generation bigint,p_claim_id uuid,p_evaluation jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _job app_public.group_metric_eval_queue;
  _exercise app_public.group_exercises;
  _group_id uuid;
  _graph jsonb;
  _member jsonb;
  _revision bigint;
  _silent boolean;
  _count integer;
begin
  -- Claims only lock the queue; publication uses the same order as manager and
  -- certification RPCs: group row -> group advisory -> queue -> projections.
  select group_id into _group_id from app_public.group_metric_eval_queue where id = p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from app_public.groups where id = _group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(_group_id::text));
  select * into _job from app_public.group_metric_eval_queue where id = p_job_id for update;
  if not found or p_claim_id is null or _job.claim_id is distinct from p_claim_id then
    return jsonb_build_object('completed',false);
  end if;
  if _job.generation is distinct from p_generation then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  _graph := app_public.group_metric_eval_source_graph(_job.group_id,_job.group_exercise_id);
  if _graph is null then
    -- Archival freezes projections and history. Unarchive schedules a fresh job.
    delete from app_public.group_metric_eval_queue where id = _job.id;
    return jsonb_build_object('completed',true,'frozen',true);
  end if;
  select * into strict _exercise from app_public.group_exercises where id = _job.group_exercise_id;
  _revision := _exercise.rules_revision;
  if p_evaluation ->> 'source_token' is distinct from _graph ->> 'source_token'
    or p_evaluation ->> 'rules_revision' is distinct from _revision::text
    or p_evaluation ->> 'group_id' is distinct from _job.group_id::text
    or p_evaluation ->> 'group_exercise_id' is distinct from _job.group_exercise_id::text then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  if jsonb_typeof(p_evaluation -> 'scores') is distinct from 'array' then
    raise exception 'VALIDATION: missing evaluation scores' using errcode='P0001';
  end if;
  -- Verify identities, metric family and raw pins at the trust boundary. Maths
  -- remains exclusively in the shared TypeScript resolver used by the worker.
  if exists (select 1 from jsonb_array_elements(p_evaluation -> 'scores') x
    where not (x ->> 'metric' = any(app_public.group_metric_names(_exercise.bodyweight_coefficient)))
      or x ->> 'unit' is distinct from app_public.group_metric_unit(x ->> 'metric')
      or jsonb_typeof(x -> 'value') is distinct from 'number'
      or not ((x ->> 'value')::double precision > 0 and (x ->> 'value')::double precision < 'Infinity'::double precision)
      or not exists (select 1 from jsonb_array_elements(_graph -> 'sets') r
        where r ->> 'member_user_id' = x ->> 'member_user_id' and r ->> 'set_id' = x ->> 'set_id'
          and (r ->> 'live')::boolean
          and r -> 'fingerprints' ->> (x ->> 'metric') = x ->> 'fingerprint'
          and r ->> 'session_id' = x ->> 'session_id'
          and r ->> 'session_exercise_id' = x ->> 'session_exercise_id'
          and r ->> 'exercise_definition_id' = x ->> 'exercise_definition_id')) then
    raise exception 'VALIDATION: evaluation does not match source graph' using errcode='P0001';
  end if;
  -- Keep retired revisions and inactive membership periods frozen. Only live
  -- members are recomputed; their set scores include noncounting observations.
  delete from app_public.group_metric_set_scores s
    where s.group_exercise_id=_job.group_exercise_id and s.rules_revision=_revision
      and exists (select 1 from jsonb_array_elements(_graph -> 'members') m
        where m ->> 'member_user_id'=s.member_user_id::text);
  insert into app_public.group_metric_set_scores (
    group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance,
    effective_resistance_kg,external_adjustment_kg,added_percent_bodyweight)
  select _job.group_id,_job.group_exercise_id,_revision,(x ->> 'member_user_id')::uuid,
    (m ->> 'membership_id')::uuid,x ->> 'set_id',r ->> 'session_id',r ->> 'session_exercise_id',
    r ->> 'exercise_definition_id',x ->> 'metric',app_public.group_metric_rank_value((x ->> 'value')::double precision),
    x ->> 'unit',(r ->> 'counting')::boolean,(r ->> 'achieved_at_ms')::bigint,
    (r ->> 'exercise_order_index')::integer,(r ->> 'set_order_index')::integer,
    (r ->> 'set_created_at_ms')::bigint,x ->> 'fingerprint',x -> 'performance',
    (x ->> 'effective_resistance_kg')::double precision,(x ->> 'external_adjustment_kg')::double precision,
    (x ->> 'added_percent_bodyweight')::double precision
  from jsonb_array_elements(p_evaluation -> 'scores') x
  join jsonb_array_elements(_graph -> 'sets') r on r ->> 'member_user_id'=x ->> 'member_user_id'
    and r ->> 'set_id'=x ->> 'set_id'
  join jsonb_array_elements(_graph -> 'members') m on m ->> 'member_user_id'=x ->> 'member_user_id'
  where app_public.group_metric_rank_value((x ->> 'value')::double precision) is not null;
  get diagnostics _count = row_count;
  -- Only the first publication of a calculation revision suppresses performed
  -- events. Unarchive temporarily clears published_rules_revision for reader
  -- coherence, but must still reconcile edited/voided events of that revision.
  _silent := not exists (select 1 from app_public.group_rule_revisions r
    where r.group_exercise_id=_job.group_exercise_id and r.revision=_revision
      and r.published_at is not null);
  for _member in select m from jsonb_array_elements(_graph -> 'members') m order by m ->> 'member_user_id' loop
    perform app_public.group_metric_apply_member(_job.group_id,(_member ->> 'member_user_id')::uuid,
      _job.group_exercise_id,_revision,_graph,_silent);
  end loop;
  update app_public.group_exercises set published_rules_revision=_revision where id=_job.group_exercise_id;
  update app_public.group_rule_revisions set published_at=coalesce(published_at,now())
    where group_exercise_id=_job.group_exercise_id and revision=_revision;
  if _silent and _revision > 1 then
    insert into app_public.group_events (contract_version,rules_revision,group_id,kind,group_exercise_id,
      sort_at_ms,payload)
    values (2,_revision,_job.group_id,'rules_change',_job.group_exercise_id,
      floor(extract(epoch from now())*1000)::bigint,
      jsonb_build_object('previous_revision',_revision-1,'rules',_graph -> 'rules'))
    on conflict (group_exercise_id,rules_revision) where kind='rules_change' do nothing;
  end if;
  delete from app_public.group_metric_eval_queue where id=_job.id;
  return jsonb_build_object('completed',true,'rules_revision',_revision,'scores',_count);
end;
$$;
revoke all on function app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb) to service_role;


-- Certifications.
-- Explicit metric coverage; legacy certificates are never widened.
create function app_public.group_metric_certification_json(p_row app_public.group_metric_certifications)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('certification_id',p_row.id,'metric',p_row.metric,
    'rules_revision',p_row.observed_rules_revision,'value',p_row.observed_value,'unit',p_row.unit,
    'certified_by',case when p_row.certified_by is null then null
      else app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms',floor(extract(epoch from p_row.certified_at)*1000)::bigint,
    'performance',p_row.performance,'includes_body_weight',p_row.metric in ('absolute_strength','relative_strength'),
    'ended_at_ms',floor(extract(epoch from p_row.ended_at)*1000)::bigint,'end_reason',p_row.end_reason);
$$;

create function app_public.group_metric_enqueue_isolated(p_group uuid,p_exercise uuid,p_cause text,p_actor uuid)
returns void language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _queued boolean:=false; _code text;
begin
  begin
    _queued:=app_public.group_metric_eval_enqueue(p_group,p_exercise,p_cause);
  exception when others then
    get stacked diagnostics _code=returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed',p_actor,
      jsonb_build_object('group_id',p_group,'group_exercise_id',p_exercise,'kind','exercise','sqlstate',_code));
  end;
  if _queued then perform app_public.group_eval_kick_once(p_actor); end if;
end;
$$;

create function app_public.group_metric_certify(
  p_group_id uuid,p_group_exercise_id uuid,p_member_user_id uuid,p_set_id text,
  p_metric text,p_expected_revision bigint,p_expected_fingerprint text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _ge app_public.group_exercises;
  _score app_public.group_metric_set_scores;
  _row app_public.group_metric_certifications;
  _source jsonb;
  _graph jsonb;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_member_user_id is null or p_set_id is null or p_set_id='' or p_metric is null then
    raise exception 'VALIDATION: member, set and metric are required' using errcode='P0001';
  end if;
  if p_member_user_id=_uid then
    raise exception 'VALIDATION: you cannot certify your own set' using errcode='P0001';
  end if;
  if _ge.archived_at is not null then
    raise exception 'VALIDATION: archived comparisons are read-only' using errcode='P0001';
  end if;
  if _ge.rules_revision is distinct from p_expected_revision
    or _ge.published_rules_revision is distinct from _ge.rules_revision then
    raise exception 'CONFLICT: comparison rules changed; refresh before certifying' using errcode='P0001';
  end if;
  if app_public.group_active_role(p_group_id,p_member_user_id) is null then
    raise exception 'NOT_FOUND: member not found' using errcode='P0001';
  end if;
  select s.* into _score from app_public.group_metric_set_scores s
    where s.group_exercise_id=_ge.id and s.rules_revision=_ge.rules_revision
      and s.member_user_id=p_member_user_id and s.set_id=p_set_id and s.metric=p_metric;
  if not found or not (
    exists (select 1 from app_public.group_metric_board_entries e
      where e.group_exercise_id=_ge.id and e.rules_revision=_ge.rules_revision
        and e.member_user_id=p_member_user_id and e.set_id=p_set_id and e.metric=p_metric and not e.certified)
    or exists (select 1 from app_public.group_events e
      where e.contract_version=2 and e.kind='record' and e.group_exercise_id=_ge.id
        and e.rules_revision=_ge.rules_revision and e.member_user_id=p_member_user_id and e.set_id=p_set_id
        and not exists (select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=e.id)
        and exists (select 1 from jsonb_array_elements(e.payload -> 'boards') b
          where b ->> 'metric'=p_metric and b ->> 'fingerprint'=_score.fingerprint))) then
    raise exception 'NOT_FOUND: record set not found for this metric' using errcode='P0001';
  end if;
  _graph:=app_public.group_metric_eval_source_graph(p_group_id,_ge.id);
  select r into _source from jsonb_array_elements(_graph -> 'sets') r
    where r ->> 'member_user_id'=p_member_user_id::text and r ->> 'set_id'=p_set_id;
  if _source is null or not (_source ->> 'live')::boolean or p_expected_fingerprint is null
    or _score.fingerprint is distinct from p_expected_fingerprint
    or _source -> 'fingerprints' ->> p_metric is distinct from _score.fingerprint then
    raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001';
  end if;
  select c.* into _row from app_public.group_metric_certifications c
    where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id
      and c.set_id=p_set_id and c.metric=p_metric and c.ended_at is null for update;
  if found and _row.pinned_fingerprint=_score.fingerprint then
    return jsonb_build_object('contract_version',2,'certification',app_public.group_metric_certification_json(_row),'created',false);
  elsif found then
    -- The display was already refreshed, but a prior pin still awaited the
    -- evaluator. End that observation explicitly before accepting a new one.
    update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),end_reason='voided'
      where id=_row.id;
  end if;
  insert into app_public.group_metric_certifications (group_id,group_exercise_id,member_user_id,
    set_id,session_id,metric,observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by)
  values (p_group_id,_ge.id,p_member_user_id,p_set_id,_score.session_id,p_metric,_ge.rules_revision,
    _score.value,_score.unit,_score.fingerprint,_score.performance,_uid) returning * into _row;
  perform app_public.group_metric_enqueue_isolated(p_group_id,_ge.id,'certification',_uid);
  return jsonb_build_object('contract_version',2,'certification',app_public.group_metric_certification_json(_row),'created',true);
end;
$$;

-- Public end operation keeps the current member/self/admin rules and is
-- idempotent. The selected action is a closed enum, never a caller-provided SQL
-- function or generic table mutation.
create function app_public.group_metric_certification_end(
  p_group_id uuid,p_certification_id uuid,p_action text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _role text:=app_public.group_require_member(p_group_id,_uid,true);
  _row app_public.group_metric_certifications;
begin
  if p_action is null or p_action not in ('withdraw','cancel') then
    raise exception 'VALIDATION: action must be withdraw or cancel' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select * into _row from app_public.group_metric_certifications
    where group_id=p_group_id and id=p_certification_id for update;
  if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
  if (p_action='withdraw' and _row.certified_by is distinct from _uid)
    or (p_action='cancel' and _role not in ('owner','admin')) then
    raise exception 'FORBIDDEN: certification action is not allowed' using errcode='P0001';
  end if;
  if _row.ended_at is null then
    update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),
      end_reason=case p_action when 'withdraw' then 'withdrawn' else 'cancelled' end,ended_by=_uid
      where id=_row.id returning * into _row;
    perform app_public.group_metric_enqueue_isolated(p_group_id,_row.group_exercise_id,'certification',_uid);
  end if;
  return jsonb_build_object('contract_version',2,'certification',app_public.group_metric_certification_json(_row));
end;
$$;
revoke all on function app_public.group_metric_certification_json(app_public.group_metric_certifications),
  app_public.group_metric_enqueue_isolated(uuid,uuid,text,uuid),
  app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text),
  app_public.group_metric_certification_end(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text),
  app_public.group_metric_certification_end(uuid,uuid,text) to anon,authenticated,service_role;


-- Integration.
-- Legacy identities keep the original kg-only event engine until an
-- explicit v2 rule change retires that revision. New v2 identities use generic
-- projections. Old readers never receive a bodyweight ratio as kilograms.
-- group_metric_is_legacy is defined before graph preparation.

-- Includes old-client creation and privileged fixture creation. The v2 creator
-- explicitly marks its empty initial revision nonlegacy in the same transaction.
create function app_public.group_metric_initial_revision()
returns trigger language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  insert into app_public.group_rule_revisions (group_id,group_exercise_id,revision,rules,
    reason,legacy,created_by,published_at)
  values (new.group_id,new.id,1,app_public.group_exercise_rules_json(new),'initial',true,new.created_by,now());
  return null;
end;
$$;
create trigger group_exercises_metric_initial_revision after insert on app_public.group_exercises
  for each row execute function app_public.group_metric_initial_revision();

alter function app_public.group_eval_apply(uuid,uuid,uuid,text[]) rename to group_eval_apply_legacy;
create function app_public.group_eval_apply(p_group_id uuid,p_member_user_id uuid,p_group_exercise_id uuid,p_causes text[])
returns void language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _cause text;
begin
  if app_public.group_metric_is_legacy(p_group_exercise_id) then
    perform app_public.group_eval_apply_legacy(p_group_id,p_member_user_id,p_group_exercise_id,p_causes);
  else
    foreach _cause in array p_causes loop
      perform app_public.group_metric_eval_enqueue(p_group_id,p_group_exercise_id,_cause);
    end loop;
  end if;
end;
$$;

-- A metadata change affects group compatibility/distribution. A personal
-- coefficient edit does not enqueue or alter an authoritative group score.
drop trigger exercise_definitions_group_eval_enqueue on app_public.exercise_definitions;
create trigger exercise_definitions_group_eval_enqueue
  after update of load_input_mode,movement_standard,loading_method on app_public.exercise_definitions
  for each row when ((old.load_input_mode,old.movement_standard,old.loading_method)
    is distinct from (new.load_input_mode,new.movement_standard,new.loading_method))
  execute function app_public.group_eval_on_exercise_definition();

-- Archive is a freeze; unarchive requires a full catch-up before current rows
-- are served. The existing member rejoin source trigger feeds the same wrapper.
create function app_public.group_metric_on_unarchive()
returns trigger language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  if not app_public.group_metric_is_legacy(new.id) then
    update app_public.group_exercises set published_rules_revision=null where id=new.id;
    perform app_public.group_metric_eval_enqueue(new.group_id,new.id,'membership');
    perform app_public.group_eval_kick_once(null);
  end if;
  return null;
end;
$$;
create trigger group_exercises_metric_unarchive after update of archived_at on app_public.group_exercises
  for each row when (old.archived_at is not null and new.archived_at is null)
  execute function app_public.group_metric_on_unarchive();

create or replace function app_public.group_eval_sweep()
returns boolean language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if not exists (select 1 from app_public.group_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now()))
    and not exists (select 1 from app_public.group_metric_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now())) then return false; end if;
  perform app_public.group_eval_kick();
  return true;
end;
$$;

create function app_public.group_metric_require_legacy(p_group uuid,p_exercise uuid)
returns app_public.group_exercises language plpgsql stable set search_path = app_public, pg_temp as $$
declare _row app_public.group_exercises:=app_public.group_board_require_exercise(p_group,p_exercise);
begin
  if not app_public.group_metric_is_legacy(_row.id) then
    raise exception 'VALIDATION: update the app to view this comparison and its units' using errcode='P0001';
  end if;
  return _row;
end;
$$;

-- The v1 reader/writer definitions below retain kg-only compatibility.
-- Generic RPCs check membership and role at the entrypoint. Implementation
-- helpers, including renamed originals, are denied to client roles.
revoke all on function app_public.group_metric_is_legacy(uuid),
  app_public.group_metric_initial_revision(),app_public.group_eval_apply_legacy(uuid,uuid,uuid,text[]),
  app_public.group_eval_apply(uuid,uuid,uuid,text[]),app_public.group_metric_on_unarchive(),
  app_public.group_metric_require_legacy(uuid,uuid) from public,anon,authenticated,service_role;

-- Rename/default choice changes presentation only, keeping the current
-- revision's display fields current. Retired snapshots are never rewritten.
create function app_public.group_metric_on_presentation()
returns trigger language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  update app_public.group_rule_revisions set rules=rules||jsonb_build_object('name',new.name,'default_metric',new.default_metric)
    where group_exercise_id=new.id and revision=new.rules_revision and retired_at is null;
  return null;
end;
$$;
create trigger group_exercises_metric_presentation after update of name,default_metric on app_public.group_exercises
  for each row when (new.rules_revision=old.rules_revision)
  execute function app_public.group_metric_on_presentation();
revoke all on function app_public.group_metric_on_presentation() from public,anon,authenticated,service_role;


-- Enqueue.
-- generic source routing; preserves failure-isolated original triggers.

create or replace function app_public.group_eval_session_targets(
  p_member_user_id uuid,
  p_session_id text,
  p_exercise_definition_ids text[]
)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.group_exercise_id)
              order by t.group_id, t.group_exercise_id),
    '[]'::jsonb)
    from (
      select distinct sh.group_id, app_public.group_eval_try_uuid(l.group_exercise_id) as group_exercise_id
        from app_public.group_session_shares sh
        join app_public.exercise_group_links l
          on l.owner_user_id = sh.member_user_id
         and l.deleted_at is null
         and app_public.group_eval_try_uuid(l.group_id) = sh.group_id
         and l.exercise_definition_id = any(p_exercise_definition_ids)
       where sh.member_user_id = p_member_user_id
         and sh.session_id = p_session_id
      union
      -- A previously evaluated member still has observations/certifications
      -- after unlinking. Corrections must validate those raw pins too.
      select st.group_id,st.group_exercise_id from app_public.group_metric_board_state st
      join app_public.group_session_shares sh on sh.group_id=st.group_id and sh.member_user_id=st.member_user_id
      where st.member_user_id=p_member_user_id and sh.session_id=p_session_id
    ) t
   where t.group_exercise_id is not null
     and app_public.group_eval_target_is_live(p_member_user_id, t.group_id, t.group_exercise_id);
$$;

create or replace function app_public.group_board_enqueue_links(
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
      union
      select st.member_user_id,st.group_exercise_id from app_public.group_metric_board_state st
      where st.group_id=p_group_id
        and (p_member_user_id is null or st.member_user_id=p_member_user_id)
        and (p_group_exercise_id is null or st.group_exercise_id=p_group_exercise_id)
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

create or replace function app_public.group_eval_on_exercise_definition()
returns trigger
language plpgsql
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
      select l.group_id, l.group_exercise_id
        from app_public.exercise_group_links l
       where l.owner_user_id = new.owner_user_id
         and l.exercise_definition_id = new.id
         and l.deleted_at is null
      union
      select st.group_id::text,st.group_exercise_id::text
      from app_public.group_metric_board_state st
      where st.member_user_id=new.owner_user_id and exists (
        select 1 from app_public.group_session_shares sh
        join app_public.session_exercises se on se.owner_user_id=sh.member_user_id and se.session_id=sh.session_id
        where sh.group_id=st.group_id and sh.member_user_id=new.owner_user_id and se.exercise_definition_id=new.id)
    loop
      _queued := app_public.group_eval_enqueue_target(
        new.owner_user_id,
        app_public.group_eval_try_uuid(_link.group_id),
        app_public.group_eval_try_uuid(_link.group_exercise_id),
        'load_mode') or _queued;
    end loop;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'exercise_definitions', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
$$;


-- Legacy load.
-- legacy load compatibility. Original kg/added observations keep
-- exactly their old pin. New units/modes are explicit; no B dependency is added.
create function app_public.group_legacy_set_fingerprint(p_set app_public.exercise_sets)
returns text language sql immutable set search_path = app_public, pg_temp as $$
  select case when p_set.weight_unit='kg' and coalesce(p_set.external_load_mode,'added')='added'
    then app_public.group_set_fingerprint(p_set.weight_value,p_set.reps_value,p_set.performance_status,p_set.deleted_at)
    else encode(extensions.digest(jsonb_build_array('legacy_external_v2',p_set.weight_value,p_set.weight_unit,
      p_set.external_load_mode,p_set.reps_value,p_set.performance_status,p_set.deleted_at)::text,'sha256'),'hex') end;
$$;
revoke all on function app_public.group_legacy_set_fingerprint(app_public.exercise_sets) from public,anon,authenticated,service_role;
alter table app_public.group_certifications
  add column pinned_weight_unit text not null default 'kg',
  add column pinned_external_load_mode text not null default 'added';

create or replace function app_public.group_eval_session_rows(p_member_user_id uuid, p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'session_id', p_session_id,
    'started_at_ms', s.started_at,
    'sets', case when s.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'set_id', es.id,
               'session_exercise_id', se.id,
               'exercise_definition_id', se.exercise_definition_id,
               'exercise_order_index', se.order_index,
               'set_order_index', es.order_index,
               'weight_value', es.weight_value,
               'weight_unit',es.weight_unit,'external_load_mode',es.external_load_mode,
               'reps_value', es.reps_value,
               'performance_status', es.performance_status,
               'live', es.deleted_at is null and se.deleted_at is null and s.deleted_at is null,
               'fingerprint', app_public.group_legacy_set_fingerprint(es)
             ) order by se.order_index, se.id, es.order_index, es.id)
        from app_public.session_exercises se
        join app_public.exercise_sets es
          on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
       where se.owner_user_id = p_member_user_id
         and se.session_id = p_session_id
    ), '[]'::jsonb) end
  )
    from (select 1) one
    left join app_public.sessions s on s.owner_user_id = p_member_user_id and s.id = p_session_id;
$$;

create or replace function app_public.group_certification_json(p_row app_public.group_certifications)
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
      'weight_unit',p_row.pinned_weight_unit,
      'external_load_mode',p_row.pinned_external_load_mode,
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


-- Legacy guards.
-- v1 compatibility guards. Original signatures and kg-only shapes.

create or replace function app_public.group_exercise_list(p_group_id uuid)
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
  return jsonb_build_object(
    'exercises',
    coalesce((
      select jsonb_agg(
               app_public.group_exercise_json(e)
               order by (e.archived_at is not null), lower(e.name), e.name, e.id
             )
        from app_public.group_exercises e
       where e.group_id = p_group_id and app_public.group_metric_is_legacy(e.id)
    ), '[]'::jsonb)
  );
end;
$$;

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
       where ge.group_id = p_group_id and app_public.group_metric_is_legacy(ge.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_public.group_board(
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

  _ge := app_public.group_metric_require_legacy(p_group_id, p_group_exercise_id);

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

  _ge := app_public.group_metric_require_legacy(p_group_id, p_group_exercise_id);

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

create or replace function app_public.group_certify(
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

  _ge := app_public.group_metric_require_legacy(p_group_id, p_group_exercise_id);
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
  if not found or _fp is null or app_public.group_legacy_set_fingerprint(_set) <> _fp then
    raise exception 'CONFLICT: the set changed; refresh and try again' using errcode = 'P0001';
  end if;

  insert into app_public.group_certifications (
    group_id, group_exercise_id, member_user_id, set_id, session_id, certified_by, pinned_fingerprint,
    pinned_weight_value, pinned_reps_value, pinned_performance_status, weight_kg, reps, e1rm_kg,
    pinned_weight_unit,pinned_external_load_mode)
  values (
    p_group_id, p_group_exercise_id, p_member_user_id, p_set_id, _session, _uid, _fp,
    _set.weight_value, _set.reps_value, _set.performance_status, _weight, _reps, _e1rm,
    _set.weight_unit,coalesce(_set.external_load_mode,'added'))
  returning * into _row;

  perform app_public.group_certification_enqueue(_row);
  return jsonb_build_object('certification', app_public.group_certification_json(_row), 'created', true);
end;
$$;

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
     where e.group_id = any(_scope) and e.contract_version=1
       and (e.group_exercise_id is null or app_public.group_metric_is_legacy(e.group_exercise_id))
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
     where e.group_id = any(_scope) and e.contract_version=1
       and (e.group_exercise_id is null or app_public.group_metric_is_legacy(e.group_exercise_id))
       and e.kind in ('joined', 'left', 'removed')
    union all
    select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms),
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
      left join app_public.sessions s
        on s.owner_user_id = e.member_user_id and s.id = e.session_id
     where e.group_id = any(_scope) and e.contract_version=1
       and (e.group_exercise_id is null or app_public.group_metric_is_legacy(e.group_exercise_id))
       and e.kind = 'record'
    union all
    select case when e.kind = 'record_voided' then 'record_voided' else 'link' end,
           e.id::text, e.sort_at_ms,
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
     where e.group_id = any(_scope) and e.contract_version=1
       and (e.group_exercise_id is null or app_public.group_metric_is_legacy(e.group_exercise_id))
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

create or replace function app_public.group_exercise_update(
  p_group_id uuid,
  p_exercise_id uuid,
  p_name text,
  p_load_input_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _name text := app_public.group_exercise_validate_name(p_name);
  _mode text := app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _row  app_public.group_exercises := app_public.group_exercise_require(p_group_id, p_exercise_id);
begin
  perform app_public.group_metric_require_legacy(p_group_id,p_exercise_id);
  if _row.load_input_mode is distinct from _mode then
    raise exception 'VALIDATION: update the app to change comparison rules' using errcode='P0001';
  end if;
  if _row.archived_at is not null then
    raise exception 'VALIDATION: an archived group exercise is read-only; unarchive it first'
      using errcode = 'P0001';
  end if;

  update app_public.group_exercises
     set name = _name, load_input_mode = _mode, updated_at = now()
   where id = _row.id
  returning * into _row;

  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

create or replace function app_public.group_exercise_archive_v2(p_group_id uuid, p_exercise_id uuid)
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
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if _row.archived_at is null then
    update app_public.group_exercises
       set archived_at = now(), updated_at = now()
     where id = _row.id
    returning * into _row;
  end if;
  return jsonb_build_object('contract_version',2,'exercise',app_public.group_exercise_json_v2(
    (select ge from app_public.group_exercises ge where ge.id=_row.id)));
end;
$$;

create or replace function app_public.group_exercise_archive(p_group_id uuid, p_exercise_id uuid)
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
  perform app_public.group_metric_require_legacy(p_group_id,p_exercise_id);
  if _row.archived_at is null then
    update app_public.group_exercises
       set archived_at = now(), updated_at = now()
     where id = _row.id
    returning * into _row;
  end if;
  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

create or replace function app_public.group_exercise_unarchive_v2(p_group_id uuid, p_exercise_id uuid)
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
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if _row.archived_at is not null then
    update app_public.group_exercises
       set archived_at = null, updated_at = now()
     where id = _row.id
    returning * into _row;
    -- Generic catch-up was queued by the unarchive trigger. Do not acquire a
    -- source-queue row after the generic queue (source jobs lock in the reverse
    -- order); legacy catch-up still uses its original source pipeline.
    if app_public.group_metric_is_legacy(_row.id) then
      perform app_public.group_board_enqueue_links(p_group_id, _row.id, null, 'group_exercises', _row.id::text);
    end if;
  end if;
  return jsonb_build_object('contract_version',2,'exercise',app_public.group_exercise_json_v2(
    (select ge from app_public.group_exercises ge where ge.id=_row.id)));
end;
$$;

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
  perform app_public.group_metric_require_legacy(p_group_id,p_exercise_id);
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

revoke all on function app_public.group_exercise_archive_v2(uuid,uuid),
  app_public.group_exercise_unarchive_v2(uuid,uuid) from public;
grant execute on function app_public.group_exercise_archive_v2(uuid,uuid),
  app_public.group_exercise_unarchive_v2(uuid,uuid) to anon,authenticated,service_role;


-- Readers.
-- v2 readers. Client roles can reach only membership-checked RPCs.
create function app_public.group_metric_revision_json(p_row app_public.group_rule_revisions)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('rules',p_row.rules,'reason',p_row.reason,'legacy',p_row.legacy,
    'published_at_ms',floor(extract(epoch from p_row.published_at)*1000)::bigint,
    'retired_at_ms',floor(extract(epoch from p_row.retired_at)*1000)::bigint);
$$;

-- A historical view carries that revision's publication metadata as well as
-- its calculation rules. Current publication can be temporarily cleared during
-- unarchive; it must not leak into a retired revision's ready/frozen payload.
create function app_public.group_metric_exercise_revision_json(
  p_exercise app_public.group_exercises,p_revision app_public.group_rule_revisions
)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_exercise_json_v2(p_exercise)||p_revision.rules||jsonb_build_object(
    'legacy',p_revision.legacy,
    'published_revision',case when p_revision.revision=p_exercise.rules_revision
      then p_exercise.published_rules_revision
      when p_revision.published_at is not null then p_revision.revision end,
    'rebuilding',p_revision.revision=p_exercise.rules_revision and
      p_exercise.published_rules_revision is distinct from p_exercise.rules_revision);
$$;

create function app_public.group_metric_cursor_decode(p_cursor text)
returns jsonb language plpgsql immutable set search_path = app_public, pg_temp as $$
declare _value jsonb;
begin
  if p_cursor is null then return null; end if;
  begin _value:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
  exception when others then raise exception 'VALIDATION: invalid comparison cursor' using errcode='P0001'; end;
  if jsonb_typeof(_value) is distinct from 'object' then
    raise exception 'VALIDATION: invalid comparison cursor' using errcode='P0001';
  end if;
  return _value;
end;
$$;
create function app_public.group_metric_cursor_encode(p_cursor jsonb)
returns text language sql immutable set search_path = app_public, pg_temp as $$
  select replace(encode(convert_to(p_cursor::text,'UTF8'),'base64'),E'\n','');
$$;

create function app_public.group_metric_board_ranked(
  p_group uuid,p_exercise uuid,p_revision bigint,p_metric text,p_certified boolean
)
returns table (rank integer,member_user_id uuid,value numeric,achieved_at_ms bigint,row_json jsonb)
language sql stable set search_path = app_public, pg_temp as $$
  with visible as (
    select e.*,c.id as active_certification_id
    from app_public.group_metric_entries(p_exercise,p_revision,p_metric,p_certified) e
    left join app_public.group_metric_certifications c on c.group_exercise_id=e.group_exercise_id
      and c.member_user_id=e.member_user_id and c.set_id=e.set_id and c.metric=e.metric
      and c.ended_at is null and c.pinned_fingerprint=e.fingerprint
    where not p_certified or c.id is not null
  ), ranked as (
    select v.*,row_number() over (order by v.value desc,v.achieved_at_ms,v.member_user_id)::integer as rank
    from visible v
  ) select r.rank,r.member_user_id,r.value,r.achieved_at_ms,jsonb_build_object(
    'rank',r.rank,'member',app_public.group_member_ref_json(r.member_user_id),
    'former',not exists (select 1 from app_public.group_memberships m
      where m.group_id=p_group and m.user_id=r.member_user_id and m.ended_at is null),
    'metric',r.metric,'value',r.value,'unit',r.unit,'rules_revision',r.rules_revision,
    'achieved_at_ms',r.achieved_at_ms,'set_id',r.set_id,'performance',r.performance,
    'effective_resistance_kg',r.effective_resistance_kg,'external_adjustment_kg',r.external_adjustment_kg,
    'added_percent_bodyweight',r.added_percent_bodyweight,'fingerprint',r.fingerprint,
    'certified',r.active_certification_id is not null,'certification_id',r.active_certification_id)
  from ranked r order by r.rank;
$$;

create function app_public.group_metric_board(
  p_group_id uuid,p_group_exercise_id uuid,p_metric text,p_certified boolean,
  p_revision bigint default null,p_after text default null,p_limit integer default 50
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _ge app_public.group_exercises;
  _r app_public.group_rule_revisions;
  _cursor jsonb:=app_public.group_metric_cursor_decode(p_after);
  _binding jsonb;
  _rows jsonb;
  _last jsonb;
  _count integer;
  _me jsonb;
  _more boolean;
  _state text;
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  select * into _r from app_public.group_rule_revisions
    where group_exercise_id=_ge.id and revision=coalesce(p_revision,_ge.rules_revision);
  if not found then raise exception 'NOT_FOUND: rules revision not found' using errcode='P0001'; end if;
  if _r.legacy then
    raise exception 'VALIDATION: use the original Weight/1RM view for a legacy revision' using errcode='P0001';
  end if;
  if p_metric is null or not (p_metric=any(app_public.group_metric_names((_r.rules ->> 'bodyweight_coefficient')::double precision)))
    or p_certified is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid comparison metric, scope or page size' using errcode='P0001';
  end if;
  _binding:=jsonb_build_object('exercise',_ge.id,'revision',_r.revision,'metric',p_metric,'certified',p_certified,'kind','board');
  if _cursor is not null and (
    (_cursor - 'value' - 'at' - 'member') is distinct from _binding
    or jsonb_typeof(_cursor -> 'value') is distinct from 'number'
    or jsonb_typeof(_cursor -> 'at') is distinct from 'number'
    or (_cursor ->> 'at') !~ '^-?[0-9]{1,18}$'
    or (_cursor ->> 'value')::numeric <= 0
    or app_public.group_eval_try_uuid(_cursor ->> 'member') is null) then
    raise exception 'VALIDATION: cursor belongs to a different comparison' using errcode='P0001';
  end if;
  _state:=case when _r.revision=_ge.rules_revision and _ge.published_rules_revision is distinct from _ge.rules_revision
    then 'rebuilding' when _ge.archived_at is not null or _r.retired_at is not null then 'archived' else 'ready' end;
  if _state='rebuilding' then _rows:='[]';_count:=0;_me:=null;_more:=false;
  else
    select count(*),(array_agg(r.row_json) filter (where r.member_user_id=_uid))[1] into _count,_me
      from app_public.group_metric_board_ranked(p_group_id,_ge.id,_r.revision,p_metric,p_certified) r;
    with page as (
      select r.* from app_public.group_metric_board_ranked(p_group_id,_ge.id,_r.revision,p_metric,p_certified) r
      where _cursor is null or r.value<(_cursor ->> 'value')::numeric
        or (r.value=(_cursor ->> 'value')::numeric and
          (r.achieved_at_ms,r.member_user_id)>((_cursor ->> 'at')::bigint,(_cursor ->> 'member')::uuid))
      order by r.rank limit p_limit+1
    ), numbered as (select p.*,row_number() over (order by p.rank) as n from page p)
    select coalesce(jsonb_agg(row_json order by rank) filter (where n<=p_limit),'[]'),
      count(*)>p_limit,(array_agg(jsonb_build_object('value',value,'at',achieved_at_ms,'member',member_user_id)
        order by n desc) filter (where n<=p_limit))[1] into _rows,_more,_last from numbered;
  end if;
  return jsonb_build_object('contract_version',2,'exercise',app_public.group_metric_exercise_revision_json(_ge,_r),
    'metric',p_metric,'certified',p_certified,'rules_revision',_r.revision,'state',_state,
    'entries',_rows,'entry_count',_count,'me',_me,'next_cursor',
    case when _more then app_public.group_metric_cursor_encode(_binding||_last) end);
end;
$$;

-- All revisions stay discoverable, including the immutable original kg-only
-- retirement snapshot. No raw owner reading history is queried or returned.
create function app_public.group_metric_revisions(p_group_id uuid,p_group_exercise_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  return jsonb_build_object('contract_version',2,'exercise',app_public.group_exercise_json_v2(_ge),
    'revisions',coalesce((select jsonb_agg(app_public.group_metric_revision_json(r)||
      jsonb_build_object('legacy_entries',case when r.legacy and r.retired_at is not null
        then r.legacy_entries else null end) order by r.revision desc)
      from app_public.group_rule_revisions r where r.group_exercise_id=_ge.id),'[]'));
end;
$$;

create function app_public.group_metric_public_holder(p_holder jsonb,p_group uuid)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select case when p_holder is null or jsonb_typeof(p_holder)='null' then null else
    (p_holder - 'member_user_id' - 'performance' - 'session_id') || jsonb_build_object(
      'member',app_public.group_member_ref_json((p_holder ->> 'member_user_id')::uuid),
      'former',not exists (select 1 from app_public.group_memberships m where m.group_id=p_group
        and m.user_id=(p_holder ->> 'member_user_id')::uuid and m.ended_at is null)) end;
$$;

create function app_public.group_metric_event_json(p_row app_public.group_events)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('event_id',p_row.id,'sequence',p_row.seq,'kind',p_row.kind,
    'group_exercise_id',p_row.group_exercise_id,'rules_revision',p_row.rules_revision,
    'sort_at_ms',p_row.sort_at_ms,'member',case when p_row.member_user_id is not null
      then app_public.group_member_ref_json(p_row.member_user_id) end) || case p_row.kind
    when 'record' then jsonb_build_object('session_id',p_row.session_id,'set_id',p_row.set_id,
      'provisional',exists (select 1 from app_public.sessions s where s.owner_user_id=p_row.member_user_id
        and s.id=p_row.session_id and s.status='active'),
      'performance',p_row.payload -> 'performance','boards',p_row.payload -> 'boards',
      'voided',exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=p_row.id))
    when 'record_voided' then jsonb_build_object('related_event_id',p_row.related_event_id,'reason',p_row.reason,
      'performance',p_row.payload -> 'performance','leaders',coalesce((select jsonb_agg(jsonb_build_object(
        'metric',l ->> 'metric','leader',app_public.group_metric_public_holder(l -> 'leader',p_row.group_id))
        order by l ->> 'metric') from jsonb_array_elements(p_row.payload -> 'leaders') l),'[]'))
    when 'lead_change' then jsonb_build_object('metric',p_row.metric,'certified',p_row.certified,'reason',p_row.reason,
      'related_event_id',p_row.related_event_id,'certification_id',p_row.payload -> 'certification_id',
      'leader',app_public.group_metric_public_holder(p_row.payload -> 'leader',p_row.group_id),
      'previous',app_public.group_metric_public_holder(p_row.payload -> 'previous',p_row.group_id))
    else p_row.payload end;
$$;

create function app_public.group_metric_history(
  p_group_id uuid,p_group_exercise_id uuid,p_metric text,p_certified boolean,
  p_revision bigint default null,p_before text default null,p_limit integer default 50
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _r app_public.group_rule_revisions; _cursor jsonb:=app_public.group_metric_cursor_decode(p_before);
  _binding jsonb; _rows jsonb; _more boolean; _last bigint;
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  select * into _r from app_public.group_rule_revisions where group_exercise_id=_ge.id
    and revision=coalesce(p_revision,_ge.rules_revision);
  if not found then raise exception 'NOT_FOUND: rules revision not found' using errcode='P0001'; end if;
  if p_metric is null or not(p_metric=any(app_public.group_metric_names((_r.rules ->> 'bodyweight_coefficient')::double precision)))
    or p_certified is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid comparison metric, scope or page size' using errcode='P0001';
  end if;
  _binding:=jsonb_build_object('exercise',_ge.id,'revision',_r.revision,'metric',p_metric,'certified',p_certified,'kind','history');
  if _cursor is not null and ((_cursor-'seq') is distinct from _binding or
    jsonb_typeof(_cursor -> 'seq') is distinct from 'number' or
    (_cursor ->> 'seq') !~ '^[0-9]{1,18}$') then
    raise exception 'VALIDATION: cursor belongs to a different comparison' using errcode='P0001';
  end if;
  with page as (
    select e.*,row_number() over(order by e.seq desc) as n from app_public.group_events e
    where e.group_exercise_id=_ge.id and ((e.kind='lead_change' and e.metric=p_metric and e.certified=p_certified)
        or (e.kind='rules_change' and not _r.legacy))
      and ((_r.legacy and e.contract_version=1) or (not _r.legacy and e.contract_version=2 and e.rules_revision=_r.revision))
      and (_cursor is null or e.seq<(_cursor ->> 'seq')::bigint) order by e.seq desc limit p_limit+1
  ) select coalesce(jsonb_agg(case when _r.legacy then jsonb_build_object('legacy',true,
      'event_id',p.id,'sequence',p.seq,'sort_at_ms',p.sort_at_ms,'metric',p.metric,'unit','kg',
      'reason',p.reason,'payload',p.payload||jsonb_build_object(
        'leader',app_public.group_board_holder_with_member(p.payload -> 'leader'),
        'previous',app_public.group_board_holder_with_member(p.payload -> 'previous'))) else app_public.group_metric_event_json(
        (select e from app_public.group_events e where e.id=p.id)) end order by p.seq desc)
      filter (where p.n<=p_limit),'[]'),count(*)>p_limit,min(p.seq) filter(where p.n<=p_limit)
    into _rows,_more,_last from page p;
  return jsonb_build_object('contract_version',2,'exercise',app_public.group_metric_exercise_revision_json(_ge,_r),
    'revision',app_public.group_metric_revision_json(_r),'metric',p_metric,'certified',p_certified,
    'events',_rows,'next_cursor',case when _more then app_public.group_metric_cursor_encode(_binding||jsonb_build_object('seq',_last)) end);
end;
$$;

-- Checked reader RPCs are granted below; implementation helpers stay private.

-- One card per comparison. Legacy cards retain their original strongly typed
-- kg-only shape behind an explicit tag; generic cards carry value/unit/revision.
create function app_public.group_metric_podiums(p_group_id uuid,p_certified boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _board jsonb; _legacy jsonb; _all integer; _cards jsonb:='[]';
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  if p_certified is null then raise exception 'VALIDATION: scope is required' using errcode='P0001'; end if;
  _legacy:=app_public.group_board_podiums(p_group_id,'e1rm',p_certified);
  for _ge in select * from app_public.group_exercises where group_id=p_group_id
    order by (archived_at is not null),lower(name),name,id loop
    if app_public.group_metric_is_legacy(_ge.id) then
      _cards:=_cards||jsonb_build_array(jsonb_build_object('legacy',true,
        'exercise',app_public.group_exercise_json_v2(_ge),'board',(
          select e from jsonb_array_elements(_legacy -> 'exercises') e
          where e -> 'exercise' ->> 'group_exercise_id'=_ge.id::text)));
    else
      _board:=app_public.group_metric_board(p_group_id,_ge.id,_ge.default_metric,p_certified,null,null,3);
      select count(*) into _all from app_public.group_metric_board_ranked(p_group_id,_ge.id,
        _ge.rules_revision,_ge.default_metric,false);
      _cards:=_cards||jsonb_build_array((_board-'entries'-'next_cursor')||jsonb_build_object(
        'legacy',false,'podium',_board -> 'entries','all_entry_count',case when _board ->> 'state'='rebuilding' then 0 else _all end));
    end if;
  end loop;
  return jsonb_build_object('contract_version',2,'exercises',_cards);
end;
$$;

do $privileges$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname=any(array['group_metric_revision_json','group_metric_exercise_revision_json','group_metric_cursor_decode',
      'group_metric_cursor_encode','group_metric_board_ranked','group_metric_board','group_metric_revisions',
      'group_metric_public_holder','group_metric_event_json','group_metric_history','group_metric_podiums'])
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end
$privileges$;
grant execute on function app_public.group_metric_board(uuid,uuid,text,boolean,bigint,text,integer),
  app_public.group_metric_revisions(uuid,uuid),app_public.group_metric_history(uuid,uuid,text,boolean,bigint,text,integer),
  app_public.group_metric_podiums(uuid,boolean) to anon,authenticated,service_role;

create function app_public.group_metric_certification_get(p_group_id uuid,p_certification_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_metric_certifications;
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  select * into _row from app_public.group_metric_certifications
    where group_id=p_group_id and id=p_certification_id;
  if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',2,'certification',app_public.group_metric_certification_json(_row));
end;
$$;
revoke all on function app_public.group_metric_certification_get(uuid,uuid) from public;
grant execute on function app_public.group_metric_certification_get(uuid,uuid) to anon,authenticated,service_role;


-- Mutable presentation context never changes an event's recorded score/pin.
-- A stream card can inspect/certify a still-standing historic PR even when a
-- newer All-board best exists. The write RPC rechecks current raw dependencies.
create function app_public.group_metric_stream_record_context(p_event app_public.group_events)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('exercise',app_public.group_exercise_json_v2(ge),
    'former',app_public.group_active_role(p_event.group_id,p_event.member_user_id) is null,
    'metrics',coalesce((select jsonb_agg(jsonb_build_object(
      'metric',b ->> 'metric','fingerprint',b ->> 'fingerprint',
      'effective_resistance_kg',case when s.metric<>'bodyweight_reps' then s.effective_resistance_kg end,
      'external_adjustment_kg',s.external_adjustment_kg,
      'added_percent_bodyweight',case when s.metric<>'bodyweight_reps' then s.added_percent_bodyweight end,
      'eligible',s.set_id is not null and ge.archived_at is null
        and ge.rules_revision=p_event.rules_revision and ge.published_rules_revision=ge.rules_revision
        and app_public.group_active_role(p_event.group_id,p_event.member_user_id) is not null
        and not exists (select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=p_event.id),
      'certification',case when c.id is not null then app_public.group_metric_certification_json(c) end
    ) order by b ->> 'metric')
      from jsonb_array_elements(p_event.payload -> 'boards') b
      left join app_public.group_metric_set_scores s on s.group_exercise_id=ge.id
        and s.rules_revision=p_event.rules_revision and s.member_user_id=p_event.member_user_id
        and s.set_id=p_event.set_id and s.metric=b ->> 'metric' and s.fingerprint=b ->> 'fingerprint'
      left join lateral app_public.group_metric_certification_matching(ge.id,p_event.member_user_id,
        p_event.set_id,b ->> 'metric',b ->> 'fingerprint') c on true),'[]'))
  from app_public.group_exercises ge where ge.id=p_event.group_exercise_id;
$$;
revoke all on function app_public.group_metric_stream_record_context(app_public.group_events) from public,anon,authenticated,service_role;

-- Stream.
-- v2 stream. Both event families retain explicit original units.
create function app_public.group_metric_stream_event_json(p_event uuid,p_sort bigint)
returns jsonb language sql stable set search_path = app_public, pg_temp as $$
  select case when e.contract_version=2 then app_public.group_metric_event_json(e)||jsonb_build_object(
    'metric_event',true,'key',e.id,'sort_at_ms',p_sort,
    'kind',case when e.kind='unlink' then 'link' else e.kind end,
    'event',case when e.kind in ('link','unlink') then e.kind end,
    'group',jsonb_build_object('group_id',e.group_id,'name',g.name),
    'group_exercise',jsonb_build_object('group_exercise_id',e.group_exercise_id)||r.rules) || case when e.kind='record' then jsonb_build_object('record_context',app_public.group_metric_stream_record_context(e)) else '{}'::jsonb end
  else app_public.group_stream_event_json(e.id,p_sort)||jsonb_build_object(
    'legacy',true,'rules_revision',r.revision,'group_exercise',
    jsonb_build_object('group_exercise_id',e.group_exercise_id,'name',r.rules -> 'name',
      'load_input_mode',r.rules -> 'load_input_mode')) end
  from app_public.group_events e join app_public.groups g on g.id=e.group_id
  join app_public.group_rule_revisions r on r.group_exercise_id=e.group_exercise_id
    and r.revision=coalesce(e.rules_revision,1) where e.id=p_event;
$$;

create or replace function app_public.group_stream_v2(
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
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'rules_change', 'session')
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
    union all
    select 'rules_change',e.id::text,e.sort_at_ms,e.member_user_id,null,null,null,e.group_id,e.id
      from app_public.group_events e where e.group_id=any(_scope) and e.kind='rules_change'
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
                 app_public.group_metric_stream_event_json(p.event_id,p.sort_at_ms)
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
    'contract_version',2,'items', _items,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$$;
revoke all on function app_public.group_metric_stream_event_json(uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function app_public.group_stream_v2(uuid,jsonb,integer) from public;
grant execute on function app_public.group_stream_v2(uuid,jsonb,integer) to anon,authenticated,service_role;


-- Session context.
-- additive shared-session context. Membership guards are unchanged.
-- Only the frozen shared-session tuple is exposed; no measurement timeline query.

create or replace function app_public.group_session_exercises_json(p_member uuid, p_session_id text)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'session_exercise_id', se.id,
               'exercise_definition_id',se.exercise_definition_id,
               'load_input_mode',ed.load_input_mode,
               'bodyweight_coefficient',ed.bodyweight_coefficient,
               'movement_standard',ed.movement_standard,'loading_method',ed.loading_method,
               'name', se.name,
               'machine_name', se.machine_name,
               'order_index', se.order_index,
               'sets', coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'set_id', es.id,
                            'order_index', es.order_index,
                            'weight_value', es.weight_value,
                            'weight_unit',es.weight_unit,'external_load_mode',es.external_load_mode,
                            'reps_value', es.reps_value,
                            'set_type', es.set_type,
                            'performance_status', es.performance_status
                          )
                          order by es.order_index, es.id
                        )
                   from app_public.exercise_sets es
                  where es.owner_user_id = se.owner_user_id
                    and es.session_exercise_id = se.id
                    and es.deleted_at is null
               ), '[]'::jsonb)
             )
             order by se.order_index, se.id
           ),
           '[]'::jsonb
         )
    from app_public.session_exercises se
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id
      and ed.id=se.exercise_definition_id
   where se.owner_user_id = p_member
     and se.session_id = p_session_id
     and se.deleted_at is null;
$$;

create or replace function app_public.group_session_card_json(p_member uuid, p_session_id text, p_groups jsonb)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'kind', 'session',
    'key', p_member::text || ':' || p_session_id,
    'sort_at_ms', s.started_at,
    'member', app_public.group_member_ref_json(p_member),
    'session_id', p_session_id,
    'groups', p_groups,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member and g.id = s.gym_id and g.deleted_at is null
    ),
    'status', s.status,
    'started_at_ms', s.started_at,
    'completed_at_ms', s.completed_at,
    'duration_sec', s.duration_sec,
    'metric_scope','personal','metric_revision','effective_load_v1',
    'body_weight_kg',s.body_weight_kg,'body_weight_source',s.body_weight_source,
    'body_weight_measurement_id',s.body_weight_measurement_id,
    'body_weight_measured_at_ms',s.body_weight_measured_at,
    'exercises', app_public.group_session_exercises_json(p_member, p_session_id)
  )
  from app_public.sessions s
  where s.owner_user_id = p_member and s.id = p_session_id;
$$;

create or replace function app_public.group_session_detail(p_member_user_id uuid, p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _s   record;
begin
  if not exists (
    select 1
      from app_public.group_session_shares sh
      join app_public.sessions s
        on s.owner_user_id = sh.member_user_id
       and s.id = sh.session_id
       and s.deleted_at is null
     where sh.member_user_id = p_member_user_id
       and sh.session_id = p_session_id
       and app_public.group_active_role(sh.group_id, _uid) is not null
  ) then
    raise exception 'NOT_FOUND: session not found'
      using errcode = 'P0001';
  end if;

  select x.gym_id,x.status,x.started_at,x.completed_at,x.duration_sec,
         x.body_weight_kg,x.body_weight_source,x.body_weight_measurement_id,x.body_weight_measured_at
    into _s
    from app_public.sessions x
   where x.owner_user_id = p_member_user_id and x.id = p_session_id;

  return jsonb_build_object('session', jsonb_build_object(
    'member', app_public.group_member_ref_json(p_member_user_id),
    'session_id', p_session_id,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member_user_id and g.id = _s.gym_id and g.deleted_at is null
    ),
    'status', _s.status,
    'started_at_ms', _s.started_at,
    'completed_at_ms', _s.completed_at,
    'duration_sec', _s.duration_sec,
    'metric_scope','personal','metric_revision','effective_load_v1',
    'body_weight_kg',_s.body_weight_kg,'body_weight_source',_s.body_weight_source,
    'body_weight_measurement_id',_s.body_weight_measurement_id,
    'body_weight_measured_at_ms',_s.body_weight_measured_at,
    'exercises', app_public.group_session_exercises_json(p_member_user_id, p_session_id)
  ));
end;
$$;
