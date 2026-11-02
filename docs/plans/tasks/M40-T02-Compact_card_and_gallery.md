# M40-T02 — CompactCard, native gallery and reference migration

- Status: `in_progress`
- Depends on: `M40-T01-Agree_pattern_contracts`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend; UI impact: yes

## Objective

Implement the accepted compact summary pattern and use it in real Stream and
CoW surfaces. Start the gallery with the same production exports so the human
can judge the coded pattern and its integration before it ships.

## Decided and scope

Load `docs/plans/M40-pattern-contracts.md` for the operator-approved native
templates and shared row contract. This selection is settled; recheck current
main for drift, and obtain a new template decision only for a material deviation
or new derivative. Coded-result acceptance remains required for this migration.

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
- Use the selected development-only sibling route and review viewports in the
  approved brief; settle only implementation details and report any mismatch.

## Implementation design

Current main is `1a6665d6a41d92a5fa699a1284018e33f68d7c18`; the selected
references match the approved native preview. Use CompactCard for the two
standalone Stream cards and CompactHeader for their label/metadata row and the
existing embedded CoW/Today headers. Fixed container insets and header geometry
have no consumer style override. Subjects, facts, formatted content and callbacks
remain feature-owned. Preserve existing CoW subject/status geometry and Today
current-link/previous-passive/retry boundaries. Expose existing session record
callbacks through Card's accessibility-action convention as well as touch.

The sibling UI gallery is explicitly registered after normal root routes,
self-gated by isDevMode and StoreClient exclusion, and has no normal navigation
entry. Fixture-only read states use the same pure production presenters; never
replace production hooks or introduce a parallel styled implementation. Include
normal, long, current/past/pending/unavailable/absent and error/retry states.

Lane agreement (independent Codex contract reviewer): fast, ios-smoke,
ios-groups-e2e, jest-coverage, complexity and dependencies. Lower unrelated
frontend defaults as covered-by-jest with gallery access/registration tests;
no base Card/auth policy/runtime script/native dependency changes. The existing
Groups flow dismisses only the observed seasonal icon confirmation before Expo
setup; it must pass twice consecutively. Native
captures cover375pt/402pt and the approved440pt reference; no new Maestro lane.
Product facts: none intended.

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
