# M42-T07 — Milestone closeout and spec graduation

- Status: `planned`
- Depends on: [M42-T03](M42-T03-Live_workout_warnings_and_substitutions.md), [M42-T05](M42-T05-Heatmap_injury_overlay_and_reload_analytics.md), [M42-T06](M42-T06-MCP_coach_tools_and_agent_api.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: cross-stack, docs, quality gates; UI impact: no

## Objective and scope

Run the full quality gates suite across platforms, graduate durable architecture
and product rules into persistent specs (`docs/specs/**` and `docs/product/`),
clean up task cards, and close out milestone M42.

## Baseline to verify

Load `docs/specs/02-quality-and-test-gates.md`, `docs/specs/05-data-model.md`,
`docs/specs/09-project-structure.md`, and `docs/plans/README.md`.

## Open — resolve before coding

- Verify all durable decisions are captured in persistent docs:
  - `docs/specs/05-data-model.md`: document `injuries` table, Layer 1 placement,
    and strict owner-private isolation.
  - `docs/specs/tech/training-metrics-contract.md`: formalize `'rehab'` effort
    exclusion from 1RM estimation, PR records, and working set volume.
  - `docs/product/`: record injury product facts under `injury.md`
    (`injury.lifecycle`, `injury.privacy`, `injury.reload-threshold`), update
    `set.md` (`set.eligibility` for `rehab`), and update `README.md`.
- Ensure no task card references (`M42-T*`) remain in persistent code, tests,
  or specs.
- Meet all quality targets:
  - Jest coverage: ≥80% lines, ≥80% branches across `apps/mobile`.
  - Cognitive complexity: ≤25, lines ≤200, depth ≤4, params ≤5.
  - Dependency cruiser: no cycles, strict layer hierarchy.

## Deliverables and acceptance

1. Graduate all durable rules into `docs/specs/` and `docs/product/`.
2. All quality targets green:
   - `./boga test jest-coverage`
   - `./boga test complexity`
   - `./boga test dependencies`
3. Prune task cards `M42-T01` through `M42-T06` and mark `M42` completed in
   `docs/plans/milestones/M42-injury-and-discomfort-tracking.md`.
4. Run `./boga test docs-check` and verify clean doc budgets and link integrity.

## Gates

Expected from `./boga test for`:
`fast` | `backend` | `frontend` | `jest-coverage` | `complexity` | `dependencies`
