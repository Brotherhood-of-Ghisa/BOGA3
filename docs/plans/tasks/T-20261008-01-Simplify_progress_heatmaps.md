# T-20261008-01 — Simplify Progress and Daily/Weekly heatmaps

- Status: in progress — human UI review pending
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: yes
- Execution: one agent session, one implementation worktree, one branch/PR.
- Implementation branch: `codex/plan-progress-heatmap-ui`.

## Objective and accepted design target

Apply the operator's current UI brief below to the latest-main Progress and
shared muscle/exercise history UI. Commit locally, supply a runnable native
preview, and pause before any automated tests until human testing is complete.
This card always reflects the latest agreed requirements; git preserves prior
versions. Existing typography, tokens, accessibility and metric contracts govern
everything outside these changes. Native screenshots are comparison evidence.

## Deliverables and acceptance

### Progress

- Remove target-based muscle-row colour grading and colour-only accessible
  wording. Keep the neutral background for every attainment level.
- Preserve figures, comparison periods, name links, contribution chevrons and
  the selected row's left rule. Keep saved weekly targets and heatmap colouring.
- Selected top filter segments use white text on a fixed black background,
  irrespective of the colour theme. Other segments retain their neutral style.

### Both history kinds and views

- Retain all supported metric controls, including exercise Top weight. Their
  selected segment also uses fixed black with white text in every theme.
- Remove the window subtitle (e.g. Daily/Weekly · 12 weeks), Metric caption,
  metric subtitle under the training-load title, and visible reference-label
  stack (P5/Median/P95). Keep accurate reference identities and values accessible.
- Draw no black outline around tiles/bars, including today/current week and
  selected states. Keep selection accessible and use the existing caret for
  the selected Weekly row. Neutral rules and unavailable-value styling remain.
- Bound history to the History look-back (weeks) setting: no weeks before its
  Monday-aligned start or after the current week. Current-week future day
  placeholders are blank. Retain saved view/window, scrolling and calculations.
- Rest and unavailable values are blank in both Daily and Weekly, including
  the Daily Week column: no visible Rest wording, question mark or unavailable
  caption. Genuine zero training remains numeric. Preserve accurate accessible
  distinctions and date/rest/current semantics.

### Daily

- Keep newest-first Mon–Sun plus Week calendars.
- Widen the Sun/Week gap and centre a continuous vertical rule in that gap,
  equally distant from Sun and Week, aligned through each month's header/rows.
  Keep all eight columns and Week figures readable at narrow widths.
- Monday day numbers are smaller than metric figures, anchored close to the
  tile's top-left corner. Keep the metric figure readable and separate.

### Weekly

- Remove the selected-week banner and its unused code.
- Match Daily's training-load title family, weight, size and line height.
- No visible Rest indicator, question mark or substitute dash/zero for an empty
  or unavailable week. Keep unavailable values distinct through accessibility.
- Sets: one dashed median reference line only.
- Volume, 1RM and Top weight: dashed median, P5 and P95 lines, aligned to the
  bars' shared zero-based scale. No visible P5/Median/P95 subtitles; preserve
  exact calculated positions and accurate accessible values when lines coincide.
- Preserve the virtualized newest-first list, selection toggling and current
  week semantics without borders.

## Reference calculations

Known training weeks across the complete History look-back (weeks) setting form
the reference population. Calculations and displayed weeks use the same saved,
Monday-aligned window; no independent twelve-week cap. Accessible reference labels
name that window accurately. Require six eligible weeks and a positive window
maximum. Include genuine zeros; exclude rest, future and unknown values. All-zero
and sparse histories omit references. Reuse `calculateLinearPercentile` in
`apps/mobile/src/session-insights/calculations.ts` on a sorted copy for P50/P5/P95;
no new statistics dependency.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare Progress | Open Progress; change period/metric; expand contributions | Neutral rows, black/white active filters, separate name and chevron actions | Zero/previous-only, loading/error, long figures and narrow rows preserve meaning |
| Inspect Daily | Set Daily in Settings; open either history; choose every metric | No subtitles, wider centred Sun/Week rule, small top-left Monday dates, bounded weeks | Partial months, year boundaries, blank rest/unavailable/future and genuine zero remain accessible |
| Inspect Weekly | Set Weekly in Settings; open either history; choose every metric and select rows | No banner/subtitles/black outlines; Sets median only, other metrics three lines; selection caret | Blank rest/unavailable values, sparse/zero/coincident references, long windows and narrow screens remain usable |
| Change history window | Change History look-back (weeks) while history is open or reopen it | Read, displayed weeks and median/percentile calculations follow the same saved setting | Old out-of-range figures disappear; current-week future days remain blank |
| Human review | Agent commits and supplies worktree/native preview; operator tests both views | Explicit human-testing-complete confirmation precedes automated validation | Human review pending; automated tests not run; requested UI fixes precede gates |

No new chart framework, dependency, durable preference or Maestro flow.

## Implementation, documentation and validation

- Trace shared history, calendar, Weekly bar and Progress-control callers.
- Load AGENTS always-load/UI documents and the training-metrics contract.
- Update owning component headers, heatmap README and any changed shared style
  rules. Load `docs/specs/README.md` before persistent documentation edits.
- Read `apps/mobile/__tests__/README.md` and writing-tests before editing tests.
  Extend existing calendar/Weekly/marks/real-data Progress suites and theme/control
  coverage for full-window bounds/references, window changes, omitted references,
  removed copy/borders and fixed active colours.
  Author tests now; execute none before human testing is complete.
- Commit locally with test hooks disabled. Starting the app and manual native
  captures and publishing the branch are authorized. No Jest, Maestro, quality
  lane, sweep or PR before human testing is complete.
- After explicit human-testing-complete confirmation: run `./boga test for`,
  propose the smallest lane set and agree lanes beyond fast. Fast is mandatory;
  jest-coverage, complexity and dependencies must pass before PR, together with
  the agreed device lanes. No new Maestro scenario without approval.
- Then review, follow the PR template, delete this ephemeral card in the PR,
  stop the stack after PR opening and release the worktree after merge.

## Current handoff

- Worktree: `/Users/sboschi/Projects/boga-worktrees/codex-plan-progress-heatmap-ui`.
- Slot 29; simulator `BOGA wt29`; Metro 8111. Run `./boga ios start` there for
  the native preview. Existing development data is seeded on that simulator.
- `./boga doctor` passed. Regression tests are authored; **human review pending;
  automated tests not run**. Branch publication is authorized; no quality gates
  or PR yet.
- Calculations and displayed weeks use the complete saved History look-back.
- Implementation is ready for human testing. Manual native captures in ignored
  `apps/mobile/artifacts/heatmap-ui/revised/` cover both history kinds/all metrics
  at 402pt, plus 375pt, one-/four-week bounds, selected, sparse, zero and
  coincident-reference states. Rest and unavailable figures are blank in both
  views. The temporary capture host and small simulator have been removed.

Next: human testing of the committed native preview. Automated validation starts
only after the operator explicitly confirms that human testing is complete.
