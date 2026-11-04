# T-20261104-01 — Distinguish completed and skipped programme work

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes

## Objective

Make programme progress distinguish work completed through a linked workout
from work resolved with Skip. Keep the programme Completed when every block
is resolved, and shorten the block action to Skip.

## Scope

- In: plan-block action/confirmation/accessibility copy; programme summary
  counts; planned-session outcome labels and their spoken equivalents; Jest
  coverage and native visual evidence.
- Out: lifecycle or eligibility changes, new completion actions, retroactive
  workout matching, performed-data writes, schema/sync changes, and new workout
  links. Workout-link discovery is tracked separately in
  [issue #1094](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/1094).

## Decided

1. Keep Add to session and Skip. Replace Skip without doing it with Skip,
   including accessibility and confirmation wording that implies the exercise
   was not performed. Skip may be used when work was logged outside the plan.
2. Skip resolves programme progression and retains its stored skipped outcome.
   Preserve completion eligibility under [[planner.block-completion]], existing
   workout provenance, and all logged values. Add no Mark as completed action.
3. A programme with no pending/attached blocks keeps the Completed badge,
   including when some or all blocks were skipped.
4. For the reported two-session case, show Completed on the performed session,
   Skipped on the skipped session, and the summary
   `2 sessions · 1 completed · 1 skipped`.
5. Label a fully resolved, skipped-only planned session Skipped. A fully
   resolved session with performed completions uses Completed; when it also
   contains skipped blocks, expose both counts so the label cannot hide them.
   Preserve Planned and In progress for unresolved sessions.
6. Derive outcomes from the existing read model, including completion derived
   from confirmed source-derived work in a completed workout even if the stored
   block status is still pending. Do not equate raw pending with unfinished.
7. **Product decision to record in implementation:** separate programme
   resolution from performed completion in displayed outcomes/counts. Assess
   `planner.progress-outcomes` as a new presentation fact under the fact-authoring
   criteria; preserve [[planner.block-completion]]. Highlight the final fact ID
   in the implementation PR's Product facts line.

## Open — settle during implementation

- Choose compact count wording for partial, all-completed, all-skipped, empty,
  and mixed-block sessions, preserving totals and completed/skipped distinctions.
- Use the current component/catalog contracts for the presentation declaration;
  reuse existing cards, tags and rows. This task creates no reusable template.

## Deliverables and acceptance

1. The two-session fixture renders the agreed badge, session outcomes and
   summary, with no contradictory count. An all-skipped programme is finished
   for progression and clearly identifies skipped work.
2. Pending/attached blocks keep the programme in progress as appropriate.
   Mixed-block sessions expose completed and skipped counts; singular/plural,
   zero and long-content cases remain readable.
3. Skip and Cancel retain their existing effects. A stale block with confirmed
   planned work still refuses Skip and shows the existing actionable error.
   Existing session navigation, source links and logged work remain intact.
4. Update existing real-data screen tests in
   `apps/mobile/__tests__/programme-screens.test.tsx` and
   `apps/mobile/__tests__/session-plan-screens.test.tsx`. Cover derived
   completion from a stored-pending block and assert preserved provenance.
5. Capture native before/after evidence at small and normal phone widths for
   the mixed-completion case, all-skipped, partial, long-content and error states.
   Put screenshots and gate evidence in the implementation PR; delete this card
   in that PR.

## UX contract

Design target: the repo-native brief in Decided and this table. Retain the
current programme summary card, session-list rows and plan-block action rows;
change the words and count presentation within their existing hierarchy. Use
the source screenshot's one-performed/one-skipped scenario as the reproduction,
with synthetic data. Preserve navigation, reorder controls and action order.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Skip a block | Open an eligible block; tap Skip; confirm | Block becomes Skipped and progression advances | Cancel writes nothing; confirmed planned work refuses Skip with the existing notice |
| Review programme | Open a programme containing performed and skipped blocks | Completed badge when resolved; separate completed/skipped counts; distinct session outcomes | Pending/attached blocks remain unresolved; mixed-block sessions retain both counts |
| Inspect a used block | Open a completed planned session and its block | Existing actual-session link and recorded values remain available | Derived completion works with stored pending; skipped-only blocks gain no fabricated link |

## Implementation entry points and docs

- For labels/counts, inspect
  `apps/mobile/components/session-planner/programme-detail-header.tsx`,
  `apps/mobile/components/session-planner/programme-plan-list.tsx`,
  `apps/mobile/components/session-planner/plan-detail-blocks.tsx`, and
  `apps/mobile/components/session-planner/next-programme-block-card.tsx`.
- For resolution/read behavior, load
  `apps/mobile/src/session-planner/plan-queries.ts` and
  `apps/mobile/src/session-planner/block-resolution.ts`.
- For owning docs, update `docs/specs/ui/screen-map.md` for changed screen copy
  and `docs/specs/tech/session-planning-contract.md` for changed UI outcomes.
  When recording the product decision, load
  `docs/procedures/product-facts-authoring.md` and update `docs/product/planner.md`.
- Before UI work, load `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/components-catalog.md` and `docs/specs/ui/ai-design-policy.md`.
  Before editing tests, load `apps/mobile/__tests__/README.md` and
  `docs/specs/writing-tests.md`.

## Gates

Run `./boga test for` on the implementation diff and agree the final set with
the reviewer. Expected: `./boga test fast`, plus the required pre-PR
`./boga test jest-coverage`, `./boga test complexity`, and
`./boga test dependencies`.

The UI path default is frontend-ui on macOS / frontend-android on Linux.
Propose covered-by-jest for outcome/copy changes, with native screenshot
comparison; use the existing ios-data-smoke planner flow if interaction or
navigation changes require device proof. Add no Maestro flow without the
repository's written justification. Backend/sync lanes are unnecessary while
storage, eligibility and sync remain unchanged.
