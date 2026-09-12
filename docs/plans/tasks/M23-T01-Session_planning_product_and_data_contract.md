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
  semantics, nine-entity Sync v2 registry, Sessions routes, agent API, OAuth
  boundary, Connected Agents surface, and four MCP tools.
- Lock:
  - the four table schemas, performed-session backlink, constraints, indexes,
    owner-scoped FKs, tombstones, and provenance;
  - the thirteen-entity/five-layer wire and FK graph;
  - plan lifecycle and which human actions are valid in each state;
  - atomic materialization and the deterministic-ID algorithm;
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
3. The sync section names all thirteen entities and five layers and inventories
   every registry/projection/cursor/dirty-count/FK/drift/wipe/restore surface
   T02 must update.
4. The start-plan algorithm defines active-session conflict behavior,
   transaction scope, target-to-actual mapping, lifecycle mutation,
   deterministic IDs, retry behavior, and server uniqueness.
5. Human validation and all three agent tool inputs use one explicit set of
   limits. Stable error tokens cover permission, validation, ownership,
   lifecycle, active conflict, idempotency conflict, and atomic failure.
6. Agent access documents live token/grant verification, grant-generation
   matching, default denial, service-role confinement, identity-field
   rejection, payload hashing, receipt replay, and metadata-only audit.
7. The mobile contract covers scheduled/unscheduled, programme ordering,
   create/edit/duplicate/delete/start, started immutability, offline behavior,
   sync restore, provenance, and all empty/loading/error/conflict states.
8. Older-client handling is decided with evidence: either unknown pull types
   are safely ignored or the contract requires a coordinated release window.

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
