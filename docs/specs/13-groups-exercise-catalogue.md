# Groups + Group Exercise Catalogue Milestone

> **Owns:** the planned groups, group exercise catalogue, private-to-group exercise mapping, and shared workout projection milestone. **Not here:** generic social features, comments/reactions, or local-first group sync implementation details. **Load when:** planning or implementing groups, group catalogues, private exercise mapping, group workout sharing, or related RLS/API work.

## Milestone metadata

- Milestone ID: `M-groups-catalogue`
- Title: Groups + Group Exercise Catalogue + Private-to-Group Exercise Mapping
- Status: `planned`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- API/AuthN/AuthZ: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync v2 contract: `docs/specs/tech/sync-v2-server-contract.md`

## Milestone objective

Introduce private training groups that share a canonical group exercise vocabulary
while preserving each member's private exercise catalogue and workout ownership.
A group receives a member-authorized shared projection of a workout; it never owns
or directly reads the member's private workout rows.

## Current codebase analysis

### Private exercise catalogue

- The mobile app currently models exercises as private, user-scoped local rows in
  `exercise_definitions`. The local schema includes an `id`, `name`, soft-delete
  timestamp, Sync v2 dirty bit, local LWW timestamp, and created/updated
  timestamps. There is no existing group/global exercise catalogue column or
  ownership distinction in this table.
- Exercise-to-muscle metadata is modeled separately in
  `exercise_muscle_mappings`, keyed by local `exercise_definition_id` and
  `muscle_group_id`, with `weight`, `role`, soft-delete, and Sync v2 fields.
- The exercise catalogue repository returns private exercise graphs shaped like
  `{ id, name, deletedAt, mappings }`, filtering out soft-deleted exercises by
  default.
- Saving a private exercise writes to `exercise_definitions`, marks the row dirty
  for Sync v2, and reconciles muscle mapping rows with tombstones rather than hard
  deletes.

### Private sessions, session exercises, and sets

- Workout sessions are private local rows in `sessions`, with status, timestamps,
  materialized duration, soft-delete, dirty-bit, local LWW timestamp, and
  created/updated timestamps.
- Session exercises are child rows of private sessions. They preserve both the
  canonical private `exercise_definition_id` and display metadata such as `name`
  and `machine_name`. This is the key current affordance for rendering the same
  workout through a different group exercise lens without mutating the private
  workout.
- Sets are child rows of session exercises and include actual performed values
  plus planned target values and `performance_status`.
- The session draft repository expects each session exercise to have an
  `exerciseDefinitionId` and blocks normal mutation of completed sessions. Sharing
  should therefore be a separate post-completion action, not a mutation of the
  completed private session graph.

### Privacy and Sync v2 posture

- Sync v2 is scoped to nine user-owned entity tables: `gyms`, `sessions`,
  `session_exercises`, `exercise_sets`, `exercise_definitions`,
  `exercise_muscle_mappings`, `exercise_tag_definitions`,
  `session_exercise_tags`, and `muscle_groups`.
- The Sync v2 client uses FK-safe topological layers. Exercise definitions and
  muscle groups are Layer 0; sessions and exercise muscle mappings are Layer 1;
  session exercises are Layer 2; exercise sets and session exercise tags are
  Layer 3.
- The backend mirror of the Sync v2 domain uses `owner_user_id` and RLS policies
  following `owner_user_id = auth.uid()`. The `sync_pull` RPC also explicitly
  filters each leg by the authenticated user.
- There is no existing first-class `groups`, `group_memberships`, group exercise
  catalogue, group feed, or group sharing model in the inspected schema/app
  paths. This milestone is a new domain area.

## Proposed data model and migrations

### Design principles

1. Private rows stay private. Existing `sessions`, `session_exercises`,
   `exercise_sets`, `exercise_definitions`, and `exercise_muscle_mappings` remain
   user-owned Sync v2 entities.
2. Groups own catalogue vocabulary, not workouts. Group exercise definitions are
   group-owned canonical labels and metadata.
3. Users own their mappings. A private-to-group mapping is controlled by the user
   whose private exercise is being mapped.
4. Shared workouts are projections. Sharing creates group-visible projection rows
   that snapshot enough data to render in the group feed without transferring
   ownership of the source workout.
5. Admin request flow is separate from sharing. If a private exercise is
   unmapped, a member can ask admins to create or choose a group exercise.

