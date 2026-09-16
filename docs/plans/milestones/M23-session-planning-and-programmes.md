# M23 - Session Planning and Programmes

## Milestone metadata

- Milestone ID: `M23`
- Title: Milestone: Session Planning and Programmes
- Status: `planned`

## Parent references

- Project directives: `AGENTS.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing and gates: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- UX standard and current UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- API authorization: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`
- Origin: [GitHub issue #262 - Sessions plans](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/262)

## Milestone objective

A person can plan one future training session or an ordered programme of
several sessions, sync those plans across devices, and use either a complete
plan or one exercise block in the existing recorder. Planned work is additive:
the person can pull the next squat block from a programme into an otherwise
freeform session, perform unrelated exercises, and explicitly complete that
block so the programme exposes the next one. A separately authorized coaching
agent can inspect the upcoming queue, page through exact performed-workout
history, and create the same plan structures through MCP. Human and agent
creation converge on one domain model; neither route can mutate performed
workout history or advance programme progress.

## Boundary decisions

1. **Plans are a separate synced domain.** Do not add `planned` to
   `sessions.status`. The existing `sessions` graph remains performed workout
   state (`active | completed`). Plan rows always remain absent from history,
   analytics, records, and group activity; only confirmed actual rows in the
   materialized performed graph can contribute there.
2. **Using planned work is materialization, not a recorder mode.** Starting a
   complete plan materializes all of its available blocks; adding one block
   materializes only that `session_plan_exercises` row and its target sets. Both
   paths create ordinary `session_exercises -> exercise_sets` rows that the
   existing recorder already understands. Plan rows never become live recorder
   state.
3. **One model, two writers.** The mobile planner writes locally and syncs in
   the normal way. The agent API writes the same server rows atomically; the
   phone receives them through normal `sync_pull`.
4. **Agents create; people remain in control.** M23 agents may read upcoming
   plans and create a one-off plan or programme. They cannot edit/delete plans,
   start a workout, or insert/update/delete any performed-session row.
5. **Write permission is separate and opt-in.** Existing OAuth grants keep
   their current read-only access. Absence of a current per-client planning
   permission denies all three planning tools; the two new history tools remain
   read-only under the existing base grant. The permission cannot be represented
   as a Supabase custom OAuth scope, so it is app-owned and managed in Connected
   Agents.
6. **Programme is the product term.** A wave is an ordered programme a person
   or coach can name as such. V1 stores the order and targets but does not
   encode a wave formula, progression algorithm, or recurrence engine.
7. **Coaching history is complete by contract.** Any collection used for
   coaching is either keyset-paginated to exhaustion or returned as an exact
   database-side aggregate. A hidden row cap, a `truncated` boolean without a
   continuation cursor, or a "personal record" calculated from only the
   returned page is not acceptable. Existing response-size and rate limits
   remain safety boundaries, but callers must be able to continue reading
   without losing qualifying history.
8. **The exercise block is the unit of consumption and progress.** One plan
   block is one `session_plan_exercises` row plus its ordered target sets. A
   person may attach one block to an existing active session or create a new
   session from it; other planned blocks and freeform recorder work are
   unaffected. Attaching never advances the programme. Only explicit Complete
   or Skip resolves the block. Block identity belongs to the performed exercise
   card and source-set identity belongs to each materialized planned set, so
   manual warm-ups and planned work may coexist and reorder inside one card.

## Product behavior

### One-off plans

- A signed-in person can create, edit, reschedule, duplicate, and delete an
  unused plan, including while offline. After partial use, attached/resolved
  blocks are immutable while future unattached blocks remain editable under the
  lifecycle rules locked by T01.
- A plan has a title, an optional gym, an optional scheduled date/time, one or
  more ordered exercises, and one or more ordered target sets per exercise.
- No scheduled time means the plan appears in an **Unscheduled** queue rather
  than being rejected or assigned an invented date.
- Reps are required positive integers. Weight is optional and non-negative;
  blank means "choose during the workout". Set type is optional and uses the
  recorder's existing set-type vocabulary. The current load unit remains kg.
- Exercise rows retain an owned exercise-definition reference when available
  plus the durable exercise-name and machine-name snapshot used by performed
  sessions.

### Programmes

- A programme has a name, optional description, and two or more ordered
  session plans.
- Each session can be scheduled or unscheduled and has its own complete
  exercise/set targets.
- People can create and edit the programme and its unused/future blocks as one
  coherent flow. Reordering changes programme order, not scheduled time and
  cannot rewrite already attached/resolved source identity.
- Each planned exercise is also an independently consumable block. A squat
  wave may therefore contain one squat block in each ordered child plan while
  the person's performed sessions contain any other work they choose.
- The programme exposes the earliest unresolved block in programme-order then
  exercise-order. People may also select another available block explicitly;
  V1 has one ordered stream and does not infer independent tracks from exercise
  names.
- Starting one complete programme session or attaching one of its blocks does
  not automatically start, reschedule, generate, or resolve another block.
  Future unresolved blocks remain planned work.

### Using a complete plan or one block

1. **Start all** is a convenience for a complete plan. With no active session,
   one local transaction creates the active session and materializes every
   available block. If another active session exists, BoGa offers Resume and
   does not merge, replace, or silently complete it; the person can instead add
   individual blocks to that active session.
2. **Add block** materializes exactly one source block. If a session is active,
   the block is appended to it. Otherwise BoGa creates an active session using
   the source plan's gym and appends the block. The rest of the session remains
   freeform and no other plan block is consumed.
3. Add block may attach to an existing compatible `session_exercises` row for
   the same exercise definition. An explicitly selected compatible card wins;
   otherwise exactly one unsourced match is selected automatically. With no
   match BoGa creates a card, and with multiple possible matches it asks rather
   than guessing. A performed exercise card may reference at most one source
   plan block, while manual sets may remain on that card.
4. `session_exercises.source_plan_exercise_id` identifies the source block.
   Each materialized target row copies weight/reps/type into the existing
   `exercise_sets.planned_*` fields and records its source in
   `exercise_sets.source_plan_set_id`; manual rows leave that field null. Actual
   weight and reps remain blank and `performance_status` starts as `planned`.
   On an existing card, copied targets take the next dense performed order
   indexes after its current live sets while retaining their source-target
   order, so existing warm-ups remain above them by default.
   Deterministic IDs plus partial uniqueness guards allow at most one live
   performed exercise per source block and one live performed set per source
   target. Whole-plan starts additionally set `sessions.source_plan_id`;
   individual-block sessions leave it null. Retries and competing devices must
   converge without two live uses.
5. Attaching a block does not resolve it. The source block remains `pending`
   until the person explicitly marks it **Complete** after at least one valid
   confirmed source-derived set, or explicitly **Skip**s it without claiming
   performance. Manual warm-ups alone cannot complete it, while target
   deviations on a source-derived row never prevent completion. Complete/Skip
   sets the block's resolution timestamp and is the only event that advances
   the programme; an attached-but-unresolved block remains current.
6. Parent plan/programme labels (`planned | in_progress | completed`) are
   derived from block attachment and resolution rather than stored as a
   whole-plan `started` flag. Attached/resolved source blocks and their targets
   are immutable snapshots; future unattached blocks remain editable. Recorder
   edits never overwrite the source targets.

### Ordering manual and planned sets

- Performed-set order is independent of immutable source-plan order. Reordering
  changes only `exercise_sets.order_index` in the performed graph; it never
  changes `source_plan_set_id`, planned target values, confirmation state, or
  the source `session_plan_sets.order_index`.
- A person may add manual warm-up or other sets before or after attachment and
  move any performed row above, below, or between source-derived rows. This
  covers both warm-ups-first then Add block and Add block first then warm-ups;
  newly added manual rows use the recorder's normal append behavior until moved.
- Reordering is a new recorder capability with lightweight playlist-style
  direct manipulation: each movable set has a compact, low-emphasis grab
  handle, and dragging it lifts the row and shows its insertion position. It
  requires no separate reorder mode and does not add always-visible Move
  buttons to every row. VoiceOver custom actions and keyboard/overflow
  fallbacks expose Move earlier/Move later so drag is not the only accessible
  path. Autosave, sync, hydration, completion, and completed-edit preserve the
  resulting performed order and every row's provenance.

### Agent history reads

- Exercise search remains keyset-paginated and every page is complete for its
  query, muscle, and equipment filters. Database-side filtering replaces the
  current bounded candidate preselection; no matching exercise may disappear
  because an intermediate mapping or historical-equipment query reached an
  internal row cap.
- An agent can page through the full performed-set history for one owned
  exercise in stable completed-session order. Pages include the session and
  exercise-block identity needed to reconstruct performances and expose an
  opaque continuation cursor until every qualifying row has been drained.
- Exercise context keeps a compact recent preview, but lifetime personal
  records, total history counts, and last-performed time are exact aggregates
  over all qualifying completed history. They are never computed from the
  preview page or from a fixed number of exercise blocks. Exact calculations
  use the canonical performed-set parsing and volume/record semantics; a SQL
  implementation must pass the same shared calculation vectors as mobile.
- An agent can request one completed workout by stable session ID and page
  through every performed set in exercise/set order. The session header and
  totals are exact and repeated consistently across pages; a page never reports
  a partial count or volume as if it were complete.
- History reads include only non-deleted completed sessions and performed sets.
  Planned/unperformed rows remain excluded, matching the app's history,
  records, analytics, and group-record semantics.
- Page sizes, cursor shapes, filter binding, and deterministic tie-breakers are
  locked in the T01 contract. If concurrent history edits invalidate a coherent
  drain, the API returns a stable restartable cursor error rather than silently
  skipping or duplicating rows.

## Data and sync contract

M23 expands Sync v2 from ten to fourteen user-owned entity types.

| Entity | Purpose | Important fields / rules |
| --- | --- | --- |
| `training_programmes` | Named container for an ordered series. | `name`, optional `description`, normal sync/timestamp/tombstone fields. |
| `session_plans` | One future session, standalone or in a programme. | Optional `programme_id` and `gym_id`; `title`; optional `scheduled_for`; optional `programme_order_index`; provenance `human | agent`; derived lifecycle from child blocks; normal sync/timestamp/tombstone fields. |
| `session_plan_exercises` | Ordered, independently consumable plan blocks. | `session_plan_id`, optional owned `exercise_definition_id`, `order_index`, `name`, optional `machine_name`; `progress_status = pending | completed | skipped`; nullable `resolved_at`; normal sync/timestamp/tombstone fields. Agent create inputs may only create `pending` blocks. |
| `session_plan_sets` | Ordered targets for one planned exercise. | `session_plan_exercise_id`, `order_index`, optional non-negative `target_weight_value`, positive `target_reps`, optional `target_set_type`; normal sync/timestamp/tombstone fields. |

Additional performed-domain field:

- `sessions.source_plan_id` is nullable, references the same owner's
  `session_plans` row, and has a partial uniqueness constraint for non-deleted
  rows. It is set only by whole-plan Start; manual and individual-block starts
  leave it null.
- `session_exercises.source_plan_exercise_id` is nullable, references the same
  owner's `session_plan_exercises` row, and has a partial uniqueness constraint
  for non-deleted rows. It is the block-level provenance and retry boundary;
  existing/manual exercise blocks leave it null.
- `exercise_sets.source_plan_set_id` is nullable, references the same owner's
  `session_plan_sets` row, and has a partial uniqueness constraint for
  non-deleted rows. It preserves source identity independently of performed
  set ordering; existing/manual sets leave it null.

A non-null source-set link is valid only when its performed set belongs to a
`session_exercises` row sourced from that plan set's parent block. An unsourced
exercise card cannot contain source-derived sets; a sourced card may freely mix
matching source-derived rows with null-linked manual rows. T01 must lock the
database/sync enforcement shape for this cross-level invariant.

All server primary and foreign keys remain owner-scoped composites. Every new
sync table uses the existing direct-app-only OAuth RLS policy, explicit table
grants, LWW/tombstone behavior, server receipt ordering, and account wipe
contract. Agent OAuth tokens still cannot call PostgREST or `sync_push`
directly.

The expected five-layer topology is:

```text
L0  gyms, exercise_definitions, muscle_groups, training_programmes
L1  session_plans, exercise_muscle_mappings, exercise_tag_definitions, exercise_group_links
L2  sessions, session_plan_exercises
L3  session_exercises, session_plan_sets
L4  exercise_sets, session_exercise_tags
```

The new `exercise_sets.source_plan_set_id -> session_plan_sets` edge is from L4
to L3, so it does not add an entity or another layer; the expected count remains
fourteen entities in five layers.

The schema task must confirm this graph against the actual foreign keys and
update the canonical topology if an implementation detail changes it. It also
updates push/pull projections, per-layer cursors, dirty counts, FK preflight,
schema drift, restore/first-sync, tombstones, and account wipe; adding local
tables alone is not complete.

## Agent authorization and API contract

### Permission boundary

- `public.agent_plan_permissions` is outside Sync v2 and keyed by owner plus
  OAuth client. It records the current grant's `granted_at` value and whether
  plan access is enabled.
- Connected Agents shows **Allow this coach to create plans**. Its disclosure
  says this also lets the client read the upcoming/unscheduled plan queue so it
  can avoid duplicates.
- Missing, false, or grant-timestamp-mismatched permission returns `403
  PLAN_PERMISSION_REQUIRED`. Existing grants therefore do not silently gain
  access, and revoking then re-authorizing a client defaults to disabled.
- Revocation or disabling the toggle takes effect on the next request. The
  agent API continues to validate the bearer token and live OAuth grant before
  consulting this permission.
- Normal app users can read/update only their own permission rows and only with
  a non-agent token. `anon` and OAuth direct access are denied. The service role
  is confined to the agent API and never enters the MCP service, consent app,
  or mobile app.

### Routes and atomicity

The existing path remains:

```text
MCP client -> services/boga-mcp -> functions/v1/agent-api
           -> service-role-only atomic RPC -> app_public plan tables
           -> normal sync_pull -> mobile
```

M23 adds:

- `GET /v1/agent/session-plans` — bounded upcoming and unscheduled plans;
- `POST /v1/agent/session-plans` — create exactly one complete plan graph;
- `POST /v1/agent/programmes` — create one programme and all of its ordered
  plan graphs in one transaction;
- `GET /v1/agent/exercises/:exerciseId/history` — keyset-paginated performed-set
  history for one exercise, with no fixed lifetime row cap;
- `GET /v1/agent/workouts/:sessionId` — an exact completed-workout header and
  keyset-paginated performed sets for one session.

M23 also upgrades the existing reads without breaking their current inputs:

- `/v1/agent/exercises` performs complete database-side muscle/equipment
  filtering before applying its public page limit; intermediate query caps may
  not silently narrow the result set;
- `/v1/agent/exercises/:exerciseId/context` computes lifetime records, counts,
  and `last_performed_at` across all qualifying history. Its bounded recent
  preview is explicitly a preview and is ordered by completed-session time;
- `/v1/agent/workouts/recent` remains a pageable compact index. Its exact
  counts/volume are computed independently of embedded preview rows, and the
  new workout-detail route is the continuation path for the complete graph.

All collection routes use opaque, filter-bound keyset cursors. Page responses
return `next_cursor` until exhaustion; internal safety limits must be surfaced
as continuation, never as silent omission. Aggregate fields documented as
exact are evaluated database-side across the full qualifying owner-scoped data
set and are invariant under requested page size.

Every route derives owner and client identity only from the validated token,
rejects identity-shaped request fields, validates a strict bounded JSON body,
checks that exercise and gym IDs belong to the owner, and returns the existing
versioned success/error envelope. A failed child row rolls back the whole
mutation.

Both POST routes require an opaque `idempotency_key`. A service-role-only
`public.agent_plan_write_receipts` row is keyed by owner, client, operation,
and key, and stores a payload hash plus the bounded result IDs—not the training
payload. Same key plus same payload returns the original result; same key plus
a different payload returns `409 IDEMPOTENCY_CONFLICT`. Concurrent requests
must have the same behavior.

`agent_access_audit` remains metadata-only: client, route/tool, request ID,
status, occurrence time, and duration. It never stores authorization headers,
request bodies, plan titles, exercises, or sets.

### MCP tools

M23 adds five tools, bringing the MCP surface from four tools to nine:

1. `get_exercise_history`
   - required owned `exercise_id`, plus bounded `limit` and opaque `cursor`;
   - drains performed sets in stable completed-session order and returns
     `next_cursor` until the exercise's qualifying history is exhausted;
   - `readOnlyHint: true`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
2. `get_workout_detail`
   - required completed `session_id`, plus bounded `limit` and opaque `cursor`;
   - returns an exact session header/totals and a page of performed sets in
     deterministic exercise/set order;
   - `readOnlyHint: true`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
3. `get_upcoming_session_plans`
   - bounded cursor/limit input, with an option to include unscheduled plans;
   - `readOnlyHint: true`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
4. `create_session_plan`
   - required `idempotency_key`, title, optional schedule/gym, and a bounded
     ordered exercise/set graph using owned exercise IDs;
   - `readOnlyHint: false`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
5. `create_training_programme`
   - required `idempotency_key`, name/description, and a bounded ordered list
     of complete session plan inputs;
   - the same non-destructive idempotent-write annotations.

The AI can use profile, complete exercise search, exact exercise context,
pageable exercise history, recent-workout indexing, and exact workout detail to
formulate a suggestion, then create it only after the user has enabled plan
access. A recommendation that depends on older history must drain the relevant
cursor; it must not present a preview page as the person's complete history.
Agent creation always writes `pending` blocks. Agents cannot attach, complete,
skip, or otherwise advance them. There is no server-hosted model or adaptive
recommendation engine in M23.

## Mobile UX contract

### Screen and route shape

- `/sessions` becomes the planning home as well as the complete session list,
  with clearly separated **Active**, **Upcoming**, **Unscheduled**, and
  **Completed** sections.
- `/session-plan/new` creates a one-off plan.
- `/session-plan/[planId]` views and edits a plan, offers Start all, Duplicate,
  and Delete where lifecycle permits, and offers Add block on each available
  exercise block. Attached/resolved blocks are read-only and link to their
  performed session; future unattached blocks remain editable.
- `/programme/new` creates a programme and its ordered sessions.
- `/programme/[programmeId]` views/edits the programme, identifies the next
  unresolved block, opens each plan, and can add an available block to the
  active recorder.
- The recorder's exercise picker adds **From programme** alongside empty-entry
  and completed-history reuse. The existing historical **Append plan** wording
  becomes **Repeat last** so it cannot be confused with authored plans.
- Start all dismisses into the existing `/session-recorder`; an active-session
  conflict routes to Resume. Add block appends to that active recorder instead
  of treating it as a conflict, or creates an active session when none exists.
  It attaches to an explicitly selected compatible same-exercise card, uses the
  only unambiguous unsourced match, or creates a new card. Multiple compatible
  cards require a choice.
- A programme-sourced exercise card identifies its source block, and each
  planned set identifies its source target independently from manual sets on
  the same card. The card exposes Complete block when it has a valid confirmed
  source-derived set. Completion is explicit, target mismatch is allowed, and
  the recorder remains open for arbitrary freeform work. Skip is a distinct
  programme action and never records work.
- The recorder gives each movable set a subtle playlist-style grab handle for
  direct reordering, without a separate mode or persistent up/down button
  clutter. Equivalent Move earlier/Move later accessibility actions remain
  available. A person can therefore add warm-ups before or after planned sets
  and move them above the working sets without losing block or per-set source
  identity.

Planner implementation belongs in a dedicated `apps/mobile/src/session-planner/`
domain module instead of adding a third mode to the recorder. UI composes the
existing exercise picker, gym picker, set-type vocabulary, shared tokens,
primitives, list rows, inputs, buttons, error/empty/loading patterns, and
accessibility conventions. New routes, components, and interactions are added
to the canonical UI docs in the same task that ships them.

### Required states

- local-first create/edit/delete/duplicate while offline;
- scheduled and unscheduled empty states;
- sync-restored agent-created plan;
- validation errors located at the relevant plan, exercise, or set;
- available, attached, completed, and skipped block states plus derived plan
  progress;
- active-session Start-all conflict with a single Resume action;
- block addition to an existing active session, mixed with freeform exercises;
- block attachment to a selected or unambiguous compatible exercise card,
  including a required choice when more than one card is compatible;
- manual warm-ups before planned attachment and manual warm-ups added after
  attachment then reordered above planned sets, all within one exercise card;
- attached-but-unresolved state that does not expose the next block;
- agent provenance that does not overpower the plan title;
- destructive confirmation for deleting an eligible unused plan or programme.

## In scope

1. The four-entity synced planning graph, `sessions.source_plan_id`,
   `session_exercises.source_plan_exercise_id`, and
   `exercise_sets.source_plan_set_id`.
2. Local repositories, validation, whole-plan and single-block
   materialization, same-exercise card selection, performed-set reordering,
   explicit Complete/Skip, and deterministic retry.
3. One-off planner, programme, and recorder block-consumption flows on mobile.
4. Upcoming/unscheduled plan presentation in Sessions.
5. Per-connected-agent planning permission and Connected Agents control.
6. Three planning API routes, two exact-history API routes, five new MCP tools,
   and exactness upgrades to the existing read tools.
7. Unit, sync, backend authorization, MCP, and Maestro coverage across the
   seams described below.
8. Canonical spec, README, lane, and UI-document updates.

## Out of scope

Calendar views or calendar-provider integration; recurrence rules; reminders
or push notifications; templating beyond programmes; automatic load/rep
progression or wave calculations; inferred multi-exercise programme tracks;
adaptive recommendation services; collaborative/shared plans; programme
adherence analytics; plan-versus-actual analytics UI; agent editing/deleting,
attaching, completing, or skipping plan blocks; agent starting sessions; and
any agent mutation of active, completed, or deleted workout history.

## Deliverables

1. An authoritative `docs/specs/tech/session-planning-contract.md` with exact
   columns, constraints, wire shapes, validation limits, errors, state
   transitions, deterministic-ID recipe, and agent route schemas.
2. SQLite and Supabase schema/migration work for the four planning entities
   and performed session/block/set provenance fields, including the complete
   Sync v2 expansion.
3. `apps/mobile/src/session-planner/` repositories, whole-plan/block
   materializers, performed-set reordering, and explicit block-resolution
   operations.
4. One-off planner screens and Sessions planning sections.
5. Programme authoring and programme detail screens.
6. App-owned agent permission, receipt storage, planning API routes/RPCs,
   Connected Agents toggle, and authorization tests.
7. Exact-history API reads, MCP tools, and cross-stack verification using the
   seam strategy below.
8. As-built updates to `00`, `03`, `05`, `06`, `09`, `10`, the sync contract,
   UI bundle, UX standard when new patterns are introduced, service/app
   READMEs, and the lane/trigger registries.
9. Closeout on merged `main`, including all required local gates, an
   acceptance-evidence matrix, task archival, and milestone archival.

## Acceptance criteria

1. A person can create, edit, reschedule, duplicate, and delete an unused
   one-off plan locally, including offline.
2. A person can create a named programme containing multiple ordered plans;
   each retains its own schedule, gym, ordered exercise blocks, and targets.
3. First sync/reinstall restores programmes and plans with order, snapshots,
   schedules, targets, block resolution, and provenance intact.
4. A person can Start all with no active session or add exactly one available
   block to an existing/new active session. Each path copies targets into the
   existing `planned_*` fields, leaves actuals blank, and opens or resumes the
   ordinary recorder without consuming unrelated blocks. Add block attaches to
   an explicitly selected compatible same-exercise card, otherwise uses the
   single unambiguous unsourced match or creates a card.
5. Start all while another session is active never merges or replaces it and
   presents Resume. Add block never guesses between multiple compatible cards,
   never overwrites another block's provenance, and local retry or competing-
   device attachment converges on at most one live performed exercise for each
   source block and one live performed set for each source target.
6. Attaching a block does not advance programme progress. Explicit Complete
   after at least one valid confirmed source-derived set advances despite
   target deviations; manual warm-ups alone do not. Explicit Skip advances
   without creating performed work. The next unresolved block is deterministic.
7. Planned, pending, skipped, and deleted plan rows do not appear in completed
   history, stats, records, or group streams. A session may mix sourced blocks
   and arbitrary freeform exercises, including manual and planned sets on the
   same exercise card. Reordering those performed sets preserves their planned
   or manual provenance; confirmed actual work behaves exactly like any other
   session in those surfaces.
8. Filtered exercise search can page through every matching owned exercise
   without silent intermediate candidate caps, including fixtures beyond the
   current 1,000-row mapping/equipment boundaries.
9. Exercise-history and workout-detail cursors drain every qualifying performed
   set exactly once in deterministic order; lifetime records, history counts,
   last-performed time, and workout totals remain exact and do not change with
   page size.
10. The existing context and recent-workout tools label embedded collections as
   previews and provide a complete continuation path. No response uses a bare
   `history_truncated`/`truncated` flag as the only way to report omitted data.
11. An existing or newly connected agent without current plan permission gets
   `PLAN_PERMISSION_REQUIRED` from all new plan tools and retains access only
   to the read-only tools.
12. An authorized agent can atomically create one valid plan and one valid
   multi-session programme containing pending blocks; those server-created rows
   are pullable by the owner's phone, but the agent cannot attach or resolve
   them.
13. Same-key/same-payload retries return the same IDs without duplicates;
   same-key/different-payload and concurrent conflicts return stable results.
14. Missing/foreign exercise, session, or gym IDs, cross-owner reads, identity inputs,
    malformed targets, oversized graphs, and partial programme failures expose
    no foreign data and create no partial rows.
15. Disabling permission or revoking the OAuth grant blocks the next plan
    request. Re-authorizing the same client does not revive an old permission.
16. Agent routes and direct OAuth database access cannot create, edit, delete,
    attach, complete, skip, start, or otherwise mutate performed sessions or
    human-controlled plan progress.
17. Audit rows contain only the approved metadata fields and never plan
    payload content or credentials.
18. The planning UI meets the UX standard, uses shared tokens/primitives,
    documents routes/components/patterns, and has required screenshots and
    accessibility coverage, including same-card block/freeform use, ambiguous
    card selection, and lightweight playlist-style performed-set reordering
    with equivalent non-drag accessibility actions.
19. All path-triggered local gates and the milestone closeout gate set are
    green, with measured timing evidence from `./boga timings` only.

## Verification strategy

- **Unit:** repository CRUD and validation, programme ordering, target
  normalization, full-plan and single-block materialization, active-session
  append versus Start-all conflict, compatible-card selection and ambiguity,
  manual/planned set provenance and reordering, explicit Complete/Skip,
  deterministic retries, filter-bound cursor validation, page-size-independent
  exact aggregates, API/MCP schemas, annotations, response parsing, and error
  translation.
- **Sync:** schema drift over fourteen entities, the five-layer FK graph,
  push/pull round trips, server-created plan pulls, tombstones, first-sync
  restore, dirty counts, wipe coverage, session/block/set provenance fields,
  performed-set order, and block-resolution behavior.
- **Backend authorization and reads:** default-denied/current-grant-matched
  permission, app-only toggle RLS, owner isolation, strict body limits, atomic
  RPCs, idempotency receipts, revocation, direct OAuth denial, actual-session
  immutability, metadata-only audit, filtered search beyond 1,000 intermediate
  rows, more than 500 exercise-history blocks, multi-page workout/exercise
  drains, exact aggregates independent of page size, and SQL/mobile calculation
  parity over the shared metric vectors.
- **MCP smoke:** discover nine tools; drain multi-page exercise history and
  workout detail; verify exact records/totals; prove default plan denial; enable
  permission; create a plan and programme; repeat a key; reject a conflicting
  key; revoke; and verify resulting database rows.
- **Maestro:** create and Start all for a one-off plan, create a programme,
  add its next block to a squat card that already contains warm-ups, then cover
  the inverse order by adding warm-ups after planned sets and moving them above,
  log another exercise freely, complete the block and expose the next one,
  render a server-seeded plan after sync, handle ambiguous card choice and the
  Start-all active-session conflict, and capture required UI states.
- **Seam rule:** do not build one brittle MCP-process-to-Maestro mega-test.
  MCP smoke proves protocol-to-database writes, sync integration proves a
  server-created plan reaches the client model, and Maestro proves that a
  synced/seeded plan renders and materializes correctly.

## Rollout order

1. Deploy the additive server schema, sync RPCs, permission/receipt tables,
   and compatible agent API before releasing a mobile schema that emits the
   new entity types.
2. Release the mobile sync/schema and human planner. Older clients ignore the
   new server entity types only if the contract task proves that compatibility;
   otherwise deployment must be coordinated as an explicit migration window.
3. Deploy the upgraded read routes and five new MCP tools only after the hosted
   migration and agent API are live. Existing tool inputs remain compatible
   throughout rollout.
4. Keep all existing agents disabled for plan access. Users enable clients one
   at a time in Connected Agents.
5. Run hosted discovery, permission, create, pull, retry, revocation, and audit
   smoke after deployment. Local results are not hosted proof; the owning task
   records hosted evidence or an explicit deferred owner and trigger.

## Task breakdown

Each card is intended to be one reviewable PR.

1. `docs/plans/tasks/M23-T01-Session_planning_product_and_data_contract.md` — lock
   exact product, schema, lifecycle, validation, API, and error contracts
   (`planned`).
2. `docs/plans/tasks/M23-T02-Synced_session_plan_schema_and_server_contract.md` —
   add the four synced entities, performed session/block/set provenance, and
   full Sync v2 expansion (`planned`).
3. `docs/plans/tasks/M23-T03-Mobile_plan_repository_and_session_materialization.md`
   — local repositories, validation, deterministic whole-plan/block
   materialization, compatible-card selection, performed-set reordering,
   explicit resolution, and active-session behavior
   (`planned`).
4. `docs/plans/tasks/M23-T04-Mobile_one_off_session_planner.md` — Sessions planning
   sections plus one-off create/view/edit/start/add-block/duplicate/delete and
   recorder block/reordering UX (`planned`).
5. `docs/plans/tasks/M23-T05-Mobile_training_programmes.md` — programme create,
   order, edit, detail, next-block, Complete/Skip, and child-plan flows
   (`planned`).
6. `docs/plans/tasks/M23-T06-Agent_plan_permission_and_write_API.md` — current-grant
   permission, idempotency receipts, atomic agent API writes, and Connected
   Agents control (`planned`).
7. `docs/plans/tasks/M23-T07-MCP_planning_tools_and_cross_stack_verification.md` —
   exact-history API upgrades, two pageable history tools, three planning tools,
   protocol smoke, server-to-mobile seam coverage, and the planning Maestro
   lane (`planned`).
8. `docs/plans/tasks/M23-T08-Milestone_closeout.md` — full gates, acceptance matrix,
   as-built docs, hosted-smoke accounting, and archive (`planned`).

Dependency graph (parallel where arrows allow):

```text
T01 ──► T02 ──► T03 ──► T04 ──► T05 ──┐
              └────────► T06 ──────────┼──► T07 ──► T08
```

- T04 owns the shared plan-block recorder interaction; T05 builds programme
  selection/progress on that surface after T04 lands.
- T06 can proceed after the server schema exists and in parallel with mobile
  planner UI.
- T07 integrates only after both the API and human-facing plan path exist.

## Risks / dependencies

- **Sync expansion is cross-cutting.** Missing any registry, cursor, wipe, FK,
  drift, or restore site can strand data. T02 owns an explicit inventory and
  fourteen-entity round trip.
- **Block attachment is a multi-device race.** Deterministic block/set IDs plus
  server uniqueness are both required; either alone leaves duplicate live uses
  or ambiguous completion. T01 must specify how two devices attaching the same
  block to different active sessions converge.
- **Agent consent can be misunderstood.** The mobile toggle must name the
  client and disclose upcoming-plan reads as well as creation. OAuth consent
  copy must not claim that the base grant itself permits writes.
- **Bounded reads can masquerade as complete history.** T01 locks filter-bound
  cursor semantics and the distinction between previews and exact aggregates;
  T07 seeds data beyond every current 500/1,000-row safety threshold and proves
  full drains and page-size-independent totals before agents use history for a
  recommendation.
- **Service role bypasses RLS.** The agent API and atomic RPC must explicitly
  bind every row and referenced ID to the validated owner. Cross-owner and
  performed-session mutation tests are release blockers.
- **Plans could leak into analytics.** Keeping them in separate tables avoids
  most risk; regression assertions still cover history, records, stats, and
  groups.
- **Same-exercise attachment or reordering can erase provenance.** Add block
  only targets an explicitly selected or single unambiguous compatible,
  unsourced exercise card; otherwise it creates or asks. Block provenance stays
  on `session_exercises`, set provenance stays on each source-derived
  `exercise_sets` row, and reordering changes only performed `order_index`.
  Manual rows keep a null source-set link.
- **Programme editing can become a general scheduler.** V1 remains an ordered
  collection with optional dates and one deterministic block stream. Inferred
  tracks, recurrence, auto-progression, calendar, and notifications stay out
  of scope.
- **Older-client compatibility needs proof.** T01/T02 must either prove that
  older pull clients safely ignore unknown entities or document a coordinated
  release requirement before code ships.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned |
  in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task
  completion note and/or milestone completion note (status remains
  `in_progress`).
