---
task_id: DLM-T14-Group_exercises_and_linking
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/08-ux-delivery-standard.md (pattern 10), docs/specs/ui/design-targets/{groups,group-exercise-unlink}.md (+ its PNGs)"
---

# DLM-T14 Group exercises and linking

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T11 and T07 (`ExerciseCoreFields`). The last of T13/T14 deletes
  `groupFormStyles`.
- Design target: extends `design-targets/groups.md`, and supersedes the
  appearance half of `design-targets/group-exercise-unlink.md` (T14-D4).
- Files (1,667 lines):
  - `app/group/[groupId]/exercises/{new,[exerciseId]/edit}.tsx`;
  - `app/exercise-link.tsx`;
  - `components/groups/{group-exercises-page,group-exercise-row,group-exercise-form,group-exercise-unlink-sheet,standard-exercise-picker,group-exercise-pick-sheet}.tsx`.
  - (`picker-group-section` is T06's.)

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| `GroupExercisesPage`: feedback notice (**success**: archive, link, add-as-new, unlink); links-failed notice + "Retry reading links"; empty state (with Add); **Add exercise (primary)** + a `UiSurface` list of `GroupExerciseRow`; four overlays | `Notice`s (G3). `Add exercise` becomes **outline** in the section header (T13-D1). One `Card` of rows. Overlays per below |
| `GroupExerciseRow`: name, mode, link status ("Linked: …" / "Not linked", text only), an **Archived pill**, chevron (owner/admin), "Unlink…" (**danger**) and "Link your exercise" (secondary), each 44pt | A `ListRow`: name Archivo 600, mode + status `ink-muted`, `Tag` "Archived", chevron when actionable; "Unlink…" a text `tone="danger"` button, "Link your exercise" outline. **The accessibility labels are kept exactly**: Maestro taps rows by label ("Sled Push, Per side, Not linked", "Link your exercise to …", "Unlink Bench, Total load, Linked: …") |
| **Add exercise** (`exercises/new`): `SegmentedChips` joined "From catalogue" / "Custom" (`group-exercise-source`); `StandardExercisePicker`: label, search, rows (**selected = blue border and wash**, :89-92), "Showing N of M"; `GroupExerciseForm` | `SegmentedControl` (`group-exercise-source-row` / `-custom` kept). The picker becomes a `SearchField` + one `Card` of `ListRow`s, the selected row marked by `radio-on` in `ink` (no wash, as the gym sheet does); `selected` state kept. The form below |
| `GroupExerciseForm`: card, note, `ExerciseCoreFields` (T07), notice, **submit (primary)** | A `Card`: note `ink-muted`, the T07 fields, `Notice`, submit `accent` (`group-exercise-form-*` kept) |
| **`GroupExercisePickSheet`** (also used by T06's picker): RN `Modal` (slide), scrim with no testID, card `group-pick-sheet`; title, prompt; radio rows with **blue radio and blue selected row** (:259, :313-316); search and choices (unavailable greyed); notes; error; **confirm (primary)**; **Cancel `group-pick-sheet-cancel`** | A `Sheet` (G5) titled like today: `ListRow`s with `radio-on`/`radio-off` in `ink`; unavailable choices `ink-faint` with their reason; notes `ink-muted`; `Notice tone="danger"`; confirm the sheet's `accent`. **No Cancel.** testIDs kept (`group-pick-sheet`, `-option-*`, `-choice-<id>`, `-confirm`) |
| **`GroupExerciseUnlinkSheet`**: RN `Modal` (`group-unlink-modal`), relying on **iOS `Modal.onDismiss`** so the native Alert opens only after the sheet has gone (:20-27); panel `group-unlink-chooser`; rows + "Unlink" (danger); **Cancel `group-unlink-cancel`** | A `Sheet` that gains **`onDismissed`** (fired from the iOS `Modal.onDismiss`, and immediately on Android: the same sequencing, now in the primitive, G5). Rows are `ListRow`s with a trailing text `tone="danger"` "Unlink". **No Cancel.** `group-unlink-chooser` and `group-unlink-choice-*` kept. The native Alert ("Cancel" / "Unlink") is unchanged, and Maestro taps it by text |
| **Link screen** (`exercise-link.tsx`): offline banner; **notice as bare green / red text** (:156-162, :332-337); inline error; links error + Retry; "Linked" section rows (name · group, status, load note, **Unlink danger**); state panels; search; "Suggested" / "All group exercises" sections, rows with **Link (secondary)**; empty text. No primary | `Notice`s (neutral + `circle-check` / `danger`) in place of the bare coloured text. Section micro-labels. `Card`s of `ListRow`s: Unlink text `tone="danger"`, Link outline. `SearchField`. `StatePanel`s. testIDs kept (`exercise-link-link-*`, `-unlink-*`, `-linked-row-*`) |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T14-D1 | The pick and unlink sheets lose Cancel (G5) | Yes. Jest: `exercise-picker.test.tsx:399` (`group-pick-sheet-cancel`) and `groups-exercise-screens.test.tsx:940` (`group-unlink-cancel`) → press `-backdrop`. No Maestro flow uses either (measured) |
| T14-D2 | The unlink chooser's dismiss-then-alert sequencing | **Move it into `Sheet` as `onDismissed`** so any sheet can hand off to a native alert. `groups-exercise-screens.test.tsx:868` reads `onDismiss` from the Modal found by `group-unlink-modal`: keep that testID on the `Sheet`'s `Modal` and assert through `onDismissed` |
| T14-D3 | A primary inside the pick sheet while the host screen has its own | Allowed: one per sheet (G6) |
| **T14-D4** | `design-targets/group-exercise-unlink.md` pins appearance to "production styling at `53b2a0f1`", with committed PNGs (baseline, chooser, confirmation, success, offline; small and large) | **Keep its behaviour brief and replace its appearance**: point it at `groups.md` for appearance, and **delete its PNGs** (they show the retired look and would mislead). The new accepted captures are recorded in `groups.md`. The alternative (re-capture both device sizes and commit them) keeps the two-device evidence if you value it |

## UX contract

- **Add a group exercise** (owner/admin). Trigger: `Add exercise`. Steps: From
  catalogue (search, pick) or Custom → name, weight entry → submit. Success:
  the row appears with a notice. Edge: validation inline; offline refused.
- **Link your exercise.** Trigger: `Link your exercise`. Success: the pick
  sheet, radio choice, `Link` → "Linked: …". Edge: already-linked choices are
  disabled with the reason.
- **Unlink.** Trigger: `Unlink…`. One link confirms natively; several open the
  chooser sheet, which dismisses before the confirm. Success: the notice and
  "Not linked". Edge: failure keeps the link and allows a retry (`ux-rules`
  §14.11).
- **Link screen** (from an exercise's ⋮). Success: link or unlink per row with
  notices. Edge: deleted exercise, offline, error panels.

## Gallery

- `groups-two-user-stream`: `groups-04b-1-exercises-added`,
  `04b-2-pick-sheet-link-only`, `04b-3-exercise-linked-renamed-archived`,
  `unlink-01-linked-row`, `unlink-02-chooser`, `unlink-03-confirmation` (native
  Alert over the restyled screen), `unlink-04-success`,
  `unlink-05-preserved-record`.
- `groups-link-exercise`: `groups-link-01-link-screen`, `-02-linked`,
  `-06-exercise-page-link-screen`.
- **New:** `groups-add-exercise-catalogue` at `group-standard-exercise-search`
  (:189) and `groups-add-exercise-custom` after `group-exercise-source-custom`
  (:211).

## Tests

- `groups-exercise-screens.test.tsx`: :489, :799 (load-mode `selected`) kept;
  :662, :704 (radio `checked`) kept; :756 (`disabled`) kept; :371, :588
  (`group-exercise-source-row`) kept; :868 (T14-D2); :940 (T14-D1).
- `groups-exercise-link-screen.test.tsx`: notice copy kept.
- `exercise-picker.test.tsx:394,399`: T14-D1.
- `ui-design-primitives.test.tsx`: `Sheet`'s `onDismissed` fires after the
  modal's `onDismiss` on iOS and at once on Android.

## Docs

- `screen-map.md` 20 (`/exercise-link`) and the group exercise routes.
- `ux-rules.md` §14.11 (sheets without Cancel; the wording otherwise kept).
- `08` pattern 10 (the picker's pick sheet).
- `components-catalog.md` (`GroupExercisesPage`, `GroupExerciseRow`,
  `GroupExerciseUnlinkSheet`, `GroupExerciseForm`, `StandardExercisePicker`,
  `GroupExercisePickSheet`; `Sheet`'s `onDismissed`).
- `design-targets/{groups,group-exercise-unlink}.md` (T14-D4).

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the listed files. `groupFormStyles` is deleted if
   T13 has landed.
2. The unlink sequencing works on device (`unlink-02` → `unlink-03`).
3. Gallery accepted. The unlink target is updated per T14-D4.
4. Estimate: about 1,400 lines.
