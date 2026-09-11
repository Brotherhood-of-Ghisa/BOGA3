---
task_id: M24-T05-Milestone_closeout
milestone_id: "M24"
status: planned
ui_impact: "no"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md, docs/specs/09-project-structure.md, docs/specs/ui/**, docs/specs/milestones/**, docs/specs/README.md"
---

# M24-T05 — Milestone closeout

## Task metadata

- Task ID: `M24-T05-Milestone_closeout`
- Status: `planned`
- Depends on: `M24-T01` through `M24-T04` merged

## Parent references

- Milestone: `docs/specs/milestones/M24-current-session-insights-and-pr-celebration.md`
- Milestone archive rule: `docs/specs/milestones/README.md`
- Quality/testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- UX/UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Canonical docs inventory: `docs/specs/README.md`

## Objective

Verify the merged M24 experience end to end, reconcile every canonical document
with the as-built behavior, and archive the milestone only when every acceptance
criterion has evidence.

## Scope and acceptance criteria

1. Start from current `origin/main`, run `./boga doctor`, and inventory the full
   merged M24 diff. Fix bootstrap gaps rather than skipping a lane.
2. Run `./boga test fast` and `./boga test frontend` on the closeout commit.
   Run any path-triggered named lanes that are not included and record only
   measured timings from `./boga timings`.
3. Map M24 AC1-AC18 to exact tests, Maestro artifacts, screenshots, or manual
   evidence. Any gap becomes a follow-up and keeps the milestone open.
4. Exercise the mapped, partially mapped, unmapped, catalog-error, no-PR,
   one-PR, multiple-PR, share-cancel/error, reversal, completion, Done/back, and
   seven-day handoff states on supported small and large phone viewports.
5. Confirm the share test stops after opening/closing the platform sheet and
   sends nothing externally.
6. Confirm normal completed-session history detail and completed-edit save have
   no celebration regression.
7. Reconcile `00-product.md`, applicable architecture/testing/structure docs,
   and all triggered `docs/specs/ui/**` docs with as-built source links. Do not
   add schema/sync claims when no model change occurred.
8. Confirm no raw UI colors, new native dependency, schema, migration, backend,
   RLS, or sync change entered the milestone. If one did, run and document its
   full required gate set before closeout.
9. Fill every task completion note, move completed task cards to
   `docs/tasks/complete/`, move the M24 spec to
   `docs/specs/milestones/archive/`, and update all inbound references.
10. Run `./boga test docs-check`, task closeout helpers, and
    `./boga test for --diff origin/main` after the final archive/doc edits.

## Docs touched

- Review every path in frontmatter; change only documents whose canonical
  statement or index requires reconciliation.
- `docs/specs/00-product.md` records the shipped two-signal and completion
  decisions.
- `docs/specs/ui/screen-map.md`, `navigation-contract.md`,
  `components-catalog.md`, and `ux-rules.md` must match the as-built behavior.
- Archive milestone/task documents rather than leaving completed active specs.

## Testing and verification approach

- Use only `./boga` gate entrypoints.
- Validate the closeout PR body with `./boga pr check --body <file>` and list
  every aggregate gate as ran or path-triggered N/A.
- Keep the milestone open for missing visual, interaction, accessibility, or
  route evidence.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
