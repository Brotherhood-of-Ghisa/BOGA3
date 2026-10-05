# T-20261005-01 — Full-height, swipe-dismissible history popup

- Status: `planned`
- Depends on: this planning PR being merged; no other task
- Milestone: none
- Areas: frontend + UI documentation; UI impact: yes
- Execution: one local session, one worktree, one implementation PR

## Objective

Improve only the history popup opened by an individual muscle name or exercise
row in Progress. Both entry points must use the same full-height popup, with an
interactive downward drag from its handle/header to dismiss it and no visible
close button. Preserve the existing heatmaps, metric controls, history reads and
Progress browsing state.

## Accepted target and settled decisions

The operator accepted the revised **popup-only** graphic in this conversation
with “Yes matches.” The durable target is
[History popup](../../specs/ui/design-targets/history-popup.md), including its
[selected graphic](../../specs/ui/design-targets/history-popup/reference.png).
The earlier graphic with vertically stacked quarterly heatmaps was rejected by
the scope clarification and is not an implementation source.

1. Only the `HistorySheet` opened from Progress is being improved. The current
   Progress and exercise browsing screens are not redesign targets.
2. The popup occupies the full available height, respecting the top safe area
   and bottom inset; it is still an in-route modal, not a new navigation route.
3. The handle and non-interactive title/header area drag the popup downward.
   There is no `X`, Close, Cancel, Done or Back control in the popup.
4. Keep one daily seven-row grid or the existing weekly bar chart, with
   horizontal history scrolling. Do not stack months/quarters vertically,
   enlarge the visualization to fill the screen, or add another chart.
5. Muscle metrics remain Volume/Sets; exercise history additionally offers
   1RM/Top weight. Settings retains ownership of Daily/Weekly and look-back.
6. Use the existing theme tokens, fonts, dimensions and primitives. The graphic
   shows Plum as an example; the implementation follows the active preset.
7. The subtle `Swipe down to dismiss` text below the handle is a gesture hint,
   not a tappable dismissal button. The design-board captions and annotation
   outside the two popup examples are not application copy.

The selected image governs the popup presentation and gesture affordance.
Existing repository contracts govern chart geometry, data, labels, numbers and
states. Its sample dates, values and approximate cell counts are illustrative.
Do not hard-code `52 weeks`, exercise names, sample values or Plum colours.

## Scope

### In

- Full-height sizing and safe-area handling for muscle/exercise `HistorySheet`.
- A real drag gesture, interactive vertical translation, dismissal animation
  and snap-back on an incomplete/cancelled drag.
- Gesture arbitration, modal accessibility, focus restoration and a
  non-visual accessible dismissal action.
- Focused regression tests, device evidence and the owning UI documentation.
- A narrowly scoped, opt-in `Sheet` extension if that is the simplest way to
  reuse the existing modal. Existing callers retain their current behavior.

### Out

- Progress landing tables, muscle comparisons/contributions, exercise search,
  sorting, tabs, settings, exercise/session screens and other sheets.
- A separate `/exercise-history` route redesign: this task concerns the
  Progress popup, not the exercise page's full history screen.
- Heatmap layout/ramp/selection changes, new statistics, chart summaries,
  time-range controls, inline Daily/Weekly switches or history pagination.
- Data queries/calculations, preferences, auth/sync, schema and backend changes.
- A new bottom-sheet dependency or native/config-plugin change by default.

## Code map and baseline to inspect

Revalidate against latest `origin/main` at execution. This card was checked
against `9b1aca9de70c389b1a3c804d4830374b8777e0b5`.

| Surface | Current responsibility / constraint |
| --- | --- |
| `apps/mobile/components/stats/history-sheet.tsx` | Shared muscle/exercise popup. `BODY_SHARE_OF_SCREEN = 0.7` sizes only its body. Owns heading, saved view/window label, metric control, week banner and scroll body. |
| `apps/mobile/components/ui/sheet.tsx` | Transparent native modal, scrim, bottom-anchored panel and decorative handle. Reserves a minimum backdrop tap target; has no drag gesture. Preserve default callers and `onDismissed` semantics. |
| `apps/mobile/app/(tabs)/stats-history.tsx` | Shared Progress implementation; opens history targets and closes them in place. Preserve selected table, period, search, sort and scroll. |
| `apps/mobile/app/(tabs)/progress.tsx` | Progress route entry; do not introduce another implementation or route. |
| `apps/mobile/components/heatmaps/` | Existing daily/weekly views and chart data. Consume them without redesign. |
| `apps/mobile/components/stats/use-history.ts` | Existing reads, loading/retry, account/window race protection. Preserve these contracts. |
| `apps/mobile/components/exercise-page/swipe-set-row.tsx` | Existing Gesture Handler/Reanimated usage. Reuse the installed stack/conventions; do not couple history to exercise-page code. |
| `apps/mobile/__tests__/stats-screen-local-data.test.tsx` | Existing real-data tests for both history targets, metrics, saved preferences, Retry, empty/loading and dismissal. |
| `apps/mobile/__tests__/ui-design-primitives.test.tsx` | Existing shared primitive contracts; extend if `Sheet` changes. |
| `apps/mobile/__tests__/heatmap-marks.test.tsx` | Existing today/selection visual semantics; preserve. |

