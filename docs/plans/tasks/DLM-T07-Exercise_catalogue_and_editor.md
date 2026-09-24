---
task_id: DLM-T07-Exercise_catalogue_and_editor
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/ui/design-targets/exercise-catalogue.md, apps/mobile/scripts/maestro-run-lane.sh + docs/specs/02 (if a flow is added to a lane)"
---

# DLM-T07 Exercise catalogue and the exercise editor

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T06. T14 depends on this card, since the group exercise form
  renders `ExerciseCoreFields`.
- Design target (G1): brief + gallery → extends
  `design-targets/exercise-catalogue.md`.
- Files: `app/(tabs)/exercise-catalog.tsx` (839),
  `components/exercise-catalog/exercise-editor-modal.tsx` (798),
  `components/exercise-core/exercise-core-fields.tsx` (144).
- **No screenshot covers any of these today** (measured). This card adds a flow
  (see Gallery).

## Today → becomes

### Catalogue (`/exercise-catalog`, a hidden tab reached from More or the picker's Manage)

| Today (line) | Becomes |
| --- | --- |
| `MoreHubBackButton` (T02); **no title** | T02's text back, then an in-content title "Exercises" (T07-D1) |
| Top row: filter input, **"+" filled `actionPrimary`** (:618), ⋮ outline "Exercise catalog options" | `SearchField` ("Filter by exercise or muscle group", a11y "Exercise filter input" kept), then `IconButton` `plus` in the **accent** tone as the screen's one primary (T07-D2), then `IconButton` ⋮ (label kept) |
| Always-on active-filter chips (≥3: Range, Grouped/Flat, Recents), blue-subtle | `Tag`s in a wrapping row; tapping one opens Filters (kept) |
| **Success feedback card** (`surfaceSuccess`, "Exercise created." etc., :675-700); error card (danger-subtle) | `Notice` + `circle-check` / `Notice tone="danger"`; copy kept |
| List (`ExerciseListContent`, T06) + a duplicate grouped-empty line (:371) | T06's list. The duplicate empty line is removed; `ExerciseListContent` already renders one |
| **Filters**: centred `Modal` (fade), header "Filters" + outline "Done" (a11y "Close filters"); preference controls; "MUSCLE GROUPS" + "Clear" link (`actionPrimary`) + blue muscle pills; "VISIBILITY" + "Show deleted" / "Show never-done" pills | A `Sheet` titled "Filters" (G5: no Done). The preference controls (T06), then a micro-label "Muscle groups" + a text `Clear` + `ChipGroup mode="multi"`, then "Visibility" + `ChipGroup mode="multi"` |
| **Exercise Actions**: centred `Modal` card "Exercise Actions" + name; outline Edit / Link to group exercise… / Undelete; **danger-subtle Delete, no confirm** | A `Sheet` titled with the exercise name, with `ListRow`s Edit / `Link to group exercise…` (`exercise-action-link-group` kept) / Undelete, and Delete as `tone="danger"` (still no confirm: behaviour stays; soft-delete is undoable) |
| Loading / error in a centred bordered card | `StatePanel` |

### Editor (`ExerciseEditorModal`: catalogue, picker ×2, exercise page, group exercises page)

