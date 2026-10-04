# M32 — Progress tables and individual history

- Status: `in progress`
- Created: 2026-10-04; planning baseline `a50615579636e700146d6acde4c490534f15240e` on `origin/main`

## Objective

Replace the current Progress landing page with a compact muscle comparison
table and an inline table of the selected muscle's contributing exercises.
Keep the existing history heatmaps behind individual muscle and exercise names,
with Daily/Weekly controlled by the user's setting and Daily the default.

## Scope

- In: Progress landing, muscle selection and contributions, individual history
  entry points, the heatmap-view default, accessibility, tests and UI contracts.
- Out: treemaps; new charts; family history entry points; changes to set
  eligibility, muscle-volume arithmetic, targets, effort rules, sync or backend
  schema; programme/planning features; rebuilding the existing heatmaps.

## Agreed design direction

### D1. A table, with muscle families as headings

The user chose the table alternative on 2026-10-04 and subsequently selected
the first proposal's separate chevron, with unnecessary subtitles removed.
The final brief and selected reference now live in the
[accepted replacement target](../../specs/ui/design-targets/progress-tables.md).
Use `Muscle | Now | Previous | Change`, aligned numeric columns, taxonomy-ordered
family headings and quiet dividers. Working sets is the initial metric; Volume
is the alternative. Families are labels, never aggregate heatmap targets.
No large graphical summary or heatmap appears on the landing page itself.

The target pins layout and interactions, not generated production code.
Names open history; separate >=44pt chevrons select inline contributions.
Total is not an action. Figures, chevrons and spacing follow the repository's
accessibility, formatting and token rules, including neutral signed-delta ink
and the landed target grading. Instructional/repetitive subtitles are omitted.

### D2. Working sets means physical working sets

Reuse `isWorkingSet(set, effortPolicy)` with the active account's durable
`workingSetEfforts` choices from PR #497. For one muscle, count each eligible
physical set once, whether its mapping is primary or secondary; stabilizer-only
mappings contribute nothing. Do not multiply set counts by role factors or
redefine the session-summary calculation.

Volume independently uses `isVolumeSet(set, effortPolicy)` and `volumeEfforts`;
it is not restricted to working sets. Both predicates require confirmed
performance. Warm-up, RIR, Technique and Cooldown inclusion follows the saved
calculation choices; Display choices do not determine eligibility. Either
calculation column may be empty. Follow the existing legacy-label handling in
`docs/specs/tech/training-metrics-contract.md` rather than copying the rules.
Production copy must reflect the active policy instead of asserting
unconditional warm-up exclusion; the accepted target omits a generic footnote.

Muscle Volume retains the existing per-side, role-weighted calculation and
bodyweight policy. Exercise contribution Volume is that exercise's allocation
to the selected muscle, not its entire exercise volume. Use the same account
and policy snapshot for both periods, muscle rows and exercise contributions.

The selected muscle's exercise rows and Total must reconcile with its summary
row for both periods. Multiple blocks of one exercise definition combine into
one row. Counts across different muscles overlap and must not be presented as
an overall physical workout-set total. Count changes are signed absolute values;
Volume keeps its existing comparison and incomplete-coverage semantics.

### D3. Zero-current muscles belong in the table

Keep previous-only and zero-current muscles discoverable as ordinary rows,
including a real `0` and its change. Load the union of exercises contributing
in either comparison period so a decrease to zero remains explainable.
An all-zero muscle has a valid empty contribution state and still opens its
individual history. Zero working sets can coexist with nonzero Volume; retain
volume-only contributors and decide emptiness using the selected metric.
There is no separate "Outside the map" section.

### D4. Selection and history are separate actions

Selecting an individual muscle through a distinct, labelled selection affordance
sets the inline `Contributing exercises` table below the muscle table. Pressing
that muscle's **name** opens its existing heatmap history sheet, scoped to
exactly one muscle ID. Pressing an **exercise name** in the contribution table
or retained exercise browsing opens that exercise's heatmap by definition ID.
Do not make a name press also trigger selection, and do not use nested competing
pressables. The two actions need distinct accessible labels and tap targets.
Family names cannot open history, even when the family contains one muscle.

Dismissal returns to the same selection, metric, period and scroll context.
Exercise heatmaps remain whole-exercise history; the contribution table remains
scoped to the selected muscle. Selection must survive opening/dismissing either
sheet, while stale asynchronous results cannot overwrite a newer selection.

### D5. Settings owns Daily/Weekly; Daily is the default

