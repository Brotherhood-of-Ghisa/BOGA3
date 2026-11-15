-- Group stream: a keyset base page whose items are built once, from one
-- redaction cache per page; and the CoW result reader's rows built once.
--
-- Cost before (read-path fixture, M=5, H=180, one call): stream_v5 232k
-- pages, of which the finished CoW's results item 160k (its ranking rows
-- built twice per metric, redaction asked per member x source ref), the
-- session cards 82k (redaction asked per card exercise, each answer reading
-- the member's bodyweight scores and sets), and the v3-v5 wrappers each
-- rebuilt the page's record items from JSON.
--
-- Now:
-- - One redaction cache per page (group_competition_redaction_cache): for each
--   member on the page, one pass over what the bodyweight redaction reads
--   (links, counting scores, certifications, legacy entries, events and the
--   CoW refs, with each set's current definition), answering every
--   definition from memory (group_competition_redaction_lookup). A lookup it
--   does not cover (another group, a member not in it, no cache) asks the
--   live function. The readers' `p_redactions` overloads take it, or the
--   records history's map of a few pairs each asked live: one lookup reads
--   both.
-- - The base page takes at most limit+1 candidates per kind, by keyset on the
--   group's events, merges them in stream order and builds only the items it
--   returns, all in one statement: candidates, cache and items see one
--   snapshot. Sessions page by their stream event's sort_at_ms, which the
--   session trigger keeps equal to the session's started_at on every
--   accepted write; positions are still the live started_at. Records sort at
--   their session's live start, which their event does not track, so a
--   group's records are ranked whole (the record-only index).
-- - v2-v5 build each item once at their own level (v2/v3 add `record`, v4
--   `group_record_metrics`, v5 `withdrawn`), instead of re-reading items by
--   `e.id::text`; an event's disclosure is decided by one function
--   (group_competition_event_normalized), so a record's `record` no longer
--   builds its event JSON again.
-- - group_cow_public_result builds each metric's rows once and asks
--   redaction through one cache for the CoW's participants.
--
-- Every reader returns the same JSON as before; the read-path parity cases
-- compare old and new for every fixture viewer, walking every stream page,
-- and each builder with a cache against itself without one.

-- ---------------------------------------------------------------------------
-- Redaction cache
-- ---------------------------------------------------------------------------

-- What group_competition_redacts_exercise(array[p_group], m, d) reads, for
-- every member m of p_members at once:
--   {"group": p_group, "bw": <the group has a bodyweight-aware exercise and
--    bodyweight calculations on>, "members": {"<m>": {"hits": [d, ...],
--    "cow_all": <a retained CoW ref with an unknown definition>, "cow": [d, ...]}}}
-- `hits` are the definitions the bodyweight branch matches (a link, a score's
-- or certification's performance or the set's current definition, a legacy
-- entry, an event); `cow` those the CoW disclosure matches (a ref's
-- definition or its set's current one).
create function app_public.group_competition_redaction_cache(p_group uuid,p_members uuid[])
returns jsonb language plpgsql stable set search_path=app_public,pg_temp as $$
declare result jsonb;
begin
  -- The live CoW branch rejects agents; so does every cached answer.
  perform app_public.group_cow_reject_agent();
  with bw as materialized (
    select ge.id from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
     where ge.group_id=p_group and g.deleted_at is null and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0
  ), members as materialized (
    select distinct m as member_user_id from unnest(p_members) m where m is not null and exists(select 1 from bw)
  ), refs as materialized (
    -- Every set id a branch checks the current definition of, with the
    -- definitions the branch matches directly.
    select s.member_user_id,s.set_id,s.performance->>'exercise_definition_id' as definition_id,'hit'::text as branch
      from app_public.group_metric_set_scores s join bw on bw.id=s.group_exercise_id
      join members m on m.member_user_id=s.member_user_id where s.counting
    union all
    select c.member_user_id,c.set_id,c.performance->>'exercise_definition_id','hit'
      from app_public.group_metric_certifications c join bw on bw.id=c.group_exercise_id
      join members m on m.member_user_id=c.member_user_id
    union all
    select m.member_user_id,b->>'set_id',b->>'exercise_definition_id','hit'
      from app_public.group_rule_revisions r join bw on bw.id=r.group_exercise_id
      cross join lateral jsonb_array_elements(r.legacy_entries) b
      join members m on b->>'member_user_id'=m.member_user_id::text
    union all
    select e.member_user_id,e.set_id,d.definition_id,'hit'
      from app_public.group_events e join bw on bw.id=e.group_exercise_id
      join members m on m.member_user_id=e.member_user_id
      cross join lateral (
        select e.payload->'performance'->>'exercise_definition_id'
        union all select e.payload->>'exercise_definition_id'
        -- `payload->'exercise_definition_ids' ? d`: a string element, a key, or the string itself.
        union all select v#>>'{}' from jsonb_array_elements(case when jsonb_typeof(e.payload->'exercise_definition_ids')='array'
            then e.payload->'exercise_definition_ids' end) v where jsonb_typeof(v)='string'
        union all select k from jsonb_object_keys(case when jsonb_typeof(e.payload->'exercise_definition_ids')='object'
            then e.payload->'exercise_definition_ids' end) k
        union all select e.payload->'exercise_definition_ids'#>>'{}' where jsonb_typeof(e.payload->'exercise_definition_ids')='string'
      ) d(definition_id)
    union all
    select r.member_user_id,r.set_id,r.definition_id,'cow'
      from app_public.group_cow_source_refs r join app_public.group_cows c on c.id=r.cow_id
      join bw on bw.id=c.group_exercise_id join members m on m.member_user_id=r.member_user_id
     where c.group_id=p_group
  ), member_sets as materialized (
    -- The current definition of each set a branch names. Each member's sets
    -- and exercises are read once by owner and joined in memory: one probe
    -- per named set would read three pages each.
    select es.owner_user_id as member_user_id,es.id as set_id,es.session_exercise_id
      from members m join app_public.exercise_sets es on es.owner_user_id=m.member_user_id
     where exists(select 1 from refs)
  ), member_exercises as materialized (
    select se.owner_user_id as member_user_id,se.id,se.exercise_definition_id
      from members m join app_public.session_exercises se on se.owner_user_id=m.member_user_id
     where exists(select 1 from refs)
  ), sets as materialized (
    select s.member_user_id,s.set_id,x.exercise_definition_id
      from (select distinct r.member_user_id,r.set_id from refs r) r
      join member_sets s on s.member_user_id=r.member_user_id and s.set_id=r.set_id
      join member_exercises x on x.member_user_id=s.member_user_id and x.id=s.session_exercise_id
  ), links as (
    select l.owner_user_id as member_user_id,l.exercise_definition_id as definition_id
      from members m join app_public.exercise_group_links l on l.owner_user_id=m.member_user_id
      join bw on bw.id=app_public.group_eval_try_uuid(l.group_exercise_id)
     where app_public.group_eval_try_uuid(l.group_id)=p_group
  ), matched as (
    select member_user_id,definition_id,'hit'::text as branch from links
    union select r.member_user_id,r.definition_id,r.branch from refs r where r.definition_id is not null
    union select r.member_user_id,s.exercise_definition_id,r.branch from refs r
      join sets s on s.member_user_id=r.member_user_id and s.set_id=r.set_id where s.exercise_definition_id is not null
  )
  select jsonb_build_object('group',p_group,'bw',exists(select 1 from bw),'members',coalesce((
    select jsonb_object_agg(m.member_user_id::text,jsonb_build_object(
      'hits',coalesce((select jsonb_agg(x.definition_id) from matched x where x.member_user_id=m.member_user_id and x.branch='hit'),'[]'),
      'cow',coalesce((select jsonb_agg(x.definition_id) from matched x where x.member_user_id=m.member_user_id and x.branch='cow'),'[]'),
      'cow_all',exists(select 1 from refs r where r.member_user_id=m.member_user_id and r.branch='cow' and r.definition_id='')))
    from members m),'{}'))
  into result;
  -- With no bodyweight-aware exercise nothing redacts: every member answers false.
  if not (result->>'bw')::boolean then
    result:=jsonb_set(result,'{members}',coalesce((select jsonb_object_agg(m::text,'{"hits":[],"cow":[],"cow_all":false}'::jsonb)
      from (select distinct m from unnest(p_members) m where m is not null) x(m)),'{}'));
  end if;
  return result;
end $$;

-- group_competition_redacts_exercise(p_groups, p_member, p_definition), from
-- a reader's `p_redactions` when it answers the call, else live. Two forms:
-- the per-member cache above (a reader that asks about many definitions),
-- or a map of answered pairs keyed by group_competition_redaction_key (a
-- reader that asks about a few, each asked live once).
create function app_public.group_competition_redaction_lookup(p_cache jsonb,p_groups uuid[],p_member uuid,p_definition text)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select case
    when p_cache is null then app_public.group_competition_redacts_exercise(p_groups,p_member,p_definition)
    when not p_cache ? 'members' then coalesce(
      (p_cache->>app_public.group_competition_redaction_key(p_member,p_definition))::boolean,
      app_public.group_competition_redacts_exercise(p_groups,p_member,p_definition))
    when p_member is not null and cardinality(p_groups)=1
      and p_groups[1]=(p_cache->>'group')::uuid and p_cache->'members' ? p_member::text then
      (p_cache->>'bw')::boolean and (p_definition is null
        or (p_cache->'members'->p_member::text->>'cow_all')::boolean
        or p_cache->'members'->p_member::text->'cow' ? p_definition
        or p_cache->'members'->p_member::text->'hits' ? p_definition)
    else app_public.group_competition_redacts_exercise(p_groups,p_member,p_definition) end;
$$;

revoke all on function app_public.group_competition_redaction_cache(uuid,uuid[]),
  app_public.group_competition_redaction_lookup(jsonb,uuid[],uuid,text) from public,anon,authenticated,service_role;


-- ---------------------------------------------------------------------------
-- Readers' item builders: disclosure in one place, a cache per call
-- ---------------------------------------------------------------------------

-- An event's disclosure: whether event_json shows it `normalized` (null: the
-- event names no group exercise, and event_json is null). The one place it
-- is decided; event_json and stream_record read it.
create function app_public.group_competition_event_normalized(p_event app_public.group_events,p_redactions jsonb)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  with holders as (
    select h from jsonb_array_elements(jsonb_build_array(p_event.payload->'leader',p_event.payload->'previous')) h
      where jsonb_typeof(h)='object'
    union all select x->'leader' from jsonb_array_elements(coalesce(p_event.payload->'leaders','[]')) x
      where jsonb_typeof(x->'leader')='object'
  ), holder_identities as (
    select app_public.group_eval_try_uuid(h->>'member_user_id') as member,
      h->'performance'->>'exercise_definition_id' as definition
      from holders
  ), identities as (
    select p_event.member_user_id as member,coalesce(p_event.payload->'performance'->>'exercise_definition_id',p_event.payload->>'exercise_definition_id') as definition
    union all select member,definition from holder_identities
    union all select p_event.member_user_id,d from jsonb_array_elements_text(coalesce(p_event.payload->'exercise_definition_ids','[]')) d
  )
  select g.bodyweight_calculations_enabled and (ge.bodyweight_contribution>0
      or exists(select 1 from identities i
        where app_public.group_competition_redaction_lookup(p_redactions,array[p_event.group_id],i.member,i.definition))
      -- Unknown historical source identities cannot exempt an absolute holder
      -- from the enabled group's privacy boundary.
      or (exists(select 1 from app_public.group_exercises x where x.group_id=g.id and x.bodyweight_contribution>0) and (
        exists(select 1 from holder_identities i where i.member is null or i.definition is null)
        or (p_event.kind='record' and not exists(select 1 from identities i where i.member=p_event.member_user_id and i.definition is not null))
        or p_event.kind in ('link','unlink'))))
    from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
   where g.id=p_event.group_id and ge.id=p_event.group_exercise_id;
$$;
revoke all on function app_public.group_competition_event_normalized(app_public.group_events,jsonb) from public,anon,authenticated,service_role;

create or replace FUNCTION app_public.group_competition_event_json(p_event app_public.group_events, p_redactions jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with disclosure as (select app_public.group_competition_event_normalized(p_event,p_redactions) as normalized,
    ge.name,r.representation_version from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
    left join app_public.group_rule_revisions r on r.group_exercise_id=ge.id and r.revision=coalesce(p_event.rules_revision,1)
    where g.id=p_event.group_id and ge.id=p_event.group_exercise_id), values_to_project as (
    select b as v,'record'::text as role,b->>'metric' as metric from jsonb_array_elements(coalesce(p_event.payload->'boards','[]')) b
    union all select p_event.payload->'leader','leader',p_event.metric where p_event.kind='lead_change'
    union all select p_event.payload->'previous','previous',p_event.metric where p_event.kind='lead_change'
    union all select b->'before','before',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'effects','[]')) b
    union all select b->'after','after',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'effects','[]')) b
    union all select b->'leader','leader',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'leaders','[]')) b
  ) select jsonb_build_object('event_id',p_event.id,'sequence',p_event.seq,'kind',p_event.kind,
    'group',jsonb_build_object('group_id',p_event.group_id,'name',(select name from app_public.groups where id=p_event.group_id)),
    'group_exercise',jsonb_build_object('group_exercise_id',p_event.group_exercise_id,'name',d.name),
    'rules_revision',coalesce(p_event.rules_revision,1),'representation_version',case when p_event.contract_version=1 then 1 else d.representation_version end,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'sort_at_ms',p_event.sort_at_ms,'member',case when p_event.member_user_id is not null then app_public.group_member_ref_json(p_event.member_user_id) end,
    'metric',p_event.metric,'certified',p_event.certified,'reason',p_event.reason,'related_event_id',p_event.related_event_id,
    'session_id',p_event.session_id,'set_id',p_event.set_id,
    'reps',coalesce(p_event.payload->'performance'->'reps',p_event.payload->'reps'),
    'provisional',exists(select 1 from app_public.sessions s where s.owner_user_id=p_event.member_user_id and s.id=p_event.session_id and s.status='active'),
    'voided',exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=p_event.id),
    'values',coalesce((select jsonb_agg(app_public.group_competition_history_display(v,d.normalized,role,metric,p_event) order by role,metric)
      filter(where jsonb_typeof(v)='object') from values_to_project),'[]'::jsonb),
    'record_context',case when p_event.kind='record' then app_public.group_competition_record_context(p_event) end)
  from disclosure d;
