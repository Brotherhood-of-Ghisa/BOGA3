---
task_id: DLM-T01-Foundation_primitives_and_tokens
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes (no visible change intended)"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{components-catalog,design-language,ux-rules}.md"
---

# DLM-T01 Foundation: design-language primitives and tokens

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: nothing. Every later card depends on this one.
- Design target: none. There is no visible change; the proof is identical before
  and after captures of the design-language lanes.

## Objective

Build the primitives that the remaining screens need, extracting them from the
design-language screens where they are already written out. Rebuild those
screens on the primitives with no visible change. Retire what nothing uses:
`uiElevation`, and `uiRadius.full` in the design-language files.

## Scope

In:

1. **Tokens** (`components/ui/tokens.ts`):
   - add `uiGeometry.radius.pill: 999`, and switch `ui/sheet.tsx:81`,
     `exercise-page/set-logger.tsx:208` and
     `session-complete/exercise-volume-card.tsx:253-312` to it;
   - delete `uiElevation`, `UiElevationToken` and `uiTokens.elevation`, plus
     `UiSurface`'s `elevation` prop (`surface.tsx`). Measured: no caller passes
     it, and no screen or component references `shadow*`;
   - `Icon`'s default colour becomes `uiRoles.ink` (`icon.tsx:5,12`), and the
     doc comment drops "`uiColors.*` on shipped screens".
