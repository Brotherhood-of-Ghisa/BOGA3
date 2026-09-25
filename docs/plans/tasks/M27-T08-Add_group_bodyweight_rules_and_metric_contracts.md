---
task_id: M27-T08-Add_group_bodyweight_rules_and_metric_contracts
milestone_id: M27
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|deno|supabase|sql"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-groups-e2e"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/tech/groups-contract.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/10-api-authn-authz-guidelines.md"
---

# M27-T08 — Add group bodyweight rules and metric contracts

- Status: `planned`
- Depends on: M27-T02, M27-T03, M27-T05.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D7–D10.

## Objective and scope

Extend group comparison identities and board contracts so each group controls
its calculation standard and metrics carry correct units. Read AGENTS.md,
specs 02/03/05/09/10, groups/bodyweight contracts and `supabase/README.md`.
Refresh schema/RPC/validator inventory and HEAD; read test-directory READMEs.

## Deliverables and acceptance

1. Add group coefficient, movement/loading standard, default metric and rules
   revision to server-owned group exercise configuration. Personal metadata is
   independent; link/create-from-group flows carry explicit semantics without
   overwriting an existing personal exercise. Validate compatible movement and
   distribution modes. Owners/admins retain sole rule-write permissions.
2. Add typed metric identities/units for bodyweight reps, relative 1RM (×BW)
   and absolute total 1RM (kg). Keep conventional Weight/1RM behaviour and both
   Certified/All scopes. A reps or ratio score must never masquerade as kg.
3. Update board-entry, podium, detail, event/history, pagination and cache wire
   contracts; specify numeric precision and deterministic ties. Keep values
   additive/backward-compatible where practical; document activation/version
   controls wherever old readers would mislabel scores.
4. Provide raw session B/provenance and actual load mode to authorised group
   readers/evaluator, without exposing unrelated weigh-ins. Group tables remain
   outside Sync v2; member links remain the existing synced relationship.
5. Define rule-rebuild publication so a board never compares different rule
   revisions. Version changes label a recalculation, not a performed PR.
   Preserve historic events and specify how legacy bodyweight Weight/e1RM
   entries transition; no silent deletion or relabelling of historical scores.
6. Resolve archived/former-member policy explicitly: preserve their frozen
   historical entries with their original version, and do not mix them into a
   newly recalculated live ranking under incompatible rules. Keep the archived
   history accessible. Update the existing freeze contract accordingly.
7. Define certification payload/fingerprint dependencies and migration from old
   attestations. A prior attestation that never pinned B cannot automatically
   certify a new B-dependent score. T09 implements the resulting evaluation.

## Implementation boundaries

Own group schema/RPC migrations, shared exercise-core validation where
appropriate, group wire types/API and compatibility vectors. No leaderboard
screen work here; T10 owns presentation. Migration rollout and deployed smoke
belong to T12. Supply an explicit old-reader/writer compatibility plan.

## Verification and closeout

Contract tests cover rule permissions, non-member/OAuth denial, owner history
privacy, metric units, defaults, links to different groups, revisions,
archived/former data and legacy migration. Run `./boga test fast`,
`./boga test backend`, `./boga test ios-groups-e2e`; include `ios-sync-e2e`
if sync paths change and all requirements from `./boga test for`.
Graduate group/data/auth decisions, attach evidence, mark the milestone entry
complete and delete this card when shipped.
