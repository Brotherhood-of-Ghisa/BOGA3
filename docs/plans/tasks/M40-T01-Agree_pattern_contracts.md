# M40-T01 — Agree pattern contracts and human acceptance

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: docs, frontend discovery; UI impact: no shipped UI in this task

## Objective

Make the four pattern contracts concrete enough to implement and review. Agree
compact density and the human acceptance process against current native screens,
including the exact At a glance tile and leaderboard references.

## Scope and decided

Follow milestone D1–D6. Inventory existing foundations and callers before
proposing exports; reuse Card, ListRow, Stat and StatsTable. This task captures
and agrees targets and updates workflow docs; production components and screen
migrations belong to later cards. The HTML sketches are conceptual inputs only.

## Open — resolve with the human before implementation

- Confirm working component names, their content/action slots and bounded
  variants. Show the four references and get the human's selection.
- Agree a compact row recipe for ListCard and SortableTable: exact token roles,
  vertical insets, text/number alignment, multiline growth, nested rows and any
  passive/interactive variant. Preserve full touch targets without stacking
  duplicate minimum heights. Do not assume a passive row must be 44pt tall.
- Identify the At a glance headline Group stats tile separately from the period
  controls; confirm what the human meant by the top tile.
- Agree the small/normal native viewports, initial gallery host and how the human
  will inspect builds. Identify the first guardrail scope and any art/native
  boundary exceptions that require explicit treatment.

## Deliverables and acceptance

1. Recheck current main; capture and inspect the actual Stream, leaderboard,
   Progress Muscle/contributor and At a glance references. Keep captures under
   the gitignored artifact tree and link them from the PR.
2. Record the agreed contracts and native design targets, including fixed
   styling versus feature-provided content/behavior, in the task/PR. Show the
   shared row recipe for list/table side by side. Highlight conflicts with
   existing semantics instead of silently resolving them from the mocks.
3. Publish the workflow rule: recommend existing patterns and ask the human to
   choose; present a parent/delta proposal before a new derivative is built.
4. Publish a human acceptance checklist requiring explicit acceptance of coded
   components and migrated screens at the reviewed commit before each migration
   ships. Approval of this task does not accept the later coded result.
5. Update the remaining cards with settled references and contract decisions.
   Human acceptance of the contracts is required before T02 starts.

## Specs to update

- `docs/specs/08-ux-delivery-standard.md` — selection and human acceptance workflow.
- `docs/specs/ui/ai-design-policy.md` — native target/acceptance evidence if its
  existing visual comparison rule needs clarification; keep one owner per rule.
- `docs/specs/ui/design-language.md` — agreed compact composition/row principles.
- `docs/specs/ui/components-catalog.md` — selection guidance; label unimplemented
  families as planned, with no claim that new exports already exist.
- `AGENTS.md` — concise load trigger/required selection step, pointing to owners.

## Gates and closeout

Start from `./boga test for`; expected docs-only lane: docs-check. Agree the
final set with the independent reviewer and run the repository's required
quality targets. Run fast if production or test code enters the diff. Capture
work uses the slot-isolated native runtime; run doctor and repair prerequisites
before declaring it unavailable. Run independent code and product reviews.
Delete this card and mark it completed in the milestone in the shipping PR;
downstream work begins only after the human-approved PR merges.
