---
task_id: T-20260923-02-Restyle_View_Session
milestone_id: "none (plan: docs/plans/exercise-session-redesign.md, step 7 blocker)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,navigation-contract,ux-rules,components-catalog}.md, docs/specs/ui/design-targets/view-session.md (new, if V1 = brief), docs/specs/08-ux-delivery-standard.md, docs/specs/tech/groups-contract.md, docs/plans/exercise-session-redesign.md"
---

# Restyle View Session (and the group session view) to the design language

## Task metadata

- Task ID: `T-20260923-02-Restyle_View_Session`
- Status: `planned`, **approved by the user on 2026-09-23** (V1–V16 all decided, below). **Build nothing before 6b-3 merges (V2).**
- Session date: 2026-09-23
- Plan: `docs/plans/exercise-session-redesign.md`, step 7 ("Blocked also by the View Session restyle"). Decided by the user on 2026-09-23: View Session sits badly beside the new screens, because the completed edit's `Edit` → session view → `Done` loop crosses it.

## Context freshness

- Branch `claude/practical-goodall-04c90a` at `origin/main` `f97111a` (#330, 6b-1, merged 2026-09-23 16:49Z); slot 2 leased.
- Docs read: `AGENTS.md`; specs `02`, `03`, `09`, `08`; `ui/{ai-design-policy,README,design-language,components-catalog}.md`; `ui/design-targets/exercise-session-v5.md`; the completed-session, session-view and exercise-page sections of `ui/{screen-map,navigation-contract,ux-rules}.md`; the plan, the build spec, the 6b card; `docs/plans/README.md`.
- Code read: `app/completed-session/[sessionId].tsx` (1,204 lines), `components/session-recorder/{session-completion-presentation,exercise-personal-record-celebration,exercise-volume-comparison,session-share-preview}.tsx`, `components/session-view/*`, `components/ui/{card,stat,list-row,sheet,tokens}`, `src/session-recorder/{session-view-model,use-session-view}.ts`, the harness fixture and the Maestro flows below. Line numbers refer to `f97111a`.
- **Rebased 2026-09-23 onto `482c5e0`** (6b-3, #331, and #328's configurable RIR range). What that changed for this card:
  - 6b-3 deleted `exercise-block-history-fixture.yaml` and moved its completion tail (two PRs, share preview, share failure, native share sheet) into `session-completion-states-fixture.yaml`, with a `completion-two-prs` fixture; `activeSessionHref` is gone (append pushes `sessionViewHref` of the id the append returns).
  - 6b-3 kept only `listSessionExerciseAssignedTags` in `src/data/exercise-tags.ts`; its last caller was this screen, so V8 deletes the file.
  - #328 put every effort label behind `formatSessionSetType` (`RIR n` for any stored RIR), which `formatSetRow` uses.
- **Build notes (PR A):** the detail draws its own top bar (`back · View Session · ⋮ · Edit`, header hidden) rather than a native header's right slot, matching the session view and exercise page it sits between; the `ActionButton` outline is the session view's `ink` hairline at the control radius.

## Objective

Move `/completed-session/[sessionId]` (the detail and `presentation=completion`) from `uiColors` / `uiRadius` / `UiButton` / system font to `uiRoles` / `uiGeometry` / `uiFonts` and the `Card` / `Stat` / `ListRow` / `Sheet` primitives, reusing the session view's set-row presentation. Do the same for the group session view (`/group-session/[memberId]/[sessionId]`, V15), which shows the same kind of content and shares most of the components. After this, no View Session or group-session file imports `uiColors`, which clears the restyle blocker on step 7. Behaviour changes only where a decision below says so.

## Structure (V13)

**Two screens on one route, sharing components.** Detail and completion do different jobs (a record you return to; a one-off moment after `Finish`), with different entries, exits, actions, data and deleted-session handling, so they are separate compositions. The URL stays `/completed-session/<id>[?presentation=completion]`, because the navigation contract (transitions 12, 47), the harness teleport, five flows and `Finish` all use it. The route file becomes a thin switch over:

- `components/view-session/`: the detail's composition (header actions, options and exercise sheets, deleted band).
- `components/session-complete/`: the completion's composition (PR cards, volume cards, muscle pills, share sheet and card).
- `components/session-detail/`: what the detail, the group session view (V15) and the session view share:
  - `SetSummaryRow`, moved out of `session-view/session-exercise-card.tsx`;
  - `ExerciseSetsCard`: a `Card` with name, count, an optional trailing slot (⋮ or chevron), rows and an optional record band. The session view's `SessionExerciseCard` is rebuilt on it, so one card recipe serves all three screens;
  - `SessionFactsCard`: a `Card` of stacked `Stat` rows;
  - a pure row model for performed sets from plain `{ weight, reps, setType }`, which the group view's numeric weights and the local session's strings both feed.

## Inventory: what each part becomes

### Detail (`/completed-session/<id>`, title `View Session`)

| Today (line) | Becomes | Reuses |
| --- | --- | --- |
| Blue-grey `surfacePage` ground, `uiSpace.xl` gutter (932-937) | `paper` ground, `uiSpace.md` gutter as on the session view | `uiRoles.paper` |
| Sticky action strip with `Edit` (blue filled) and `Delete`/`Undelete` (red subtle), `Deleting...` label, feedback line (639-683, 524-559) | **V4.** `Edit` in the header's right slot, the screen's one `accent` primary; a ⋮ next to it opens a `Session` sheet with `Delete session` (danger) or `Undelete session`. While deleted, a quiet band under the header reads `Deleted · hidden from history`, and `Edit` is hidden (see the bug below). Write failures show inline in `danger` | `Sheet`, `ListRow tone="danger"`, `Icon more-vertical`; the session view's options-sheet pattern |
| Header card: 2×2 grid of Start / End / Duration / Location, bold system font (685-734) | Summary `Card`: `Start` · `End` in the edit fields' `YYYY-MM-DD HH:mm` (so the `Edit`/`Done` loop reads the same values in the same place), then `Duration` · `Gym` · `Sets` · `Volume` as stacked `Stat`s. Sets and Volume are new, and come from the same derivation as the session view | `Stat` (`kind="text"` for Gym) |
| Per-exercise `SessionContentLayout` card: title toggles collapse, collapsed summary counts (736-755) | **V5.** No collapse. One `Card` per exercise: name, set count, rows | `Card` |
| Set table: `Set` / `Weight` / `Reps` / `Effort` header, `-` for no effort, performed sets only (788-863, 130-141) | The session view row: `type · weight × reps · 1RM · VOL` with mini legends, `—` for no effort. Performed sets only, as today (V7). There is no set-number column | `SetSummaryRow` from `session-exercise-card.tsx` (exported), `formatWeightFigure` / `formatOneRepMaxFigure` / `formatVolumeFigure` |
| No record shown ("this viewer does not compute an as-of-session comparison", `ux-rules` §7.6) | **V3.** The session view's record 1RM (brass) and `record` band, derived against the rest of history the way the completed edit does it | `historicalBestOneRepMax`, `deriveExercisePersonalRecord` |
| `Append` blue-grey pill in the card header (771-787, 507-522) | **V6.** A ⋮ (44pt) at the top right of each exercise card opens an exercise sheet with `Append to current session`. The card itself is not a link. Keeps testID `completed-session-detail-append-exercise-button-<id>` on the sheet row; the ⋮ is `completed-session-detail-exercise-options-<id>` | `Sheet`, `ListRow`, `Icon more-vertical` (the exercise page's ⋮ pattern) |
| Tag chips: blue pills, `(deleted)` suffix (864-880), loaded per exercise by `listSessionExerciseAssignedTags` (206-224) | **V8. Dropped.** The loader stops reading tags, and `CompletedSessionDetailExercise.tags` goes. After 6b-3 deletes the recorder, `listSessionExerciseAssignedTags` has no caller, so PR A deletes it (and its repository method if nothing else uses it) with its tests. The synced tag tables and exercise history's tag filter are untouched | none |
| `No exercises logged in this session.` | Same copy, `inkMuted` body on `paper` | none |
| Loading / error / not found: centred system-font text (561-597) | Same three states and copy, in `uiFonts` / `uiRoles` on `paper` | none |
| `intent=edit` redirect placeholder (905-919) | Unchanged behaviour, restyled text | none |
| Dead styles `editModeBanner*`, `reopenHintText`, `readOnlyField*`, `editFieldInput`, `setRowEdit`, `setIndexText`, `editSetInput`, and the unused `initialMode` prop | Deleted | none |

**Bug found in passing (fixed by V4):** on a deleted session, `Edit` pushes `/session/<id>`, and `useSessionView` then renders `This session is no longer active.`, because it only loads undeleted completed sessions (`use-session-view.ts:46-48`). Hiding `Edit` while the session is deleted closes that route.

### Completion (`presentation=completion`, title `Session complete`)

| Today | Becomes | Reuses |
| --- | --- | --- |
| Native header, no back; `Share session` (blue filled) and `Done` (secondary) at the bottom (183-201) | **V9.** A header-less screen with its own top bar, `Session complete` · `Done` (`accent`). `Done` sits where `Finish` sat one tap earlier. `Share session` becomes an outline button at the end of the content. The back gesture stays off, and Android back and `Done` still replace to `/progress` | `SessionTopBar` gains `mode="complete"`; the outline button (V12) |
| `Session Summary` card: DURATION / EXERCISES / SETS `n (m working)` / GYM, a grid of system-font figures (88-116) | Summary `Card` of stacked `Stat`s: `Duration` · `Exercises` · `Sets` · `Working` · `Gym` | `Stat` |
| `Working sets by muscle` blue chips `Quads (4)`, hint "Numbers in brackets are working sets.", loading/error/empty copy (118-144) | The same section inside the card under a `ruleSoft` divider, with a micro-label legend. Chips become `name` + Plex Mono count pills (1px `rule`, `radius.control`), so the bracket hint goes. The loading/error/empty copy is unchanged | none (local style) |
| `Personal records`: green `surfaceSuccess` cards with a star, `100 kg × 3 reps · est. 1RM 107 kg` (147-161) | **V10.** Record language: one `Card` per PR with a `record` band header (`New 1RM record · 110.0`), then the exercise name and `100.0 × 3`. The 1RM is bold `record`. No "est." and no `kg` (`design-language` §6) | the session view's band style |
| `Exercise volume`: `2,560 kg`, blue delta text, blue current marker on a grey P5–P95 track (163-181; `exercise-volume-comparison.tsx`) | **V10.** A `Card` per exercise: name, set counts, `Vol` figure `2560` (no separator, no unit), the delta in `ink`. Track in `ruleStrong`, median tick `inkMuted`, current dot `ink`. `Above P95` / `Below P5` as an `inkMuted` micro-label. `accent` is not used, since it marks the one primary. Baseline and no-history states keep their copy | `Card`, `uiFonts.figure` |
| Share preview: custom modal with drag handle, `Close`, `Share image` (blue) and `Cancel` (`session-share-preview.tsx`) | **V11.** The design-language `Sheet`, titled `Share session`. The backdrop, Android back and the VoiceOver escape dismiss it (all disabled while sharing), so `Close` and `Cancel` go. `Share image` is the sheet's `accent` action; the privacy line and inline retryable error stay. `Sheet` gains an optional scrollable body with a max height | `Sheet` (small additive prop) |
| Share card PNG: blue `BOGA` mark, green PR block, `kg` figures | **V11.** Restyled to match: `surface`, an `ink` Archivo mark, record-band PRs, Plex Mono figures. It still leaves out gym and location | the restyled volume row (`variant="share"`) |
| Loading / error / not-found / deleted target, each with `Back to Stats and History` | Restyled; the copy becomes `Back to Progress` (the tab has been named Progress since M26). `testID="session-completion-safe-exit"` is kept | none |

### Group session view (`/group-session/<memberId>/<sessionId>`, V15)

| Today (`components/groups/friend-session-content.tsx`, route) | Becomes | Reuses |
| --- | --- | --- |
| `groupScreenStyles` ground (`uiColors`) | `paper` ground on this route | `uiRoles.paper` |
| Header `UiSurface`: member name, status `In progress` (green) or `Completed · 58m`, then Start / End / Location | `SessionFactsCard`: the member name as its heading, the status line in `inkMuted` (`In progress` beside the `set-current` glyph, since a ring is how the design language marks "current"), then `Start` · `End` · `Gym` · `Sets` · `Volume` | `SessionFactsCard`, `Icon set-current` |
| `SessionContentLayout` cards with collapse; `Set` / `Weight` / `Reps` / `Effort` table; `100 kg`; `-` for no effort | `ExerciseSetsCard` with `SetSummaryRow`s: `type · weight × reps · 1RM · VOL`, `100.0` with no unit, `—`. No collapse, no ⋮, and **no record band**: the friend's history is not on this device | `ExerciseSetsCard`, `SetSummaryRow` |
| `No performed sets yet.` | Same copy, restyled | none |
| Offline banner, inline error, missing-data, lost-access and sign-in states (`components/groups/*`) | **V16.** Unchanged: every group screen shares them, so restyling them belongs to the groups screens | none |

Kept: cache-first loading, pull-to-refresh, lost-access eviction, performed sets only (contract §5), no owner actions, and the testIDs `group-session-screen`, `-header`, `-member`, `-status`, `-set-row-<setId>`.

With the recorder gone (6b-3) and both viewers moved off it, `SessionContentLayout` and `ExerciseCardCollapsedSummary` have no consumers left, and are deleted in PR C.

### Kept exactly

The route, params and transitions: `intent=edit`, `presentation`, the `maestroShare` / `maestroCatalog` dev hooks, and focus reload. Also: the data client, completion insights loading and the history fallback; share capture, cleanup and silent cancel; completion hiding edit/delete/append.

**testIDs are kept** wherever the element survives: `completed-session-detail-*`, `session-completion-*` and `session-share-*`. Removed elements lose theirs: the set-table header, the collapsed summary, `session-share-close` and `session-share-cancel`. New elements get `completed-session-detail-options-button`, `-options-sheet`, `-deleted-band`, `-exercise-options-<id>`, `-exercise-sheet` and `-exercise-<id>-set-<n>`. This keeps `data-runtime-smoke`, `session-view`, `sync-first-run-log-and-roundtrip` and the completion tail of `exercise-block-history-fixture` green with no edits.

## Decisions for the user

| # | Question | Recommendation |
| --- | --- | --- |
| **V1** ✅ **(a), decided 2026-09-23** | **Which accepted design target governs?** (`ai-design-policy` §2 requires one.) (a) A repo-native brief: this card's inventory, in V6-Session's vocabulary, plus the screenshots you accept from gallery iteration 1, recorded in a short `design-targets/view-session.md`. (b) New artboards on the existing Claude Design canvas (`V7-View`, `V7-Complete`, `V7-Share`), drawn and accepted before any build. (c) Mixed: the detail by brief (it is the session view made read-only), the completion and share card by new artboards (they have no precedent: range bar, PR cards, muscle pills, the PNG) | **(a)**. Almost every element maps onto a shipped primitive. Gallery iteration 1 gives you the same accept-or-redirect point that an artboard would, without a second design surface to keep in sync |
| **V2** ✅ **both after 6b-3, decided 2026-09-23** | **Order against 6b-3**, which rewrites the same completion flows, deletes `ExercisePersonalRecordCelebration`'s other variants, moves `SessionMuscleLoadCatalogState`, and changes the append handler (`activeSessionHref`) | **PR A (detail) now**, in parallel with 6b-3: stable testIDs, and the append handler's logic is left alone. **PR B (completion) after 6b-3 merges**, so it restyles a single PR variant and edits the completion flows after 6b-3 has moved them |
| **V3** ✅ **show identically, decided 2026-09-23** | **Records on View Session cards.** Today there are none. The session view's completed edit shows a brass 1RM and `New 1RM record` band when this session holds the best 1RM against every other session | **Show them, identically.** The `Edit`/`Done` loop then shows the same card on both sides. This reverses `ux-rules` §7.6's "no PR label" |
| V4 ✅ **approved 2026-09-23** | Actions: header `Edit` (`accent`) + ⋮ sheet (Delete/Undelete), deleted band, `Edit` hidden while deleted | As described |
| V5 ✅ **approved 2026-09-23** | Drop collapsible cards (the session view dropped them) | Drop |
| V6 ✅ **decided 2026-09-23** | Append is an edge case: it moves into a ⋮ at the top right of each exercise card (sheet row `Append to current session`). Cards are not links | As decided |
| V7 ✅ **approved 2026-09-23** | Keep showing performed sets only; the header shows `n sets`, not `n/m` | Keep |
| V8 ✅ **decided 2026-09-23** | Tags on View Session | **Dropped** (not restyled). Retires `ux-rules` §7.4 |
| V9 ✅ **approved 2026-09-23** | Completion: own top bar, `Session complete` · `Done` (`accent`); Share as an outline button | As described |
| V10 ✅ **approved 2026-09-23** | PRs in record language; volume cards in mono, with no separators, no `kg` and no `accent` | As described |
| V11 ✅ **approved 2026-09-23** | Share preview becomes a `Sheet` (no Close/Cancel), and the share PNG is restyled | Yes, both. The PNG is what people see |
| **V13** ✅ **decided 2026-09-23** | One screen, or two sharing components? | Two screens (detail, completion) on one route, sharing components (see Structure) |
| V14 ✅ **no, decided 2026-09-23** | The completion extras are one-time only: since 6b-1 removed `presentation=summary`, nothing reaches the PR cards, volume comparisons or Share after `Done`. Should the detail offer them? | **No.** The detail gets neither Share nor the volume comparisons; they stay part of the completion moment |
| **V15** ✅ **decided 2026-09-23** | Include the group session view? | Yes, as PR C, on the shared components |
| V16 ✅ **decided 2026-09-23** | The group state components (offline banner, inline error, missing data, lost access, sign-in) keep their current styling on the restyled group session page | Keep: they are shared by every group screen. The mismatch shows only offline or on an error |
| V12 ✅ **approved 2026-09-23** | Promote one design-language button primitive (`primary` / `outline` / `text`) to `components/ui/`, replacing `session-view/OutlineButton` and `gyms/GymButton`. View Session is its third consumer (the plan's extraction rule) | Yes, in PR A |

## UX contract (`08`)

- **View a completed session.** Trigger: exercise-history row, Today recent, or the session view's `Done` fallback. Steps: the page opens on `paper` with the summary card, then the exercise cards. Success: every performed set shows its 1RM and volume, and a record band shows where one was set. Edge: loading, error or not found each render in place.
- **Edit loop.** Trigger: header `Edit`. Steps: session view → change a set or time → `Done`. Success: back on View Session, the change shows (focus reload), with Start/End in the same format. Edge: while deleted, `Edit` is absent.
- **Delete / Undelete.** Trigger: ⋮ → `Delete session`. Success: the band appears and ⋮ offers `Undelete session`; undeleting removes the band. Edge: a write failure shows inline in `danger`, and the state is unchanged.
- **Append.** Trigger: a card's ⋮ → `Append to current session`. Success: the active session opens with the block as planned rows. Edge: a failure shows inline.
- **Completion.** Trigger: session view `Finish`. Steps: summary → PRs → volume → `Share session`. Success: `Done` (top bar) or Android back replaces to Progress. Edge: missing history shows the no-history rows; a failed catalogue shows `Muscle breakdown unavailable.`; an unavailable target shows `Back to Progress`.
- **View a group member's session.** Trigger: a stream session card, or a record sheet's `View full session`. Steps: the facts card, then the exercise cards. Success: every performed set shows its 1RM and volume; an active session reads `In progress` and updates on pull. Edge: offline shows the cached copy with the offline banner; lost access shows the unavailable state.
- **Share.** Trigger: `Share session`. Success: the sheet previews the PNG, and `Share image` opens the native sheet. Edge: a capture failure shows inline and can be retried; a native cancel is silent; the backdrop is inert while sharing.

## Verification, screenshots and the gallery

Per the user's preference, **every accepted state is captured in the lane, and each iteration sends one rendered HTML gallery**, with the `main` capture beside the new one. States:

- **Detail:** top of the page (summary + first card); a card with a record band; the exercise ⋮ sheet; the options sheet; the deleted band; not found; no exercises.
- **Group session:** a completed session; an in-progress session; offline (cached).
- **Completion:** one PR; multiple PRs; volume cards in the distribution, baseline and no-history states; catalogue error; unmapped; share preview; share error; the safe exit.

**Maestro changes** (runner lines unchanged except where noted; spec `11`, `README-maestro.md`):

| Flow (lane) | PR | Change |
| --- | --- | --- |
| `session-completion-states-fixture.yaml` (ios-ui-regression) | A | The read-back (`:180-193`) asserts the row by its label (`100.0 × 6`), not the bare text `6`/`5`. **Add** detail steps: open detail → screenshot → ⋮ → `Delete session` → band screenshot → `Undelete session`; the exercise ⋮ sheet; not found (bogus id). New screenshots `view-session-*` |
| same | B | The completion screenshots change with no step edits. **Add** a share-preview step if 6b-3 has not already moved it here |
| `exercise-block-history-fixture.yaml` tail (ios-ui-regression) | B | None if it still exists (testIDs are stable). 6b-3 is expected to have deleted it |
| `groups-two-user-stream.yaml:397-402` (ios-groups-e2e) | A | Repoint the three `assertNotVisible`s to the new `completed-session-detail-options-button` / `-edit-button`, so the friend view's read-only proof still names live IDs |
| same, `:379-403` | C | Steps unchanged (testIDs kept); the `groups-07-friend-view-read-only` screenshot changes. Add a screenshot of the in-progress friend session if the flow reaches one |
| `data-runtime-smoke`, `session-view`, `sync-first-run-log-and-roundtrip` | none | Completion testIDs are stable |

**Fixture** (`src/maestro/exercise-block-history-fixture.ts`): add a two-PR completion session in PR B unless 6b-3 already added it (its card plans one).

**Jest:** rewrite `completed-session-detail-screen.test.tsx` (1,093 lines) for the new structure. Keep its behaviour cases (load states, Edit → `/session/<id>`, intent redirect, delete/undelete + failure, append + failure, completion exits, share success/failure/cancel, catalogue states). Add: records band present/absent, `Edit` hidden while deleted, the options sheet, the volume figure format. Extend `ui-design-primitives.test.tsx` for `Sheet`'s scroll prop and the button primitive (V12). Add a component test for `components/session-detail/` (row model: string and numeric weights, `—` effort, record flag). Update `groups-screens.test.tsx:536-544` (friend rows) for the new row text, and keep its no-owner-testID assertion. `session-view-screen.test.tsx` must stay green over the rebuilt `SessionExerciseCard`.

## Doc graduations (each in the PR that ships it)

- `ui/screen-map.md` §10 and `ui/navigation-contract.md` §10: header actions, ⋮, deleted band; completion's own top bar and `Done` (A: detail; B: completion). Navigation contract "Header titles": completion becomes header-less.
- `ui/ux-rules.md` §7: rewrite rules 1, 2, 5, 6 and retire rule 4, tag chips (A) and 7–10 (B); §6.1 state styling; §9a/§9c "only users are the session view and exercise page" gains View Session; §1 gets `Back to Progress` wording.
- `ui/components-catalog.md`: `SessionCompletionPresentation`, `ExercisePersonalRecordCelebration`, `ExerciseVolumeComparisonRow`, `SessionSharePreview` (B); `SessionContentLayout` loses completed-session as a consumer; the button primitive and `Sheet`'s scroll prop (A).
- `08-ux-delivery-standard.md`: pattern 4's usage drops completed-session detail (A). Once PR C deletes `SessionContentLayout`, pattern 4 has no user: retire it, and make pattern 6 (stream card) stand alone rather than citing it (C).
- `tech/groups-contract.md:1490-1492, 1535-1540`: the friend's view composes `components/session-detail/`, with rows `type · weight × reps · 1RM · VOL` (C).
- `ui/components-catalog.md`: `components/session-detail/` (A); `FriendSessionContent`; delete `SessionContentLayout` / `ExerciseCardCollapsedSummary` (C). `ui/screen-map.md`: the group session entry (C).
- `ui/design-targets/view-session.md`: new, if V1 = (a), with the accepted gallery states listed (A, completed in B).
- `docs/plans/exercise-session-redesign.md` step 7 row: the restyle blocker is cleared (the last of B and C). **Delete this card in that PR.**

## PR split (each ≤ ~2,000 added/modified lines)

All three PRs start after 6b-3 merges (V2). Rebase this card's line references and flow table onto that merge first: 6b-3 is expected to delete `exercise-block-history-fixture.yaml`, move its completion tail into `session-completion-states-fixture.yaml`, add a two-PR fixture session, and remove `activeSessionHref` and the other PR-celebration variants.

| PR | Scope | Estimate (added/modified) | Gates (`./boga test for`) |
| --- | --- | --- | --- |
| **A: detail** | Route switch, detail branch and states; `components/session-detail/` (shared card, row, facts card, row model; `SessionExerciseCard` rebuilt on it); `components/view-session/` (header actions, sheets, deleted band); drop tag loading and delete `listSessionExerciseAssignedTags` (V8); button primitive (V12) + callsite swaps; fixture tags; jest; flow edits; docs | ~1,100 | `fast` + `frontend` + **`backend`** (the `src/data/exercise-tags.ts` deletion is "data layer") + `docs-check` + `meta-tests`; also `handles` by name |
| **B: completion + share** | `SessionTopBar` `complete` mode; `components/session-complete/` (PR card, volume row, muscle pills, share sheet and card); `Sheet` scroll prop; jest; flow edits; docs | ~1,000 | same |
| **C: group session view** | `FriendSessionContent` and the route on `components/session-detail/`; delete `SessionContentLayout` / `ExerciseCardCollapsedSummary`; jest; flow screenshot; groups-contract, catalog, screen-map, 08 | ~500 | same (`frontend` includes `ios-groups-e2e`) |

A goes first, since it creates `components/session-detail/`; B and C then run in parallel. The last of B and C to merge updates the plan's step 7 row and **deletes this card**.

No native change, so no dev-client rebuild. Only PR A touches `src/data` (V8), so only it needs `backend`. Durations come from `./boga timings` only (median `ios-ui-regression` 6.2m, `ios-groups-e2e` 3.8m). Run `./boga db reset` between `frontend` and anything backend-flavoured (known pollution).

## Acceptance criteria

1. No file under `app/completed-session/`, `app/group-session/`, `components/{view-session,session-complete,session-detail}/` or `components/groups/friend-session-content.tsx` imports `uiColors`, `uiRadius` or `UiButton`, and `SessionContentLayout` is gone. `ui-guardrails` stays at budget 0.
2. Every state in the gallery list is captured by a Maestro lane and was accepted by the user in a gallery iteration.
3. Every behaviour in "Kept exactly" still has a jest assertion. The V3/V4 behaviour changes each have one.
4. The lanes above are green, with evidence in each PR body per `.github/pull_request_template.md` (`./boga pr check`).
