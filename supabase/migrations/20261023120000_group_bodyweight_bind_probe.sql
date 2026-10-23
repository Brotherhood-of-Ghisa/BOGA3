-- Binding a published graph's bodyweight contexts probes each set by primary
-- key instead of joining the whole graph.
--
-- Before: the bind joined every graph set as a whole jsonb row against a
-- fixed 100-row estimate. It hashed those rows (spilling to temp) or
-- seq-scanned exercise_sets, probed session_exercises and sessions for the
-- session start, and computed each set's key twice.
--
-- Now: only the typed fields the bind needs are unpacked. The session start
-- comes from the graph's achieved_at_ms (the session's started_at). The set and
-- its binding are each read by one primary-key probe, and the key is computed
-- once with the same group_set_body_weight_key the graph lookup uses. Results
-- are unchanged: the same sets bind with the same key and context. In steady
-- state nothing is written, and the publish's source recheck still rolls back
-- a set that moved.

create or replace function app_public.group_set_body_weight_bind(p_graph jsonb)
returns void language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if not coalesce((p_graph->'rules'->>'bodyweight_calculations_enabled')::boolean, false)
     or coalesce((p_graph->'rules'->>'bodyweight_contribution')::double precision, 0) <= 0 then
    return;
  end if;
  insert into app_public.group_set_body_weight_bindings as b (member_user_id, set_id, source_key, context)
  select k.member_user_id, k.set_id, k.source_key, k.context
    from (select r.member_user_id, r.set_id,
                 (select app_public.group_set_body_weight_key(es, r.achieved_at_ms)
                    from app_public.exercise_sets es
                   where es.owner_user_id = r.member_user_id and es.id = r.set_id) as source_key,
                 (select x.source_key from app_public.group_set_body_weight_bindings x
                   where x.member_user_id = r.member_user_id and x.set_id = r.set_id) as bound_key,
                 jsonb_build_object('body_weight_kg', r.body_weight_kg, 'body_weight_source', r.body_weight_source,
                   'body_weight_measurement_id', r.body_weight_measurement_id,
                   'body_weight_measured_at', r.body_weight_measured_at_ms) as context
            from jsonb_to_recordset(p_graph->'sets') as r(member_user_id uuid, set_id text, achieved_at_ms bigint,
                   body_weight_kg jsonb, body_weight_source jsonb, body_weight_measurement_id jsonb,
                   body_weight_measured_at_ms jsonb)
           -- A fence: each probe and key runs once per set, not again per reference.
           offset 0) k
   where k.source_key is not null and k.source_key is distinct from k.bound_key
   order by k.member_user_id, k.set_id
  on conflict (member_user_id, set_id) do update
    set source_key = excluded.source_key, context = excluded.context, bound_at = now()
    where b.source_key is distinct from excluded.source_key;
end;
$$;

revoke all on function app_public.group_set_body_weight_bind(jsonb) from public, anon, authenticated, service_role;