Use the existing account-local `heatmapView: 'daily' | 'weekly'` preference and
Settings control introduced by the dependency below. Remove/keep absent the
Daily/Weekly toggle from muscle and exercise history sheets. A static view and
look-back label may explain what is shown. The separate history metric control
remains available, with muscle metrics limited to Working sets/Volume and the
existing exercise metrics retained.

Fresh, missing and invalid view preferences resolve to `daily`. Preserve a valid
explicit saved choice, including `weekly`; do not reset every existing account.
The same setting applies to all individual muscle and exercise heatmaps.
Preserve WeeklyHeatmap, its data adapter, week selection/banner and tests for
future use and for a saved Weekly choice. Do not delete it or force all users to
Daily independently of the preference. Preference errors retain the existing
durable-save/retry and account-isolation behaviour.

### D6. Reuse the landed Progress settings work

[PR #497](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/497),
`Add Progress preferences and independent effort calculation choices`, has
landed as `0296545b`. It supplies the preference store, Settings surface,
independent Working set/Volume eligibility, calendar-week period logic,
history look-back and view-controlled sheets. T01–T04 build on that baseline;
they do not recreate those features or change its eligibility rules. Personal
table/history reads consume the durable active policy; groups and coaching
retain their existing shared default and receive no device-local choices.

Preserve the landed configured calendar-week period choices, comparison bounds,
look-back, shared targets and
effort settings. Do not silently restore rolling day windows, hard-code a
one-year history window or replace quota-based heatmap semantics. The accepted
target records the final control wording and retained target treatment.

### D7. Preserve paths and existing history capabilities

The new landing owns `/progress`; preserve the `/stats-history` compatibility
path and valid entry parameters, adapting them to the new surface rather than
maintaining two competing implementations. Preserve access to Sessions and
existing exercise browsing/history. Any legacy entry with a family target must
not silently open a family heatmap. No new backend, sync envelope or durable
analytics cache is required; projections read the existing local data.

## Task breakdown

One card = one local worktree = one session = one PR. The planning PR #502 and
dependency #497 have landed. Use the task protocol in `docs/plans/README.md`:
design, build, review, PR, user review, merge and owner cleanup. Each shipping
PR deletes its card and marks the row completed. The last task deletes this
milestone; durable rules belong in their owning specs, and evidence belongs in PRs.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M32-T01 | Pin the table target and distinct selection/history actions | planning PR merged; PR #497 landed | completed |
| M32-T02 | Derive reconciled muscle and exercise comparisons | T01; PR #497 landed | completed |
| M32-T03 | Daily default and individual, preference-driven heatmaps | T01; PR #497 landed | completed |
| M32-T04 | Integrate the landing and inline contributions | T02, T03 | completed |
| [M32-T05](../tasks/M32-T05-Accept_and_close_progress_tables.md) | Native acceptance, regressions and closeout | T04 | planned |

T02 and T03 can be executed independently after their dependencies; each still
uses its own session and worktree. Do not begin implementation in this planning
session.

## Verification and completion

Every code task updates meaningful Jest coverage and passes `./boga test fast`.
At each task start, query `./boga test for` and agree all lanes beyond fast with
the operator. UI defaults start at `frontend-ui`; choose only flows exercising
the change and justify any lowering as `covered-by-jest`. No new Maestro flow
without a device-only claim and prior operator approval. Runtime screenshots
of accepted states are still required. Run `jest-coverage`, `complexity` and
`dependencies` once on each finished PR change and record the agreed gates.
Do not estimate timings; use `./boga timings` when reporting them.

Closeout proves table/Total parity, zero-current and previous-only contributions,
one-muscle history scope, exercise history, Daily by default, a saved Weekly
choice, absent in-sheet view toggles, state restoration, small-screen usability,
and preference/account isolation. Table, contributions and history must agree
after changing Working set/Volume choices, including volume-only contributions
and either calculation column empty. Preserve all existing heatmap tests and
the weekly component. No target, threshold or suppression is weakened.

## Risks / dependencies

- Recheck the merged PR #497 baseline; its landed heatmap default is
  Weekly, which this milestone deliberately changes to Daily for unset choices.
- Eligibility is account-local and independent for Working sets and Volume;
  never fall back to the shared non-warm-up rule or filter Volume through
  Working sets. Settings changes/refocus and account switches must refresh
  comparisons and history together without rewriting recorded workouts.
- Name-to-history and selection are different actions from the generated
  chevrons. T01 must make their targets understandable before building.
- History sheets and their reusable lifecycle are shared; verify both muscle
  and exercise paths, not just the landing table.
- Volume allocation/coverage and duplicate source mappings must not break the
  contribution totals or turn unavailable values into zero.
- The long table must scroll with >=44pt tap targets; the mockup's density does
  not waive that constraint. All-zero/loading/error states need their own target.
