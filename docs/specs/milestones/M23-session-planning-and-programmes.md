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
several sessions, sync those plans across devices, and start a plan in the
existing recorder. A separately authorized coaching agent can inspect the
upcoming queue and create the same plan structures through MCP. Human and
agent creation converge on one domain model; neither route can mutate
performed workout history.

## Boundary decisions

1. **Plans are a separate synced domain.** Do not add `planned` to
   `sessions.status`. The existing `sessions` graph remains performed workout
   state (`active | completed`), while plan rows remain absent from history,
   analytics, records, and group activity until a person starts one.
2. **Starting is materialization, not a status flip.** Starting a plan creates
   one active `sessions -> session_exercises -> exercise_sets` graph and opens
   the existing recorder. It does not make the recorder understand plan rows.
3. **One model, two writers.** The mobile planner writes locally and syncs in
   the normal way. The agent API writes the same server rows atomically; the
   phone receives them through normal `sync_pull`.
4. **Agents create; people remain in control.** M23 agents may read upcoming
   plans and create a one-off plan or programme. They cannot edit/delete plans,
   start a workout, or insert/update/delete any performed-session row.
5. **Write permission is separate and opt-in.** Existing OAuth grants keep
   their current read-only access. Absence of a current per-client planning
   permission denies all three new tools. The permission cannot be represented
   as a Supabase custom OAuth scope, so it is app-owned and managed in Connected
   Agents.
6. **Programme is the product term.** A wave is an ordered programme a person
   or coach can name as such. V1 stores the order and targets but does not
   encode a wave formula, progression algorithm, or recurrence engine.

## Product behavior

### One-off plans

- A signed-in person can create, edit, reschedule, duplicate, and delete an
  unstarted plan, including while offline.
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
- People can create and edit the programme and its unstarted plans as one
  coherent flow. Reordering changes programme order, not scheduled time.
- Starting one programme session does not automatically start, reschedule, or
  generate another. Later sessions remain ordinary plans.

### Starting a plan

1. The person taps **Start** on an unstarted plan.
2. If another active session exists, BoGa routes to **Resume** and does not
   merge, replace, or silently complete it.
3. Otherwise one local transaction creates the active performed graph:
   - the session retains the selected gym and a backlink to the source plan;
   - each planned exercise becomes a `session_exercises` snapshot;
   - each target set copies weight/reps/type into the existing
     `exercise_sets.planned_*` fields;
   - actual weight and reps remain blank and `performance_status` starts as
     `planned`.
4. Deterministic IDs derived from the owner, plan, entity kind, and source-row
   ID make a retry or simultaneous start of the same plan converge on the same
   performed graph. A server uniqueness guard allows at most one non-deleted
   session for a source plan.
5. The source plan becomes `started` and immutable. It remains available for
   future planned-versus-performed comparison rather than being overwritten by
   recorder edits.

## Data and sync contract

M23 expands Sync v2 from nine to thirteen user-owned entity types.

| Entity | Purpose | Important fields / rules |
| --- | --- | --- |
| `training_programmes` | Named container for an ordered series. | `name`, optional `description`, normal sync/timestamp/tombstone fields. |
| `session_plans` | One future session, standalone or in a programme. | Optional `programme_id` and `gym_id`; `title`; optional `scheduled_for`; optional `programme_order_index`; `status = planned | started`; provenance `human | agent`; normal sync/timestamp/tombstone fields. |
| `session_plan_exercises` | Ordered exercise snapshots for a plan. | `session_plan_id`, optional owned `exercise_definition_id`, `order_index`, `name`, optional `machine_name`; normal sync/timestamp/tombstone fields. |
| `session_plan_sets` | Ordered targets for one planned exercise. | `session_plan_exercise_id`, `order_index`, optional non-negative `target_weight_value`, positive `target_reps`, optional `target_set_type`; normal sync/timestamp/tombstone fields. |

Additional performed-domain field:

- `sessions.source_plan_id` is nullable, references the same owner's
  `session_plans` row, and has a partial uniqueness constraint for non-deleted
  rows. Existing/manual sessions leave it null.

All server primary and foreign keys remain owner-scoped composites. Every new
sync table uses the existing direct-app-only OAuth RLS policy, explicit table
grants, LWW/tombstone behavior, server receipt ordering, and account wipe
contract. Agent OAuth tokens still cannot call PostgREST or `sync_push`
directly.

The expected five-layer topology is:

```text
L0  gyms, exercise_definitions, muscle_groups, training_programmes
L1  session_plans, exercise_muscle_mappings, exercise_tag_definitions
L2  sessions, session_plan_exercises
L3  session_exercises, session_plan_sets
L4  exercise_sets, session_exercise_tags
```

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
  plan graphs in one transaction.

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

1. `get_upcoming_session_plans`
   - bounded cursor/limit input, with an option to include unscheduled plans;
   - `readOnlyHint: true`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
2. `create_session_plan`
   - required `idempotency_key`, title, optional schedule/gym, and a bounded
     ordered exercise/set graph using owned exercise IDs;
   - `readOnlyHint: false`, `idempotentHint: true`,
     `destructiveHint: false`, `openWorldHint: false`.
