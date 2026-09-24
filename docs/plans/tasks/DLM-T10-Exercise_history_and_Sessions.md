---
task_id: DLM-T10-Exercise_history_and_Sessions
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog,navigation-contract}.md, docs/specs/ui/design-targets/progress.md"
---

# DLM-T10 Exercise history and Sessions

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T09. Goes last in the Progress chain (G10).
- Design target: extends `design-targets/progress.md`.
- Files: `app/exercise-history.tsx` (790), `app/sessions.tsx` (194),
  `components/session-list/{history-list,active-session-row}.tsx` (518 + 181).
- **PR #336** (bozothegrey) edits `app/sessions.tsx` and History→Summary
  routing. If it has merged, restyle its result. If it is still open, restyle
  only (no structural change to `sessions.tsx`) and tell its author about the
  overlap. Never build on its branch.

## Today → becomes

### Exercise history (`/exercise-history`, opened from the exercise page's `History`)

| Today (EH line) | Becomes |
| --- | --- |
| Period chips, hand-rolled blue pills "Last 7 days / Last 30 days / All time" (:97-115) | `SegmentedControl` (testIDs kept) |
| Tag chips, a horizontal row "All tags" + "`name · count`"; **a deleted tag in warning colours** (:117-146, :239-271) | `ChipGroup mode="single"` in a horizontal scroll. A deleted tag reads "`name (deleted)`" (`ux-rules` §10.2 wording) as a faint chip, not warning |
| **Deleted-exercise warning banner** (:167-173) | `Notice` + `triangle-alert` (copy "has been deleted" kept; asserted :370) |
| `BestCard` "All-time bests": `BestRow`s "**Est. 1RM**" and "Top weight" + date, pressable → View Session | A `Card` of two `ListRow` links. **The best figures in `record`** (T10-D2), labels "1RM" (G7) and "Top weight", dates in Plex Mono |
| `SessionCard`s: date + gym, tag chips, four metrics "**Est 1RM**" / "Top set" / "Volume" / "W/sets", then a **Type / Set / Weight / Reps table**; type badge accent or **warning (warm-up)**; non-working rows on `surfaceMuted` | **`ExerciseSetsCard` + `SetSummaryRow`** (T10-D1): header date · gym, a row of stacked `Stat`s (1RM, Top set, Vol, W/sets), then the set rows `type · weight × reps · 1RM · VOL`, with warm-ups presented like working sets (`design-language` §6). The card is a link to View Session. Tag chips become `Tag`s under the header |
| States: "Could not load history", "Loading exercise history…", "No sessions in this view" | `StatePanel`, copy kept |
| `formatNumeric` 1 decimal, no `k`; `185 × 8` | Figures via `formatWeightFigure` / `formatOneRepMaxFigure` / `formatVolumeFigure` (`session-view-model`), so History reads like the session view. Asserted `185 × 8` / `W-Up` / `2026-05-18` stay true |
| `MainTabs` strip at the bottom (Progress selected) | Kept, restyled by T02 |

### Sessions (`/sessions`) and its rows

