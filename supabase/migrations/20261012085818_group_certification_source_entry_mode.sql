-- Generation zero preserves every existing witness, including historical mode
-- mismatches. Only a later committed source-mode transition changes this binding.
create table app_public.group_source_mode_generations (
  member_user_id uuid not null references auth.users(id) on delete cascade,
  exercise_definition_id text not null,
  generation bigint not null check(generation>0),
  changed_at timestamptz not null,
  primary key(member_user_id,exercise_definition_id)
);
alter table app_public.group_source_mode_generations enable row level security;
revoke all on app_public.group_source_mode_generations from public,anon,authenticated,service_role;
alter table app_public.group_metric_set_scores add column source_mode_generation bigint not null default 0 check(source_mode_generation>=0);
alter table app_public.group_metric_certifications add column source_mode_generation bigint not null default 0 check(source_mode_generation>=0);
alter table app_public.group_certifications add column source_mode_generation bigint not null default 0 check(source_mode_generation>=0);
alter table app_public.group_certifications add column source_exercise_definition_id text;

create function app_public.group_source_mode_generation(p_member uuid,p_definition text)
returns bigint language sql stable set search_path=app_public,pg_temp as $$
  select coalesce((select generation from app_public.group_source_mode_generations
    where member_user_id=p_member and exercise_definition_id=p_definition),0);
$$;
create function app_public.group_metric_certification_mode_matches(p_row app_public.group_metric_certifications)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select p_row.source_mode_generation=app_public.group_source_mode_generation(
    p_row.member_user_id,p_row.performance->>'exercise_definition_id');
$$;
create function app_public.group_legacy_certification_definition(p_row app_public.group_certifications)
returns text language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(p_row.source_exercise_definition_id,
    (select se.exercise_definition_id from app_public.exercise_sets es
      join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
      where es.owner_user_id=p_row.member_user_id and es.id=p_row.set_id),
    (select s.exercise_definition_id from app_public.group_metric_set_scores s
      where s.group_exercise_id=p_row.group_exercise_id and s.member_user_id=p_row.member_user_id
        and s.set_id=p_row.set_id order by s.rules_revision limit 1));
$$;
create function app_public.group_legacy_certification_mode_matches(p_row app_public.group_certifications)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select p_row.source_mode_generation=app_public.group_source_mode_generation(p_row.member_user_id,
    app_public.group_legacy_certification_definition(p_row));
$$;
revoke all on function app_public.group_source_mode_generation(uuid,text),
  app_public.group_metric_certification_mode_matches(app_public.group_metric_certifications),
  app_public.group_legacy_certification_definition(app_public.group_certifications),
  app_public.group_legacy_certification_mode_matches(app_public.group_certifications)
  from public,anon,authenticated,service_role;

-- Bind legacy roots separately from their immutable observed raw audit.
update app_public.group_certifications c set source_exercise_definition_id=app_public.group_legacy_certification_definition(c)
  where c.source_exercise_definition_id is null;

