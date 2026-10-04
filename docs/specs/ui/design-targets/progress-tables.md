# Accepted replacement target — Progress tables

**Accepted direction; awaiting implementation.** On 2026-10-04 the user chose
the first chevron proposal and asked to remove unnecessary subtitles. This
brief records that choice; it makes no claim about the current application.
Current behavior remains documented in `../screen-map.md`, `../ux-rules.md`
and `../navigation-contract.md` until the corresponding change ships.

## Target

- Repo-native brief plus the selected ImageGen reference:
  [selected contributions](progress-tables/selected-contributions.png), refined
  on 2026-10-04 to remove instructional and repetitive subtitles. Native
  generated originals remain in their generation environment.
- The image is a 390pt-wide mobile composition showing an excerpt of a longer
  table. It illustrates hierarchy and separate hit targets, not a fixed row
  count, viewport fit, dataset or target-attainment palette.
- This brief replaces the landing portion of [Progress](progress.md). Its
  accepted history-sheet, Daily/Weekly heatmap, exercise-history route and
  Sessions presentation remain the visual references for those surfaces.
- [Design language](../design-language.md), repository tokens, accessibility and
  [training metrics](../../tech/training-metrics-contract.md) govern production.
  The written rules below govern where illustrative images differ.

## Brief and copy

- One `ScreenScroll` on `paper`, above the existing fixed `MainTabs`. Start with
  the existing joined period control: configured `N weeks` / `This week`, or
  only `This week` when N=1. The configured window remains the default. A second
  joined control offers `Working sets` / `Volume`, initially Working sets.
  Use one comparison label, `vs previous week` or `vs previous N weeks`; the
  accessible wording states that the preceding window covers the same elapsed
  calendar span. No rolling-day controls, bare `So far` label or duplicated
  date subtitles.
- `Work by muscle`: `Muscle | Now | Previous | Change`, with aligned numbers,
  taxonomy-ordered static family headings and quiet dividers. Include every
  individual taxonomy muscle, even all-zero and previous-only rows. There are
  no family totals, family actions, landing heatmaps or large summary cards.
- A muscle name is an underlined history link. Its right-hand chevron is a
  separate selection button: right when unselected, down when selected. An ink
  left rule marks the selected row. Numeric cells are static. Selection is
  transient screen state; no new durable preference is needed.
- The inline `<muscle> contributions` section follows the muscle table. Use
  `Exercise | Now | Previous | Change`; individual exercise names open history.
  Optional Primary/Secondary captions explain involvement. `Total` is plain
  data, without a link, chevron or press action. Do not add `Working sets
  involving <muscle>`, `Name: history`, tap instructions or generic footnotes.
- Keep `Browse exercises` and `Sessions` as quiet link rows below the content.
  Browse exercises opens the retained exercise table in the same screen,
  preserving its search, sort and exercise-name heatmap access; `By Muscle`
  returns to the new landing. Sessions opens the existing `/sessions` route.
  These controls need labels, not explanatory subtitles.
- Calculation choices remain in Settings. Do not assert unconditional warm-up
  exclusion or imply that Volume uses Working set eligibility. Add explanation
  only when needed to interpret unavailable data, coverage or an empty state.
  Keep the existing concise coverage wording for incomplete Volume.

## UX contract

| Flow | Trigger and steps | Success | Failure / edge |
| --- | --- | --- | --- |
| Compare muscles | Open Progress; choose period or metric | All individual rows show both periods and the correct signed change | First load shows Loading; a failed read offers Retry; unknown values never become zero |
| Inspect contributions | Press a muscle's chevron; bring the inline section into view | One selected muscle; exercise rows and Total reconcile with its row in both periods | Previous-only exercises remain; a successful all-zero read shows a metric-specific empty state; superseded reads cannot publish |
| Open individual history | Press a muscle or exercise name; dismiss its sheet | Exactly one muscle ID or exercise definition ID; previous selection, period, metric and scroll restored | Names never also select; families and Total are inert; history failure remains inline and retryable |
| Respect Settings | Change the saved view, look-back or calculation choices; reopen/refocus | All projections use the durable active account choices; unset view opens Daily, valid saved Weekly still works | Failed writes keep the prior durable value and retry; account switches clear foreign state and ignore old responses |
| Browse retained history | Open Browse exercises or Sessions; return | Existing exercise browsing/history and Sessions remain reachable | Legacy entry parameters adapt to this shared surface; no second landing implementation |

