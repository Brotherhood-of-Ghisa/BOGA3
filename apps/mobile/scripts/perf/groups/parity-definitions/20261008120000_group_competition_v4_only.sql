CREATE OR REPLACE FUNCTION app_public.group_competition_board(p_group_id uuid, p_group_exercise_id uuid, p_metric text, p_certified boolean DEFAULT true, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _rules jsonb; _state text; _cursor jsonb; _after integer:=0; _entries jsonb; _me jsonb; _count integer; _last integer; _next text;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_metric is null or p_metric not in ('volume','e1rm') or p_certified is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid competition board dimensions' using errcode='P0001';
  end if;
  _rules:=app_public.group_competition_rules_json(_ge);
  _state:=case when _ge.archived_at is not null then 'archived'
    when _ge.published_rules_revision is distinct from _ge.rules_revision then 'rebuilding' else 'ready' end;
  _cursor:=app_public.group_metric_cursor_decode(p_cursor);
  if _cursor is not null then
    if _cursor->>'group_id' is distinct from p_group_id::text or _cursor->>'group_exercise_id' is distinct from _ge.id::text
      or _cursor->>'metric' is distinct from p_metric or _cursor->>'certified' is distinct from p_certified::text
      or _cursor->>'rules_revision' is distinct from _ge.rules_revision::text
      or jsonb_typeof(_cursor->'after_rank') is distinct from 'number' then
      raise exception 'VALIDATION: competition cursor scope mismatch' using errcode='P0001';
    end if;
    begin _after:=(_cursor->>'after_rank')::integer;
    exception when others then raise exception 'VALIDATION: invalid competition cursor rank' using errcode='P0001'; end;
    if _after<0 then raise exception 'VALIDATION: invalid competition cursor rank' using errcode='P0001'; end if;
  end if;
  if _state='rebuilding' then _entries:='[]'; _count:=0;
  else
    select count(*) into _count from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified);
    select coalesce(jsonb_agg(r.row_json order by r.rank),'[]'),max(r.rank) into _entries,_last from (
      select * from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified)
      where rank>_after order by rank limit p_limit) r;
    select row_json into _me from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified) where member_user_id=_uid;
    if _last<_count then _next:=app_public.group_metric_cursor_encode(jsonb_build_object('group_id',p_group_id,'group_exercise_id',_ge.id,
      'metric',p_metric,'certified',p_certified,'rules_revision',_ge.rules_revision,'after_rank',_last)); end if;
  end if;
  return jsonb_build_object('contract_version',4,'group_exercise_id',_ge.id,'rules',_rules,'metric',p_metric,
    'certified',p_certified,'state',_state,'entries',_entries,'entry_count',_count,'me',_me,'next_cursor',_next);
end;
$function$

