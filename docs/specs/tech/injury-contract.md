# Injury and Discomfort Contract

> **Owns:** the injury and discomfort tracking data model, lifecycle states,
> anatomical linkage, strict owner privacy boundary, and Sync v2 server/client
> schema rules.
> **Not here:** live session warning presentation →
> `docs/specs/08-ux-delivery-standard.md`; metric volume rules →
> `docs/specs/tech/training-metrics-contract.md`; general sync protocol →
> `docs/specs/tech/sync-v2-server-contract.md`.
> **Load when:** changing `app_public.injuries`, mobile injury schema,
> injury sync projection, or injury privacy rules.

## Privacy boundary

Following the strict owner privacy model established for bodyweight in
`docs/specs/tech/bodyweight-load-contract.md`:
1. Injury and discomfort records are **strictly owner-private**.
2. Group tables, triggers, competition projections, and shared workout feeds are
   completely decoupled from `app_public.injuries`.
3. No injury data, discomfort tags, or pain scores are ever published to group
   streams, leaderboards, or peer feeds.
4. RLS policies enforce that only the authenticated row owner can read or write
   injuries, and restrictive app-only policies exclude unauthenticated and
   unauthorized agent contexts.

| Path | Who | Authority |
| --- | --- | --- |
| `app_public.injuries` | Owner app session | RLS: `owner_user_id = auth.uid()`; restrictive `direct_app_only` policy requires no client ID |
| `sync_push` / `sync_pull` | Owner app session | Security invoker; respects owner RLS policies |
| Connected Virtual Coach | Agent API | Dedicated agent endpoints with explicit user consent; zero group leak |

## Data model and lifecycle

### Lifecycle states

An injury record progresses through four distinct lifecycle states:
- `acute`: active, high-salience pain or fresh tissue strain requiring exercise
  modification, prominent workout warnings, and substitution suggestions.
- `managing`: known limitation under active rehab or management; monitored with
  subtle badges during workouts without intrusive modal interruptions.
- `monitoring`: recovering tissue or asymptomatic condition undergoing gradual
  volume reloading and tissue adaptation.
- `resolved`: fully rehabilitated structure with `resolved_at` recorded; kept
  for historical audit and flare-up context without active warnings.

### Anatomical linkage and alias mapping

Each injury links natural language description to structured anatomy:
1. `muscle_group_id`: nullable foreign key to `app_public.muscle_groups(owner_user_id, id)`
   (Layer 0). When populated, drives exercise matching, 3D/2D heatmap overlays,
   and volume reload tracking. Nullable for unmapped regional discomfort (e.g.
   bruised rib, tailbone).
2. `side`: nullable text indicator (`left`, `right`, `bilateral`).
3. `label`: non-empty human-readable label (e.g. "Patellar tendon irritation").
4. `notes`: optional detailed notes or flare-up history.
5. `contraindications`: optional text or movement tags to avoid.
6. `pain_score`: optional subjective intensity rating from 0 to 10.

A static, zero-dependency anatomical alias dictionary (`ANATOMY_ALIASES` in
`apps/mobile/src/injuries/anatomy-aliases.ts`) maps lay terms, joints, and
tendons to canonical `muscle_groups.id` values:
- "knee", "patella" -> `quads`
- "lumbar", "lower back" -> `spinal_erectors`
- "elbow", "wrist" -> `forearms_grip`
- "rotator cuff", "shoulder joint" -> `rotator_cuff`
- "groin" -> `adductors`
- "achilles", "ankle" -> `calves`
- "hip joint" -> `hip_flexors`

### Tissue reloading analytics

Active injuries link to the workout history to monitor post-injury tissue
reloading:
1. **Pre-injury baseline ($\bar{S}_{\text{pre}}$):** calculated as the average
   weekly working sets over the 4-week window prior to injury date,
   $[T_{\text{injury}}-28\text{d}, T_{\text{injury}})$.
2. **Current-week load ($S_{\text{curr}}$):** total working sets performed for
   the injured muscle group in the current calendar week.
3. **Rehab volume ($R_{\text{curr}}$):** total sets and volume (kg) logged with
   the `rehab` purpose tag in the current calendar week; tracked therapeutically
   without triggering reload volume cautions.
