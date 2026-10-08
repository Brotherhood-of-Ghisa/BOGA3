# T-20261008-01 — Simplify Progress and Daily/Weekly heatmaps

- Status: in progress — Sets clarification and human review pending
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes
- Execution: one agent session, one implementation worktree, one branch/PR.
- Implementation branch: `codex/plan-progress-heatmap-ui` (operator requested existing branch).

## Objective

Apply the operator's 2026-10-08 UI edits to Progress and the shared muscle/exercise
history heatmaps. Commit the implementation on a new branch, make it available
for human UI testing, and pause before running any automated tests.

## Accepted design target

Target: this operator brief, applied to the latest `origin/main` production UI.
Capture the current app before editing and compare the changed states against
the requirements below. Existing repository typography, tokens, accessibility
and metric contracts govern everything outside these edits.

The main checkout inspected during planning was behind `origin/main`; start
from current main, which already has Daily month calendars with Mon–Sun and Week
columns. Do not restore the older sideways daily grid.

## Deliverables and acceptance

### Progress page

- Remove target-based colour grading from the Progress landing presentation.
  Planning interpretation of “bar colour grading”: the muscle row attainment
  shading in `apps/mobile/components/stats/progress-tables.tsx`.
- Use the existing neutral row background regardless of target attainment;
  remove colour-only accessible wording and obsolete grading code/props where
  no caller needs them.
- Preserve metric values, comparison periods, name links, contribution chevrons
  and selected-row indication. This request does not remove heatmap colouring
  or the saved weekly target.

### Daily heatmap — both muscle and exercise

- Draw a vertical separator between Sun and Week, aligned through each month's
  header and calendar rows using existing rule tokens. Keep the eight columns
  aligned and the Week value readable at narrow widths.
- Remove the small metric subtitle directly under “Daily training load” for
  every supported metric.
- Show no dash in an empty/rest Week tile, including the current future-week
  placeholder. Keep rest/empty values blank, genuine zero training numeric and
  unavailable values distinct; preserve date and accessibility descriptions.
- Retain existing metric controls, month ordering, week aggregation and colours.

### Weekly heatmap — both muscle and exercise

- Remove the top selected-week box above “Weekly training load”, including its
  range/value content. This is the shared `WeekSelectionBanner` in
  `apps/mobile/components/stats/history-sheet.tsx`; remove its unused code.
  Do not remove the Metric controls or the “Top weight” metric.
- Match “Weekly training load” to “Daily training load”: font family, weight,
  size and line height, using existing tokens/shared styles.
- Remove the subtitle below “Weekly training load” for every supported metric.
- Remove the visible Rest indicator; leave a rest week's value blank without
  substituting a dash or zero. Keep zero training and unavailable values distinct,
  and keep useful rest semantics in accessibility labels.
- Sets: show one dashed median reference line (provisional interpretation of
  the repeated phrase in the request; see Open below).
- Every supported metric other than Sets: show dashed median, 5th-percentile
  and 95th-percentile reference lines, with concise, distinguishable labels.
- Replace the existing average calculation, line, labels and related accessible
  text with the requested references. Keep references aligned to the same
  zero-based scale used for the weekly bars.
- Preserve the Weekly list, saved view/look-back, scrolling and current/selected
  row indications. Removing the banner does not require redesigning selection.

## Statistical defaults proposed for this task

Reuse the current reference population: known training weeks in the most recent
12 calendar weeks of the selected history window. Keep the existing minimum
of six eligible weeks and the positive-scale requirement unless the operator
requests a different baseline. Include genuine zero training; exclude rest,
future and unavailable values.

Sort a copy of eligible values and reuse
`calculateLinearPercentile` in `apps/mobile/src/session-insights/calculations.ts`
for P50/P5/P95 if its import fits the dependency rules. Do not add a statistics
dependency. Keep numeric/accessible labels accurate when references coincide;
handle overlapping labels without changing the calculated values.

These population/minimum choices are implementation defaults, not additional
operator requirements. State them when presenting the UI for human review.

## Open — resolve before the affected implementation

The request says “Sets metric: replace median dashed line with median dashed
line.” Planning asked whether this means a single dashed median for Sets.
Until answered, the recommendation above is provisional; settle this with the
operator before implementing the Sets reference.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare Progress | Open Progress; change period/metric and expand contributions | Neutral muscle rows; existing figures and separate name/chevron actions remain | All-zero, previous-only, loading/error and narrow-width rows retain their existing meaning |
| Inspect Daily | Set Daily in Settings; open a muscle or exercise history and choose each available metric | Sun/Week separator; title without subtitle; empty Week tiles blank | Partial months, future weeks, year boundaries, genuine zeros and unavailable values stay distinguishable |
| Inspect Weekly | Set Weekly in Settings; open either history and choose each available metric | No top banner, subtitle or visible Rest; matching title; median/P5/P95 references as applicable | Sparse/all-zero history has no misleading references; coincident references remain readable; controls and scrolling stay usable |
| Human review | Agent commits the UI and supplies branch, worktree and runnable preview instructions; operator tests both views | Operator confirms testing is complete before automated validation starts | Report “human review pending; automated tests not run”; incorporate requested UI fixes without starting tests |

