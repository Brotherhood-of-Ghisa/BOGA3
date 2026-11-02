# M40-T06 — Enforce pattern adoption and finish the coded catalog

- Status: `planned`
- Depends on: `M40-T04-Sortable_table_migration`, `M40-T05-Summary_tile_migration`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend, tooling, docs; UI impact: gallery and any corrective migration

## Objective

Close the loop between the four human-accepted production patterns, the coded
gallery and the mandatory choice/derivation workflow. Make measurable styling
drift fail the existing gates, with clear scope and actionable errors.

## Decided and scope

Load `docs/plans/M40-pattern-contracts.md` for the operator-approved native
templates and shared row contract. This selection is settled; recheck current
main for drift, and obtain a new template decision only for a material deviation
or new derivative. Coded-result acceptance remains required for this migration.

Follow D1–D6 and the accepted implementations. Complete the existing
ui-guardrails/ESLint/Jest mechanisms; no replacement framework, repo-wide restyle
or unapproved baseline. Rules must distinguish legitimate foundation definitions
from feature overrides and cover both TS style modules and TSX components.
Future features select an accepted family; derivations require a parent/delta
proposal and explicit human selection before coding.

## Open — resolve with the human at session start

- Recheck enforcement already delivered by sibling cards. Agree the remaining
  adopted scope, real exceptions and incremental expansion policy; disclose
  untouched consumers instead of claiming global coverage.
- Decide the smallest rule mechanism per violation and the PR checklist evidence
  for semantic pattern selection. A pass/fail script cannot decide every design
  question.
- Confirm that every family/reference has explicit acceptance for its current
  production form. Any material correction needs a fresh native human review.

## Deliverables and acceptance

1. Demonstrate rejection of unauthorized type/casing/spacing overrides in adopted
   consumers and the old CoW role choice; safe examples of the approved
   patterns/foundation definitions pass. Add meaningful script/Jest coverage for
   both detections and false-positive boundaries, including TS style files.
2. Keep the gallery wired to production exports. Verify four families, edge
   states and side-by-side list/table spacing; remove duplicate preview styling
   and ensure gallery fixtures/routes remain development-only.
3. Complete the catalog, AGENTS routing and UX/PR selection checklist, including
   explicit human acceptance tied to reviewed code. Keep one owner for each
   lasting rule and preserve existing PR template requirements.
4. Document the accepted adoption scope and how touched screens join it. Any
   discovered suppression/budget relaxation needs operator agreement before it
   enters the diff.
5. Run independent code/product reviews. Present the complete coded catalog and
   evidence of the four reference acceptances to the human. Final human
   acceptance is required; AI review and green tests are not substitutes.

## Specs and gates

Update `docs/specs/ui/components-catalog.md`, `docs/specs/ui/design-language.md`,
`docs/specs/08-ux-delivery-standard.md` and `AGENTS.md` as their ownership requires.
Update `docs/specs/ui/ai-design-policy.md` only if its own policy changes. Keep
new lane/trigger changes in their registries if needed, following spec 02.
Read `apps/mobile/__tests__/README.md` before editing tests. Use `./boga test for`;
fast and the quality targets are required for code/tooling changes, and native
lanes/captures follow any changed gallery or production UI. Agree the final set
with the reviewer. Delete this card and the milestone in the shipping PR once
all accepted migrations and enforcement work are complete; durable rules stay
with their spec owners and evidence stays in the PRs.
