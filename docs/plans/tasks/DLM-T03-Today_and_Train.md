---
task_id: DLM-T03-Today_and_Train
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/08-ux-delivery-standard.md (if a pattern changes), docs/specs/ui/design-targets/today-train.md (new)"
---

# DLM-T03 Today and Train

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02.
- Design target (G1): brief + gallery → `design-targets/today-train.md`.
  **Artboards are offered as the alternative**, because Today's composition
  (training slot, group activity, recents) has no design-language precedent.
- Files: `app/(tabs)/today.tsx` (617), `app/(tabs)/train.tsx` (369),
  `components/session-list/session-summary-line.tsx` (153).

## Objective

Move the two home tabs onto the design language. Behaviour is unchanged except
where a decision below says so.

## Today → becomes

### Today (`today.tsx`)

| Today (line) | Becomes |
| --- | --- |
| In-content title "Today" (`xxl`) + intro, `surfacePage` ground | `ScreenScroll`; the title in Archivo 800 at `xxl` and the intro in `ink-muted` Source Sans |
| Training section: an active card (**green `surfaceSuccess`/`borderSuccess` = active**, :582-585) with "Active session" + `SessionSummaryLine` + **Resume (primary)** | A `Card`: heading "Workout in progress" with the `set-current` glyph (the design-language mark for "current", as on the group session view), the summary line, and `Resume workout` as the screen's `accent` primary. No green (G3) |
| `TodayPlanCard` states: loading, error + Retry / "Open Train", unavailable "Watch this space 👀", empty; the `Start planned workout` primary | `StatePanel` inside a `Card`, with the copy (and the 👀) unchanged. `Start planned workout` stays the primary only when there is no active workout, so there is one primary either way |
| Social: header "Group activity" + secondary "View groups"; offline banner, inline error, missing-data, empty, and up to 3 stream cards (`components/groups/*`) | Section header: a micro-label plus a text `ActionButton` "View groups". **The group components stay as they are here**; T11 restyles them, and Today's `groups-07c-0-today-record` changes then. The social *auth-unavailable* and *signed-out* panels, which are Today's own `GroupStateView` calls (:238, :249), become `StatePanel` here |
| Recents: header "Recent sessions" + secondary "View progress"; up to 3 pressable `UiSurface` rows (summary + chevron); loading / error + Retry / empty + "Open Train" | Section header as above. One `Card` of `ListRow density="list"` rows, each the summary line plus a `chevron-right`, pressable as a row. States use `StatePanel`. testIDs `today-recent-session-<id>` are kept |
| Launch error text in `actionDangerText` (:615) | `danger` text below the button (`Notice tone="danger"` if multi-line) |

### Train (`train.tsx`)

| Today (line) | Becomes |
| --- | --- |
| Title "Train" + intro | As Today |
| Loading / error + Retry (`GroupStateView`, :123) | `StatePanel` |
| Active: green card "Continue your active session" + summary + note + **Resume (primary)** | The Today active card recipe (`set-current`, `Card`, `Resume workout` `accent`) |
| Start: card "Empty workout" + **Start empty (primary)**; Planning: `TrainPlanningCard` with **Start planned (primary)** + "Manage planning" (secondary); unavailable / empty `GroupStateView`s (:242-267) | See **T03-D1** for the primaries. The planning panels become `StatePanel` (copy and the 👀 kept; `train-manage-planning-button` is kept on both uses) |

### `SessionSummaryLine` (Today, Train, and the Sessions / History rows)

| Today | Becomes |
| --- | --- |
| Row 1: start (`textAccentStrong` navy), duration, `@ gym`; row 2: sets • exercises in `textSecondary`; `•` in `textDisabled`; `tabular-nums` system font | Row 1: the start in Plex Mono 500 `ink`, duration mono, gym Source Sans `ink`. Row 2 in `ink-muted`; `·` separators in `ink-faint`. **The wording is unchanged**: Maestro asserts "1 exercise". testIDs `<prefix>-start|-duration|-gym|-sets|-exercises` are kept. Consumers outside this card (Sessions, `HistoryList`) change with it; T10 restyles the rest of those screens |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| **T03-D1** | **Train shows two primaries** when idle and a plan is ready (`train.tsx:183` + `:297`). Measured: the route defaults `planningState` to `unavailable` (:318), so only tests reach it today | `Start planned workout` is the primary when a plan is ready, and `Start empty workout` becomes `outline`. With no ready plan, `Start empty` is the primary |
| T03-D2 | The active-workout signal: green today. Options: (a) `set-current` glyph + words on a neutral `Card`; (b) an `accent-wash` card | **(a).** `accent-wash` means "the row being edited" (`design-language` §2); the ring already means "current" |
| T03-D3 | Section-header links ("View groups", "View progress") are secondary buttons today | Text `ActionButton`s (caps label). They are navigation, not actions |
| T03-D4 | Recents as one card of rows, or a card per row? | **One `Card` of `ListRow`s**, as Gyms does |

## UX contract

- **Resume from Today or Train.** Trigger: `Resume workout`. Success: the
  session view opens. Edge: none new.
- **Start a workout.** Trigger: `Start empty workout` (Train) or
  `Start planned workout`. Success: the session view opens; "Starting…" shows
  meanwhile. Edge: a launch failure shows in `danger` under the button.
- **Open a recent session.** Trigger: a recents row. Success: View Session.
  Edge: loading, error + Retry, and empty + "Open Train" show in place.
- **Planning states.** Unavailable, empty, error: `StatePanel`s with their
  current copy.

## Gallery

States with their flows:

- Today, idle: `01-m26-today` (smoke).
- Today with an active workout: **new** step in `smoke-launch` after
  `train-start-empty-button`. Return to Today and capture
  `today-active-workout`, asserting `today-active-session-card`.
- Today recents with sessions: `17-first-run-roundtrip-bootstrapped` (sync
  e2e), plus **new** `today-recents` in `session-view.yaml` after `Done` (tap
  `top-level-tab-today`, assert `today-recents-section`).
- Train idle: `02-m26-train`.
- Train active: **new** `train-active-workout` in `session-view.yaml` at its
  `train-resume-session-button` step.
- Train after abandon: `02-abandoned-back-on-train`.
- Planning unavailable: in `02-m26-train`.
- Error and empty panels: jest only (the harness has no seam that fails the
  repository). Listed so the gallery is honest about it.

## Tests

- `today-screen.test.tsx`, `train-screen.test.tsx`: behaviour assertions are
  unchanged ("Watch this space 👀", "Starting…", testIDs). Add: Train with a
  ready plan has exactly one `accent` button (T03-D1), and the active card
  renders the `set-current` glyph.
- `index.test.tsx`, `main-tabs.test.tsx`: unchanged.

## Docs

- `screen-map.md` 1b (`/today`) and the Train entry: the active signal, the
  primaries, and the section headers.
- `ux-rules.md` §1.1: the examples list `Start Session`; align it with the
  current labels (`Start empty workout`, `Resume workout`).
- `components-catalog.md` specialized 7 (`SessionSummaryLine`): mono figures.
- `design-targets/today-train.md`: new.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in `today.tsx`, `train.tsx` or
   `session-summary-line.tsx`. Today's group section still imports
   `components/groups` (T11).
2. At most one `accent` button on either screen in every state (jest).
3. Gallery accepted and recorded.
4. Estimate: about 1,100 lines.
