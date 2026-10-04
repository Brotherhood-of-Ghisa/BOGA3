-- A zero-contribution comparison has never used bodyweight calculations.
-- Canonicalize that effective rule in current and retired metadata, without
-- altering revision identities, publication clocks, events or certificates.
update app_public.group_rule_revisions
set rules=jsonb_set(rules,'{bodyweight_calculations_enabled}','false'::jsonb)
where (rules->>'bodyweight_contribution')::double precision=0
  and rules->'bodyweight_calculations_enabled' is distinct from 'false'::jsonb;

-- Live rule JSON describes this comparison's effective calculation. The group
-- summary separately carries the owner's global preference for editing.
create or replace function app_public.group_exercise_rules_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'name',p_row.name,
    'load_input_mode',p_row.load_input_mode,
    'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled and p_row.bodyweight_contribution>0,
    'bodyweight_contribution',p_row.bodyweight_contribution,
    'default_metric',case when p_row.default_metric in ('weight','e1rm')
      then p_row.default_metric else 'e1rm' end,
    'rules_revision',p_row.rules_revision)
  from app_public.groups g where g.id=p_row.group_id;
$$;

create or replace function app_public.group_update(
  p_group_id uuid,p_name text,p_description text,p_bodyweight_calculations_enabled boolean
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _role text:=app_public.group_require_member(p_group_id,_uid,true);
  _name text;
  _description text;
  _prior boolean;
  _exercise app_public.group_exercises;
  _affected boolean:=false;
begin
  if _role not in ('owner','admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can edit the group' using errcode='P0001';
  end if;
  if p_bodyweight_calculations_enabled is null then
    raise exception 'VALIDATION: bodyweight calculations state is required' using errcode='P0001';
  end if;
  _name:=app_public.group_validate_name(p_name);
  _description:=app_public.group_validate_description(p_description);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _prior
    from app_public.groups where id=p_group_id for update;
  update app_public.groups set name=_name,description=_description,
    bodyweight_calculations_enabled=p_bodyweight_calculations_enabled,updated_at=now()
    where id=p_group_id;
  if _prior is distinct from p_bodyweight_calculations_enabled then
    for _exercise in select * from app_public.group_exercises
      where group_id=p_group_id and archived_at is null and bodyweight_contribution>0 for update
    loop
      _affected:=true;
      perform app_public.group_retire_current_revision(_exercise);
      update app_public.group_exercises set rules_revision=rules_revision+1,
        published_rules_revision=null,updated_at=now()
        where id=_exercise.id returning * into _exercise;
      insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,
        reason,legacy,created_by)
      values(p_group_id,_exercise.id,_exercise.rules_revision,
        app_public.group_exercise_rules_json(_exercise),'rules_change',false,_uid);
      perform app_public.group_metric_eval_enqueue(p_group_id,_exercise.id,'rules');
    end loop;
    if _affected then perform app_public.group_eval_kick_once(_uid); end if;
  end if;
  return jsonb_build_object('group',app_public.group_summary_json(p_group_id,_role));
end;
$$;

-- Historical event audit stays immutable. Public rules-change metadata reports
-- the same effective zero rule as its revision and exercise readers.
create or replace function app_public.group_metric_event_json(p_row app_public.group_events)
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
      'related_event_id',p_row.related_event_id,'certification_id',coalesce(to_jsonb((select c.legacy_certification_id
        from app_public.group_metric_certifications c
        where c.id=app_public.group_eval_try_uuid(p_row.payload->>'certification_id'))),
        p_row.payload->'certification_id'),
      'leader',app_public.group_metric_public_holder(p_row.payload -> 'leader',p_row.group_id),
      'previous',app_public.group_metric_public_holder(p_row.payload -> 'previous',p_row.group_id))
    when 'rules_change' then case when (p_row.payload->'rules'->>'bodyweight_contribution')::double precision=0
      then jsonb_set(p_row.payload,'{rules,bodyweight_calculations_enabled}','false'::jsonb)
      else p_row.payload end
    else p_row.payload end;
$$;

-- CREATE OR REPLACE retains the existing private-helper and RPC grants.
notify pgrst, 'reload schema';
