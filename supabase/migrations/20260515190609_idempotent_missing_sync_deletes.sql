-- Make soft-delete projection events idempotent when the target row is absent.
--
-- Mobile bootstrap/convergence can legitimately send delete tombstones for rows
-- that are missing from a fresh or partially-cleared remote projection. The sync
-- contract is at-least-once and idempotent; a missing soft-delete target should
-- be an applied no-op, not a permanent blocked failure.

alter function app_public.sync_apply_projection_event(uuid, text, text, text, bigint, jsonb)
rename to sync_apply_projection_event_strict_20260515190609;

create or replace function app_public.sync_apply_projection_event(
  p_owner_user_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_event_type text,
  p_occurred_at_ms bigint,
  p_payload jsonb
)
returns void
language plpgsql
set search_path = app_public, public, extensions
as $$
begin
  begin
    perform app_public.sync_apply_projection_event_strict_20260515190609(
      p_owner_user_id,
      p_entity_type,
      p_entity_id,
      p_event_type,
      p_occurred_at_ms,
      p_payload
    );
  exception
    when sqlstate 'P0002' then
      if p_event_type = 'delete'
        and p_entity_type in (
          'gyms',
          'sessions',
          'session_exercises',
          'exercise_sets',
          'exercise_definitions',
          'exercise_tag_definitions'
        )
        and sqlerrm like 'cannot delete missing %'
      then
        return;
      end if;

      raise;
  end;
end;
$$;