2. **Primitives** (`components/ui/`, exported from `index.ts`; see the plan's
   "Primitives" table for sources and consumers):
   - `IconButton`: 44pt square; `name`, `accessibilityLabel` and `onPress`
     required; `tone` `default` / `muted` / `danger`; optional `size`;
     `disabled`.
   - `StatePanel`: `kind` `loading` / `message` / `error`; `title?`, `body`, an
     optional `action` (`{ label, onPress, testID }`, drawn as an outline
     `ActionButton`); centred on `paper` (`fill`) or inline inside a `Card`.
   - `Screen` and `ScreenScroll`: `paper` ground, the `uiSpace.md` gutter the
     session view uses, safe-area aware, optional `refreshControl` (for the
     groups screens' pull-to-refresh).
   - `FormField`: micro-label above a `TextInput` at `fieldHeight`, with
     `radius.control`, `ruleStrong`, `danger` while invalid, the error text
     below, an optional hint or counter (`n/280`), and `multiline`. It passes
     through `testID`, `accessibilityLabel` and `placeholder`
     (`placeholderTextColor` `inkFaint`).
   - `SearchField`: the swap sheet's search input with a leading search glyph
     and a clear `IconButton` when not empty. `accessibilityLabel` is required,
     because Maestro types into "Exercise filter input".
   - `SegmentedControl<T>`: a joined, equal-width selector with the same API
     and testID contract as `SegmentedChips` (`options`, `value`, `onChange`,
     `testIDPrefix` → `<prefix>-row`, `<prefix>-<value>`, `tablist` / `tab`,
     `selected`), so callers swap by name.
   - `ChipGroup<T>`: wrapping pills, `mode` `single` / `multi`, the same testID
     contract, `accessibilityState.selected` (single) or `checked` (multi), and
     optional per-chip `accessibilityLabel`. The labels matter: Maestro taps
     "Turn grouping off".
   - `Tag`: a static pill (`rule` hairline, `ink-muted` Archivo micro-label,
     `radius.pill`), `tone` `neutral` / `faint`.
   - `Notice`: a band on `surface-subtle` with a `rule` hairline, an optional
     leading `Icon`, and body text. `tone` `neutral` / `danger` (danger adds
     `accessibilityRole="alert"`); `live` sets `accessibilityLiveRegion`. G3:
     no success or warning hues.
   - `Icon` gains `wifi-off`, `circle-check`, `triangle-alert`, `search`
     and `list` from the same Lucide release (1.47.0) (`plus`, `x` and `check`
     already exist), and
     `LICENSE.lucide` is unchanged.
3. **Rebuild on the primitives, with no visible change:**
   - `session-top-bar`, `exercise-top-bar`, `view-session-top-bar` and
     `view-session-screen`'s ⋮ → `IconButton`;
   - the load / error / not-found states of `app/session/[sessionId]/index.tsx`,
     `exercise-page-screen` and `app/completed-session/[sessionId].tsx` →
     `StatePanel`;
   - `session-times-fields` and `gym-editor`'s name → `FormField`;
   - `exercise-swap-sheet`'s search → `SearchField`;
   - `records-panel`'s selector → `SegmentedControl`;
   - the session view's notice → `Notice`;
   - the five DL screens' page shells → `Screen` / `ScreenScroll`.
   - **The logger's figure fields (`set-logger`) stay as they are**: they are a
     different recipe (a large mono figure under the label).

Out:

- any legacy screen. The legacy primitives stay until T15.
- `Sheet` changes. Each is added by the card that needs it (G5).

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T01-D1 | Build `ChipGroup`, `Tag` and `Notice` before a design-language screen uses them? The extraction rule wants two consumers; here they are legacy screens (the plan table) | **Yes.** Each has three or more measured consumers, and building them once stops each card inventing its own. Their look is accepted in their first consumer's gallery (T04, T06 or T11), not here |
| T01-D2 | `StatePanel` action: outline, or primary when it is the only thing on screen? | **Outline** always. A retry or "Open Train" is never the screen's primary (G6) |

## UX contract

- **No change.** Trigger: any of the five design-language screens. Success:
  pixel-identical captures before and after. Edge: an intentional difference,
  such as the `Icon` default moving from `#122033` to `#15181D` on a legacy
  screen that relies on the default, is listed in the PR with its capture.

## Gallery (information only; there are no new states to accept)

Before and after pairs for: `ios-session-view` (`01-session-view` …
`04-session-view-finished`), `ios-exercise-page` (the V5 captures),
`ios-ui-regression`'s `view-session-*` and `session-completion-*`, and
`groups-07-friend-view-read-only`.

## Tests

- `ui-design-primitives.test.tsx`: one describe per new primitive. Each covers
  the testID contract, accessibility roles and state, `onChange` not firing on
  the selected option, the `danger` alert role, the placeholder colour and
  `radius.pill`.
- `ui-design-tokens.test.ts`: `uiGeometry` gains `radius.pill`. Assert
  `uiElevation` is not exported (`import * as tokens`).
- `ui-icon.test.tsx`: new glyph names render.
- `session-view-screen`, `exercise-page-screen`,
  `completed-session-detail-screen`, `gyms-screen`: unchanged, and must stay
  green (testIDs kept).

## Docs

- `components-catalog.md`: add the nine primitives under "Design-language
  primitives". Move `IconActionButton` (built as `IconButton`), `EmptyState` /
  state panels (built as `StatePanel`), `ScreenContainer` (built as `Screen`)
  and `FormField` out of "Pending / planned". Remove `UiSurface`'s elevation
  bullet.
- `design-language.md` §4: drop "`uiElevation` stays unused unless a screen
  proves it needs it" (it is gone), and add `radius.pill`.
- `ux-rules.md` §9a.6 (elevation) is deleted; §9c.3's icon default names
  `ink`.

## Gates

`./boga test fast` + `./boga test frontend` (`./boga test for`: "UI
components").

## Acceptance

1. `uiElevation` has no references. `grep -rn 'uiRadius' components/{ui/sheet,exercise-page,session-complete}`
   is empty.
2. The nine primitives exist with jest coverage, and the five DL screens use
   `IconButton` / `StatePanel` / `FormField` / `SearchField` / `SegmentedControl`
   / `Notice` / `Screen` where listed.
3. The DL lanes' captures match before and after, apart from any intentional
   difference listed in the PR.
4. Estimate: about 1,400 added or modified lines. Split `ChipGroup` / `Tag` /
   `Notice` into a follow-up if the diff passes 2,000.