### Interaction and layout

The name link and chevron are sibling press targets, each at least 44pt in both
dimensions, with no pressable row enclosing them. Accessible labels are
`Open <muscle> history` and `Show <muscle> contributions`; the chevron exposes
selected state. Pressing the already-selected chevron keeps that selection.
Family headings have heading semantics and no action, including one-muscle
families. Exercise links name the definition; totals have no button semantics.

Default entry has no selected muscle and no contribution section. Selecting a
chevron brings the inline contribution heading into view once laid out, with
accessible focus on that heading when appropriate. Selection is independent
of a history target and its metric/day/week selection. Dismissal returns focus
to the launching name and preserves the underlying scroll offset. A newer
selection, period, policy or account must never inherit an older result.

Use the existing typography and spacing scales. Names and long context wrap;
numeric columns share alignment, retain full figures and never use `k`,
thousands separators or reduced text size to force a fit. At 320pt and 430pt
phone widths, rows may grow. If full figures cannot fit beside the name and
chevron, put the name/actions on the first line and all three aligned numeric
cells on a full-width second line, with matching shared headers. Never split a
figure's digits across lines. Coverage copy may occupy a separate line. No
horizontal table scrolling, clipped controls or content hidden under the tabs.

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
Total equals the muscle row. Working set changes are signed absolute counts;
Volume keeps existing percentage/new/incomplete-baseline semantics. Percentages
are calculated per row and are not added. Valid zero and unknown coverage differ.

`/progress` owns the replacement; `/stats-history` uses the same implementation.
Preserve `period=7` as This week; missing/invalid/other period values resolve to
the configured window, as in the landed implementation. `breakdown=exercise`
opens retained exercise browsing; `breakdown=muscle` and fresh default entry
open the muscle table. Unknown breakdown values use the new default. Legacy
family history targets never silently open a multi-muscle heatmap.

## Target states and acceptance evidence

These are targets awaiting implementation, not runtime screenshots. The selected
image illustrates the contribution state; the remaining states use this brief
and the retained [history target](progress.md#history-sheets-and-heatmaps-dlm-t09).

| State | Required result |
| --- | --- |
| Default table | Working sets, configured calendar window, all taxonomy rows, no selection |
| Selected contributions | Separate chevron/name actions; reconciled exercise rows and inert Total |
| Zero current / previous-only | Muscle 0 vs 3 → −3; its previous-only exercise remains explainable |
| All-zero / no history | Keep muscle rows and name links; when the selected metric has no eligible contributors, say `No working sets for <muscle> in either period` or `No volume-included sets for <muscle> in either period` only after a successful read; included zero-load sets retain exercise rows with real zeros; retained empty history sheet remains available |
| Volume-only / empty calculation column | Zero working sets can coexist with Volume; contributors and empty copy follow the selected metric; valid zero load is not missing data |
| Incomplete Volume | Known subtotal/coverage remain explicit in rows and Total; no fabricated full value or percentage |
| Loading / error / Retry | No premature empty state; no relabelled old selection/window/account; Retry keeps selection and controls; a failed same-context refocus may retain prior values alongside its error |
| Individual Daily history | Unset/missing/invalid view uses Daily and saved look-back; one muscle or exercise, retained metric/day details, no view toggle |
| Saved Weekly history | Valid explicit Weekly survives; existing adapter, bars, week banner and selection remain; no view toggle |
| Small / large phone | Full names/figures, distinct 44pt targets, scrolling above tabs, restored focus/scroll |

Implementation acceptance requires new native captures of relevant states at
small and large widths, compared with this target, plus the agreed `./boga`
gates and meaningful real-data Jest checks. Record captures and material
differences in the shipping PR; retain Weekly coverage and all quality targets.
