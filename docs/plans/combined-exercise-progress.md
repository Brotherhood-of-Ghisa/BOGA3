# Combined exercise progress

Issue: https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/1220
Branch: `codex/progress-multi-exercise`. Build protocol: default build.

## Scope and design target

Implement the operator-approved first version recorded on the issue: 2–5
exercises, combined Sets/Volume, all three charts, one gym scope, chronological
labelled history, and deduplicated primary/secondary muscle links. Selection is
temporary and concealed until a long press or the equivalent accessibility
action. No combined strength, PRs, RM curves, contribution legend or saved groups.

Design target: the approved conversation mock at
`/Users/sboschi/.codex/visualizations/2026/11/22/01a20522-60d8-7033-b57e-ab9a63357dce/combined-progress.html`.
It is a build input, not production code. Reuse the existing ListRow/checkbox,
ActionButton, HistoryTitle, Sheet and historical-card patterns; the operator
approved these bounded adaptations in the conversation.

Product facts: audit whether the combined workload/record boundary needs a
cross-surface fact under the existing subjects. Keep screen-only choices in
component comments and tests. Retain the existing counting, gym, muscle,
calendar and isometric/repetition rules.

## UX Contract

### Select and open combined progress

- Trigger: long press an exercise row, or its accessibility selection action.
- Steps: select the held exercise; replace the existing search/filter row with
  Cancel, a tappable count and Show progress; taps toggle checkboxes; open with
  2–5 choices. Normal browsing retains short-tap navigation.
- Success: existing chart route displays the combined workload, retaining gym
  and supported metric. The tappable count/title opens the full selected names.
- Edge: a sixth choice leaves the five intact and shows a limit message; a hold
  release never also navigates; a scroll cancels the hold; malformed or stale
  targets show the existing unavailable state. Cancel clears; Back restores
  selection, row focus and scroll.

### Read combined charts and menu

- Trigger: Show progress, then the view/metric/gym controls or Options.
- Steps: reuse Timeline, Grid and Weekly over the additive daily series. Show
  Sets and Volume only. Timeline reads selected exercises' blocks for its week.
  Options opens merged History directly and the union of primary/secondary
  muscle links, each once, Primary winning an overlap.
- Success: the same gym scope and date window govern totals and detail; no
  combined records or all-time bests appear. Muscle links open the existing
  whole-muscle page. Existing applicable View sets behavior remains.
- Edge: rest, known zero, unsupported hold-only Volume and unavailable/overflow
  preserve current distinctions. Repeated blocks/overlapping sessions never
  duplicate a physical set or session identity.

### Read chronological history

- Trigger: Options → History.
- Steps: reuse the existing history route, gym/period controls and cards; show
  exercise names on combined cards. Order all selected blocks by completion
  descending, deterministic session tie, then original block order.
- Success: exercises are interleaved in one feed, each set once by id, with its
  own calculation context and individual records; Back returns to combined
  progress.
- Edge: empty filters, failed reads, stale ids and account changes use current
  loading/error/unavailable behavior. Equal-looking distinct sets remain.

## Implementation steps

1. [x] Define a bounded exercise-id selection contract and route encoding;
   preserve existing single-exercise and muscle links and validate ambiguity.
2. [x] Extend local analytics to load selected definitions/blocks in one bounded
   graph read, preserving each definition's calculation context; derive combined
   additive history and gym choices without strength or record fields.
3. [x] Extend the history read model with exercise identity and block order;
   compose the bounded selected histories into a chronological feed while
   preserving tags, gym choices, individual records and period expansion.
4. [x] Wire concealed Progress selection, accessibility, names sheets, combined
   chart subject, selected-week blocks and menu links into existing components.
5. [x] Add Jest coverage using the real local-data fixtures for combined totals,
   hold/repetition cases, gym scopes, selection/navigation, all chart views,
   records, chronology, roles, malformed routes and superseded/account reads.
6. [x] Update owning UI/spec docs and any required product fact; capture native
   comparison evidence against the target at small/normal phone widths.
