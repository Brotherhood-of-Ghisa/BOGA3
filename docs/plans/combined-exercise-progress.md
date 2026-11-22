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
6. [ ] Update owning UI/spec docs and any required product fact; capture native
   comparison evidence against the target at small/normal phone widths.
7. [ ] Run agreed gates and quality targets, obtain independent code/product
   reviews, and open a reviewable PR. Merge only on explicit approval.

## Verification proposal

- Always: `./boga test fast`.
- Quality targets: `jest-coverage`, `complexity`, `dependencies` once finished.
- Path default: `frontend-ui` for screen/component/navigation work.
- Agreed with independent reviewer `implementation_reviewer`: `fast`,
  `ios-data-smoke`, `ios-exercise-page`, `ios-rm-curve`, `jest-coverage`,
  `complexity`, `dependencies`. Backend omitted as `covered-by-jest` while the
  diff remains local readers with no schema/sync/auth/backend changes. The two
  other frontend-ui lanes add no affected journey while ListRow only forwards
  optional props. Reassess if these boundaries change. Optional sweep suggested
  to the operator because ListRow is shared.
- Native lane: `ios-data-smoke`, extending its existing
  Progress journey if needed. New scenario justification: RN's native hold,
  scroll cancellation, release-vs-navigation, real stack Back and sheet/scroll
  reachability cannot be proven by Jest event invocation. Counting and route
  combinations stay in Jest. Reviewer agent must agree before non-fast lanes.
- No migration, sync, auth, root-stack or native dependency changes intended;
  reassess lanes if implementation reaches one of those boundaries.
- `./boga doctor`: passed on the allocated slot before implementation.

## Progress

- Issue updated with the agreed scope, preserving its original screenshots.
- Worktree created from latest `origin/main` (`d1e8e94f`); slot 10 allocated.
- Current main's Timeline menu action is `View sets` and pushes scoped day/week
  detail; preserve it for combined selections. Its newer `Add to session…`
  remains single-exercise, without introducing a bulk-add action.
- First typecheck passed; initial Jest regression run: 509 suites passed and
  one new route test expected an outdated no-gym sentinel (corrected).
- Combined readers, routes, selection UI and History cards are implemented;
  screen, native, quality and final review verification remain in progress.
- Full `fast` gate passed, including real-data selection, chart and History
  screen tests. Native gesture checks and the three quality targets are next.
- Final Jest run: 511 suites and 8,219 tests passed. Coverage passed at 88.79%
  branches and 95.93% lines; complexity and dependencies passed. No thresholds,
  suppressions, dependency baselines or calculation revisions changed.
- Independent code review: no actionable findings after the complexity
  extractions. Product review: clean after two fact citations; no new fact.
- Native selection and hold/scroll/release checks passed. The names-sheet
  dismissal step was corrected to the existing backdrop-tap pattern; the full
  native lane and final visual comparison remain outstanding.
- The complete combined native journey passed, including all three charts,
  menu roles, chronological History, Back and Cancel. Screenshot review found
  the Timeline name lacked its card inset; the exact existing summary spacing
  was applied. Reviewer agreed it is cosmetic: repeat fast and fresh small/
  normal screenshots, reuse unchanged behavioral/quality checks.
- The full data-smoke run also exposed an existing injury-flow test tapping
  Save behind the software keyboard. Its failure screenshot shows the editor
  still open and a stray typed character. Added explicit keyboard dismissal
  after entry; no injury app behavior changed. The chosen lane set is unchanged.
- Large muscle unions can exceed a phone viewport. Reuse the existing scrolling
  sheet body for Options. Native justification: Jest proves the complete union
  and destinations, but cannot prove that the last link and History remain
  reachable through a bounded native modal. Extend the same native journey to
  three exercises and scroll to the last secondary link, then back to History;
  capture small/normal layouts and long current exercise names.
- Reviewer agreed the final menu delta gates: fast, data-smoke on normal/small,
  and exercise-page on normal. Earlier RM-curve and quality passes remain
  applicable: handlers/data/metrics are unchanged, while fresh combined and
  single-exercise journeys exercise the changed Options wrapper. Final product
  review is clean. Fast and the additional final Jest run (511 suites / 8,219
  tests) passed; normal data-smoke passed all seven flows. Small is running.