3. `create_training_programme`
   - required `idempotency_key`, name/description, and a bounded ordered list
     of complete session plan inputs;
   - the same non-destructive idempotent-write annotations.

The AI can use the existing profile, exercise-search, exercise-context, and
recent-workout tools to formulate a suggestion, then create it only after the
user has enabled plan access. There is no server-hosted model or adaptive
recommendation engine in M23.

## Mobile UX contract

### Screen and route shape

- `/sessions` becomes the planning home as well as the complete session list,
  with clearly separated **Active**, **Upcoming**, **Unscheduled**, and
  **Completed** sections.
- `/session-plan/new` creates a one-off plan.
- `/session-plan/[planId]` views and edits an unstarted plan and offers Start,
  Duplicate, and Delete. A started plan is read-only and links to its session.
- `/programme/new` creates a programme and its ordered sessions.
- `/programme/[programmeId]` views/edits the programme and opens each plan.
- Starting dismisses into the existing `/session-recorder`; an active-session
  conflict routes to the existing recorder Resume state.

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
- started/read-only state;
- active-session conflict with a single Resume action;
- agent provenance that does not overpower the plan title;
- destructive confirmation for deleting an unstarted plan or programme.

## In scope

1. The four-entity synced planning graph and `sessions.source_plan_id`.
2. Local repositories, validation, materialization, and deterministic retry.
3. One-off planner and programme flows on mobile.
4. Upcoming/unscheduled plan presentation in Sessions.
5. Per-connected-agent planning permission and Connected Agents control.
6. Three agent API routes and three MCP tools.
7. Unit, sync, backend authorization, MCP, and Maestro coverage across the
   seams described below.
8. Canonical spec, README, lane, and UI-document updates.

## Out of scope

Calendar views or calendar-provider integration; recurrence rules; reminders
or push notifications; templating beyond programmes; automatic progression or
wave calculations; adaptive recommendation services; collaborative/shared
plans; programme adherence analytics; plan-versus-actual analytics UI; agent
editing/deleting plans; agent starting sessions; and any agent mutation of
active, completed, or deleted workout history.

## Deliverables

1. An authoritative `docs/specs/tech/session-planning-contract.md` with exact
   columns, constraints, wire shapes, validation limits, errors, state
   transitions, deterministic-ID recipe, and agent route schemas.
2. SQLite and Supabase schema/migration work for the four planning entities
   and performed-session backlink, including the complete Sync v2 expansion.
3. `apps/mobile/src/session-planner/` repositories and plan materializer.
4. One-off planner screens and Sessions planning sections.
5. Programme authoring and programme detail screens.
6. App-owned agent permission, receipt storage, API routes/RPCs, Connected
   Agents toggle, and authorization tests.
7. MCP tools plus cross-stack verification using the seam strategy below.
8. As-built updates to `00`, `03`, `05`, `06`, `09`, `10`, the sync contract,
   UI bundle, UX standard when new patterns are introduced, service/app
   READMEs, and the lane/trigger registries.
9. Closeout on merged `main`, including all required local gates, an
   acceptance-evidence matrix, task archival, and milestone archival.

## Acceptance criteria

1. A person can create, edit, reschedule, duplicate, and delete an unstarted
   one-off plan locally, including offline.
2. A person can create a named programme containing multiple ordered plans;
   each retains its own schedule, gym, exercises, and targets.
3. First sync/reinstall restores programmes and plans with order, snapshots,
   schedules, targets, lifecycle, and provenance intact.
4. Starting a plan creates exactly one active performed graph, copies targets
   into the existing `planned_*` fields, leaves actuals blank, and opens the
   recorder.
5. Starting while another session is active never merges or replaces it and
   presents Resume. Retrying or starting the same plan on two devices does not
   create a duplicate session graph.
6. Planned and cancelled/deleted plan rows do not appear in completed history,
   stats, records, or group streams. Once performed, the actual session behaves
   exactly like any other session in those surfaces.
7. An existing or newly connected agent without current plan permission gets
   `PLAN_PERMISSION_REQUIRED` from all new plan tools and retains access only
   to the existing four read-only tools.
8. An authorized agent can atomically create one valid plan and one valid
   multi-session programme; those server-created rows are pullable by the
   owner's phone.
9. Same-key/same-payload retries return the same IDs without duplicates;
   same-key/different-payload and concurrent conflicts return stable results.
10. Missing/foreign exercise or gym IDs, cross-owner reads, identity inputs,
    malformed targets, oversized graphs, and partial programme failures expose
    no foreign data and create no partial rows.
11. Disabling permission or revoking the OAuth grant blocks the next plan
    request. Re-authorizing the same client does not revive an old permission.
12. Agent routes and direct OAuth database access cannot create, edit, delete,
    start, or otherwise mutate performed sessions.
13. Audit rows contain only the approved metadata fields and never plan
    payload content or credentials.
14. The planning UI meets the UX standard, uses shared tokens/primitives,
    documents routes/components/patterns, and has required screenshots and
    accessibility coverage.
