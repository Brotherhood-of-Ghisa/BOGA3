# M42 — Injury Lifecycle, In-Workout Modifications, and Pain Awareness

- Status: `planned`
- Created: 2026-11-10
- Planning baseline: `9460d9e51df1689a24a3c30d367bf718cc53cc33` on `origin/main`
- Execution: one task, session, local worktree, and PR at a time, following `docs/plans/README.md`.

## Objective

Equip BoGa with native, low-friction injury and discomfort tracking that ties
directly into the app's anatomical model (`muscle_groups`, per-side awareness)
and AI Virtual Coach (`services/boga-mcp`). Athletes can track injury
lifecycles, receive contextual warnings and substitutions during live
workouts, tag set-level rehab/discomfort without contaminating PR analytics,
visualize reload volume on muscle heatmaps, and allow AI coaches to respect
physical limitations when generating session plans.

## Scope

- In:
  - Dedicated `injuries` Sync v2 entity table (Layer 1 in topological FK order)
    with lifecycle states (`acute`, `managing`, `monitoring`, `resolved`), side
    (`left`, `right`, `bilateral`), pain score (0–10), and contraindications.
  - Owner-private sync boundary mirroring the privacy standards established for
    bodyweight in `docs/specs/tech/bodyweight-load-contract.md` (strictly
    private; never leaked to groups, social feeds, or leaderboards).
  - Mobile UI in Profile/Settings to log, update, check in on, and resolve
    injuries.
  - Live workout warnings: contextual alerts on exercises stressing injured
    muscles/sides, with 1-tap movement substitutions and early-stop / skip
    reasons.
  - Set-level pain/discomfort notation and `'rehab'` set type protection
    ensuring rehab volume does not corrupt working set volume or 1RM/PR curves
    (`docs/specs/tech/training-metrics-contract.md`).
  - 3D/2D muscle heatmap visual status overlay (`muscle-body-mesh`) and tissue
    reloading analytics (weekly working sets on recovering muscles).
  - MCP tools (`get_active_injuries`, `log_injury`, `update_injury_status`) and
    Edge API routes for connected AI coaches.
- Out:
  - Medical diagnostics, clinical treatment prescriptions, or physical therapy
    regimens.
  - Group-shared injury feeds or injury disclosure in group competitions.
  - Forced hard blocks preventing an athlete from performing an exercise if
    they explicitly choose to proceed.
- This PR contains planning documents only. It changes no runtime behavior,
  product fact, permission, schema, or published tool catalogue.

## Agreed design direction

### D1. Dual-tier anatomical linkage and alias dictionary

An injury record stores both a structured anchor and the athlete's natural
language label:
1. `muscle_group_id` (foreign key to `muscle_groups.id`, Layer 0): the
   governing anatomical engine key driving exercise warning banners, 3D
   heatmap overlays, and volume reload tracking. Nullable for non-muscular
   or unmapped regional pain (e.g. bruised rib, tailbone).
2. `label` and `notes`: free text preserving the athlete's exact words (e.g.
   "Patellar tendon irritation on deep squats", "Right AC joint impingement").

In-app selection uses a static, zero-dependency anatomical alias dictionary
(`ANATOMY_ALIASES`) mapping lay terms, joints, and tendons to governing
muscle groups (e.g. "knee/patella" → `quads`, "lumbar/lower back" →
`spinal_erectors`, "elbow/wrist" → `forearms_grip`). Tapping the 3D body mesh
directly hit-tests the mesh face and assigns `muscle_group_id` and `side`
without typing.

### D2. Strict owner privacy and zero group disclosure

Following the privacy model of `body_weight_measurements` in
`docs/specs/tech/bodyweight-load-contract.md`, injury records and pain logs are
strictly owner-private. Group tables, triggers, competition projections, and
shared workout feeds are completely decoupled from `injuries`. No injury data
or pain annotations are ever published to group caches, streams, or
leaderboards.

### D3. In-workout contextual guidance and non-destructive substitution

When an athlete views an exercise in an active workout that involves an
actively injured muscle/side (`acute` or `managing`), a non-blocking warning
banner indicates the flare-up and pain triggers. A 1-tap "Swap" modal suggests
exercises sharing the primary movement pattern that spare the affected tissue.
Skipping or aborting an exercise provides a 1-tap reason: "Discomfort / Injury
flare-up".

