# Health activities contract

> **Owns:** imported health-app activities: the server table, the app's write
> RPC, the strength-overlap rule and the coach's reads. **Not here:** what the
> coach may read → [[agents.health-activities]]; agent auth and envelopes →
> `supabase/functions/agent-api/README.md`. **Load when:** changing
> `app_public.health_activities`, `health_activities_apply`, the activities
> route, training-status `cardio` or the phone's health import.

## Boundary

The phone is the bridge: the health store (Apple Health) has no cloud API, so
the app reads its workouts and writes summaries to the server; the coach reads
server state only. The table is owner-private, out of sync scope (no local
SQLite table, no Sync v2 entity: the health store is the device copy), and
outside every training and group figure ([[agents.health-activities]]).

| Path | Who | Authority |
| --- | --- | --- |
| `app_public.health_activities_apply` | owner app session | `SECURITY DEFINER`; derives the owner from `auth.uid()`; rejects an OAuth `client_id` (`AGENT_FORBIDDEN`) |
| `SELECT` on `app_public.health_activities` | owner app session | RLS: `user_id = auth.uid()`, and a restrictive policy requires no `client_id`; no client insert, update or delete privilege |
| `GET /v1/agent/activities`, training-status `cardio` | coach (OAuth) | the agent API's base read grant; service role, owner-filtered |

## Table

One row per `(user_id, source, external_id)`. The owner column is `user_id` on
purpose: the sync drift checker treats every `app_public` table with
`owner_user_id` as a Sync v2 entity. `source` names the store
(`apple_health`; another store adds a value to the check), `external_id` is the
store's workout UUID. Summary columns only: `activity_type`, `started_at`,
`ended_at`, `duration_sec`, `distance_m`, `active_energy_kcal`,
`avg_heart_rate_bpm`, `max_heart_rate_bpm`, `elevation_gain_m`, `source_name`,
`device_name`. No routes, no per-sample series. Ranges and nullability are the
migration's checks (`supabase/migrations/20261110213906_health_activities.sql`).

`activity_type` is snake_case text (`running`, `cycling`, `walking`,
`traditional_strength_training`, …); the importer maps the store's enum to it,
and the server checks only its form, so a new store type needs no migration.

## Write RPC

`health_activities_apply(p_source, p_upserts, p_deletes, p_complete_since, p_complete_ids)`
applies one batch of the store's change feed in one transaction, serialized
per owner and source:

1. `p_deletes` (≤ 1000 external ids) are deleted: the store reported them gone.
2. `p_upserts` (≤ 1000 objects with exactly the table's summary fields) are
   inserted or updated in place, so a re-import is idempotent.
3. A fresh backfill may take several batches. Its closing call passes
   `p_complete_since` with `p_complete_ids` (≤ 20000): every external id the
   store still has from that instant on. Rows in that window outside the list
   and this call's upserts are pruned. One without the other is rejected.

Any unknown field, wrong type, zone-less timestamp, out-of-range figure,
duplicate id, or id both upserted and deleted fails the whole batch with
`INVALID_ARGUMENT: <reason>`; nothing is clamped or skipped. It returns
`{upserted, deleted, pruned}`.

## Strength overlap

This implements the overlap decision of [[agents.health-activities]]. An activity of type `traditional_strength_training`,
`functional_strength_training`, `core_training` or `cross_training` overlaps a
session when their half-open spans share any time; the session is an owner's
non-deleted completed one, or an active one running until now but at most 12
hours, so a session left open cannot swallow later workouts. The row is kept
and flagged (`overlaps_logged_session`, `overlapping_session_id`: the
earliest such session). Other types are never flagged: a run during a gym visit
is cardio. The rule is `overlappingSessionId` in
`supabase/functions/agent-api/activities.ts`.

## Coach reads

`GET /v1/agent/activities` (tool `get_recent_activities`): optional `from`
(inclusive) and `to` (exclusive) on the start, ISO 8601 instants with a zone;
`limit` `1..50` (default 20); opaque `cursor`. Newest start first, then source
and external id. Each row has the summary fields (`duration_seconds`; null =
not recorded) and the overlap flag; `overlap_complete: false` when the session
read (one window per strength activity, merged under a day apart) hit its cap
(500).

Training status `cardio` (tool `get_training_status`): `this_week` and
`last_4_weeks` (oldest first) on the profile's Monday-start weeks, each with
`activities`, `duration_seconds`, `distance_m`, `active_energy_kcal` (rounded
sums; a null figure adds 0) and `by_type` (longest first). Flagged strength
activities are left out and counted in `overlapping_excluded`; unflagged ones,
watch-only strength included, count. `last_activity_on` is the latest counted
start's local day. `complete: false` when the 500-activity or session read hit
its cap.

## Tests

`apps/mobile/__tests__/agent-api-activities.test.ts` proves the overlap rule,
range and cursor parsing and the weekly buckets. `./boga test agent-api` proves
the RPC (idempotency, rejection, delete, prune), RLS, OAuth denial, ownership,
ordering, paging and `cardio`; `./boga test mcp-smoke` the MCP-to-API path.
