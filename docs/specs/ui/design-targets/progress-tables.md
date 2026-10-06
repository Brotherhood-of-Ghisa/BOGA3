# Accepted replacement target — Progress tables

**Accepted direction, refined 2026-10-06.** The operator selected the continuous
inline contribution table and amended it to use normal, non-underlined names
and no visible contribution Total row. The operator also requested frozen
selectors/search, palette-coloured selection and removal of the comparison
subtitle. This image supersedes the earlier
contribution layout. `/progress` owns the implementation; `/stats-history`
re-exports it. The written rules preserve production data, accessibility,
responsive fallbacks and target-attainment shading. Current rules also live in
`../screen-map.md` and `../navigation-contract.md`.

## Target

- Repo-native brief plus the selected ImageGen reference:
  [selected continuous table](progress-tables/selected-continuous-table.png),
  regenerated on 2026-10-06 with the operator's authorization from the selected
  proposal's archived prompt. Native generated originals remain in their
  generation environment.
- The image is a mobile composition showing an excerpt of a longer
  table. It illustrates hierarchy and separate hit targets, not a fixed row
  count, viewport fit, dataset or target-attainment palette.
- This brief replaces the landing portion of [Progress](progress.md). Its
  Daily/Weekly heatmap, exercise-history route and Sessions presentation remain
  references; [History popup](history-popup.md) owns its page-sheet container.
- [Design language](../design-language.md), repository tokens, accessibility and
  [training metrics](../../tech/training-metrics-contract.md) govern production.
  The written rules below govern where illustrative images differ.

## Brief and copy

- Freeze `By Exercise` / `By Muscle`, the period control and either the muscle
  metric control or exercise search above `ScreenScroll` on `paper`; retain
  fixed `MainTabs`. Period choices are configured `N weeks` / `This week`, or
  only `This week` when N=1; the configured window remains the default. Muscle
  metrics are `Working sets` / `Volume`, initially Working sets. Selected
  segments use `viz4` with `ink` text. No visible comparison subtitle; each period
  tab's accessible wording names the preceding window and same elapsed
  calendar span. No rolling-day controls or duplicated date subtitles.
- `Work by muscle`: `Muscle | Now | Previous | Change`, with aligned numbers,
  taxonomy-ordered static family headings and quiet dividers. Include every
  individual taxonomy muscle, even all-zero and previous-only rows. There are
  no family totals, family actions, landing heatmaps or large summary cards.
- A muscle name is a normal, non-underlined history link. Its right-hand chevron is a
  separate selection button: right when unselected, down when selected. An ink
  left rule marks the selected row. Numeric cells are static. Selection is
  transient screen state; no new durable preference is needed.
- One contribution block expands directly beneath its muscle row, before the
  next muscle/family, without a large contribution title. Use
  `Exercise | Now | Previous | Change`; individual exercise names open history.
  Names use normal text, without underlines or underscore characters; optional
  Primary/Secondary captions explain involvement. The full contribution block
  uses a subtle neutral `ruleSoft` ground, quiet `rule` top/bottom hairlines,
  shared numeric alignment and no intervening gap, card or shadow. Do not render
  a contribution Total/subtotal row. Do not add `Working sets
  involving <muscle>`, `Name: history`, tap instructions or generic footnotes.
- The pinned switch opens either view in-route, preserving exercise search,
  sort, comparison metric, period and disclosure. Remove `Browse exercises`.
  `Sessions` is the final scrolling link in both views (including empty/error),
  opening `/sessions`; no fixed footer or explanatory subtitle.
- Calculation choices remain in Settings. Do not assert unconditional warm-up
  exclusion or imply that Volume uses Working set eligibility. Add explanation
  only when needed to interpret unavailable data, coverage or an empty state.
  Keep the existing concise coverage wording for incomplete Volume.

## UX contract

| Flow | Trigger and steps | Success | Failure / edge |
| --- | --- | --- | --- |
| Compare muscles | Open Progress; choose period or metric | All individual rows show both periods and the correct signed change | First load shows Loading; a failed read says `Could not load progress` with Retry, without raw database details; unknown values never become zero |
| Inspect contributions | Press a muscle's chevron; press again to collapse, or select another | Zero or one expanded muscle, directly below its row; contributor values reconcile with its row in both periods; no visible Total | Previous-only exercises remain; a successful all-zero read shows a metric-specific empty state; superseded reads cannot publish |
| Open individual history | Press a muscle or exercise name; dismiss its sheet | Exactly one muscle ID or exercise definition ID; previous selection, period, metric and scroll restored | Names never also select; families are inert; history failure remains inline and retryable |
| Respect Settings | Change the saved view, look-back or calculation choices; reopen/refocus | All projections use the durable active account choices; unset view opens Daily, valid saved Weekly still works | Failed writes keep the prior durable value and retry; account switches clear foreign state and ignore old responses |
| Browse retained history | Use the pinned view switch or Sessions; return | Existing exercise browsing/history and Sessions remain reachable | Legacy entry parameters adapt to this shared surface; no second landing implementation |

### Interaction and layout