### Backend tables

Add these tables under `app_public` in Supabase migrations.

#### `groups`

Represents private training circles.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `name text not null check (length(trim(name)) > 0)`
- `owner_user_id uuid not null references auth.users(id) on delete cascade`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz`

#### `group_memberships`

Represents membership and role.

Suggested columns:

- `group_id uuid not null references app_public.groups(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `role text not null check (role in ('owner', 'admin', 'member'))`
- `status text not null check (status in ('active', 'invited', 'left', 'removed'))`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `primary key (group_id, user_id)`

#### `group_exercise_definitions`

The canonical group exercise catalogue.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `group_id uuid not null references app_public.groups(id) on delete cascade`
- `name text not null`
- `normalized_name text not null`
- `notes text`
- `created_by_user_id uuid not null references auth.users(id)`
- `updated_by_user_id uuid references auth.users(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz`
- `unique (group_id, normalized_name)`

Use `archived_at` instead of hard deletion so historical shared projections can
continue to reference old group exercises.

#### `group_exercise_muscle_mappings`

Optional for the first MVP slice, but recommended if the group catalogue should
carry canonical muscle metadata.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `group_exercise_definition_id uuid not null references app_public.group_exercise_definitions(id) on delete cascade`
- `muscle_group_id text not null`
- `weight numeric not null check (weight > 0)`
- `role text check (role in ('primary', 'secondary', 'stabilizer'))`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz`
- `unique (group_exercise_definition_id, muscle_group_id)`

Open decision: current `muscle_groups` are per-user synced entities, not a global
taxonomy. For MVP, prefer storing stable seed muscle group IDs as text and avoid a
foreign key into user-owned `muscle_groups`.

#### `private_group_exercise_mappings`

User-owned mapping from a private exercise definition to a group exercise.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `group_id uuid not null references app_public.groups(id) on delete cascade`
- `private_exercise_definition_id text not null`
- `group_exercise_definition_id uuid not null references app_public.group_exercise_definitions(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz`
- `unique (user_id, group_id, private_exercise_definition_id)`

The `private_exercise_definition_id` is from the user's private Sync v2 namespace.
This table must not grant group admins access to the private exercise row itself.

#### `group_exercise_creation_requests`

Tracks unmapped private exercises that members ask admins to resolve.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `group_id uuid not null references app_public.groups(id) on delete cascade`
- `requester_user_id uuid not null references auth.users(id) on delete cascade`
- `private_exercise_definition_id text not null`
- `requested_name text not null`
- `requested_notes text`
- `requested_metadata jsonb not null default '{}'::jsonb`
- `requested_muscle_mappings jsonb not null default '[]'::jsonb`
- `status text not null check (status in ('pending', 'approved_as_new', 'mapped_existing', 'created_different', 'rejected', 'cancelled'))`
- `resolved_by_user_id uuid references auth.users(id)`
- `resolved_group_exercise_definition_id uuid references app_public.group_exercise_definitions(id)`
- `resolution_note text`
- `created_at timestamptz not null default now()`
- `resolved_at timestamptz`
- `updated_at timestamptz not null default now()`

The request stores a member-approved snapshot of the private definition proposed
to admins. Admins should not gain ongoing read access to the requester's private
exercise catalogue.

#### `group_shared_workout_sessions`

Header row for a group-visible workout projection.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `group_id uuid not null references app_public.groups(id) on delete cascade`
- `owner_user_id uuid not null references auth.users(id) on delete cascade`
- `source_session_id text not null`
- `started_at timestamptz`
- `completed_at timestamptz`
- `duration_sec integer check (duration_sec is null or duration_sec >= 0)`
- `caption text`
- `visibility_status text not null check (visibility_status in ('visible', 'hidden_by_owner', 'removed_by_admin'))`
- `projection_version integer not null default 1`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `unique (group_id, owner_user_id, source_session_id)`

#### `group_shared_workout_exercises`

Exercise rows within the group projection.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `shared_session_id uuid not null references app_public.group_shared_workout_sessions(id) on delete cascade`
- `order_index integer not null check (order_index >= 0)`
- `source_session_exercise_id text not null`
- `source_private_exercise_definition_id text`
- `group_exercise_definition_id uuid not null references app_public.group_exercise_definitions(id)`
- `group_exercise_name_snapshot text not null`
- `private_exercise_name_snapshot text`
- `machine_name_snapshot text`
- `created_at timestamptz not null default now()`
- `unique (shared_session_id, order_index)`

The group exercise name snapshot keeps historical feed rendering stable even if
an admin later renames the group exercise.

#### `group_shared_workout_sets`

Set rows within the group projection.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `shared_exercise_id uuid not null references app_public.group_shared_workout_exercises(id) on delete cascade`
- `order_index integer not null check (order_index >= 0)`
- `weight_value text not null default ''`
- `reps_value text not null default ''`
- `set_type text`
- `performance_status text`
- `created_at timestamptz not null default now()`
- `unique (shared_exercise_id, order_index)`

MVP can include actual performed set values only. Planned targets can be deferred
unless product explicitly wants shared planned workout execution.

### Local mobile schema and sync scope

Decision: group milestone tables are initially **out of existing Sync v2 scope**.

Rationale:

- Existing Sync v2 is owner-user scoped and relies on `owner_user_id = auth.uid()`
  RLS.
- Group rows are membership-scoped and sometimes admin-scoped.
- Shared workout projections are intentionally not the user's private workout
  rows.
- Adding group tables to Sync v2 would mix two authorization models in one
  pull/push pipeline.

Guardrails:

- Do not add group tables to `TOPO_LAYERS` in MVP.
- Do not alter existing `sync_push` or `sync_pull` to expose group rows.
- Use explicit Supabase RPCs/views for group operations.
- Add backend contract tests proving private Sync v2 tables remain inaccessible
  cross-user while group projections are visible only to active group members.

## RLS and security implications

### Security invariants

1. A user can only see their own private exercise/session rows through Sync v2.
2. A group member can see group catalogue rows for groups where their membership
   is active.
3. Only group owners/admins can create, update, or archive group catalogue rows.
4. A user can create, update, and delete their own private-to-group mappings only
   if they are an active member of that group.
5. Group admins cannot browse a user's private exercise catalogue or private
   sessions.
6. A user can share only their own private completed sessions.
7. Group feed readers see only projections for groups where they are active
   members.
8. Leaving or removal from a group removes read access to group catalogue/feed on
   future reads.

### Recommended helper functions

Add policy helpers for group access checks:

- `app_public.is_active_group_member(group_id uuid, user_id uuid)`
- `app_public.is_group_admin(group_id uuid, user_id uuid)`
- `app_public.is_group_owner(group_id uuid, user_id uuid)`

If implemented as `security definer`, lock `search_path` and keep the function
body minimal to avoid privilege surprises.

### Policy sketch

- `groups`: active members can read; owners/admins can update mutable fields;
  group creation should go through an RPC that also inserts owner membership.
- `group_memberships`: active members can read membership as product allows;
  owner/admin manages membership; a member can leave by updating own status to
  `left`.
- `group_exercise_definitions`: active members can read; owner/admin can write.
- `private_group_exercise_mappings`: mapping owner can read/write their own
  mappings when active in the group; admins should not get broad private mapping
  access unless a specific product/admin use case is approved.
- `group_exercise_creation_requests`: requester can create/read/cancel own
  pending requests; admins can list and resolve group requests.
- `group_shared_workout_sessions` and children: active members can read visible
  projections; owner can hide own shares; admins can moderate/remove; arbitrary
  direct child-row writes should be blocked.

## API and service-layer changes

### Backend RPCs/views

Add server-mediated operations for cross-row invariants:

1. `create_group(name)`
   - Creates a group and owner membership transactionally.
2. `list_my_groups()`
   - Returns active memberships and group summaries.
3. `list_group_exercise_catalog(group_id)`
   - Returns group exercise definitions and optional muscle metadata.
4. `save_group_exercise_definition(payload)`
   - Admin-only create/update/archive operation.
5. `list_private_group_exercise_mappings(group_id)`
   - Returns the caller's mappings for a group.
6. `upsert_private_group_exercise_mapping(payload)`
   - Validates membership and same-group catalogue target, then upserts mapping.
7. `create_group_exercise_request(payload)`
   - Inserts a member-approved snapshot of an unmapped private exercise.
8. `resolve_group_exercise_request(payload)`
   - Admin-only transactional resolution: approve as-is, map existing, create
     different, or reject.
9. `share_session_to_group(payload)`
   - Validates active membership, source session ownership/completion, and full
     mapping coverage; inserts projection header/exercises/sets transactionally.
10. `list_group_feed(payload)`
   - Returns paginated group shared workout projections.

### Mobile service modules

Add a new area under `apps/mobile/src/groups/`:

- `api.ts` for Supabase RPC wrappers.
- `types.ts` for group, catalogue, mapping, request, and feed types.
- `group-catalog.ts` for catalogue operations.
- `group-exercise-mappings.ts` for private-to-group mapping operations.
- `group-share-session.ts` for share orchestration.
- `group-requests.ts` for request/admin resolution operations.
- `share-projection.ts` for pure local share-readiness checks.

These services should reuse the authenticated Supabase mobile client, normalize
RLS/auth errors into UI-safe states, and never use `service_role` credentials.

### Share-readiness projection builder

Add a pure module that reads a completed private session graph locally, extracts
distinct private exercise definition IDs, compares them against the selected
group's mappings, and returns one of:

- `ready`: all exercises are mapped and a share RPC input can be built.
- `unmapped`: one or more private exercises require mapping/request/cancel.
- `invalid`: the session is missing, deleted, or not completed.

### Sync-before-share strategy

MVP should require a successful Sync v2 cycle before creating the group
projection. This lets `share_session_to_group` read and validate the source
private session graph on the server under existing private RLS, instead of
trusting a client-supplied workout payload.

Flow:

1. User taps Share to Group.
2. App runs or requests Sync v2.
3. If relevant private rows remain dirty or sync fails, show a clear retry/sign-in
   state and do not call the share RPC.
4. When the server copy is current enough, call `share_session_to_group`.

## UI and UX flow

### New navigation areas

- Groups list: my groups, create group, open group.
- Group detail: feed, catalogue, members, and admin requests.
- Group exercise catalogue: member read/search, admin create/edit/archive.
- My exercise mappings: private exercise to group exercise mapping status.
- Share completed session: group picker, readiness check, preview, confirm.

### Happy path: all exercises mapped

1. User opens a completed session.
2. User taps Share to Group.
3. User chooses a group.
4. App loads the local private session graph, the caller's mappings for that
   group, and the group exercise catalogue.
5. If every exercise is mapped, show a preview using group exercise names.
6. App runs the sync-before-share check.
7. App calls `share_session_to_group`.
8. Group feed shows the projection.

Use copy that reinforces: "Your workout stays yours. The group sees a shared view
using the group catalogue."

### Unmapped exercise flow

For each unmapped private exercise, the user can:

1. Map it to an existing group exercise.
2. Request that an admin create a new group exercise based on a member-approved
   private definition snapshot.
3. Cancel sharing.

Sharing remains blocked until all private exercises in the session are mapped.

### Admin request flow

Admins can resolve requests by:

1. Approving as-is: create a group exercise from the request snapshot and map the
   requester's private exercise to it.
2. Mapping to existing: select an existing group exercise and create the
   requester mapping.
3. Creating different: create a different group exercise, then map the requester
   to it.
4. Rejecting: mark the request rejected with an optional note and create no
   mapping.

### Feed rendering

Member-facing group feed cards should show:

- Member display name.
- Completed date/time.
- Duration.
- Group exercise name snapshots.
- Actual set values.

Do not show source private session IDs, source private exercise IDs, private
exercise names, or private notes by default. Owner-only detail can optionally show
"Mapped from your private exercise: X".

## Task breakdown

### Phase 0: Product and spec alignment

1. Write and review this milestone spec.
2. Confirm MVP/non-MVP boundaries and privacy invariants with product.
3. Decide whether group catalogue muscle mappings are in MVP.

### Phase 1: Backend foundation

1. Add `groups` and `group_memberships` schema, helper functions, RLS, and
   contract tests.
2. Add `group_exercise_definitions` and optional
   `group_exercise_muscle_mappings`, admin RPCs, RLS, and contract tests.
3. Add `private_group_exercise_mappings`, mapping RPCs, RLS, and contract tests.

### Phase 2: Requests and admin workflow

1. Add `group_exercise_creation_requests`, RLS, user request RPC, admin list RPC,
   and admin resolution RPC.
2. Cover all resolution actions in backend tests: approve as-is, map existing,
   create different, and reject.

### Phase 3: Shared workout projection backend

1. Add `group_shared_workout_sessions`, `group_shared_workout_exercises`, and
   `group_shared_workout_sets` with RLS.
2. Implement `share_session_to_group` RPC.
3. Implement paginated group feed RPC/view.
4. Add backend contract tests for member visibility, non-member denial,
   cross-user private denial, unmapped rejection, and same-group mapping checks.

### Phase 4: Mobile service layer

1. Add `apps/mobile/src/groups/*` API and type modules.
2. Add pure share-readiness projection builder.
3. Add sync-before-share orchestration.
4. Unit-test service error handling and readiness states.

### Phase 5: Mobile UI MVP

1. Add groups list and create group UI.
2. Add group detail feed/catalogue screens.
3. Add admin group catalogue management.
4. Add my private-to-group mappings UI.
5. Add completed-session share flow with map/request/cancel branches.
6. Add admin request queue UI.

### Phase 6: End-to-end hardening

1. Expand backend contract suite for groups, catalogue, mappings, requests,
   projections, and RLS negative paths.
2. Add mobile tests for service modules, share readiness, mapped share, unmapped
   flow, and admin request resolution UI.
3. Add or update Maestro coverage for the MVP happy path if the UI surfaces are
   included in the same implementation wave.

## Risks and open questions

1. **Sync-before-share:** A session may be local-only or dirty when sharing is
   attempted. MVP should require a successful Sync v2 cycle before sharing.
2. **Muscle taxonomy:** Current `muscle_groups` are per-user synced rows. Decide
   whether MVP stores stable muscle IDs as text or introduces a global/system
   taxonomy table.
3. **Private exercise metadata:** Current private exercise definitions store a
   name, with muscle metadata in separate mapping rows. Decide what request
   snapshots should include if richer private notes/metadata are not available
   yet.
4. **Admin data visibility:** Request snapshots must be explicit user-approved
   disclosures, not a path for admins to browse private catalogues.
5. **Historical rendering:** Store group exercise name snapshots so old shared
   workouts do not change unexpectedly after catalogue renames.
6. **Mapping changes after share:** Existing shared projections should not
   dynamically recompute from current mappings. Mapping is applied at share time.
7. **Multi-group sharing:** Allow one projection per
   `(group_id, owner_user_id, source_session_id)` so different groups can use
   different vocabularies.
8. **Membership lifecycle:** Decide whether leaving a group hides a member's past
   shares or only removes that member's future read access.
9. **Moderation:** Prefer visibility/archive fields over hard deletes.
10. **Test matrix:** This milestone crosses backend RLS, mobile UI, auth, and
    sync-before-share behavior. Backend/RLS work requires backend gates; UI work
    requires fast and frontend gates.

## Suggested MVP cut

### Include

- Groups with owner/admin/member roles.
- Admin-maintained group exercise catalogue.
- User-owned private-to-group exercise mappings.
- Completed-session sharing to a group through a server-created projection.
- Unmapped exercise flow: map existing, request new, or cancel.
- Admin request queue: approve as-is, map existing, reject; include create
  different if the admin catalogue form is already available.
- Security tests for non-member denial, member/admin boundaries, private Sync v2
  cross-user denial, same-group mapping checks, and ownership checks when
  sharing.

### Defer

- Offline queued group shares.
- Real-time group feed subscriptions.
- Group invite links.
- Comments, reactions, and generic social feed features.
- Group analytics.
- Dynamic re-rendering of old shares after remapping.
- Local-first group data sync.
- Rich private exercise notes/metadata unless a parallel exercise metadata
  milestone exists.
- Complex former-member retention policy beyond visibility/read-access rules.

## Acceptance criteria

1. Existing private Sync v2 exercise/session/set ownership remains unchanged.
2. Group catalogue rows are readable by active group members and writable only by
   group owners/admins.
3. Private-to-group mappings are owned by the mapping user and cannot expose
   private exercises to admins or other members.
4. A completed private session can be shared only by its owner and only after all
   session exercises are mapped to group exercises in the selected group.
5. Shared group feed rows render from projection snapshots using group exercise
   names.
6. Unmapped private exercises force a user choice: map existing, request admin
   creation, or cancel sharing.
7. Admin request resolution can approve as-is, map existing, create different, or
   reject without granting admins direct private catalogue access.
8. Backend RLS tests cover unauthenticated denial, non-member denial,
   member/admin boundary checks, and cross-user private data denial.
9. The milestone remains out of existing Sync v2 scope unless a future spec
   explicitly designs a separate group sync model.