### D4. Metric and PR integrity protection

A new set classification (`setType: 'rehab'`) and optional discomfort tag
(`painScore: 0..10`) prevent rehabilitation work from degrading historical
performance curves:
1. Rehab sets do not register as failed attempts on historical 1RM curves.
2. Rehab sets are tracked separately from primary working volume in muscle
   report targets.
3. Workout execution audit records and performed history remain intact.

### D5. Heatmap overlay and tissue load management

The 3D/2D muscle mesh projection (`muscle-body-projection.ts`) supports visual
injury badges and highlighted contours on affected muscles and sides.
Progress/Recovery views gain a "Tissue Reloading" card showing accumulated
weekly volume (working sets) on the injured structure to prevent premature
volume spikes.

### D6. AI Virtual Coach and MCP integration

Connected AI coaches with write permissions gain tools to inspect limitations
(`get_active_injuries`) and record athlete-reported discomfort (`log_injury`,
`update_injury_status`). Automated session plan generation
(`create_session_plan`) validates proposed exercises against active injuries
and flags contraindications.

### D7. Sync v2 topological ordering and wire-stable error tokens

`injuries` joins Layer 1 of `TOPO_LAYERS` in `apps/mobile/src/sync/topo-order.ts`
(dependent on Layer 0 `muscle_groups`). Standard LWW timestamp progression
(`local_updated_at_ms`, `client_updated_at_ms`) applies. Stable error tokens:
- `INJURY_NOT_FOUND` (404)
- `INVALID_ANATOMY_REFERENCE` (400)
- `INJURY_PERMISSION_REQUIRED` (403)

## Task breakdown

One card = one session = one worktree = one implementation PR. Merge this
planning PR before starting implementation; re-check each card against main.
The implementation PR deletes its card and marks its row completed; the last
also deletes this milestone. Durable rules graduate to their owning docs.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| [M42-T01](../tasks/M42-T01-Injury_contract_and_sync_schema.md) | Author technical contract, Postgres migration, mobile Drizzle schema, and Sync v2 topo ordering | none | planned |
| [M42-T02](../tasks/M42-T02-Mobile_injury_management_ui.md) | Profile/Settings injury dashboard: log, check-in, edit, and resolve active injuries | T01 | planned |
| [M42-T03](../tasks/M42-T03-Live_workout_warnings_and_substitutions.md) | In-workout injury warning banners, 1-tap exercise substitutions, and abort reasons | T01, T02 | planned |
| [M42-T04](../tasks/M42-T04-Set_rehab_tagging_and_metric_protection.md) | Set-level rehab/pain tagging, 1RM/PR exclusion rules, and volume calculation updates | T01 | planned |
| [M42-T05](../tasks/M42-T05-Heatmap_injury_overlay_and_reload_analytics.md) | 3D muscle mesh injury visualization and tissue reload volume tracking | T01, T02, T04 | planned |
| [M42-T06](../tasks/M42-T06-MCP_coach_tools_and_agent_api.md) | Edge API routes and MCP tools for active injury reads, logging, and plan checks | T01 | planned |
| [M42-T07](../tasks/M42-T07-Milestone_closeout_and_spec_graduation.md) | Quality gates (coverage, complexity, deps), spec graduation, and milestone closeout | T03, T05, T06 | planned |

## Risks and dependencies

- **Sync v2 schema expansion:** Adding `injuries` to Sync v2 requires strict
  alignment between Postgres, `sync_push`/`sync_pull` RPC projections, mobile
  Drizzle SQLite schema, `ENTITY_FIELDS` in `cycle.ts`, and `topo-order.ts`.
  Missing any projection site causes `check-sync-schema-drift.ts` to fail.
- **Privacy boundary:** Strict owner isolation must be asserted via Postgres
  RLS policies and automated contract tests. No group query or worker trigger
  may read or mirror `injuries`.
- **Anatomical matching performance:** In-workout warning resolution must query
  active injuries and `exercise_muscle_mappings` in memory without delaying
  session recorder rendering or navigation transitions.