The name link and chevron are sibling press targets, each at least 44pt in both
dimensions, with no pressable row enclosing them. Accessible labels are
`Open <muscle> history` and `Show` / `Hide <muscle> contributions`; the chevron
exposes `accessibilityState.expanded`. Repeating the chevron collapses it.
Family headings have heading semantics and no action, including one-muscle
families. Exercise links name the definition; no contribution Total row is rendered.

Default entry has no selected muscle and no contribution section. Selecting a
chevron leaves focus on that button and expands the next block without an
automatic scroll. Disclosure is independent
of a history target and its metric/day/week selection. Dismissal returns focus
to the launching name and preserves the underlying scroll offset. A newer
selection, period, policy or account must never inherit an older result.

Use the existing typography and spacing scales. Names and long context wrap;
numeric columns share alignment, retain full figures and never use `k`,
thousands separators or reduced text size to force a fit. At 320pt and 430pt
phone widths, rows may grow. If full figures cannot fit beside the name and
chevron, put the name/actions on the first line and all three aligned numeric
cells on a full-width second line, with matching shared headers. Never split a
figure's digits across lines. If extreme figures/percentages exceed even that
three-cell budget, labelled Now/Previous/Change lines each use the full row
width. This additional fallback preserves figures and units; it deliberately
extends the reference's second-line layout. Incomplete Volume coverage uses
separate full-width lines beneath the figures, labelled Now/Previous. No
horizontal table scrolling, clipped controls or content hidden under
the tabs.

Signed deltas use the existing ink roles, never red/green. Preserve the landed
muscle target grading and `viz` ramp: a row's working sets are graded against
the saved weekly quota × selected weeks, capped at 100%, without proration.
The selection rule/chevron stays distinct from attainment shading. Text on a
`viz` ground uses `ink`. Accessible value labels explain target attainment;
any retained legend provides that meaning without an instructional subtitle.
The mock's neutral rows do not waive this existing target behavior.

### Data and compatibility

Both periods, the muscle table and contributions use one local-data and durable
account-policy snapshot. Reuse the settled working/volume flags and period
bounds. Each eligible physical working set counts once per muscle at primary
or secondary involvement; stabilizers add nothing. Role weights affect Volume,
not this set count. The session summary's role-weighted Sets by muscle is
unchanged. Counts overlap across muscles and are never summed into a workout
total. Volume independently includes its eligible performed sets, including
volume-only contributors, with the existing per-side/bodyweight arithmetic.

Combine repeated exercise blocks by definition ID, using the union of
contributors from both periods. Exercise Volume here is its allocation to the
selected muscle; exercise heatmaps remain whole-exercise history. Each period's
contributor sum equals the muscle row even though the Total row is hidden. Working set changes are signed absolute counts;
Volume keeps existing percentage/new/incomplete-baseline semantics. Percentages
are calculated per row and are not added. Valid zero and unknown coverage differ.

`/progress` owns the replacement; `/stats-history` uses the same implementation.
Preserve `period=7` as This week; missing/invalid/other period values resolve to
the configured window, as in the landed implementation. `breakdown=exercise`
opens retained exercise browsing; `breakdown=muscle` and fresh default entry
open the muscle table. Unknown breakdown values use the new default. Legacy
family history targets never silently open a multi-muscle heatmap.

## Target states and acceptance evidence

These states are governed by the brief; the selected image is a design
reference, not a runtime screenshot. The image illustrates the contribution
state; the remaining states use this brief
and the retained [history target](progress.md#history-sheets-and-heatmaps-dlm-t09).

| State | Required result |
| --- | --- |
| Default table | Working sets, configured calendar window, all taxonomy rows, no selection |
| Expanded / collapsed contributions | Separate chevron/name actions; one block directly after its row, repeat tap collapses; reconciled rows, normal name links and no visible Total |
| Frozen controls / final Sessions | Breakdown, period and metric/search visible over either scrolled body; retained search/sort; Sessions last, including empty/error |
| Zero current / previous-only | Muscle 0 vs 3 → −3; its previous-only exercise remains explainable |
| All-zero / no history | Keep muscle rows and name links; when the selected metric has no eligible contributors, say `No working sets for <muscle> in either period` or `No volume-included sets for <muscle> in either period` only after a successful read; included zero-load sets retain exercise rows with real zeros; retained empty history sheet remains available |
| Volume-only / empty calculation column | Zero working sets can coexist with Volume; contributors and empty copy follow the selected metric; valid zero load is not missing data |
| Incomplete Volume | Known subtotal/coverage remain explicit in muscle and exercise rows; no fabricated full value or percentage |
| Loading / error / Retry | No premature empty state; no relabelled old selection/window/account; Retry keeps selection and controls; a failed same-context refocus may retain prior values alongside its error |
| Individual Daily history | Unset/missing/invalid view uses Daily and saved look-back; one muscle or exercise, retained metric/day details, no view toggle |
| Saved Weekly history | Valid explicit Weekly survives; existing adapter, bars, week banner and selection remain; no view toggle |
| Small / large phone | Full names/figures, distinct 44pt targets, scrolling above tabs, restored focus/scroll |

Implementation acceptance requires new native captures of relevant states at
small and large widths, compared with this target, plus the agreed `./boga`
gates and meaningful real-data Jest checks. Record captures and material
differences in the shipping PR; retain Weekly coverage and all quality targets.