$function$;

create or replace FUNCTION app_public.group_competition_stream_record(p_event app_public.group_events, p_redactions jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with v as (select app_public.group_competition_event_normalized(p_event,p_redactions) as normalized),
  perf as (select p_event.payload->'performance' as p),
  boards as (select b from jsonb_array_elements(coalesce(p_event.payload->'boards','[]'::jsonb)) b
    where jsonb_typeof(b)='object' and b->>'metric' in ('volume','e1rm')),
  previous as (
    select b->>'metric' as metric,l.payload->'previous' as holder,
      v.normalized or app_public.group_competition_event_normalized(l,p_redactions) as normalized
    from boards,v
    cross join lateral (select l.* from app_public.group_events l
      where l.kind='lead_change' and not l.certified and l.related_event_id=p_event.id and l.metric=boards.b->>'metric'
      order by l.seq desc limit 1) l
    union all
    -- No lead change: the lifter was already #1 and beat their own best.
    select b->>'metric',jsonb_build_object('member_user_id',p_event.member_user_id,'metric',b->>'metric',
        'unit',b->'unit','value',b->'previous_value'),v.normalized
    from boards,v
    where coalesce((b->>'group_record')::boolean,false) and jsonb_typeof(b->'previous_value')='number'
      and not exists(select 1 from app_public.group_events l
        where l.kind='lead_change' and not l.certified and l.related_event_id=p_event.id and l.metric=b->>'metric')
  )
  select jsonb_build_object(
    'performance',case when jsonb_typeof(perf.p)='object' and perf.p ?& array['session_id','session_exercise_id',
        'exercise_definition_id','set_id','reps','source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index']
      and (v.normalized or jsonb_typeof(perf.p->'weight_value')='string')
      then app_public.group_competition_display_performance(perf.p,v.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,p_event.member_user_id) end,
    'previous',coalesce((select jsonb_agg(jsonb_build_object(
        'value',app_public.group_competition_history_display(p.holder,p.normalized,'previous',p.metric,p_event),
        'performance',case when jsonb_typeof(p.holder->'performance')='object'
          and (p.normalized or jsonb_typeof(p.holder->'performance'->'weight_value')='string')
          and p.holder->'performance' ?& array['session_id','session_exercise_id','exercise_definition_id','set_id','reps',
            'source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index']
          then app_public.group_competition_display_performance(p.holder->'performance',p.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,(p.holder->>'member_user_id')::uuid) end)
      order by case p.metric when 'e1rm' then 0 else 1 end)
      from previous p where jsonb_typeof(p.holder)='object'
        and app_public.group_competition_history_display(p.holder,p.normalized,'previous',p.metric,p_event) is not null),'[]'::jsonb))
  from v,perf;
$function$;

create function app_public.group_competition_stream_withdrawn(p_event app_public.group_events,p_redactions jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('event',app_public.group_competition_event_json(r,p_redactions),
    'record',app_public.group_competition_stream_record(r,p_redactions)
      ||jsonb_build_object('group_record_metrics',app_public.group_competition_stream_group_record_metrics(r)))
  from app_public.group_events r
  where r.id=p_event.related_event_id and r.kind='record' and r.group_id=p_event.group_id
    and r.group_exercise_id=p_event.group_exercise_id and r.member_user_id=p_event.member_user_id;
$$;

create or replace function app_public.group_competition_stream_withdrawn(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select app_public.group_competition_stream_withdrawn(p_event,null::jsonb);
$$;

create function app_public.group_competition_session_exercises(p_groups uuid[], p_member uuid, p_session text, p_redactions jsonb)
returns jsonb
language sql
stable
set search_path to 'app_public', 'pg_temp'
as $function$
  -- The redaction answer is asked once per distinct definition the session
  -- logged, not once per exercise block; one statement sees one snapshot.
  with blocks as (
    select se.*, ed.id as ed_id, ed.load_input_mode as ed_load_input_mode,
      case when ed.id is not null then se.exercise_definition_id end as redaction_definition
    from app_public.session_exercises se
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null
  ), redaction as materialized (
    select x.definition, app_public.group_competition_redaction_lookup(p_redactions,p_groups,p_member,x.definition) as normalized
    from (select distinct b.redaction_definition as definition from blocks b) x
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',se.ed_load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status)
      ||case when not d.normalized then jsonb_build_object('weight_value',es.weight_value)
        when app_public.group_competition_set_display_enabled() then
          jsonb_build_object('normalized_metrics',app_public.group_competition_set_display(p_groups,p_member,es.id))
        else '{}'::jsonb end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from blocks se
  join redaction d on d.definition is not distinct from se.redaction_definition;
$function$;

create function app_public.group_competition_session_json(p_groups uuid[],p_member uuid,p_session text,p_redactions jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('member',app_public.group_member_ref_json(p_member),'session_id',s.id,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member and g.id=s.gym_id and g.deleted_at is null),
    'status',s.status,'started_at_ms',s.started_at,'completed_at_ms',s.completed_at,'duration_sec',s.duration_sec,
    'exercises',app_public.group_competition_session_exercises(p_groups,p_member,p_session,p_redactions))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$$;

create function app_public.group_competition_session_card(p_member uuid,p_session text,p_groups jsonb,p_redactions jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('kind','session','key',p_member::text||':'||p_session,'sort_at_ms',s.started_at,
    'groups',p_groups,'session',app_public.group_competition_session_json(
      array(select (g->>'group_id')::uuid from jsonb_array_elements(p_groups) g),p_member,p_session,p_redactions))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- CoW result: rows once per metric, redaction from one cache
-- ---------------------------------------------------------------------------

create function app_public.group_cow_result_rows(p_cow app_public.group_cows,p_metric text,p_redactions jsonb)
returns table(ordinal integer,member_id uuid,row_json jsonb)
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  if app_public.group_cow_public_state(p_cow)<>'ready' then return; end if;
  return query with ranking as (
    select r from jsonb_array_elements(case when p_cow.finalized_at is not null then p_cow.final_rankings
      else p_cow.live_rankings->'rankings' end) r where r->>'metric'=p_metric
  ), members as (
    select p.member_user_id,e.entry,r.r->'unavailableMemberIds' ? p.member_user_id::text as arithmetic_unavailable
      from app_public.group_cow_participants p cross join ranking r left join lateral (
        select v as entry from jsonb_array_elements(r.r->'entries') v where v->>'memberId'=p.member_user_id::text
      ) e on true where p.cow_id=p_cow.id
  ), disclosure as (
    select m.*,not (p_cow.start_context->>'normalized')::boolean and exists(
      select 1 from app_public.group_cow_source_refs refs where refs.cow_id=p_cow.id
        and refs.member_user_id=m.member_user_id and refs.metric=p_metric and
        (app_public.group_competition_redaction_lookup(p_redactions,array[p_cow.group_id],m.member_user_id,nullif(refs.definition_id,''))
          or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
            on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
            where es.owner_user_id=m.member_user_id and es.id=refs.set_id
              and app_public.group_competition_redaction_lookup(p_redactions,array[p_cow.group_id],m.member_user_id,se.exercise_definition_id)))) as suppressed
      from members m
  ) select (m.entry->>'rank')::integer,m.member_user_id,jsonb_build_object('rank',(m.entry->>'rank')::integer,
      'member',app_public.group_member_ref_json(m.member_user_id),
      'former',not exists(select 1 from app_public.group_memberships p where p.group_id=p_cow.group_id and p.user_id=m.member_user_id and p.ended_at is null),
      'value',case when not m.suppressed then m.entry->'value' end,
      'state',case when m.suppressed or m.arithmetic_unavailable then 'unavailable' when m.entry is null then 'unranked' else 'ranked' end)
        ||app_public.group_competition_added_e1rm_json(p_metric,
          app_public.group_competition_unit(p_metric,(p_cow.start_context->>'normalized')::boolean),
          case when not m.suppressed and not m.arithmetic_unavailable then m.entry->'value' end,
          (p_cow.start_context->>'bodyweight_contribution')::numeric)
    from disclosure m;
end $$;

create or replace function app_public.group_cow_result_rows(p_cow app_public.group_cows,p_metric text)
returns table(ordinal integer,member_id uuid,row_json jsonb)
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  return query select * from app_public.group_cow_result_rows(p_cow,p_metric,null::jsonb);
end $$;

-- `p_redactions` null: one is built here for the CoW's participants, when a row
-- can need it (a ready, not normalized CoW).
create function app_public.group_cow_public_result(p_cow app_public.group_cows,p_metrics text[],p_before text,p_limit integer,p_top boolean,p_redactions jsonb)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare metric text; state text:=app_public.group_cow_public_state(p_cow); ranks jsonb:='[]'; rows jsonb; page jsonb;
  cursor jsonb; edge integer:=0; edge_id uuid:='00000000-0000-0000-0000-000000000000'; last_row jsonb; total integer; more boolean;
  ge app_public.group_exercises; normalized boolean; unit text; publication uuid; cache jsonb:=p_redactions;
begin
  perform app_public.group_cow_reject_agent();
  select * into ge from app_public.group_exercises where id=p_cow.group_exercise_id and group_id=p_cow.group_id;
  normalized:=case when (p_cow.start_context->>'available')::boolean then (p_cow.start_context->>'normalized')::boolean end;
  publication:=case when state<>'pending' then p_cow.publication_id end;
  if p_before is not null then
    begin
      cursor:=p_before::jsonb;
      if cardinality(p_metrics)<>1 or not (cursor ?& array['group','cow','revision','metric','publication','rank','member']) or
        cursor-array['group','cow','revision','metric','publication','rank','member']<>'{}'::jsonb or
        cursor->>'group' is distinct from p_cow.group_id::text or cursor->>'cow' is distinct from p_cow.id::text or
        cursor->>'metric' is distinct from p_metrics[1] or (cursor->>'revision')::bigint is distinct from p_cow.revision then raise exception 'bad scope'; end if;
      edge:=(cursor->>'rank')::integer; edge_id:=(cursor->>'member')::uuid;
      if edge is null or edge<1 or edge_id is null then raise exception 'bad edge'; end if;
    exception when others then raise exception 'VALIDATION: invalid CoW cursor' using errcode='P0001'; end;
    if cursor->>'publication' is distinct from publication::text then raise exception 'CONFLICT: CoW changed; refresh results' using errcode='P0001'; end if;
  end if;
  if cache is null and state='ready' and (p_cow.start_context->>'normalized')::boolean is false then
    cache:=app_public.group_competition_redaction_cache(p_cow.group_id,
      array(select p.member_user_id from app_public.group_cow_participants p where p.cow_id=p_cow.id));
  end if;
  foreach metric in array p_metrics loop
    unit:=case when normalized is null then null when metric='improvement' then 'percent'
      else app_public.group_competition_unit(metric,normalized) end;
    with r as materialized (select * from app_public.group_cow_result_rows(p_cow,metric,cache))
    select (select count(*)::integer from r),coalesce(jsonb_agg(x.row_json order by coalesce(x.ordinal,2147483647),x.member_id),'[]'),count(*)>p_limit
      into total,rows,more
      from (select * from r where (not p_top or r.ordinal<=3) and (coalesce(r.ordinal,2147483647),r.member_id)>(edge,edge_id)
        order by coalesce(r.ordinal,2147483647),r.member_id limit p_limit+1) x;
    if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
    last_row:=rows->(jsonb_array_length(rows)-1);
    page:=jsonb_build_object('metric',metric,'unit',unit,'entries',rows,'entry_count',total,'next_cursor',case when more then
      jsonb_build_object('group',p_cow.group_id,'cow',p_cow.id,'revision',p_cow.revision,'metric',metric,'publication',publication,
        'rank',coalesce((last_row->>'rank')::integer,2147483647),'member',last_row->'member'->>'user_id')::text end);
    ranks:=ranks||jsonb_build_array(page);
  end loop;
  return jsonb_build_object('cow',app_public.group_cow_json(p_cow),'exercise',case when ge.id is not null then app_public.group_competition_exercise_json(ge) end,
    'bodyweight_calculations_enabled',(select bodyweight_calculations_enabled from app_public.groups where id=p_cow.group_id),
    'state',state,'normalized',normalized,'publication_id',publication,'rankings',ranks);
end $$;

create or replace function app_public.group_cow_public_result(p_cow app_public.group_cows,p_metrics text[],p_before text,p_limit integer,p_top boolean default false)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_cow_public_result(p_cow,p_metrics,p_before,p_limit,p_top,null::jsonb);
end $$;

create function app_public.group_cow_stream_item(p_event_id uuid,p_sort bigint,p_redactions jsonb) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare e app_public.group_events; c app_public.group_cows; result jsonb;
begin
  perform app_public.group_cow_reject_agent();
  select * into strict e from app_public.group_events where id=p_event_id and kind='cow';
  if e.payload->>'event' in ('results','unavailable') then
    select * into strict c from app_public.group_cows where id=(e.payload->'definition'->>'cow_id')::uuid
      and group_id=e.group_id and finalized_at is not null and publication_id::text=e.payload->>'publication_id';
    result:=app_public.group_cow_public_result(c,c.metrics,null,1,true,p_redactions);
  end if;
  return jsonb_build_object('kind','cow','key',lpad(e.seq::text,20,'0'),'sort_at_ms',p_sort,
    'event',e.payload->'event','definition',e.payload->'definition','previous',e.payload->'previous',
    'actor',case when e.actor_user_id is not null then app_public.group_member_ref_json(e.actor_user_id) end,'result',result);
end $$;

create or replace function app_public.group_cow_stream_item(p_event_id uuid,p_sort bigint) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_cow_stream_item(p_event_id,p_sort,null::jsonb);
end $$;

-- The new overloads are private, like the forms they sit beside.
revoke all on function app_public.group_competition_stream_withdrawn(app_public.group_events,jsonb),
  app_public.group_competition_session_exercises(uuid[],uuid,text,jsonb),
  app_public.group_competition_session_json(uuid[],uuid,text,jsonb),
  app_public.group_competition_session_card(uuid,text,jsonb,jsonb),
  app_public.group_cow_result_rows(app_public.group_cows,text,jsonb),
  app_public.group_cow_public_result(app_public.group_cows,text[],text,integer,boolean,jsonb),
  app_public.group_cow_stream_item(uuid,bigint,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- The stream page
-- ---------------------------------------------------------------------------

-- One stream page in `sort_at_ms desc, kind, key desc` order ("C"
-- collation), after the cursor. `p_cow`: v3+ pages list CoW items (and
-- accept a `cow` cursor). `p_level`: 1 the base items; 2 and 3 add each
-- record item's `record`; 4 also its `group_record_metrics`; 5 also each
-- withdrawal's `withdrawn`. Checks, in order, as the page functions did.
create function app_public.group_competition_stream_page_core(p_group_id uuid,p_before jsonb,p_limit integer,p_cow boolean,p_level integer)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _scope uuid[]; _limit integer; _c_sort bigint; _c_kind text; _c_key text; _group uuid;
  _items jsonb; _has_more boolean; _last jsonb;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[]) into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid and m.ended_at is null;
  end if;
  for _group in select unnest(_scope) order by 1 loop
    perform app_public.group_competition_require_member(_group,_uid);
  end loop;
  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50' using errcode = 'P0001';
  end if;
  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'rules_change', 'session', 'shared_exercise')
          and not (p_cow and (p_before ->> 'kind') = 'cow')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor' using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  -- The first limit+1 items of each kind after the cursor, per group in
  -- scope: the page's limit+1 items are among them. A kind's own scan stops
  -- at limit+1 (the stream index orders each group's events by sort_at_ms);
  -- records, which sort at their session's live start, are ranked whole.
  with candidates as (
    select c.* from unnest(_scope) sg(gid) cross join lateral (
      (select 'session'::text as kind, e.member_user_id::text||':'||e.session_id as key, s.started_at as sort_at_ms,
              e.member_user_id as user_id, e.session_id, null::text as event, null::uuid as group_id, null::uuid as event_id
         from app_public.group_events e
         join app_public.groups g on g.id = e.group_id and g.deleted_at is null
         join app_public.sessions s on s.owner_user_id = e.member_user_id and s.id = e.session_id and s.deleted_at is null
        where e.group_id = sg.gid and e.kind = 'session'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or s.started_at < _c_sort or (s.started_at = _c_sort and ('session' collate "C" > _c_kind
               or ('session' = _c_kind and (e.member_user_id::text||':'||e.session_id) collate "C" < _c_key))))
        order by e.sort_at_ms desc, (e.member_user_id::text||':'||e.session_id) collate "C" desc
        limit _limit + 1)
      union all
      (select 'membership', x.key, e.sort_at_ms, e.member_user_id, null, e.kind, e.group_id, null
         from app_public.group_events e
         cross join lateral (select e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end as key) x
        where e.group_id = sg.gid and e.kind in ('joined', 'left', 'removed')
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('membership' collate "C" > _c_kind
               or ('membership' = _c_kind and x.key collate "C" < _c_key))))
        order by e.sort_at_ms desc, x.key collate "C" desc
        limit _limit + 1)
      union all
      (select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms), e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         left join app_public.sessions s on s.owner_user_id = e.member_user_id and s.id = e.session_id
        where e.group_id = sg.gid and e.kind = 'record'
          and (_c_sort is null or coalesce(s.started_at, e.sort_at_ms) < _c_sort or (coalesce(s.started_at, e.sort_at_ms) = _c_sort
               and ('record' collate "C" > _c_kind or ('record' = _c_kind and e.id::text collate "C" < _c_key))))
        order by coalesce(s.started_at, e.sort_at_ms) desc, e.id::text collate "C" desc
        limit _limit + 1)
      union all
      (select x.kind, e.id::text, e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         cross join lateral (select case when e.kind = 'record_voided' then 'record_voided' else 'link' end as kind) x
        where e.group_id = sg.gid and e.kind in ('record_voided', 'link', 'unlink')
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and (x.kind collate "C" > _c_kind
               or (x.kind = _c_kind and e.id::text collate "C" < _c_key))))
        order by e.sort_at_ms desc, x.kind collate "C", e.id::text collate "C" desc
        limit _limit + 1)
      union all
      (select 'cow', lpad(e.seq::text,20,'0'), e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
        where p_cow and e.group_id = sg.gid and e.kind = 'cow'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('cow' collate "C" > _c_kind
               or ('cow' = _c_kind and lpad(e.seq::text,20,'0') collate "C" < _c_key))))
        order by e.sort_at_ms desc, lpad(e.seq::text,20,'0') collate "C" desc
        limit _limit + 1)
      union all
      (select 'shared_exercise', e.id::text, e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         join app_public.group_shared_exercises se on se.id = (e.payload->>'shared_exercise_id')::uuid and se.deleted_at is null
        where e.group_id = sg.gid and e.kind = 'shared_exercise'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('shared_exercise' collate "C" > _c_kind
               or ('shared_exercise' = _c_kind and e.id::text collate "C" < _c_key))))
        order by e.sort_at_ms desc, e.id::text collate "C" desc
        limit _limit + 1)
    ) c
  ),
  -- One card per (member, session) in scope, deduplicated across groups.
  distinct_candidates as (
    select distinct on (kind, key) * from candidates order by kind, key
  ),
  page as (
    select d.*, row_number() over (order by d.sort_at_ms desc, d.kind collate "C", d.key collate "C" desc) as rn
      from distinct_candidates d
     order by d.sort_at_ms desc, d.kind collate "C", d.key collate "C" desc
     limit _limit + 1
  ),
  shown as materialized (select * from page where rn <= _limit),
  -- One redaction cache for everything the page's items ask about: the
  -- members of its items, the holders their events name, and a finished
  -- CoW's participants. In this statement, so the cache and the items it
  -- governs see one snapshot.
  cache as materialized (
    select case when cardinality(_scope) = 1 and exists(select 1 from shown) then
      app_public.group_competition_redaction_cache(_scope[1], array(
        select distinct m from (
          select s.user_id as m from shown s
          union all
          select app_public.group_eval_try_uuid(h#>>'{}')
            from shown s
            join app_public.group_events e on e.id = s.event_id
            left join app_public.group_events x on x.related_event_id = e.id and x.kind = 'lead_change'
            left join app_public.group_events w on w.id = e.related_event_id and e.kind = 'record_voided'
            cross join lateral jsonb_path_query(jsonb_build_array(e.payload, x.payload, w.payload), 'lax $.**.member_user_id') h
          union all
          select w.member_user_id
            from shown s
            join app_public.group_events e on e.id = s.event_id and e.kind = 'record_voided'
            join app_public.group_events w on w.id = e.related_event_id
          union all
          select p.member_user_id
            from shown s
            join app_public.group_events e on e.id = s.event_id and e.kind = 'cow' and e.payload->>'event' = 'results'
            join app_public.group_cow_participants p on p.cow_id = (e.payload->'definition'->>'cow_id')::uuid
        ) x where m is not null)) end as c
  ),
  items as (
    select s.rn, case
             when s.kind = 'session' then
               app_public.group_competition_session_card(s.user_id, s.session_id, (
                 select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name) order by lower(g.name), g.name, g.id)
                   from app_public.group_events e
                   join app_public.groups g on g.id = e.group_id and g.deleted_at is null
                  where e.kind = 'session' and e.member_user_id = s.user_id and e.session_id = s.session_id
                    and e.group_id = any(_scope)), (select c from cache))
             when s.kind = 'membership' then
               jsonb_build_object('kind', 'membership', 'key', s.key, 'sort_at_ms', s.sort_at_ms, 'event', s.event,
                 'group', (select jsonb_build_object('group_id', g.id, 'name', g.name) from app_public.groups g where g.id = s.group_id),
                 'member', app_public.group_member_ref_json(s.user_id))
             when s.kind = 'cow' then
               app_public.group_cow_stream_item(s.event_id, s.sort_at_ms, (select c from cache))
             when s.kind = 'shared_exercise' then
               app_public.group_shared_exercise_stream_card(s.event_id, s.sort_at_ms)
             else (
               select case
                   when p_level >= 2 and e.kind = 'record' then
                     case when p_level >= 4 and jsonb_typeof(i.item->'record') = 'object' then
                       jsonb_set(i.item, '{record,group_record_metrics}', app_public.group_competition_stream_group_record_metrics(e))
                     else i.item end
                   when p_level >= 5 and e.kind = 'record_voided' then
                     i.item || jsonb_build_object('withdrawn', coalesce(app_public.group_competition_stream_withdrawn(e, (select c from cache)), 'null'::jsonb))
                   else i.item end
                 from app_public.group_events e
                 -- offset 0: built once, not once per reference.
                 cross join lateral (select jsonb_build_object('kind', 'competition', 'key', e.id, 'sort_at_ms', s.sort_at_ms,
                     'event', app_public.group_competition_event_json(e, (select c from cache)))
                   || case when p_level >= 2 and e.kind = 'record' then jsonb_build_object('record',
                        app_public.group_competition_stream_record(e, (select c from cache))) else '{}'::jsonb end
                   as item offset 0) i
                where e.id = s.event_id)
           end as item
      from shown s
  )
  select coalesce((select jsonb_agg(i.item order by i.rn) from items i), '[]'::jsonb),
         (select count(*) > _limit from page),
         (select jsonb_build_object('sort_at_ms', s.sort_at_ms, 'kind', s.kind, 'key', s.key) from shown s order by s.rn desc limit 1)
    into _items, _has_more, _last;

  return jsonb_build_object('contract_version', 4, 'items', _items,
    'next_cursor', case when _has_more then _last else null end, 'has_more', _has_more);
