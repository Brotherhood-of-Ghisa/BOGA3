-- Additive negotiation only. No percentage activation or old-reader behavior
-- changes before the reviewed scorer/public-reader cutover is installed.
create function app_public.group_competition_contract(p_group_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = app_public, pg_temp as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-contract','');
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  if _protocol <> '4' then
    raise exception 'UPDATE_REQUIRED: Update BoGa to use group competitions.' using errcode='P0001';
  end if;
  return jsonb_build_object('contract_version',4,'activation_state','pending','cache_version',5,
    'metrics',jsonb_build_array('volume','e1rm'),'default_metric','e1rm',
    'ordinary_units',jsonb_build_object('volume','kg_reps','e1rm','kg'),
    'normalized_units',jsonb_build_object('volume','percent_bw_reps','e1rm','percent_bw'));
end;
$$;
revoke all on function app_public.group_competition_contract(uuid) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_contract(uuid) to authenticated;
notify pgrst,'reload schema';
