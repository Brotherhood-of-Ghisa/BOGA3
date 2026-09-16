---
task_id: M23-T01-Session_planning_product_and_data_contract
milestone_id: "M23"
status: planned
ui_impact: "no"
areas: "docs"
runtimes: "docs"
gates_fast: "./boga test docs-check"
gates_slow: "N/A"
docs_touched: "docs/specs/tech/session-planning-contract.md, docs/specs/tech/README.md, docs/plans/milestones/M23-session-planning-and-programmes.md"
---

# M23-T01 — Session-planning product and data contract

## Task metadata

- Task ID: `M23-T01-Session_planning_product_and_data_contract`
- Status: `planned`
- Depends on: none

## Parent references (required)

- Milestone spec: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- Product: `docs/specs/00-product.md`
- Architecture and data: `docs/specs/03-technical-architecture.md`,
  `docs/specs/05-data-model.md`
- Sync: `docs/specs/tech/sync-v2-server-contract.md`
- AuthZ: `docs/specs/10-api-authn-authz-guidelines.md`
- UX and UI inventory: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Turn the M23 decisions into one implementation-level technical contract before
schema or UI code lands. The contract must be exact enough that mobile,
Supabase, agent API, MCP, and tests can be implemented independently without
inventing incompatible field names, bounds, lifecycle rules, or errors.

## Scope

### In scope

- Create `docs/specs/tech/session-planning-contract.md`.
- Inventory the current performed-session graph, planned-vs-performed set
  semantics, ten-entity Sync v2 registry, Sessions routes, agent API, OAuth
  boundary, Connected Agents surface, and four MCP tools.
- Lock:
  - the four table schemas, performed session/block/set provenance fields,
    constraints, indexes, owner-scoped FKs, tombstones, block progress, and
    provenance, including `sessions.source_plan_id`,
    `session_exercises.source_plan_exercise_id`, and
    `exercise_sets.source_plan_set_id`;
  - the fourteen-entity/five-layer wire and FK graph;
  - block and derived parent lifecycle, including pending, attached, completed,
    skipped, and the human actions valid in each state;
  - atomic whole-plan and single-block materialization, including compatible
    exercise-card selection, ambiguity handling, per-set source identity,
    explicit resolution, and the deterministic-ID algorithm;
  - active-session behavior: Start all conflicts safely, while Add block
    appends to the active session or creates one when none exists;
  - same-exercise behavior, manual/planned set coexistence, performed-set
    reordering, target deviation, freeform-session coexistence, and the
    deterministic definition of the next unresolved block;
  - exact card compatibility: automatic matching requires the same non-null
    owned exercise-definition ID and an unsourced target card; snapshots never
    act as identity, and multiple candidates require explicit selection;
  - the cross-level provenance invariant and its database/sync enforcement: a
    source-derived set's plan-set parent must equal its performed card's source
    block, an unsourced card cannot contain source-derived sets, and null-linked
    manual rows remain valid on a sourced card;
  - ordering invariants: reordering mutates only performed
    `exercise_sets.order_index`, keeps source-plan order immutable, preserves
    all block/set provenance and target/actual fields, uses a compact playlist-
    style drag handle without a separate reorder mode, and exposes equivalent
    non-drag accessibility actions without permanent button clutter;
  - target normalization, graph cardinality, text, date, cursor, and payload
    limits shared by mobile/API/MCP;
  - current-grant-matched permission and receipt-table semantics;
  - agent route request/response/error envelopes and MCP input/output schemas;
  - mobile routes, screen states, copy requirements, and accessibility intent;
  - deployment compatibility and rollback expectations.
- Add the contract to `docs/specs/tech/README.md` and align this milestone if a
  detailed decision reveals a contradiction.

### Out of scope

Runtime code, migrations, generated schema, UI, or changing canonical specs to
claim planned behavior is already shipped.

## Acceptance criteria

1. Every M23 boundary decision is represented by a normative rule, table,
   state transition, wire shape, or testable acceptance statement.
2. The schema section names every column, type, nullability rule, check,
   uniqueness rule, index, FK action, RLS/grant posture, and Sync v2 metadata
   field for all new or changed tables.
3. The sync section names all fourteen entities and five layers and inventories
   every registry/projection/cursor/dirty-count/FK/drift/wipe/restore surface
   T02 must update.
4. The materialization algorithms define Start-all conflict behavior, Add-block
   selected/unambiguous-card attachment or card creation, ambiguity results,
   performed block/set identity, transaction scope, target-to-actual mapping,
   Complete/Skip semantics, deterministic IDs, retry/competing-device behavior,
   and server uniqueness.
5. Human validation and all three agent tool inputs use one explicit set of
   limits. Stable error tokens cover permission, validation, ownership,
   lifecycle, active conflict, idempotency conflict, and atomic failure.
6. Agent access documents live token/grant verification, grant-generation
   matching, default denial, service-role confinement, identity-field
   rejection, payload hashing, receipt replay, and metadata-only audit.
7. The mobile contract covers scheduled/unscheduled, programme ordering,
   create/edit/duplicate/delete, Start all, Add block, explicit Complete/Skip,
   per-block immutability, manual/planned sets on one exercise card, accessible
   performed-set reordering, freeform session coexistence, offline behavior,
   sync restore, provenance, and all empty/loading/error/conflict states.
8. Older-client handling is decided with evidence: either unknown pull types
   are safely ignored or the contract requires a coordinated release window.
9. The mobile/data rules explicitly cover both warm-ups-first then Add block and
   Add block first then warm-ups moved above planned sets. They preserve one
   exercise card, block/set source identity, and manual null provenance across
   autosave, sync, hydration, completion, and completed-session editing.

## Docs touched (required)

- `docs/specs/tech/session-planning-contract.md`: new authoritative M23
  implementation contract.
- `docs/specs/tech/README.md`: add the contract to the subsystem index.
- `docs/plans/milestones/M23-session-planning-and-programmes.md`: align only
  where the detailed design makes a milestone statement more exact.

## Testing and verification approach

- Run `./boga test docs-check`.
- Run `./boga test for --diff origin/main` and record the path-derived result.
- Review every milestone AC and every downstream task against a contract
  section; unresolved decisions block T02 rather than becoming code guesses.
- Slow gates are `N/A`: this task changes only planning documentation and does
  not assert runtime behavior.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
