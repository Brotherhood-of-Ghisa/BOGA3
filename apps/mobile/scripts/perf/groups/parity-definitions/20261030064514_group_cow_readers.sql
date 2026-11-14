CREATE OR REPLACE FUNCTION app_public.group_competition_redacts_exercise(p_groups uuid[], p_member uuid, p_definition text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select app_public.group_cow_redacts_exercise(p_groups,p_member,p_definition) or exists(select 1 from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
    where ge.group_id=any(p_groups) and g.deleted_at is null and g.bodyweight_calculations_enabled
      and ge.bodyweight_contribution>0 and (p_definition is null or
        exists(select 1 from app_public.exercise_group_links l where l.owner_user_id=p_member
          and l.exercise_definition_id=p_definition and app_public.group_eval_try_uuid(l.group_id)=ge.group_id
          and app_public.group_eval_try_uuid(l.group_exercise_id)=ge.id)
        or exists(select 1 from app_public.group_metric_set_scores s where s.group_exercise_id=ge.id and s.counting
          and s.member_user_id=p_member and (s.performance->>'exercise_definition_id'=p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=s.set_id and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_metric_certifications c where c.group_exercise_id=ge.id
          and c.member_user_id=p_member and (c.performance->>'exercise_definition_id'=p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=c.set_id and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_rule_revisions r cross join lateral jsonb_array_elements(r.legacy_entries) b
          where r.group_exercise_id=ge.id and b->>'member_user_id'=p_member::text and
            (b->>'exercise_definition_id'=p_definition or exists(
              select 1 from app_public.exercise_sets es join app_public.session_exercises se
                on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
                where es.owner_user_id=p_member and es.id=b->>'set_id' and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_events e where e.group_exercise_id=ge.id and e.member_user_id=p_member
          and (e.payload->'performance'->>'exercise_definition_id'=p_definition
            or e.payload->>'exercise_definition_id'=p_definition
            or e.payload->'exercise_definition_ids' ? p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=e.set_id and se.exercise_definition_id=p_definition)))))
$function$

