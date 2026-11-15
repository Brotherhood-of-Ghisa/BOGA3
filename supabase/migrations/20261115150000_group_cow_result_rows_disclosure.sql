-- group_cow_result_rows: the disclosure CTE is read three times per row (value,
-- state and the added-load fields), and being referenced more than once it was
-- inlined, so each row re-ran its source-ref and set-definition probes three
-- times. It is now materialized: one probe set per member. The same rows, in the
-- same order; the read-path parity cases compare the old definition with this
-- one for every fixture viewer and CoW.

create or replace function app_public.group_cow_result_rows(p_cow app_public.group_cows,p_metric text,p_redactions jsonb)
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
  ), disclosure as materialized (
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
