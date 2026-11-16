-- CoW result rows: the kg disclosure rule depends on the member and the
-- source exercise only, so it runs once per distinct exercise of the member's
-- source refs instead of once per source set (a finished CoW holds every set
-- its week counted, about three pages a call); the rows are unchanged.
CREATE OR REPLACE FUNCTION app_public.group_cow_result_rows(p_cow app_public.group_cows, p_metric text)
 RETURNS TABLE(ordinal integer, member_id uuid, row_json jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
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
  ), sources as materialized (
    -- Materialized, so the rule is not pushed below the distinct to run per set.
    select distinct refs.member_user_id,refs.definition_id from app_public.group_cow_source_refs refs
      where refs.cow_id=p_cow.id and refs.metric=p_metric
  ), disclosure as materialized (
    select m.*,not (p_cow.start_context->>'normalized')::boolean and (exists(
      select 1 from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
        where g.id=p_cow.group_id and ge.id=p_cow.group_exercise_id and g.deleted_at is null
          and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0) or exists(
      select 1 from sources s where s.member_user_id=m.member_user_id and
        app_public.group_competition_redacts_exercise(array[p_cow.group_id],m.member_user_id,nullif(s.definition_id,'')))) as suppressed
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
end $function$;
