# Design Language (Pending / planned)

> **Owns:** the visual and interaction language the mobile UI is moving to —
> colour roles, type, surfaces, and the patterns built from them.
> **Not here:** current shipped semantics → `ux-rules.md`; component inventory →
> `components-catalog.md`; design-source policy → `ai-design-policy.md`.
> **Load when:** building or reviewing any screen in the new language.

**Status: `Pending / planned`.** Approved direction, accepted 2026-09-21, not yet
implemented. The shipped app still uses the scales in
`apps/mobile/components/ui/tokens.ts` and the semantics in `ux-rules.md`. Each
build PR graduates part of this doc to `Current behavior` and updates the owning
doc in the same change.

Accepted target: `design-targets/exercise-session-v5.md`.

## 1. What the app is

Two modes, one language. **In-workout** is one-handed, mid-set, glanceable: one
obvious action, large figures, no decoration. **Out-of-workout** is exploratory:
dense, information-rich, scannable. The split is carried by *density and
emphasis*, never by a different visual vocabulary.

The voice is a brotherhood of geeks — the numbers are the point. Estimated 1RM,
volume and effort are shown wherever they are known, not hidden behind a detail
tap.

## 2. Colour roles

Semantic roles, not a palette. Every value below is used in the accepted target.

| Role | Value | Use |
| --- | --- | --- |
| `ink` | `#15181D` | primary text, chrome, performed values |
| `ink-muted` | `#6B6358` | secondary text, volume figures |
| `ink-faint` | `#9B948A` | mini legends, tertiary labels |
| `planned` | `#B3ABA0` | planned sets: text and projected figures |
| `disabled` | `#C4BDB0` | absent values, faintest labels |
| `paper` | `#F6F4EF` | page ground |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `surface-subtle` | `#FBF9F5` | in-card action strips (`+ Add set`) |
| `rule` | `#E2DCD0` | card borders |
| `rule-soft` | `#EFEAE0` | dividers inside a card |
| `rule-faint` | `#F3EFE6` | dividers inside a panel |
| `rule-strong` | `#DDD6C8` | segmented-control borders, sheet handle |
| `accent` | `#C2410C` | the one primary action on a screen |
| `accent-wash` | `#FDF6EE` | the row being edited |
| `record` | `#C2410C` | an all-time record value |
| `record-wash` / `record-rule` | `#FDF0E6` / `#F6E2D2` | record band on a card |
| `danger` | `#A4262C` | destructive actions only |

**Unresolved:** `accent` and `record` are the same hex. On one screen that makes
"your best lift ever" and "the button that ends the set" identical. Either
`record` moves (a gold or deeper rust), or the collision is accepted in writing
with a reason. Decide before the tokens PR; do not let the build settle it by
accident.

**Light only.** There are no dark variants, and `app.config.ts` pins
`userInterfaceStyle: "light"`. See `ux-rules.md` §9a.

## 3. Typography

| Family | Weights | Use |
| --- | --- | --- |
| Archivo | 600/700/800 | headings, control labels, set-type labels, buttons |
| Source Sans 3 | 400/600 | body and prose |
| IBM Plex Mono | 500/600/700 | **every number** |

Figures are monospaced so digits align down a column — the set list depends on
it. Uppercase micro-labels (8–10px, `letter-spacing` 0.06–0.12em, Archivo 700)
carry units and legends.

None of these are installed today: the app is system-font only. See the plan for
the dependency step.

## 4. Surfaces and layout

- Reference viewport 390×844. Page gutter 14. Cards: `surface`, 1px `rule`,
  radius 6.
- **No shadows.** Depth is a hairline and a ground-colour change, never an
  elevation ramp. `uiElevation` stays unused unless a screen proves it needs it.
- Sheets: bottom-anchored, radius 16 top corners, a 38×4 handle, dimmed
  backdrop. **Tap outside dismisses; sheets carry no Cancel button.**
- Tap targets ≥44. The iOS status bar and the tab tray are never redrawn in
  content.

## 5. Patterns

**One primary action per screen**, in `accent`. Everything else is an outline or
plain text button. A screen with two saturated buttons is a bug.

**Set row.** The unit of the whole feature:

```
[type 44] [weight × reps flex] [1RM · VOL stacked] [control 44]
```

Every row — performed, current, planned — ends in a 44px control column, so the
controls share one vertical axis. Metric pairs put a mini legend left of a
right-aligned fixed-width value.

**State lives in the control glyph:** filled check = performed
(`performanceStatus === null`), `accent` ring = current, dashed ring = planned.
Planned rows additionally use `planned` text.

**Emphasis is two-level and must not be mixed:** bold `ink` = best of *this
exercise today*; `record` = all-time record, plus a record band on the card.

## 6. Data rules

- **`1RM` everywhere**, never `e1RM`. Computed by `estimateOneRepMax`
  (Mayhew) in `apps/mobile/src/exercise-calculations/index.ts`.
- **No thousands separators.** `2560`, not `2 560`.
- **No unit suffix on inputs.** The weight field is labelled `Weight`; per-side
  exercises qualify the label, since `load_input_mode` is an
  `exercise_definitions` attribute and is edited via the exercise, not the set.
- **Warm-ups render identically to working sets**, including a real 1RM.
  They remain excluded from records and working-set stats by
  `isWorkingSetType` (`src/session-insights/calculations.ts`). This divergence
  between what is shown and what counts is deliberate and must be stated
  wherever records are explained.
- Planned sets show their projected 1RM and volume from
  `plannedWeightValue` / `plannedRepsValue` / `plannedSetType`.

## 7. Screen contracts

**Exercise page** — top bar (back to session · name · ⋮), collapsible
records panel (`Records` | `Last` selector and `History` link always visible),
one ordered set list with the current row expanded in place, `+ Add set`,
`Complete exercise`. The ⋮ sheet holds Edit / Swap / **Remove from session**.
Effort is a field that opens a picker sheet, defaulting to the planned
`setType`.

**Session view** — top bar (`Session` · ⋮ · **Finish**), summary card
(Time / Gym / Sets / Volume), one read-only card per exercise showing its sets
with emphasis and a record band, `+ Add exercise`. **No editing here**: the whole
card is a link into the exercise. Session ⋮ holds Abandon session.

**Planned vs ad-hoc is not a mode.** Rows below the cursor mean a plan is being
followed; none means ad-hoc. `Append plan` adds rows in either case.
