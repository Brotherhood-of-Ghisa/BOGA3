-- Clear hosted sync/projection state for one user while preserving
-- auth.users and app_public.user_profiles.
--
-- Current target owner_user_id was observed in app_public.sync_device_ingest_state.
-- Replace the UUID below if running for a different account.

begin;

-- Pre-clear counts for dashboard visibility.
with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
select 'before' as phase, 'sync_ingested_events' as table_name, count(*) as row_count
from app_public.sync_ingested_events e, target_owner t
where e.owner_user_id = t.owner_user_id
union all
select 'before', 'sync_device_ingest_state', count(*)
from app_public.sync_device_ingest_state s, target_owner t
where s.owner_user_id = t.owner_user_id
union all
select 'before', 'gyms', count(*)
from app_public.gyms x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'sessions', count(*)
from app_public.sessions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'session_exercises', count(*)
from app_public.session_exercises x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'exercise_sets', count(*)
from app_public.exercise_sets x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'exercise_definitions', count(*)
from app_public.exercise_definitions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'exercise_muscle_mappings', count(*)
from app_public.exercise_muscle_mappings x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'exercise_tag_definitions', count(*)
from app_public.exercise_tag_definitions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'before', 'session_exercise_tags', count(*)
from app_public.session_exercise_tags x, target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.sync_ingested_events e
using target_owner t
where e.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.sync_device_ingest_state s
using target_owner t
where s.owner_user_id = t.owner_user_id;

-- Projection children first, then parents.
with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.session_exercise_tags x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.exercise_sets x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.session_exercises x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.sessions x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.gyms x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.exercise_tag_definitions x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.exercise_muscle_mappings x
using target_owner t
where x.owner_user_id = t.owner_user_id;

with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
delete from app_public.exercise_definitions x
using target_owner t
where x.owner_user_id = t.owner_user_id;

-- Post-clear counts should all be zero.
with target_owner as (
  select '7b11978a-6306-4560-98f6-fb6d374618a9'::uuid as owner_user_id
)
select 'after' as phase, 'sync_ingested_events' as table_name, count(*) as row_count
from app_public.sync_ingested_events e, target_owner t
where e.owner_user_id = t.owner_user_id
union all
select 'after', 'sync_device_ingest_state', count(*)
from app_public.sync_device_ingest_state s, target_owner t
where s.owner_user_id = t.owner_user_id
union all
select 'after', 'gyms', count(*)
from app_public.gyms x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'sessions', count(*)
from app_public.sessions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'session_exercises', count(*)
from app_public.session_exercises x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'exercise_sets', count(*)
from app_public.exercise_sets x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'exercise_definitions', count(*)
from app_public.exercise_definitions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'exercise_muscle_mappings', count(*)
from app_public.exercise_muscle_mappings x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'exercise_tag_definitions', count(*)
from app_public.exercise_tag_definitions x, target_owner t
where x.owner_user_id = t.owner_user_id
union all
select 'after', 'session_exercise_tags', count(*)
from app_public.session_exercise_tags x, target_owner t
where x.owner_user_id = t.owner_user_id;

commit;