Appearance: use existing palette/type/rule tokens; keep long names and figures
readable, useful accessible labels and existing native navigation. No new
dependencies, chart framework, durable preference or Maestro flow.

## Implementation entrypoints

- `apps/mobile/components/stats/progress-tables.tsx` — Progress row grading.
- `apps/mobile/components/heatmaps/DailyHeatmap.tsx`,
  `apps/mobile/components/heatmaps/calendar-tile.tsx` — calendar separator,
  subtitle and Week placeholder.
- `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`,
  `apps/mobile/components/heatmaps/heatmap-style.ts` — headings and references.
- `apps/mobile/components/stats/history-sheet.tsx` — selected-week banner.
- Trace callers before removing helpers/props. Shared components must cover
  both kinds of history, including every metric each kind actually offers.

When updating tests, first read `apps/mobile/__tests__/README.md`. Extend the
existing Daily calendar, Weekly bars, heatmap marks and real-data Progress screen
tests for these changes. Cover reference values/eligibility, removed presentation,
neutral shading and zero/rest/unavailable distinctions. Tests may be authored
during implementation; none may be executed before human testing.

## Documentation

Load the AGENTS.md always-load and UI documents; load
`docs/specs/tech/training-metrics-contract.md` for metric/reference work.
Update `apps/mobile/components/heatmaps/README.md` for banner, blank tiles and
reference semantics, and the owning UI specs where current contracts change,
following `docs/specs/ui/README.md`. Load `docs/specs/README.md` before writing
persistent documentation.

Current code/docs prescribe graded Progress rows, a Weekly banner and an average
reference. This task explicitly changes those rules; record the change and
remove stale descriptions. Design inputs remain with the task/PR under the
current design policy. Do not reference this task from code, tests or specs.

## Branch, review and gates — human first

1. Follow `docs/plans/README.md` task protocol for one task/session. Create a
   fresh local worktree/branch with `./boga worktree create` from latest
   `origin/main`; carry this card into that session if the planning branch has
   not been merged. Use the normal isolated slot and dependencies.
2. Implement, author regression coverage, update owning docs and commit the UI
   changes locally on the new branch. Starting the app and taking manual native
   captures are allowed. Do not run Jest, Maestro, any test/quality lane, a sweep
   or a commit hook that runs tests; do not push/open a PR that starts CI yet.
3. Present the committed branch/worktree and a runnable UI for the operator.
   Capture both history kinds across available metrics, rest/empty, real zero,
   unavailable and reference edge states at relevant small/large widths.
   Pause until the operator explicitly confirms human testing is complete.
4. After that confirmation, run `./boga test for`, propose the smallest appropriate
   lane set and obtain operator agreement for lanes beyond fast. Expected:
   `fast`, plus the agreed UI/device lanes and
   `jest-coverage`, `complexity`, `dependencies` before the PR.
   Deferral changes the order of validation; it does not waive it.
5. Run agreed gates to green, record command/artifact evidence, and follow the
   repository review/PR template and lifecycle. No new Maestro scenario without
   operator approval. Delete this ephemeral card in the implementation PR.
   Stop the stack after opening the PR and release the worktree after merge.

## Execution handoff — 2026-10-08

- Implemented neutral Progress rows, Daily separator/blank future Week values,
  shared heading typography, removed subtitles/banner/visible Rest, and
  median/P5/P95 for non-Sets metrics. Sets references remain unimplemented
  pending the clarification above; the current preview has no Sets reference.
- References use at least six known training weeks among the latest twelve
  calendar weeks. Genuine zeros count; rest, future and unavailable values do
  not. All-zero scales omit references. Coincident labels occupy separate lines.
- Regression coverage authored in the existing suites; **human review pending;
  automated tests not run**. No quality lanes, test hooks, push or PR yet.
- Reused the operator's branch, which contains current `origin/main`, with
  `./boga worktree start`; slot 29. `./boga doctor` passed.
- Worktree: `/Users/sboschi/Projects/boga-worktrees/codex-plan-progress-heatmap-ui`.
  Run `./boga ios start` there to open the native preview (Metro port 8111,
  simulator `BOGA wt29`). Existing development data is seeded on this simulator.
- Human review: Progress → muscle name or contribution exercise name; choose
  each available Metric. Switch the saved Daily/Weekly view in Settings and
  reopen history. Check neutral rows, selection/chevrons, separator, blank
  rest/future values, numeric zero, unknown values, scrolling and references.
- Manual native captures: `apps/mobile/artifacts/heatmap-ui/` (ignored).
  Both history kinds and all metrics were captured at 402pt; 375pt captures
  include Daily layouts and sparse/zero/coincident Weekly references. Edge
  states use a temporary host with production components; the host is removed
  before the local commit. `before-loaded.png` captures the original Progress.

Next: settle Sets, finish that reference and its coverage, present the completed
UI for human testing. Only after explicit testing-complete confirmation, agree
and run validation lanes as specified above.
