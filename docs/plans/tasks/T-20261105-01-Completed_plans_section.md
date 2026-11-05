# T-20261105-01 — Separate completed plans from unfinished queues

- Status: `planned`
- Source: [issue #1104](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/1104)
- Depends on: this planning PR merging; the separate completion-tag/date work
  referenced by the issue reaching `origin/main` before implementation.
- Milestone: none; one implementation session, worktree and PR.
- Areas: frontend; UI impact: yes.

## Objective

Keep resolved planning work out of Upcoming and Unscheduled, even when
**Show completed plans** is enabled. Reveal those rows in a separate
**Completed plans** section between Unscheduled and weekly workout history.
Keep unfinished programmes visible with a completed sessions fraction:
the number of completed child sessions divided by the total live child sessions.
This card plans the work; this PR changes no application code.

## Scope and decisions

- Upcoming contains unfinished scheduled standalone and programme-child plans.
  Unscheduled contains unfinished standalone plans and programmes.
  Programmes currently have no schedule of their own: their row stays in
  Unscheduled while unfinished dated children remain in Upcoming. Do not infer
  a programme schedule from a child or add programme scheduling in this task.
- Classify by the existing derived `progress === 'completed'`, never by a
  future schedule, an available next block, or whether a completion date exists.
  Preserve [[planner.block-completion]] and [[planner.progress-outcomes]].
- Completed plans includes resolved standalone and programme-child plans,
  scheduled or unscheduled, plus fully resolved programme summaries. Classify
  each child independently of its programme: a completed child appears there
  while its unfinished programme stays in Unscheduled. Each entity appears
  once; do not introduce unfinished unscheduled-child rows in the hub.
- Programme rows show the completed sessions fraction as
  `Programme · {completedSessions}/{totalSessions} completed`, derived from the
  programme's current live children; `1/10 completed` is only an example.
  Count session outcomes using
  [[planner.progress-outcomes]], never completed blocks or workout count.
  Append `· {skippedSessions} skipped` when the skipped count is nonzero; skipped
  sessions do not inflate the numerator. An entirely resolved programme moves
  to Completed plans under the existing resolution rule, even when skipped
  sessions mean its completed fraction is below the total. Speak the fraction
  as `{completedSessions} of {totalSessions} sessions completed` and the skipped
  count separately.
- Keep unfinished ordering. For the new section, retain programme order, then
  resolved scheduled-plan order, then resolved unscheduled-plan order; dedupe
  plans by plan ID and programmes by programme ID if sources overlap. Append
  newly included unscheduled children in existing programme/child order.
  No new chronology or date-based sort is needed.
- The switch remains off by default and lasts for the existing screen mount.
  Disabled or empty means no Completed plans section. Keep the independent
  deleted-session option and all existing destinations and authoring actions.
- Partition in the Sessions presentation. Shared planner queries remain
  exhaustive for Today, the planner picker and other readers. No database,
  schema, sync, scheduling or completion-state mutations belong to this task.

**Product decisions planned:** resolved summaries belong in a separate optional
section, including unscheduled programme children; unfinished programmes show
a completed sessions fraction with skips separate. Outcome facts and training
calculations remain unchanged. Record the grouping in the owning screen documentation and
highlight it on the implementation PR's `Product facts:` line; the product
review determines any required fact authoring under `docs/product/`.

## UX contract and design target

Design target: issue #1104's section order, using the running Sessions screen
as the repo-native reference. Reuse production `PlanSection` and its existing
Card/ListRow composition, status/date presentation, tokens and accessibility.
The issue explicitly selects this component; no new component family or visual
variant is proposed. Retain completion tags/dates from the prerequisite work.
Capture the baseline before editing; keep comparison evidence under the
gitignored `apps/mobile/artifacts/` tree and link it in the implementation PR.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Browse unfinished work | Open Sessions with the switch off | Unfinished programmes stay in Unscheduled with their completed sessions fraction; unfinished scheduled children stay in Upcoming | Empty plans and pending/attached work retain existing visibility; skip counts stay separate; loading/errors keep their established behavior |
| Reveal resolved work | Open options, enable Show completed plans, dismiss; disable again | Completed plans appears after Unscheduled and disappears immediately on reversal; rows open their existing plan/programme details | No section when empty; unknown completion dates stay absent; labels follow [[planner.progress-outcomes]]; no SQL or history-count change on toggle |
| Return after completion | Resolve a plan elsewhere, then refocus Sessions with either switch value | Newly resolved rows leave unfinished queues; appear only in the enabled completed section | Failed reload retains the last successful rows and existing error; week/day navigation stays a one-time scroll without filtering |

## Implementation tasks and acceptance

1. **Refresh the base and prerequisite.** In a fresh leased worktree, verify
   latest `origin/main` includes the completion-tag/date work. Do not copy or
   modify its uncommitted worktree. Recheck the route, summary types and existing
   tests; report dependency drift before coding.
2. **Partition and render.** Update `apps/mobile/app/sessions.tsx` to derive
   unfinished queues and resolved plan/programme collections from
   `usePlanSections`. Add one `PlanSection` with a stable completed-section
   test ID and existing navigation callbacks after Unscheduled. Include only
   visible resolved collections in the global-empty-state calculation. Reuse
   `apps/mobile/components/session-planner/plan-sections.tsx`; update its header
   comment to describe the third section, without reimplementing its labels.
   Extend the Sessions read model to include resolved unscheduled programme
   children. Enrich `ProgrammeSummaryView` in
   `apps/mobile/src/session-planner/plan-queries.ts` with derived child-session
   outcome counts for the fraction; reuse the existing bulk child/block reads
   and outcome rules, keeping query results exhaustive. Render the fraction
   and separate skipped count in the existing programme metadata line, without
   new badges, styles, persistence or per-row detail requests.
3. **Prepare real-data coverage.** Extend the existing
   `apps/mobile/__tests__/sessions-screen.test.tsx` fixtures/assertions; read its
   directory README and `docs/specs/writing-tests.md` first. Cover:
   - a resolved future-scheduled plan appearing only in Completed plans;
   - resolved programmes and scheduled children, partial programmes with both
     resolved and unfinished children, including unscheduled completed children
     of an unfinished programme, and one row per entity;
   - completed sessions fractions derived from different completed/total
     counts, with the parent retained when the completed toggle is off or on;
     unchanged placement and ordering of unfinished scheduled children;
   - fractions counting whole child outcomes rather than blocks, mixed and
     all-skipped outcomes with separate skip counts, zero/empty programmes,
     tombstoned children excluded, accessible counts and focus refresh;
   - empty, pending, attached, partially resolved and entirely skipped work;
   - existing outcome/date labels, missing dates, local Date format and routes;
   - default hidden state, immediate toggle reversal, mount reset and focus
     retention, with no SQL on toggle and no state/schedule writes;
   - visible-only global emptiness, initial loading, failed reads and refocus
     completion with the switch both on and off;
   - unchanged workout rows/counts, deleted-session filtering, authoring entries
     and one-time week/day jumps, including toggling after a jump.
   Update prerequisite tests that still expect resolved rows in the old groups.
   Add focused summary-query coverage in
   `apps/mobile/__tests__/session-plan-queries.test.ts` for the new outcome
   counts, especially mixed blocks, entirely skipped and deleted child plans.
4. **Share screenshots before running further tests.** Build the smallest
   runnable slice and capture before/after on small and normal phones: hidden
   and revealed sections, a completed future-scheduled plan, resolved/partial
   programmes (including completed sessions fractions and skips), skipped/missing-date rows,
   long names, empty/loading/error states
   and the boundary with workout history. Share the updated captures and wait
   for the operator's visual review before any test/gate run. Address requested
   visual changes first; record the reviewed commit and devices in the PR.
5. **Update owning docs and verify.** Update the Sessions row in
   `docs/specs/ui/screen-map.md`, relevant queue rules in
   `docs/specs/ui/ux-rules.md`, and the Sessions section inventory in
   `docs/specs/tech/session-planning-contract.md`. Load the persistent-doc rules
   in `docs/specs/README.md` before editing; avoid duplicating product facts.
   Record any product-fact change explicitly, within existing budgets.
6. **Review and deliver.** After visual review, run the agreed gates below to
   green. Obtain independent code and product reviews, fix findings, and open
   the implementation PR as **draft** with screenshots, lane evidence and
   review verdicts. Stop its stack with `./boga db down`. Keep it draft; merge
   only with explicit human authorization, then release its worktree. Delete
   this card in the implementation PR; do not reference it from production code
   or persistent docs.

## Gates for the implementation

After the screenshot checkpoint, run `./boga test for` on the finished diff and
agree the lane set with the reviewer before lanes beyond `fast`.

- Required: `./boga test fast`, `./boga test jest-coverage`,
  `./boga test complexity`, `./boga test dependencies`.
- Path default: `./boga test frontend-ui` on macOS or
  `./boga test frontend-android` on Linux. Propose `covered-by-jest` reduction
  only with reviewer agreement: this task changes derived grouping/toggle
  behavior, proved by real-data route tests, with native fit/scroll evidence.
  If device behavior changes, retain the smallest relevant existing lanes.
- No new committed Maestro flow is planned. Adding a scenario requires the
  written device-only justification before authoring it.
- No backend/sync/native changes are planned; reassess gates if scope expands.
  Use `./boga doctor` to fix bootstrap gaps and `./boga timings` for measured
  durations; never invent timing or mark an unavailable lane skipped.

## Planning PR verification

This PR adds only this ephemeral card. Use `./boga test for` and independent
review to settle its docs-only lane set: `./boga test docs-check` plus the
repository's required pre-PR quality targets, `./boga test jest-coverage`,
`./boga test complexity` and `./boga test dependencies`. The implementation's
`fast`/device gates and screenshot checkpoint apply to the later code change,
not to validating this planning document.
