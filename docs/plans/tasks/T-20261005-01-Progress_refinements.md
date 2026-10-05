# T-20261005-01 — Progress refinements

- Status: `planned`
- Source: [Issue #523 — Refinements for progress](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/523)
- Depends on: none; merge the planning PR before starting implementation
- Milestone: none
- Areas: frontend, docs; UI impact: yes
- Delivery: one implementation session, one local worktree, one PR
- Plan and verification set agreed with the operator: 2026-10-05

## Objective

Make exercise and muscle progress equally accessible through a pinned view
switch, and let users inspect muscle contributions in place. Contributions must
expand and collapse beneath their muscle row, with one muscle open at a time.
Keep the existing Sessions link after the content in both views.

## Scope

- In: Progress layout, contribution disclosure and accessibility, existing
  Jest coverage, the existing data-smoke navigation steps, native visual
  evidence, and the owning UI documentation.
- Out: calculation changes, database/schema/sync/backend changes, new durable
  preferences, history-sheet redesign, and new committed Maestro scenarios.

## Decided

These decisions were explicitly agreed during planning. Do not reopen them
without a material conflict and the operator's input.

1. Show the existing `By Exercise` / `By Muscle` joined control in both views,
   pinned at the top, above the scrollable content. It remains visible while
   scrolling. Only this control is pinned; period and metric controls scroll.
2. Keep `Sessions` as the final link after the content in both views, opening
   the existing `/sessions` route. It is not a fixed footer. Current code
   already renders this link in both views; retain and verify it.
3. Remove `Browse exercises`. The pinned switch provides access to that view.
4. The default muscle view starts with no expanded muscle. Tapping a closed
   chevron expands that muscle; tapping it again collapses it. Opening another
   muscle closes the previous one.
5. Contributions appear immediately below their muscle row, before the next
   muscle or family heading. Remove the separate contribution section below
   the whole muscle table and the large `<muscle> contributions` title.
6. Retain compact `Exercise | Now | Previous | Change` headers, the existing
   exercise contribution rows and Primary/Secondary captions, and inert Total.
   Use existing typography, spacing, colours, and numeric/coverage formatting.
7. Muscle names still open individual history. The sibling chevron controls
   disclosure independently; exercise names in contributions still open their
   existing history sheet. Preserve the separate 44pt targets.
8. Preserve existing default entry, legacy route parameters, Settings-driven
   calculations/history choices, and mounted-screen search/sort/period/metric
   state. Disclosure remains transient and resets on account change.

## Accepted design target

The accepted target is this repo-native refinement brief, agreed on 2026-10-05,
applied to the existing [Progress tables target](../../specs/ui/design-targets/progress-tables.md)
and [retained Progress/history target](../../specs/ui/design-targets/progress.md).
The existing selected image remains a reference for row hierarchy and separate
name/chevron targets; repository tokens and contracts govern production.

Explicit replacements of the earlier target: its fully scrolling control
layout becomes the pinned view switch; its below-table contribution section
becomes an accordion under the selected row; its contribution title is removed;
its repeat selection that stays open becomes collapse; and its Browse exercises
link is replaced by the switch. Update those owning documents in the shipping
PR so they describe the new accepted behavior.

Required native comparison states at 320pt and 430pt widths: initial muscle
view, expanded contributions, collapsed again, another muscle expanded,
exercise view, pinned switch while scrolled, and Sessions reached after each
view's content. Include a metric-specific empty contribution state and long
names/large or incomplete Volume values. Captures stay in the gitignored
artifact tree and are linked in the implementation PR.

## Open questions

None. Use the agreed brief and existing component conventions. Report material
conflicts before changing the accepted behavior or expanding scope.

## Implementation approach

Baseline inspected: `origin/main` at `9b1aca9d`. Recheck against latest main at
execution start; the paths below identify ownership, not a frozen code layout.

1. In `apps/mobile/app/(tabs)/progress.tsx`, render one view switch in a
   non-scrolling header above `ScreenScroll`, with matching page gutters. Keep
   loading/error feedback, period controls, metric controls, tables, and the
   final Sessions link in the scrolling body. Remove Browse exercises.
2. Toggle the nullable contribution ID on repeated selection. In
   `apps/mobile/components/stats/progress-tables.tsx`, render the selected
   muscle's contribution block within the muscle loop, immediately after its
   row. Reuse the current contribution projections and row renderers.
3. Remove the obsolete below-table heading and its automatic scroll/focus
   plumbing. Do not jump to the end of the taxonomy when expanding. Keep the
   disclosure button focused and expose `accessibilityState.expanded` with
   Show/Hide wording; retain history-sheet focus restoration to its launcher.
4. Update the existing screen tests rather than duplicating their fixture
   setup. Read `apps/mobile/__tests__/README.md` first. Use the production route
   over migrated real SQLite data for behavioral checks; force only loading,
   failed-read, and race states that real fixtures cannot produce.
5. In `apps/mobile/.maestro/flows/data-runtime-smoke.yaml`, replace the existing
   scroll-to-Browse-exercises/tap steps with the pinned By Exercise switch.
   Preserve its existing device claim: a logged session is read back through
   the on-device SQLite runtime. Update its header wording and counterpart
   references as needed; do not add an accordion scenario to this flow.

## Deliverables and acceptance

1. The switch appears once, remains reachable while either view scrolls, and
   selects the appropriate content. The body and its controls remain fully
   usable below the header and above the existing tab bar at both widths.
2. One or zero contribution blocks can be visible. Each visible block belongs
   directly to its selected muscle, precedes the following muscle/family, and
   closes on a second chevron tap. No large contribution title remains.
3. Opening individual history does not toggle disclosure. Dismissing history
   restores the launching control's focus and preserves underlying period,
   metric, disclosure and scroll state. Exercise search and sort survive view
   switching; account changes clear foreign transient state.
4. Existing data semantics remain proven: Total reconciles with its muscle in
   both periods; previous-only contributors, volume-only and zero-load rows,
   metric-specific emptiness, and incomplete Volume stay correctly displayed.
   Loading must not become premature emptiness; failed reads remain retryable.
5. Sessions is the final content link in both views, including empty/error
   states, and opens `/sessions`. Browse exercises is absent and the pinned
   switch provides the retained exercise browsing entry point.
6. Jest proves the changed happy paths and at least one failure/edge path;
   existing data-smoke remains green through the replacement control. Native
   captures show the pinned switch while scrolled and inline disclosure, with
   material differences from the accepted target recorded in the PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Switch breakdown | Open Progress; scroll; tap the pinned By Exercise or By Muscle choice | Requested content is reachable, selected choice is clear, and period/search/sort choices are retained | Switch remains reachable over long or empty content and loading/error states; no content is covered by the header |
| Inspect contributions | Tap a muscle chevron; tap it again; open a different muscle | Contributions appear directly below the row; repeated tap closes; another muscle replaces the open one; accessibility announces expanded/collapsed state | Successful no-contributor read shows the existing metric-specific empty copy; previous-only and incomplete rows remain explainable; no jump to the old bottom section |
| Change comparison | With a muscle expanded, change period or Working sets/Volume | Existing projections update together and Total reconciles to the muscle; disclosure remains associated with that muscle | Loading hides superseded values; failed reads retain existing Retry behavior without fabricated zeros or stale-context contributions |
| Inspect history | Tap a muscle name or contribution exercise name; dismiss its sheet | Existing individual history opens; dismissal preserves underlying state/scroll and returns focus to its launcher | History failure stays inline and retryable; the name action never toggles the chevron |
| Open Sessions | In either view, reach the end of the content and tap Sessions | Existing Sessions route opens | Link remains reachable with no history, no search matches, or a failed progress read |

## Specs to update

- `docs/specs/ui/design-targets/progress-tables.md` — record the accepted
  refinement, pinned switch, inline accordion and revised acceptance states.
- `docs/specs/ui/design-targets/progress.md` — align retained exercise browsing
  entry/control wording with the shared pinned switch.
- `docs/specs/ui/ux-rules.md` §13 — replace selection-that-stays-open and
  below-table heading/focus rules with accessible accordion behavior.
- `docs/specs/ui/screen-map.md` — describe the shared switch and inline
  contributions, with Sessions as the final link in both views.
- `docs/specs/ui/navigation-contract.md` — replace Browse exercises entry
  wording with the in-route switch while retaining shared route compatibility.
- `docs/specs/06-testing-strategy.md` — update the existing data-smoke journey's
  Browse exercises wording; its purpose and lane membership stay the same.

## Gates

The operator agreed to this focused implementation set on 2026-10-05:

| Command | Purpose |
| --- | --- |
| `./boga test fast` | Required Jest and normal fast gates, including meta checks for the updated flow selectors |
| `./boga test ios-data-smoke` | Existing affected device journey using the replacement top switch |
| `./boga test jest-coverage` | Required whole-suite coverage floor before the PR |
| `./boga test complexity` | Required complexity limits before the PR |
| `./boga test dependencies` | Required import-direction/cycle limits before the PR |

Run `./boga test for` on the finished diff and record its actual path defaults.
The UI default `frontend-ui` is intentionally narrowed to `ios-data-smoke`:
the changed disclosure/state behavior is `covered-by-jest`, the existing
data-smoke flow is the affected device journey, and native captures verify
layout at small and large widths. The exercise-page and session-view lanes do
not exercise these refinements. No root, native, sync or backend change is
planned. If implementation expands into those areas, propose an amended lane
set before running additional lanes; existing agreement need not be requested
again. New committed Maestro coverage requires separate justification and
operator approval.

Record measured results/evidence and the agreed default reduction in the
implementation PR's Tests table; never estimate durations. If a prerequisite
fails, run `./boga doctor` and fix the bootstrap gap. Follow the standard local
slot/worktree lifecycle and obtain all agreed gates green before opening the PR.

## Execution and closeout

Load `AGENTS.md`, its always-load specs, the UI/design policy, training metrics
contract, and the Maestro runtime docs for the flow edit. Execute through the
[task protocol](../README.md#task-protocol-boga), from latest `origin/main` in
a new leased local worktree after this planning card has landed.

Review the final diff and open one implementation PR referencing Issue #523.
Keep evidence in that PR, update durable rules in the owning specs, and delete
this card in the implementation PR. Do not reference the card path or task ID
from code, tests, flows, or durable documentation. Stop the slot's stack after
opening the PR; do not merge without the operator's instruction. After merge,
release the implementation worktree and its slot resources in the same session.
