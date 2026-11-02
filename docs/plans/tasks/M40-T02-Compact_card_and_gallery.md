# M40-T02 — CompactCard, native gallery and reference migration

- Status: `planned`
- Depends on: `M40-T01-Agree_pattern_contracts`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend; UI impact: yes

## Objective

Implement the accepted compact summary pattern and use it in real Stream and
CoW surfaces. Start the gallery with the same production exports so the human
can judge the coded pattern and its integration before it ships.

## Decided and scope

Follow D1–D6 and T01's accepted contract. Extract the compact header/metadata
recipe using existing primitives and text roles. Cover the selected Stream
event/session references and current/past CoW headings, including their real
destinations and accessible actions. Do not force domain-specific record
actions into one target, alter data/copy rules or migrate unrelated screens.

## Open — resolve with the human at session start

- Recheck the accepted targets, exact Stream variants and CoW surfaces against
  current main; expose any mismatch before coding.
- Settle the smallest content/action API and any necessary semantic variants;
  show derivations from the accepted family before implementing them.
- Confirm the gallery host chosen in T01 and the review fixtures/viewports.

## Deliverables and acceptance

1. Production CompactCard/header exports with bounded roles and no arbitrary
   typography or density props; move shared presentation out of feature files.
2. Native gallery rendering the production components, guarded from normal
   navigation/release behavior. Include long mixed word/figure content, metadata
   wrapping, record/status variants and relevant loading/error states.
3. Reference migrations preserve full-card and nested actions, route parameters,
   accessibility, current/past state handling and retry behavior.
4. Jest proves role/casing, date alignment and content/actions. Demonstrate a
   regression that fails for the original CoW heading/date arrangement. Add
   narrow guardrail coverage for the adopted contract where feasible now.
5. Capture current before/after native output and present the gallery plus real
   screens to the human. Record explicit acceptance at the reviewed commit per
   D5; remain awaiting acceptance if the human has not approved the result.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read and open a summary | Open Stream/Today; read the summary; activate its existing target/action | Compact hierarchy matches the accepted pattern and the same destination opens | Long content keeps complete accessible text; actions remain independently reachable where required |
| Current/past CoW | Open the current and previous blocks; inspect dates/status; retry a failed read | Both use the accepted header recipe and keep their existing state semantics | Missing, unavailable and failed reads retain the current affordances |

## Specs and gates

Update `docs/specs/ui/components-catalog.md` and the component files; update
`docs/specs/ui/design-language.md` or `docs/specs/ui/ux-rules.md` only for settled
shared rules. Read `apps/mobile/__tests__/README.md` before editing tests.
Start with fast + the relevant macOS frontend-ui/group device lanes selected by
`./boga test for`; agree reductions with the reviewer. Native captures and human
acceptance remain required even for cosmetic reductions. Run jest-coverage,
complexity and dependencies, plus independent code/product reviews. Preserve
evidence in the PR; normal closeout deletes this card only in the shipping PR.
