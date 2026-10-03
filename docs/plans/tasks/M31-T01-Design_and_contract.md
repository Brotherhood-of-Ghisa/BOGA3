# M31-T01 — Accept the exploration design and metric contracts

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: docs / frontend design; UI impact: yes

## Objective

Turn #404, #388, #400 and #260 into one accepted exploration model and an
implementable metric/persistence contract. Resolve the conflicts identified in
the milestone before any counting rule, migration or significant UI change.

## Scope and decided requirements

Milestone D1–D5 apply. This is a design/contract PR; prototype material may
support review, but production feature implementation belongs to later cards.

## Open — resolve with the user

- Pin a design source and accepted phone states per `ai-design-policy.md`.
  Specify entity picker, comparison presentation/limit, compatible metrics,
  time-range controls, granularity, selected-bucket behavior and dismissal/back.
- Resolve all five milestone risk/decision items, especially weekly target units
  versus the four-week view, target-only effort filtering versus global working
  sets, selectable RIR choices, and storage ownership/sync scope.
- Agree how preparatory code-PR `fast`/quality checks and staged human review fit
  #404's deferred closeout instruction. Do not silently waive either policy.

## Deliverables and acceptance

1. A concise accepted target record with native source/revision, phone viewport
   and screenshots for single entity, switching, comparison, targets/settings,
   empty, loading and error states. No placeholder target is labelled accepted.
2. A UX contract with these flows, refined with the selected behavior:

   | Flow | Trigger and steps | Success | Failure/edge |
   | --- | --- | --- | --- |
   | Explore | Open Progress; select range, metric and entity; switch entity | Context is predictable without leaving analytics | Missing/deleted entity, empty history and loading retain valid context |
   | Compare | Add another compatible entity; inspect a time bucket; remove it | Series share the agreed metric/unit/time bounds | Incompatible metric, no history, limit and long names have explicit behavior |
   | Configure | Save granularity, effort choices and a weekly muscle target | Relevant views use saved choices immediately | Invalid target, save error, historical effort and unset target are specified |

3. A contract covering defaults, target edits/history, week boundaries, physical
   set identity, effort classification, cache invalidation and persistence
   lifecycle. List affected readers and compatibility/migration implications.
4. Update downstream cards to the accepted decisions and concrete lane sets;
   split oversized backend work before marking this task complete.
5. Update only the owning durable specs for accepted decisions. Delete this
   card and mark T01 completed in the milestone in this PR.

## Touchpoints and specs

Inspect `app/(tabs)/stats-history.tsx`, `components/stats/history-sheet.tsx`,
`src/data/stats.ts`, `muscle-analytics.ts`, `set-types.ts`, `exercise-session-facts.ts`,
`src/config/training.ts`, `src/utils/local-calendar.ts`, and current Settings.
Update `docs/specs/05-data-model.md`, `03-technical-architecture.md` and
`docs/specs/ui/{ux-rules,navigation-contract,screen-map}.md` only where decisions
change their contracts; keep an accepted target in `ui/design-targets/` if needed.

## Gates

Agree a docs-only lane set with the operator for the contract PR. Runtime code
introduced by a prototype is a code change and requires Jest/`fast`; otherwise
do not invent runtime evidence for a design document. No final workstream
closeout before the implemented UI has been accepted.