## Implementation guidance

1. Follow `AGENTS.md` and the [task protocol](../README.md#task-protocol-boga).
   Create a local worktree from latest main with `./boga worktree create`.
   Load the always-read specs and UI/design policy. Read the test directory's
   `README.md` before editing tests. If touching Maestro, load its runtime and
   testing conventions and the mobile Maestro README first.
2. Keep the shared in-route `HistorySheet`. Prefer a small feature-specific
   shell or an explicit opt-in full-height/swipe configuration on `Sheet`;
   do not change every sheet's height or gesture behavior. If `Sheet` changes,
   cover its default behavior and existing keyboard/native-alert callbacks.
3. Replace the fixed 70% body-height allocation for these popups. The sheet
   surface reaches the bottom edge; interactive content respects safe areas.
   Do not retain an arbitrary 44-point gap at the top just to keep a visible
   backdrop target. Maintain normal OS status-bar behavior and modal focus.
4. Make the visible handle's touch area at least the existing 44-point target.
   A downward pan beginning on handle/title header follows the finger. Use a
   small activation slop so a tap does not dismiss, reject horizontal/upward
   drags, and choose documented distance/velocity release thresholds. These
   implementation constants are not a new product decision; validate them on
   device and cover both sides of the boundary in Jest.
5. On a qualifying release, animate the popup offscreen and close its transient
   target exactly once. Otherwise restore it smoothly to its open position.
   A cancelled gesture, unmount or external dismissal must not fire a second
   dismissal or leave a stale translated panel when the popup is reopened.
   Follow existing reduced-motion handling for animation/accessible actions.
6. Scope the pan to the non-interactive header. Metric taps, chart cell/bar
   taps, horizontal chart scrolling, body scrolling and Retry remain ordinary
   interactions. Do not add body pull-to-dismiss or intermediate snap heights
   as extra behavior. Ensure Gesture Handler works inside the native modal
   boundary using the existing installed libraries.
7. Preserve Android back and VoiceOver escape. Add an accessible `dismiss`
   action on the handle/header so closing does not require sight or a physical
   pan; expose an accurate label/hint and route it to the same dismissal
   callback. Do not add a visible close button to solve accessibility.
8. Restore focus to the originating muscle/exercise control when appropriate;
   keep the underlying screen mounted. Retain the backdrop's dismissal when
   reachable during a drag, without depending on a backdrop in the full-height
   resting state. Do not show an unsaved-changes confirmation for read-only
   history. Keep dismissal available during loading, empty and failed reads.

## UX contract

| Flow | Trigger and steps | Success | Failure / edge |
| --- | --- | --- | --- |
| Open muscle history | In Progress, activate one individual muscle name; load its existing history. | Full-height modal names that muscle, offers Volume/Sets, and uses saved view/look-back. | Family headings remain inert; chevrons retain contribution selection; loading/empty/error stay inline and dismissible. |
| Open exercise history | Enter the existing exercise list, optionally filter/sort, and activate one exercise row. | Same popup geometry/gesture with that exercise's four metric choices. | Long names wrap using existing tokens; a failed read offers Retry for the same target/window. |
| Inspect history | Change metric; tap a day/week; horizontally scroll older history; scroll body if needed. | Existing charts, values, marks and selections work; the popup does not start a dismissal gesture. | Invalid/unavailable/rest/partial values retain current semantics; saved Weekly uses its existing banner; no accidental dismissal. |
| Dismiss by drag | Pan down from handle/title header and release past the distance/velocity rule. | Popup follows the finger, exits smoothly, closes once and reveals the same list state. | Short, horizontal, upward or cancelled drag leaves the popup open with its metric, selection and chart scroll intact. |
| Dismiss accessibly | Invoke VoiceOver escape or header `dismiss` action; on Android use system Back. | Same close callback; background stays inaccessible while open; focus returns to the originating control. | Works without performing a physical swipe, including loading/error/empty and reduced-motion settings. |
| Reopen / switch target | Close, reopen the same target, then open another target through its existing row. | Opens with zero drag offset and the existing fresh-target selection contract. | Late reads/animation callbacks do not resurrect the closed popup or replace a new target/account. |

### Appearance and interaction notes

- Full-height white/surface modal with existing top radius, handle and safe-area
  spacing; no floating margins, additional snap points or navigation chrome.
- Existing eyebrow/name, saved view/window, metric control, daily detail or
  weekly banner and legend keep their order and typography.
- Header/handle drives dismissal; chart/body gestures retain their own purpose.
- No Close/X/Cancel/Done/Back control. The gesture hint is subtle and non-actionable.
- Active preset and runtime content drive every colour, name, date and value.

## Deliverables and acceptance

1. Both Progress entry points open the same full-height popup on small and
   large iPhone layouts, with no clipped controls or safe-area overlap.
2. Downward handle/header dragging is interactive; qualifying releases dismiss
   once, and short/cancelled or wrong-direction drags snap back without losing
   history state. Reopening never retains a stale translation.
3. Existing metric choices, Settings-owned view/look-back, daily/weekly trees,
   chart marks/scrolling and loading/error/Retry/no-history behavior are intact.
4. Underlying Progress period, breakdown, contribution selection, filter, sort
   and scroll are unchanged by opening/dismissing history.
5. Accessible dismissal, modal isolation, originating focus and reduced motion
   have evidence. No visible close button or new route is introduced.
6. Jest covers the changed decisions and integration: threshold boundaries,
   directions/cancellation, exactly-once close, both kinds, accessible/system
   close, state retention and default `Sheet` callers if touched. Screen tests
   render production routes over real data; mocks are reserved for failures,
   loading/races or unavailable native gesture/animation mechanisms.
7. Current-app screenshots compare against the accepted target for muscle and
   exercise popups, with both Daily/Weekly, a long title, small/large phones,
   loading, error/Retry and empty state. Include device proof of actual header
   dismissal and chart-scroll independence; static screenshots/Jest alone do
   not prove native gesture recognition or motion.
8. Implementation PR records agreed lanes, results and evidence, updates the
   owning specs, and deletes this card when the change ships. Do not reference
   the card path/ID from code, tests, flows, migrations or durable specs.

## Specs to update in the implementation PR

- `docs/specs/ui/ux-rules.md` §12: replace the three-quarter history-sheet
  sizing/dismissal rule; keep the existing heatmap and data semantics.
- `docs/specs/ui/components-catalog.md`: history presentation and any opt-in
  shared `Sheet` API, including its unchanged default.
- `docs/specs/ui/design-language.md` §4: document the full-height history
  exception/gesture without requiring other sheets to change.
- `docs/specs/ui/screen-map.md` and `navigation-contract.md`: describe the
  changed history presentation/return while preserving in-route navigation.
- `docs/specs/ui/design-targets/progress.md`: narrowly supersede its old history
  container height/dismissal; retain chart, table and other target authority.
- `docs/specs/ui/design-targets/history-popup.md`: add rendered verification and
  material deviations after implementation; reference image stays a concept.
- `docs/specs/08-ux-delivery-standard.md`: update reusable UX patterns only if
  the chosen implementation introduces a reusable pattern.

## Verification and lane agreement

Run `./boga test for` on the actual implementation diff and propose the final
lane set to the operator before any lane beyond `fast`. This planning PR does
not pre-authorize slower implementation lanes or new Maestro scenarios.

- Always: update meaningful Jest coverage and pass `./boga test fast`.
- UI path default: `./boga test frontend-ui`; a shared `Sheet` change may also
  trigger a full-sweep suggestion. Propose only the lanes exercising the diff;
  the operator decides reductions/increases and whether to take the sweep.
- The present `ios-data-smoke` flow exercises Progress/exercise browsing but
  does not prove the new popup drag. Explain that device-only gap and obtain
  approval before adding a minimal scenario to an appropriate existing flow.
  Do not run an untouched lane and present it as proof of swipe dismissal.
- Finished change, once before implementation PR: `./boga test jest-coverage`,
  `./boga test complexity`, `./boga test dependencies`; get all green.
- Propose `./boga test handles` if animation callbacks, subscriptions or async
  cleanup are changed. No new native dependency/config change is expected; if
  one becomes necessary, discuss scope and apply the mandatory build-client
  rebuild and frontend verification rule.
- Verify machine capability with `./boga doctor` before declaring a gate
  unavailable; fix bootstrap gaps. Quote durations only from measured runs or
  `./boga timings`. Keep artifacts in the normal gitignored Maestro tree and
  link them in the PR's Tests/Deviations evidence.

## Handoff and closeout

After the planning PR merges, execute this card in a fresh session/worktree.
Use a reviewer pass on the finished diff, then open a lean implementation PR
following `.github/pull_request_template.md`. Capture the new popup on device
and compare it with the pinned reference before declaring completion. Run
`./boga db down` after opening/updating the PR. Do not merge without an explicit
request; after a confirmed merge release the owned worktree/stack in the same
session using `./boga worktree release`.