7. [x] Run agreed gates and quality targets, obtain independent code/product
   reviews, and prepare the reviewable PR. Merge only on explicit approval.

## Verification agreement and results

Independent reviewer `implementation_reviewer` agreed the finished lane set:
`fast`, `ios-data-smoke`, `ios-combined-progress` at normal/small widths,
`ios-exercise-page`, `ios-rm-curve`, `jest-coverage`, `complexity`, and
`dependencies`. Backend is covered by Jest for these local readers, with no
schema, sync, auth or server changes. `ios-smoke`/`ios-session-view` add no
changed journey; ListRow only forwards optional props. Android is not this
macOS host's platform lane. The optional full sweep was suggested, not run.

New native scenario justification (agreed before writing it): RN hold/release,
scroll cancellation, native stack Back, wrapping and reaching the last muscle
link in a bounded sheet cannot be proved by Jest event invocation. Counting,
route permutations and all seven union links remain covered in Jest.

- `doctor`: green for slot 10, created from latest `origin/main` (`d1e8e94f`).
- `fast`: green; final additional Jest run: 511 suites / 8,219 tests green.
- `jest-coverage`: green, 88.79% branches / 95.93% lines. `complexity` and
  `dependencies`: green; no thresholds, suppressions or baselines changed.
- Normal `ios-data-smoke`: all seven flows green, including the combined
  scenario before extraction. `ios-rm-curve`: green. Reviewer agreed to reuse
  these and the quality results after the final sheet-only/style changes.
- Focused `ios-combined-progress`: normal and 375×667 small phone green.
  Fresh `ios-exercise-page`: green, exercising the single-exercise Options body.
- Final dispatch/meta and generated-doc checks rerun after flow extraction.
- Independent code review: no actionable findings, including final test-only
  Monday-midnight fixture guards. Independent product review: clean. Product
  facts: none; current counting, eligibility and record rules are unchanged.

Evidence is retained locally under
`apps/mobile/artifacts/combined-exercise-progress/`: lane logs plus `evidence.md`.
Native comparison captures are under the corresponding Maestro run roots:

- Normal broad: `combined-exercise-progress/20261122-232150-30856`.
- Normal focused: `combined-exercise-progress/20261122-235600-97814`.
- Small focused: `combined-exercise-progress-small/20261122-235421-77510`.
- Fresh single-exercise: `combined-exercise-progress/20261122-235751-99618`.

## Delivery notes

- Issue updated with all agreed scope/UX decisions and chronological History,
  preserving original screenshots. Current `View sets` drill-downs and
  single-only `Add to session…` are retained.
- Comparison against the approved target passed at both widths: concealed
  contextual controls, full names, all three charts, accessible muscle union,
  chronological labelled cards and Back restoration. Intentional adaptations:
  current theme tokens and round selection glyphs. A missing Timeline name
  inset was corrected to use the existing summary spacing; Options now scrolls
  beneath the fixed title so every primary/secondary link is reachable.
- The normal smoke gate exposed a pre-existing injury test tapping Save behind
  its keyboard. Added explicit keyboard dismissal, retaining all assertions;
  no injury app behavior changed.
- Small broad smoke failed before this feature (first a URL confirmation on
  the fresh simulator, then legacy Train-tab navigation). Retained failure
  evidence rather than expanding product scope. Reviewer agreed to extract
  the same combined journey into a resettable flow and an `extra` focused lane;
  both platform data-smoke aggregates still include it immediately after the
  original data-runtime flow. Bootstrap/orchestration is unchanged.
- The fresh small simulator's UIKit icon-change notice is acknowledged by a
  bounded, iOS-only guard; all other readiness failures remain failures. The
  focused small journey then passed. Relative fixture sessions can fall into
  the preceding week at Monday midnight, so only an empty current week moves
  back once, then still requires the real set list.
- Worktree and lease stay allocated while the PR awaits explicit merge
  approval. Stop its local Supabase stack after opening the PR; remove the
  temporary small simulator created for this task. Release the worktree after
  merge, and delete this ephemeral plan when the feature ships.
