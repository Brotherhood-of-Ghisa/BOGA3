-- Idempotency receipts for the prediction writes the agent API serves.
--
-- Each wrapper claims the agent's idempotency key, runs the existing
-- service-role RPC and stores the result in one transaction: a retry with the
-- same key and body replays the first result, a different body under the same
-- key is IDEMPOTENCY_CONFLICT, and a refused write (NOT_FOUND, VALIDATION, ...)
-- rolls the claim back so the key stays free.

alter table public.agent_plan_write_receipts drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts add constraint agent_plan_write_receipts_operation_valid check (operation in (
  'create_session_plan','create_training_programme','create_exercise','update_exercise','delete_exercise','restore_exercise',
  'update_plan_meta','update_programme_meta','insert_plan_block','update_plan_block',
  'reorder_plan_blocks','reorder_programme_plans','reorder_block_sets','tombstone_plan_block','detach_programme_plan',
  'tombstone_plan','tombstone_programme','set_muscle_targets',
  'create_workout','start_workout','log_sets','update_set','delete_set','finish_workout',
  'add_note','remove_note',
  'log_injury','update_injury_status',
  'post_prediction_offer','withdraw_prediction_offer','schedule_group_cow'
));

create function app_public.agent_group_prediction_post_receipted(p_owner uuid, p_client_id text,
  p_idempotency_key text, p_payload_sha256 text, p_group_id uuid, p_week_start date, p_template text,
  p_parameters jsonb, p_side text, p_price integer, p_stake numeric, p_walk_away_price integer, p_note text,
  p_answers_offer_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _operation text := 'post_prediction_offer'; _replay jsonb; _result jsonb;
begin
  perform app_public.agent_group_prediction_require_service();
  _replay := app_public.agent_exercise_claim_receipt(p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256);
  if _replay is not null then
    return _replay;
  end if;
  _result := app_public.agent_group_prediction_post(p_owner, p_client_id, p_group_id, p_week_start, p_template,
    p_parameters, p_side, p_price, p_stake, p_walk_away_price, p_note, p_answers_offer_id)
    || jsonb_build_object('idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end $$;

create function app_public.agent_group_prediction_withdraw_receipted(p_owner uuid, p_client_id text,
  p_idempotency_key text, p_payload_sha256 text, p_group_id uuid, p_offer_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _operation text := 'withdraw_prediction_offer'; _replay jsonb; _result jsonb;
begin
  perform app_public.agent_group_prediction_require_service();
  _replay := app_public.agent_exercise_claim_receipt(p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256);
  if _replay is not null then
    return _replay;
  end if;
  _result := app_public.agent_group_prediction_withdraw(p_owner, p_client_id, p_group_id, p_offer_id)
    || jsonb_build_object('idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end $$;

-- The CoW's identity is derived from the owner, the client and the key, so the
-- CoW RPC's own retry rule (same AI, same request, same CoW) holds even for a
-- replay that bypasses the receipt.
create function app_public.agent_group_prediction_cow_schedule_receipted(p_owner uuid, p_client_id text,
  p_idempotency_key text, p_payload_sha256 text, p_group_id uuid, p_week_start date, p_group_exercise_id uuid,
  p_metrics text[]) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _operation text := 'schedule_group_cow'; _replay jsonb; _result jsonb;
begin
  perform app_public.agent_group_prediction_require_service();
  _replay := app_public.agent_exercise_claim_receipt(p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256);
  if _replay is not null then
    return _replay;
  end if;
  _result := app_public.agent_group_prediction_cow_schedule(p_owner, p_client_id, p_group_id,
    md5('group-cow:' || p_owner::text || ':' || p_client_id || ':' || p_idempotency_key)::uuid,
    p_week_start, p_group_exercise_id, p_metrics) || jsonb_build_object('idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end $$;

revoke all on function app_public.agent_group_prediction_post_receipted(uuid, text, text, text, uuid, date, text,
  jsonb, text, integer, numeric, integer, text, uuid) from public, anon, authenticated, service_role;
revoke all on function app_public.agent_group_prediction_withdraw_receipted(uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_public.agent_group_prediction_cow_schedule_receipted(uuid, text, text, text, uuid, date,
  uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function app_public.agent_group_prediction_post_receipted(uuid, text, text, text, uuid, date, text,
  jsonb, text, integer, numeric, integer, text, uuid) to service_role;
grant execute on function app_public.agent_group_prediction_withdraw_receipted(uuid, text, text, text, uuid, uuid)
  to service_role;
grant execute on function app_public.agent_group_prediction_cow_schedule_receipted(uuid, text, text, text, uuid, date,
  uuid, text[]) to service_role;