| Today (line) | Becomes |
| --- | --- |
| `Modal` (slide, transparent) holding a **centred card at 80% height** in a `KeyboardAvoidingView`; backdrop "Dismiss exercise editor overlay"; **no Cancel** (asserted, `exercise-catalog-screen.test.tsx:199`) | A tall `Sheet` with `keyboardAvoiding` (T06's prop), title "Create Exercise" / "Edit Exercise" / the `title` prop, and backdrop dismiss (not while saving). `dismissLabel` kept. Still no Cancel |
| `ExerciseCoreFields`: name `TextInput` + error; load-mode 2-button row **blue-selected** (:133); helper | Name → `FormField` (`<prefix>-name-input` / `-name-error` kept). Load mode → `SegmentedControl` with `testIDPrefix="<prefix>-load-mode"`, so `<prefix>-load-mode-<mode>` and `selected` are kept. Helper `ink-muted` |
| "Primary muscle" dropdown trigger + chevron + error | A `ListRow` trigger ("Primary muscle" micro-label, the value, `chevron-right`), `exercise-editor-primary-muscle-trigger` kept |
| Secondary muscles: rows on `surfaceMuted`, each with a **filled red "Remove"** (:677) | `ListRow`s with a trailing `IconButton` `x` `tone="danger"`, labelled "Remove <muscle>" |
| "Add secondary muscle" (accent outline) | Outline `ActionButton` (`exercise-editor-secondary-muscle-trigger` kept) |
| **Save Exercise (primary)** | The sheet's one `accent` (T01's rule: one primary per sheet) |
| Nested muscle selector: an absolute card inside the same Modal at 80% height, title "Select primary muscle" / "Add secondary muscle", list `exercise-editor-muscle-selector-list` (`keyboardDismissMode` on-drag, asserted :285), options `-muscle-option-<id>`, **Done** (a11y "Close muscle link selector") | A panel swap inside the same `Sheet` (T07-D3): the title changes, a leading `IconButton` `chevron-left` "Back to exercise" returns, and the rows are `ListRow`s with `radio-on/off` (single) or a check (multi). The list testID and `keyboardDismissMode` are kept |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T07-D1 | The catalogue has no title | Add an in-content title **"Exercises"**, as the other tab-owned screens (Today, Train, More, Settings) have |
| T07-D2 | The screen's primary: a filled "+" icon today. (a) accent `IconButton` `plus`, labelled "New exercise"; (b) a full `ActionButton` "New exercise" row under the search | **(a).** It keeps the one-row header; the icon is familiar and labelled |
| **T07-D3** | The editor's nested muscle selector: (a) a panel swap in the same sheet with a back control; (b) a second `Sheet` stacked on the editor | **(a).** Sheet-on-sheet on iOS stacks two modals, and the selector's `Done` (which only closes) maps naturally to "back". Tap-outside would close the whole editor, so a back control is required |
| T07-D4 | Exercise delete has no confirmation | **Keep** (behaviour stays). Soft delete is undoable via Undelete |

## UX contract

- **Create an exercise.** Trigger: accent `+`. Steps: name → weight entry →
  primary muscle (selector panel, back) → optional secondary muscles → `Save
  Exercise`. Success: the sheet closes; "Exercise created." notice; the row
  appears. Edge: missing name or primary muscle, or duplicate secondaries, show
  inline errors; a save failure shows under Save.
- **Filter.** Trigger: ⋮ or a filter tag. Success: the Filters sheet applies
  changes live; the backdrop closes it.
- **Row actions.** Trigger: a row's ⋮. Success: the sheet's Edit / Link /
  Undelete / Delete. Edge: Delete marks it deleted and it hides unless "Show
  deleted".

## Gallery

**New flow** `exercise-catalogue.yaml` in the `ios-ui-regression` lane
(infra-free: `boga3://maestro-harness?reset=data&teleport=exercise-catalog`;
asserted UI, no screenshot-only steps):

- `catalogue-list-grouped`
- `catalogue-filters-sheet`
- `catalogue-list-flat`
- `catalogue-row-actions-sheet`
- `editor-create-empty`
- `editor-validation-errors` (Save with no name)
- `editor-muscle-selector`
- `editor-filled`
- `catalogue-created-notice`

Adding a scenario to `ui-regression` edits `maestro-run-lane.sh`, so update
`02`'s lane description if its wording lists the flows.

`groups-link-exercise.yaml` (`ios-groups-e2e`) taps "Close filters". Under G5
that becomes a backdrop tap by point, since the backdrop is hidden from
accessibility on iOS 26. **Change the flow**, and re-verify `groups-link-01..03`.

## Tests

- `exercise-catalog-screen.test.tsx`: "Close filters" (:364) becomes the
  `Sheet`'s `dismissLabel`, keeping the label so the query survives. The
  no-Cancel assertion (:199) holds; "Filters" and "Exercise Actions" titles
  change to "Filters" and the exercise name (update :findByText). The feedback
  copy is kept.
- `exercise-catalog-link-menu.test.tsx`: same.
- `groups-exercise-screens.test.tsx:489,799` (load-mode `selected`): kept by
  the `SegmentedControl` contract.
- `exercise-page-screen`, `exercise-picker`: green.

## Docs

- `screen-map.md` 5 (`/exercise-catalog`), `components-catalog.md` specialized 4
  (`ExerciseEditorModal`: a `Sheet` with a selector panel) and 12
  (`ExerciseCoreFields`), `ux-rules.md` §2 and §5 (the editor's selector),
  `design-targets/exercise-catalogue.md`.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the three files.
2. The new flow is green and asserted; `groups-link-exercise` green after the
   "Close filters" change.
3. Gallery accepted.
4. Estimate: about 1,400 lines, flow included.