4. **Caution alert:** evaluates when $S_{\text{curr}} \ge 6$ and
   $(\bar{S}_{\text{pre}} = 0 \lor S_{\text{curr}} > 1.30 \times \bar{S}_{\text{pre}})$.
5. **Privacy:** all reload analytics are computed locally and strictly
   owner-private.

## Server schema

Table: `app_public.injuries`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `owner_user_id` | `uuid` | No | `auth.uid()` | Row owner, references `auth.users(id)` on delete cascade |
| `id` | `text` | No | | Client-generated UUID string |
| `muscle_group_id` | `text` | Yes | `null` | FK to `app_public.muscle_groups(owner_user_id, id)` |
| `side` | `text` | Yes | `null` | Side indicator: `left`, `right`, or `bilateral` |
| `status` | `text` | No | | Lifecycle status: `acute`, `managing`, `monitoring`, `resolved` |
| `pain_score` | `integer` | Yes | `null` | Pain score between 0 and 10 |
| `label` | `text` | No | | Athlete's descriptive label |
| `notes` | `text` | Yes | `null` | Extended injury notes |
| `contraindications` | `text` | Yes | `null` | Movement contraindications |
| `started_at` | `bigint` | No | | Timestamp in epoch milliseconds |
| `resolved_at` | `bigint` | Yes | `null` | Timestamp in epoch milliseconds |
| `created_at` | `bigint` | No | | Creation timestamp in epoch milliseconds |
| `updated_at` | `bigint` | No | | Update timestamp in epoch milliseconds |
| `deleted_at` | `bigint` | Yes | `null` | Soft deletion tombstone timestamp in epoch ms |
| `client_updated_at_ms`| `bigint` | No | | Monotonic LWW key |
| `server_received_at` | `timestamptz` | No | `now()` | Pull cursor ordering axis |

### Primary key and foreign keys

- Primary key: `(owner_user_id, id)`
- Foreign key: `(owner_user_id, muscle_group_id)` references
  `app_public.muscle_groups(owner_user_id, id)` on delete set null (muscle_group_id)
  `DEFERRABLE INITIALLY DEFERRED`.

### Indexes

- `injuries_owner_received_idx`: `(owner_user_id, server_received_at)`
- `injuries_muscle_group_id_idx`: `(muscle_group_id)`
- `injuries_deleted_at_idx`: `(deleted_at)`
- `injuries_started_at_idx`: `(started_at)`

### Triggers and RLS

- Structural triggers:
  - `injuries_touch_server_received_at`: BEFORE UPDATE when `(new is distinct from old)`
    execute function `app_public.touch_server_received_at()`
  - `injuries_owner_user_id_immutable`: BEFORE UPDATE execute function
    `app_public.enforce_owner_user_id_immutable()`
- Row-level security:
  - Enabled with four permissive owner policies (`injuries_owner_select`,
    `injuries_owner_insert`, `injuries_owner_update`, `injuries_owner_delete`).
  - Restrictive policy `injuries_direct_app_only` requires
    `((select auth.jwt())->>'client_id') is null`.

## Sync v2 integration

`injuries` is a canonical Sync v2 entity table:
- **Topological layer:** Layer 1 in `TOPO_LAYERS` in
  `apps/mobile/src/sync/topo-order.ts` (child of Layer 0 `muscle_groups`).
- **Wire envelope:** fields mapped in `ENTITY_FIELDS` in
  `apps/mobile/src/sync/cycle.ts`.
- **FK preflight:** registered in `SYNCABLE_FK_GRAPH` in
  `apps/mobile/src/sync/fk-graph.ts` referencing `muscle_groups`.
- **Wipe helper:** hard-deleted by `app_public.dev_wipe_my_data()` in
  topological order before `muscle_groups`.
- **Error tokens:**
  - `INJURY_NOT_FOUND`: referenced injury row does not exist or was deleted.
  - `INVALID_ANATOMY_REFERENCE`: referenced `muscle_group_id` does not exist for owner.
  - `INJURY_PERMISSION_REQUIRED`: unauthorized caller attempted to mutate injury state.