end $$;

create or replace function app_public.group_competition_stream_page(p_group_id uuid default null,p_before jsonb default null,p_limit integer default null)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_competition_stream_page_core(p_group_id,p_before,p_limit,false,1);
end $$;

create or replace function app_public.group_competition_stream_page_v3(p_group_id uuid default null,p_before jsonb default null,p_limit integer default null)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_competition_stream_page_core(p_group_id,p_before,p_limit,true,1);
end $$;

-- v2: the protocol-4 page (no CoW items), its records with `record`.
create or replace function app_public.group_competition_stream_v2(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _cursor jsonb; _page jsonb; _binding jsonb;
begin
  if p_group_id is not null then perform app_public.group_competition_require_member(p_group_id,_uid); end if;
  _binding:=jsonb_build_object('kind','competition_stream','group',p_group_id);
  _cursor:=app_public.group_metric_cursor_decode(p_before);
  if _cursor is not null and (_cursor-'cursor') is distinct from _binding then
    raise exception 'VALIDATION: stream cursor scope mismatch' using errcode='P0001';
  end if;
  _page:=app_public.group_competition_stream_page_core(p_group_id,_cursor->'cursor',p_limit,false,2);
  return jsonb_build_object('contract_version',4,'items',_page->'items','has_more',_page->'has_more',
    'next_cursor',case when (_page->>'has_more')::boolean then
      app_public.group_metric_cursor_encode(_binding||jsonb_build_object('cursor',_page->'next_cursor')) end);
end $$;

-- v3-v5: the v3 page (CoW items, v3 cursors) at their level.
create function app_public.group_competition_stream_v3_level(p_group_id uuid,p_before text,p_limit integer,p_level integer)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); cursor jsonb; page jsonb; binding jsonb;
begin
  if p_group_id is not null then perform app_public.group_competition_require_member(p_group_id,u); end if;
  perform app_public.group_competition_require_capability();
  binding:=jsonb_build_object('kind','competition_stream_v3','group',p_group_id);
  cursor:=app_public.group_metric_cursor_decode(p_before);
  if cursor is not null and (cursor-'cursor') is distinct from binding then
    raise exception 'VALIDATION: stream cursor scope mismatch' using errcode='P0001';
  end if;
  page:=app_public.group_competition_stream_page_core(p_group_id,cursor->'cursor',p_limit,true,p_level);
  return jsonb_build_object('contract_version',4,'items',page->'items',
    'has_more',page->'has_more','next_cursor',case when (page->>'has_more')::boolean then
      app_public.group_metric_cursor_encode(binding||jsonb_build_object('cursor',page->'next_cursor')) end);
end $$;

create or replace function app_public.group_competition_stream_v3(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_competition_stream_v3_level(p_group_id,p_before,p_limit,3);
end $$;

create or replace function app_public.group_competition_stream_v4(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_competition_stream_v3_level(p_group_id,p_before,p_limit,4);
end $$;

create or replace function app_public.group_competition_stream_v5(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  return app_public.group_competition_stream_v3_level(p_group_id,p_before,p_limit,5);
end $$;

revoke all on function app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer),
  app_public.group_competition_stream_v3_level(uuid,text,integer,integer) from public,anon,authenticated,service_role;