15. All path-triggered local gates and the milestone closeout gate set are
    green, with measured timing evidence from `./boga timings` only.

## Verification strategy

- **Unit:** repository CRUD and validation, programme ordering, target
  normalization, active-session conflict, materialization mapping,
  deterministic retries, API/MCP schemas, annotations, response parsing, and
  error translation.
- **Sync:** schema drift over thirteen entities, the five-layer FK graph,
  push/pull round trips, server-created plan pulls, tombstones, first-sync
  restore, dirty counts, wipe coverage, and plan/session backlink behavior.
- **Backend authorization:** default-denied/current-grant-matched permission,
  app-only toggle RLS, owner isolation, strict body limits, atomic RPCs,
  idempotency receipts, revocation, direct OAuth denial, actual-session
  immutability, and metadata-only audit.
- **MCP smoke:** discover seven tools, prove default denial, enable permission,
  create a plan and programme, repeat a key, reject a conflicting key, revoke,
  and verify resulting database rows.
- **Maestro:** create and start a one-off plan, create a programme, render a
  server-seeded plan after sync, handle active-session conflict, and capture
  required UI states.
- **Seam rule:** do not build one brittle MCP-process-to-Maestro mega-test.
  MCP smoke proves protocol-to-database writes, sync integration proves a
  server-created plan reaches the client model, and Maestro proves that a
  synced/seeded plan renders and starts correctly.

## Rollout order

1. Deploy the additive server schema, sync RPCs, permission/receipt tables,
   and compatible agent API before releasing a mobile schema that emits the
   new entity types.
2. Release the mobile sync/schema and human planner. Older clients ignore the
   new server entity types only if the contract task proves that compatibility;
   otherwise deployment must be coordinated as an explicit migration window.
3. Deploy MCP tools only after the hosted migration and agent API are live.
4. Keep all existing agents disabled for plan access. Users enable clients one
   at a time in Connected Agents.
5. Run hosted discovery, permission, create, pull, retry, revocation, and audit
   smoke after deployment. Local results are not hosted proof; the owning task
   records hosted evidence or an explicit deferred owner and trigger.

## Task breakdown

Each card is intended to be one reviewable PR.

1. `docs/tasks/M23-T01-Session_planning_product_and_data_contract.md` — lock
   exact product, schema, lifecycle, validation, API, and error contracts
   (`planned`).
2. `docs/tasks/M23-T02-Synced_session_plan_schema_and_server_contract.md` —
   add the four synced entities, performed-session backlink, and full Sync v2
   expansion (`planned`).
3. `docs/tasks/M23-T03-Mobile_plan_repository_and_session_materialization.md`
   — local repositories, validation, deterministic materialization, and
   active-session conflict handling (`planned`).
4. `docs/tasks/M23-T04-Mobile_one_off_session_planner.md` — Sessions planning
   sections plus one-off create/view/edit/start/duplicate/delete UX (`planned`).
5. `docs/tasks/M23-T05-Mobile_training_programmes.md` — programme create,
   order, edit, detail, and child-plan flows (`planned`).
6. `docs/tasks/M23-T06-Agent_plan_permission_and_write_API.md` — current-grant
   permission, idempotency receipts, atomic agent API writes, and Connected
   Agents control (`planned`).
7. `docs/tasks/M23-T07-MCP_planning_tools_and_cross_stack_verification.md` —
   three MCP tools, protocol smoke, server-to-mobile seam coverage, and the
   planning Maestro lane (`planned`).
8. `docs/tasks/M23-T08-Milestone_closeout.md` — full gates, acceptance matrix,
   as-built docs, hosted-smoke accounting, and archive (`planned`).

Dependency graph (parallel where arrows allow):

```text
T01 ──► T02 ──► T03 ──► T04 ──┐
              │      └──► T05 ─┼──► T07 ──► T08
              └────────► T06 ──┘
```

- T04 and T05 can proceed in parallel after the repository/materializer lands.
- T06 can proceed after the server schema exists and in parallel with mobile
  planner UI.
- T07 integrates only after both the API and human-facing plan path exist.

## Risks / dependencies

- **Sync expansion is cross-cutting.** Missing any registry, cursor, wipe, FK,
  drift, or restore site can strand data. T02 owns an explicit inventory and
  thirteen-entity round trip.
- **Start is a multi-device race.** Deterministic IDs plus server uniqueness
  are both required; either alone leaves a duplicate or conflict path.
- **Agent consent can be misunderstood.** The mobile toggle must name the
  client and disclose upcoming-plan reads as well as creation. OAuth consent
  copy must not claim that the base grant itself permits writes.
- **Service role bypasses RLS.** The agent API and atomic RPC must explicitly
  bind every row and referenced ID to the validated owner. Cross-owner and
  performed-session mutation tests are release blockers.
- **Plans could leak into analytics.** Keeping them in separate tables avoids
  most risk; regression assertions still cover history, records, stats, and
  groups.
- **Programme editing can become a general scheduler.** V1 remains an ordered
  collection with optional dates. Recurrence, auto-progression, calendar, and
  notifications stay out of scope.
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