| Today (line) | Becomes |
| --- | --- |
| Native header "Sessions" (T02); a raw `Text` "Active" heading + `ActiveSessionRow` | `ScreenScroll`; a micro-label "Active" |
| `ActiveSessionRow`: a **green** row; a 28pt **green check** "complete" button; a 28pt kebab; a centred `Modal` (fade) with one danger-subtle "Delete" that **discards immediately, no confirm** | A `Card` with `ListRow` (the `set-current` glyph, `SessionSummaryLine` from T03), then `IconButton`s (44pt) `check` "Review and complete active session" and ⋮. The menu becomes a `Sheet` with one `ListRow tone="danger"` "Delete" (still no confirm: behaviour stays, T10-D4). testIDs kept: `active-session-row-<id>`, `resume-active-session-button`, `complete-active-session-button`, `active-session-menu-button`, `discard-active-session-button` |
| `HistoryList`: a "History" heading + "Show deleted / Hide deleted" pill toggle (no `accessibilityState`) | A micro-label "History" + a text `ActionButton` "Show deleted" / "Hide deleted" with `accessibilityState.checked` (T10-D5). `toggle-deleted-sessions-button` kept |
| Rows `completed-session-row-<id>`: open + 28pt kebab; **deleted rows marked only by a danger-subtle fill** (:401-405) | A `Card` of `ListRow`s (summary line + ⋮ `IconButton`). A deleted row is faded + `Tag` "Deleted" (text, not colour: `08` baseline 5) |
| Menu: a centred `Modal`, three buttons in a row: Edit / **"Append"** (testID `-reopen-`) / Delete (danger-subtle, **no confirm**) or Undelete | A `Sheet` titled with the session's date: `ListRow`s Edit, Append, Delete (`tone="danger"`) or Undelete. testIDs kept (`completed-session-edit-menu-action-button`, `completed-session-reopen-menu-action-button`, `completed-session-modal-action-button`) |
| States: "Loading sessions..." (ASCII dots); error **with no title and no Retry**; "No completed sessions" and "No sessions yet" can stack | `StatePanel`s: "Loading sessions…"; the error gains `Retry` (T10-D6); empties unchanged |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| **T10-D1** | Exercise history's session cards: keep the Type / Set / Weight / Reps table, or use View Session's card and row (`type · weight × reps · 1RM · VOL`, no set-number column)? | **View Session's card and row.** It is one presentation of a set across the app, and it adds per-set 1RM and VOL. The set-number column goes, as it did on View Session (V-precedent). EH tests keep passing on `185 × 8` and `W-Up` |
| T10-D2 | All-time bests in `record` (brass bold)? `design-language` §5 reserves `record` for all-time bests | **Yes**, it is exactly that meaning |
| T10-D3 | "Est. 1RM" / "Est 1RM" → "1RM" (G7) | Yes |
| T10-D4 | Active and completed session Delete: no confirmation today | **Keep** (behaviour stays). Completed delete is undoable; active discard is not, **so active discard gains an `Alert.alert` confirm** (`08` pattern 3; destructive style, "Cancel" / "Discard"). **Decided 2026-09-24: add it.** |
| T10-D5 | The Show/Hide deleted pill | A text button with `checked` state. It is a view toggle, not a filter group |
| T10-D6 | Sessions' error has no Retry (Today and Train have one); "Loading sessions..." uses ASCII dots | Unify the ellipsis. **Decided 2026-09-24: add a `Retry`** (outline) to the Sessions error `StatePanel`, reloading through the same data hook as focus |

## UX contract

- **Browse an exercise's history.** Trigger: `History` on the exercise page.
  Steps: period → tag. Success: the bests card (brass figures) and one set card
  per session; tapping either opens View Session. Edge: no sessions in view
  shows the tag-aware empty copy; a deleted exercise shows the notice.
- **Manage sessions.** Trigger: a row's ⋮. Success: the sheet's Edit / Append /
  Delete or Undelete. Deleted rows show when toggled, with a "Deleted" tag.
  Edge: a write failure shows in place.
- **Active session.** Resume (row), complete (check), or ⋮ → Delete → confirm (T10-D4). Edge: Cancel in the confirm keeps the session.

## Gallery

- Sessions: `04-data-runtime-smoke-success`,
  `20-first-run-roundtrip-restored-from-remote`. **New** in `data-runtime-smoke`
  after `completed-history-scroll`: `sessions-row-menu` (⋮ → the sheet, assert
  `completed-session-edit-menu-action-button`, dismiss by backdrop point).
- **Exercise history has no coverage.** New steps in `exercise-page.yaml`
  (`ios-exercise-page`): tap the records panel's `History`, assert
  `exercise-history-screen` (add the testID if missing), capture
  `exercise-history-default` and `exercise-history-30-days`, then back. The
  fixture's history sessions supply the cards; add a second session with a
  warm-up if the fixture lacks one.

## Tests

- `exercise-history-screen.test.tsx`: :135-138 (`230`, `185 × 8`, `2026-05-18`,
  `W-Up`) hold under T10-D1; :370/:388 ("has been deleted", "deleted") are
  kept. Add: bests in `record`.
- `sessions-screen.test.tsx`: testIDs and labels are unchanged. Add: a deleted
  row carries the "Deleted" tag; active discard confirms first (spy
  `Alert.alert`, destructive button) and Cancel keeps the session; the error
  state's `Retry` reloads.

## Docs

- `screen-map.md` 9 (`/sessions`) and 11 (`/exercise-history`).
- `components-catalog.md` specialized 8 and 9 (`ActiveSessionRow`,
  `HistoryList`: sheets).
- `ux-rules.md` §10.2 (tag chips) and §13.
- `design-targets/progress.md`. Remove "History is stale" from
  `exercise-session-v5.md`'s conflict 3.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the four files.
2. Exercise history is captured by a lane.
3. Gallery accepted.
4. Estimate: about 1,300 lines.
