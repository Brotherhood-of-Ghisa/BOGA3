# M27-T15 — Decide private-reading corrections for percentage certifications

- Status: `planned`
- Depends on: none
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420), separate reading-correction boundary
- Areas: docs; UI impact: yes (future certificate state/copy)

## Objective

Resolve the lifecycle of a normalized certification when its applicable private
reading is corrected. This is a calculation-data edit, distinct from the
already decided rule-only retention guarantee. Decide with the operator before
T08/T09 introduce a percentage denominator dependency.

## Current outcome and question

The existing relevant-reading correction test voids e1RM certification while
leaving raw Weight certification active. The old group rule-sensitive pin and
old public-B/snapshot plan must not be used as authority for a new outcome.

Ask whether a corrected reading should end the new %BW certificate or retain
the witnessed unchanged set and only recalculate its score. Include value/date
edits, deletion/restore, a new backdated reading becoming applicable, missing
context and no-op corrections. A later reading that does not become applicable
is harmless under either option. Rule changes alone remain harmless under both.

## Deliverables and acceptance

1. Inventory the currently tested correction cases and current as-of selection;
   give the operator concrete before/after examples for both policies without
   publishing private readings to group members.
2. Record the operator's chosen policy and migration treatment for existing
   certificates in milestone D4 and affected task cards. State the differences
   between raw Weight legacy certificates and new percentage projections.
3. Specify active/ended audit metadata, eligibility/Certified-board behavior,
   restoration after missing input and public copy. Do not expose a private
   reading correction reason/value/date through the group payload.
4. Identify the exact existing tests to retain/change and new normalized cases
   T09 must prove. Changing an existing reading-correction assertion requires
   this explicit decision; do not silently treat data corrections as rules.
5. Keep this a planning decision PR. Implement chosen behavior and graduate the
   owning group/bodyweight contracts in T09; do not misdescribe an unimplemented
   outcome as the current production contract.

## Gates and closeout

For a docs-only decision diff, propose fast/docs-check and the required quality
checks per repository rules; do not run backend/device lanes without agreement.
If scope grows to executable behavior, add/update Jest and use `./boga test for`.
Delete this card and mark its milestone row completed once the chosen policy is
recorded in a merged plan PR. No backend mutation or deployment is authorized
by this decision task.