-- Keep marker persistence, eager termination and the existing enqueue isolated:
-- either successful invalidation mechanism survives a failure of the other.
do $patch$
declare definition text; anchor text:=E'begin\n  begin\n';
begin
  definition:=pg_get_functiondef('app_public.group_eval_on_exercise_definition()'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'source mode certification: trigger anchor changed';
  end if;
  execute replace(definition,anchor,$new$begin
  begin
    update app_public.group_certifications c set source_exercise_definition_id=new.id
      where c.member_user_id=new.owner_user_id and c.source_exercise_definition_id is null
        and app_public.group_legacy_certification_definition(c)=new.id;
    insert into app_public.group_source_mode_generations as g(member_user_id,exercise_definition_id,generation,changed_at)
    values(new.owner_user_id,new.id,1,clock_timestamp())
    on conflict(member_user_id,exercise_definition_id) do update
      set generation=g.generation+1,changed_at=excluded.changed_at;
  exception when others then
    get stacked diagnostics _sqlstate=returned_sqlstate;
    perform app_public.group_eval_log_failure('group.source_mode_invalidation_failed',new.owner_user_id,
      jsonb_build_object('table','exercise_definitions','row_id',new.id,'sqlstate',_sqlstate));
  end;
  begin
    update app_public.group_metric_certifications c set ended_at=greatest(clock_timestamp(),c.certified_at),end_reason='voided'
      where c.member_user_id=new.owner_user_id and c.ended_at is null
        and c.performance->>'exercise_definition_id'=new.id;
    -- Some inactive legacy roots have never acquired metric projections.
    update app_public.group_certifications c set ended_at=greatest(clock_timestamp(),c.certified_at),end_reason='voided'
      where c.member_user_id=new.owner_user_id and c.ended_at is null
        and app_public.group_legacy_certification_definition(c)=new.id;
    -- Rotate disposable tokens even if the independent generation write failed.
    update app_public.group_metric_set_scores set write_token=gen_random_uuid()
      where member_user_id=new.owner_user_id and exercise_definition_id=new.id;
  exception when others then
    get stacked diagnostics _sqlstate=returned_sqlstate;
    perform app_public.group_eval_log_failure('group.source_mode_invalidation_failed',new.owner_user_id,
      jsonb_build_object('table','exercise_definitions','row_id',new.id,'sqlstate',_sqlstate));
  end;
  begin
$new$);
end
$patch$;

-- Exact-anchor patches retain authorization, publication and original audits.
do $patch$
declare patch record; definition text; definitions jsonb:='{}';
begin
  for patch in select * from(values
    ('app_public.group_metric_eval_source_graph(uuid,uuid)',
      $old$_graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets,$old$,
      $new$select coalesce(jsonb_agg(r||jsonb_build_object('source_mode_generation',
      app_public.group_source_mode_generation((r->>'member_user_id')::uuid,r->>'exercise_definition_id'))
      order by r->>'member_user_id',r->>'set_id'),'[]'::jsonb) into _sets
      from jsonb_array_elements(_sets) r;
  _graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets,$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$  for _member in select m from jsonb_array_elements(_graph->'members') m$old$,
      $new$  -- Bind the trusted graph, not a generation supplied by the worker.
  update app_public.group_metric_set_scores s set source_mode_generation=(r->>'source_mode_generation')::bigint
    from jsonb_array_elements(_graph->'sets') r
    where s.group_exercise_id=_exercise.id and s.rules_revision=_revision
      and s.member_user_id::text=r->>'member_user_id' and s.set_id=r->>'set_id';
  for _member in select m from jsonb_array_elements(_graph->'members') m$new$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',
      $old$  select r into _source from jsonb_array_elements($old$,
      $new$  -- A mode writer waits until the witness commits, then sees and ends it.
  perform 1 from app_public.exercise_definitions ed
    join app_public.session_exercises se on se.owner_user_id=ed.owner_user_id and se.exercise_definition_id=ed.id
    join app_public.exercise_sets es on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
    where es.owner_user_id=p_member_user_id and es.id=p_set_id for share of ed;
  select r into _source from jsonb_array_elements($new$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',
      $old$  if _source is null or not (_source ->> 'live')::boolean or exists($old$,
      $new$  if _source is null or not (_source ->> 'live')::boolean
    or _score.source_mode_generation is distinct from (_source->>'source_mode_generation')::bigint or exists($new$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',
      $old$and (c.observed_set_pin is distinct from _source->>'observed_set_pin'$old$,
      $new$and (not app_public.group_metric_certification_mode_matches(c)
            or c.observed_set_pin is distinct from _source->>'observed_set_pin'$new$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',
      $old$observed_set_pin,reading_pin,current_fingerprint)$old$,
      $new$observed_set_pin,reading_pin,current_fingerprint,source_mode_generation)$new$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',
      $old$_source->>'observed_set_pin',_source->>'reading_pin',_score.fingerprint)$old$,
      $new$_source->>'observed_set_pin',_source->>'reading_pin',_score.fingerprint,
      (_source->>'source_mode_generation')::bigint)$new$),
    ('app_public.group_competition_complete_witness(app_public.group_metric_certifications)',
      $old$observed_set_pin,reading_pin,legacy_certification_id,witness_certification_id)$old$,
      $new$observed_set_pin,reading_pin,legacy_certification_id,witness_certification_id,source_mode_generation)$new$),
    ('app_public.group_competition_complete_witness(app_public.group_metric_certifications)',
      $old$p_origin.legacy_certification_id,p_origin.id$old$,
      $new$p_origin.legacy_certification_id,p_origin.id,p_origin.source_mode_generation$new$),
    ('app_public.group_competition_import_witnesses(uuid,uuid,uuid,jsonb)',
      $old$observed_set_pin,legacy_certification_id,witness_certification_id)$old$,
      $new$observed_set_pin,legacy_certification_id,witness_certification_id,source_mode_generation)$new$),
    ('app_public.group_competition_import_witnesses(uuid,uuid,uuid,jsonb)',
      $old$c.observed_set_pin,c.legacy_certification_id,c.id$old$,
      $new$c.observed_set_pin,c.legacy_certification_id,c.id,c.source_mode_generation$new$),
    ('app_public.group_competition_import_witnesses(uuid,uuid,uuid,jsonb)',
      $old$and c.metric='weight' and c.ended_at is null$old$,
      $new$and c.metric='weight' and c.ended_at is null and app_public.group_metric_certification_mode_matches(c)$new$),
    ('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$  -- Do not strand a pending deletion/edit outside the new engine:$old$,
      $new$  update app_public.group_certifications c set ended_at=greatest(clock_timestamp(),c.certified_at),end_reason='voided'
    where c.group_exercise_id=p_exercise.id and c.ended_at is null
      and not app_public.group_legacy_certification_mode_matches(c);
  -- Do not strand a pending deletion/edit outside the new engine:$new$),
    ('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$certified_by,certified_at,observed_set_pin,legacy_certification_id)$old$,
      $new$certified_by,certified_at,observed_set_pin,legacy_certification_id,source_mode_generation)$new$),
    ('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$app_public.group_metric_observed_set_pin(c.member_user_id,p.snapshot,es.set_type),c.id$old$,
      $new$app_public.group_metric_observed_set_pin(c.member_user_id,p.snapshot,es.set_type),c.id,c.source_mode_generation$new$),
    ('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$where c.group_exercise_id=p_exercise.id and c.ended_at is null and s.id=c.session_id$old$,
      $new$where c.group_exercise_id=p_exercise.id and c.ended_at is null
    and app_public.group_legacy_certification_mode_matches(c) and s.id=c.session_id$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$and (r ->> 'live')::boolean and r ->> 'observed_set_pin' = c.observed_set_pin$old$,
      $new$and (r ->> 'live')::boolean and r ->> 'observed_set_pin' = c.observed_set_pin
          and app_public.group_metric_certification_mode_matches(c)$new$),
    ('app_public.group_metric_certification_matching(uuid,uuid,text,text,text)',
      $old$c.ended_at is null$old$,
      $new$c.ended_at is null and app_public.group_metric_certification_mode_matches(c)$new$),
    ('app_public.group_metric_compute(uuid,bigint,uuid,uuid[])',
      $old$c.current_fingerprint = s.fingerprint and c.ended_at is null$old$,
      $new$c.current_fingerprint = s.fingerprint and c.ended_at is null
      and app_public.group_metric_certification_mode_matches(c)$new$),
    ('app_public.group_metric_certified_leader(uuid,bigint,text,uuid)',
      $old$c.ended_at is null and c.current_fingerprint = e.fingerprint$old$,
      $new$c.ended_at is null and app_public.group_metric_certification_mode_matches(c)
        and c.current_fingerprint = e.fingerprint$new$),
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',
      $old$and c.ended_at is null and (c.current_fingerprint=e.fingerprint or c.id=e.certification_id)$old$,
      $new$and c.ended_at is null and app_public.group_metric_certification_mode_matches(c)
      and (c.current_fingerprint=e.fingerprint or c.id=e.certification_id)$new$)
  ) p(fn,anchor,replacement)
  loop
    definition:=coalesce(definitions->>patch.fn,pg_get_functiondef(patch.fn::regprocedure));
    if (length(definition)-length(replace(definition,patch.anchor,'')))<>length(patch.anchor) then
      raise exception 'source mode certification: anchor changed in %',patch.fn;
    end if;
    definitions:=jsonb_set(definitions,array[patch.fn],to_jsonb(replace(definition,patch.anchor,patch.replacement)));
  end loop;
  for definition in select value from jsonb_each_text(definitions) loop execute definition; end loop;
