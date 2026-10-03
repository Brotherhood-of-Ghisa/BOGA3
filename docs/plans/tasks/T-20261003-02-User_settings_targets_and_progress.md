# T-20261003-02 — New settings, UX and application integration

- Status: `planned`
- Depends on: `T-20261003-01-Settings_storage_and_migration` (implementation PR merged)
- Milestone: none; independent of M31
- Areas: frontend / settings / personal analytics / effort logging; UI impact: yes
- Delivery: one implementation task, session, worktree and PR after account-local preference isolation

## Objective

Let users configure weekly working-set targets per muscle, the effort levels
that define working sets, the visible/selectable effort grades when logging,
the target window length, the history look-back period and the daily/weekly
heatmap view. Apply these settings to the existing Settings, Progress and set
logging experience as a standalone increment.

## Settings and defaults

Add a Progress section to Settings using existing controls:

| Setting | Behaviour | Default |
| --- | --- | --- |
| Weekly muscle targets | Positive whole-number working sets per muscle, keyed by stable muscle ID; resetting an override restores the default | 8 sets per muscle per week |
| Working-set efforts | Independent selection of individually listed RIR grades, other RIR values and unspecified effort; require at least one selection; warm-ups never count | Every non-warm-up effort |
| Visible effort grades | Choose which RIR grades appear in logging choices; offer RIR 0–3 plus an Add RIR value field; require at least one RIR; W-Up and unspecified remain available | RIR 0–3 |
| Target window | Whole number of weeks, 1–52 | 4 weeks |
| History look-back | Positive whole number of weeks; allow shorter and longer periods than the default | 52 weeks |
| Heatmap view | Daily or Weekly; changing the existing chart toggle also saves this preference | Weekly |

### Effort selector: one list, two independent columns

Show one row per effort grade with two labelled checkbox columns:

| Effort | Visible | Counts as W/set |
| --- | --- | --- |
| RIR 0 | Checked | Checked |
| RIR 1 | Checked | Checked |
| RIR 2 | Unchecked | Checked |
| RIR 3 | Checked | Unchecked |

This table illustrates a custom configuration; the defaults above still apply.
Visible means offered in the logging picker and tap cycle. Counts as W/set
means recorded sets contribute to personal statistics and weekly targets.
Changing one column never changes the other. Additional individual RIR grades
use the same two-column controls; the Other RIR counting fallback applies to
canonical RIR grades without an individual row.

W-Up's Visible control is locked on and its W/set control locked off.
Unspecified remains available for logging, with an independently selectable
W/set control. Give each checkbox an accessible label that includes both the
effort grade and its column. Use existing checkbox primitives and wrap labels
without reducing the 44pt touch targets.

The target window and history look-back are independent. The target window
controls Progress summary totals and target grading over that window; the
history look-back controls the dates loaded and displayed in history heatmaps.
Changing either must not change the other or the weekly quota.

### Persistence

All six settings are persistent: weekly muscle targets, working-set efforts,
visible effort grades, target window, history look-back and heatmap view.
Add them through the account-local preference access supplied by the settings
handling task, using the existing `expo-sqlite/kv-store`. Reuse typed defaults,
validation, updates, persistence and subscriptions. All six remain device-only
and isolated per account.

Use scoped preference keys for muscle-target overrides keyed by stable muscle
ID, the two independent effort selections, target-window weeks,
history-look-back weeks and heatmap view. Missing values receive the defaults
above. Existing browsing preferences survive these additions and every update;
do not repeat their legacy migration or add a versioned settings document.

The foundation task owns storage scopes and browsing migration. Bodyweight
remains on its existing typed synced `user_settings` column, and the theme on
its existing device-wide key. This task does not change their ownership,
synchronization or upgrade behaviour.

Settings survive relaunch and sign-out. Failed saves retain draft input and the
last saved configuration.
Targets and week counts must be positive whole numbers. Added RIR grades must
be non-negative whole numbers, including RIR 0. Reject fractional, non-finite
and unsafe numeric inputs.

## Progress behaviour

- Selected efforts define **W/sets throughout personal statistics**, including
  historical data. Ten valid sets containing four RIR 2 sets produce four
  W/sets when only RIR 2 is selected. Those four meet a weekly target of four.
  Stored workouts, raw set totals and other metric formulas retain their rules.
- Replace Progress's 30-day option with the configured **N-week** target window;
  retain **This week** as a shortcut. When N is one, show one choice. Default
  to the configured window; existing Progress `period=30` links resolve to it.
- Weeks start Monday in the device's timezone. The N-week target window contains
  the current week and preceding N−1 weeks, through now. Label the current
  period “So far”; do not prorate targets. Compare deltas against the same
  elapsed calendar span in the preceding window.
- Muscle-row colour measures working sets against **weekly target × selected
  weeks**. Use the existing colour ramp and cap attainment at 100%.