end
$patch$;

-- Pending eager termination is already terminal to public readers.
do $patch$
declare patch record; definition text;
begin
  for patch in select * from(values
    ('app_public.group_competition_certification_json(app_public.group_metric_certifications)',
      'app_public.group_metric_certification_mode_matches(p_row)',
      $lookup$(select changed_at from app_public.group_source_mode_generations
        where member_user_id=p_row.member_user_id and exercise_definition_id=p_row.performance->>'exercise_definition_id')$lookup$),
    ('app_public.group_competition_legacy_certification_json(app_public.group_certifications,text)',
      'app_public.group_legacy_certification_mode_matches(p_row)',
      $lookup$(select changed_at from app_public.group_source_mode_generations
        where member_user_id=p_row.member_user_id
          and exercise_definition_id=app_public.group_legacy_certification_definition(p_row))$lookup$)
  ) p(fn,matches,changed_at)
  loop
    definition:=pg_get_functiondef(patch.fn::regprocedure);
    if strpos(definition,'extract(epoch from p_row.ended_at)')=0 or strpos(definition,'''end_reason'',p_row.end_reason')=0 then
      raise exception 'source mode certification: public terminal anchor changed in %',patch.fn;
    end if;
    definition:=replace(definition,'extract(epoch from p_row.ended_at)',
      'extract(epoch from coalesce(p_row.ended_at,case when not '||patch.matches||
      ' then greatest(p_row.certified_at,'||patch.changed_at||') end))');
    definition:=replace(definition,'when p_row.ended_at is not null then',
      'when p_row.ended_at is not null or not '||patch.matches||' then');
    execute replace(definition,'''end_reason'',p_row.end_reason',
      '''end_reason'',coalesce(p_row.end_reason,case when not '||patch.matches||' then ''voided'' end)');
  end loop;
end
$patch$;

-- A delayed correction takes precedence over a subsequent manual action.
do $patch$
declare definition text; anchor text:=E'  if _legacy.id is not null then\n';
begin
  definition:=pg_get_functiondef('app_public.group_competition_certification_end(uuid,uuid,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'source mode certification: manual legacy end anchor changed';
  end if;
  definition:=replace(definition,anchor,$new$  if _legacy.id is not null then
    if _legacy.ended_at is null and not app_public.group_legacy_certification_mode_matches(_legacy) then
      update app_public.group_certifications set ended_at=greatest(clock_timestamp(),certified_at),end_reason='voided'
        where id=_legacy.id returning * into _legacy;
    end if;
$new$);
  anchor:=E'    if _origin.ended_at is null then\n';
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'source mode certification: manual metric end anchor changed';
  end if;
  execute replace(definition,anchor,$new$    if _origin.ended_at is null and not app_public.group_metric_certification_mode_matches(_origin) then
      update app_public.group_metric_certifications set ended_at=greatest(clock_timestamp(),certified_at),end_reason='voided'
        where id=_origin.id returning * into _origin;
    end if;
    if _origin.ended_at is null then
$new$);
end
$patch$;