- For muscle history W/sets, daily colour compares that day's count with the
  weekly target; weekly colour compares the week's count with that target.
  With a target of eight, two four-set days each show half-target intensity
  and the week reaches full intensity. The history look-back length does not
  multiply the target of a day or week.
- Grouped rows and W/sets heatmaps average each constituent muscle's attainment,
  capped individually at 100%, including muscles with zero sets. Displayed
  group counts retain physical-set deduplication.
- Volume and exercise-only metric colours retain their current scaling.
  Explain target-based colouring in legends and accessible labels.

## Effort visibility implementation

- Keep visible/selectable effort grades separate from working-set counting.
  Hiding RIR 2 from logging choices must not remove previously logged RIR 2
  sets from W/sets when the counting policy includes them, or deselect RIR 2
  in the counting settings.
- Use the saved grades in the existing effort picker and tap-to-cycle controls.
  Cycle W-Up → unspecified → selected RIR grades descending → W-Up. A hidden
  historical grade re-enters at W-Up when the user explicitly cycles it.
- Preserve and display recorded, prescribed and inherited effort even if it is
  no longer offered as a new choice. Never clear or rewrite a set's grade just
  because its visibility setting changed.
- Saving visibility choices refreshes mounted logging controls. Persistence,
  account isolation and validation failures follow the same settings contract.
  Visibility changes do not rebuild facts or change target/counting policy.

## History look-back implementation

- Use the saved look-back for both exercise and muscle/family history heatmaps,
  in both Daily and Weekly views and for every available metric.
- A look-back of H weeks spans the current local Monday-start week and the
  preceding H−1 weeks, through today. Use calendar arithmetic across DST;
  future dates remain unavailable. Changing Daily/Weekly does not change bounds.
- Replace the fixed 365-day history query bounds and the heatmap's implicit
  minimum-52-week grid with the chosen window. A shorter choice must actually
  reduce the grid; a longer choice must load older available history.
- Saving a new look-back refreshes open history and updates empty-state copy.
  Keep a selected date/week if it remains in range; otherwise reset selection
  to today/current week. Ignore responses for superseded windows or accounts.
- Missing earlier records remain empty history. Changing the window never
  deletes or edits workout data, limits synchronization, or changes separate
  session-list/exercise-history page filters.

## Implementation boundaries

- Reuse the account-local preference access shipped by the dependency. Extend
  its typed keys and subscriptions; do not add another settings store
  or migration path. Its sign-out, failure and account-isolation rules apply.
- Pass an explicit personal counting policy into calculations. Refresh mounted
  personal readers and validate derived facts against the policy fingerprint
  before serving them. Counting changes rebuild affected facts; quota, target
  window, look-back, view and effort visibility edits do not rebuild facts.
- Apply the saved Daily/Weekly view consistently to exercise and muscle history
  heatmaps. Reuse the existing Settings and Progress design targets and controls;
  capture relevant implemented states against those targets.
- Keep exploration redesign, comparisons, family target editors and server
  synchronization outside this task. Effort logging customization is limited to
  the visible/selectable grades above. Group server evaluation retains its
  existing contract and never reads account-local logging preferences.

## Deliverables and acceptance

1. All six settings save offline, propagate to the relevant views and restore
   after relaunch, isolated per account. Invalid input or storage failure keeps
   edits recoverable and the last saved configuration intact.
2. The RIR 2 example, target colouring and grouped attainment use the same
   personal working-set policy, without rewriting source data.
3. Verify look-backs of 1, 4, 52 and 104 weeks in both heatmap views: query and
   grid bounds agree, earlier records appear at 104 weeks, and shorter windows
   do not retain the default year grid. Verify empty history and partial weeks.
4. Jest covers defaults/validation, save failures, account isolation, relaunch,
   historical recomputation, stale facts, calendar/DST boundaries, target colours,
   grouped attainment, saved view propagation, look-back changes, selection
   recovery and late responses. Also prove picker/cycle visibility, added RIR
   grades, hidden historical/prescribed/inherited values and independence from
   W/sets counting. Prove both checkbox columns can be toggled independently,
   locked W-Up controls and accessible checkbox labels. Cover extension of an
   account's existing scoped preferences, defaults for missing keys and updates
   preserving migrated browsing preferences.
   Read each test directory's README before edits.
5. Update the owning data and UI specifications for shipped behaviour. Delete
   this card in the implementation PR; record evidence in the PR body.

## Specs and gates

Update `docs/specs/05-data-model.md` for account-local preferences and personal
counting, and the relevant Settings/Progress contracts under `docs/specs/ui/`
for windows, view persistence, grading and logging effort choices. Update the
architecture decision register where the implemented configuration boundary
requires it.

Pass `./boga test fast`. Before running additional lanes, agree the set with the
operator using `./boga test for`: include `jest-coverage`, `complexity` and
`dependencies`, and the smallest relevant existing iOS lanes. Follow the design
policy for visual comparison and the repository task protocol for PR/cleanup.
Both task cards land through a separate docs-only planning PR before execution.
