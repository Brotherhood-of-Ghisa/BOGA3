# Design Language

> **Owns:** the visual and interaction language of the mobile UI — colour roles,
> type, surface rules, emphasis, and how data is presented. Screen-agnostic.
> **Not here:** how a particular screen is laid out → `screen-map.md` /
> `ux-rules.md` (§14a/§14b for the session screens); component inventory →
> `components-catalog.md`; design-source policy → `ai-design-policy.md`.
> **Load when:** building or reviewing any screen.

**Status: `Current behavior` for the screens that use it; the direction for
the rest.** Accepted 2026-09-21. The session view, exercise page, Gyms screen,
View Session (detail and completion) and the group session view are built in
it (`uiRoles` / `uiFonts` / `uiGeometry` and the primitives in
`components-catalog.md`). Every other screen still uses the legacy scales in
`apps/mobile/components/ui/tokens.ts` (`uiColors`, `uiRadius`) and the semantics
in `ux-rules.md`; moving them is an app-wide migration, screen by screen.

First accepted target: `design-targets/exercise-session-v5.md`.

## 1. What the app is

Two modes, one language. **In-workout** is one-handed, mid-set, glanceable: one
obvious action, large figures, no decoration. **Out-of-workout** is exploratory:
dense, information-rich, scannable. The split is carried by *density and
emphasis*, never by a different visual vocabulary.

The voice is a brotherhood of geeks — the numbers are the point. Estimated 1RM,
volume and effort are shown wherever they are known, not hidden behind a detail
tap.

## 2. Colour roles

Semantic roles, not a palette. A screen names the role, never the hex.

| Role | Value | Use |
| --- | --- | --- |
| `ink` | `#15181D` | primary text, chrome, realised values |
| `ink-muted` | `#6B6358` | secondary text |
| `ink-faint` | `#9B948A` | mini legends, tertiary labels, not-yet-realised values |
| `planned` | `#B3ABA0` | legends of not-yet-realised values |
| `disabled` | `#C4BDB0` | absent values, faintest labels |
| `paper` | `#F6F4EF` | page ground |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `surface-subtle` | `#FBF9F5` | action strips inside a card |
| `rule` | `#E2DCD0` | card borders |
| `rule-soft` | `#EFEAE0` | dividers inside a card |
| `rule-faint` | `#F3EFE6` | dividers inside a panel |
| `rule-strong` | `#DDD6C8` | control borders, sheet handle |
| `accent` | `#C2410C` | the one primary action on a screen |
| `accent-wash` | `#FDF6EE` | the row or field being edited |
| `record` | `#8A6516` | an all-time best value |
| `record-wash` / `record-rule` | `#FBF3E2` / `#EEDFBE` | a band announcing a record |
| `danger` | `#A4262C` | destructive actions only |
| `scrim` | `rgba(21, 24, 29, 0.42)` | the dimmed backdrop behind a sheet (`ink` at 42%) |

**`accent` vs `record`, decided 2026-09-22:** the two shared `#C2410C`, so "your
best ever" and "the button that commits" read identically. **`record` moved** —
`accent` appears on every screen and `record` on few, so moving the rarer role
is the smaller change. Brass `#8A6516` sits at hue 41° against `accent`'s 17°:
far enough to read as a different mark, still inside the warm family the ground
is built from. It clears WCAG AA as text on both grounds it lands on —
**4.83:1 on `paper`, 5.31:1 on `surface`** — because `record` marks figures, not
just a band. `record-wash` / `record-rule` moved with it, keeping the same hue
relationship to `record` that the orange pair had to `accent`.

The floor is a gate, not a note: `apps/mobile/app/__tests__/ui-design-tokens.test.ts`
fails if `record` ever equals `accent` again or drops below 4.5:1.

**Light only.** No dark variants; `app.config.ts` pins
`userInterfaceStyle: "light"`. See `ux-rules.md` §9a.

## 3. Typography

| Family | Weights | Use |
| --- | --- | --- |
| Archivo | 600/700/800 | headings, control labels, buttons, micro-labels |
| Source Sans 3 | 400/600 | body and prose |
| IBM Plex Mono | 500/600/700 | **every number** |

Figures are monospaced so digits align down a column — any list of measurements
depends on it. Micro-labels are Archivo 700 at **10px** (`uiTypography.size.xxs`),
`letter-spacing` 0.06–0.12em, and carry units and legends.

**Embedded in the binary, decided 2026-09-22.** The eight faces ship inside
the app via the `expo-font` config plugin (`apps/mobile/app.config.ts`), not
loaded at runtime: the OS registers them before JS runs, so there is no loading
step, no splash gate and no flash of the system font reflowing a numeric column.
A screen names a face as `{ fontFamily, fontWeight }` from `uiFonts`
(`apps/mobile/components/ui/tokens.ts`) — the same pair on iOS and Android,
because iOS picks among an embedded family by weight and the plugin registers
an Android XML font family under the same name. Only the weights in the table
are embedded; any other weight lands on the nearest one that is. Screens not
yet in the design language still render in the system font.

**Web gets system fonts.** Config-plugin embedding is iOS/Android only, so
`expo start --web` renders every face in the browser's fallback. That is the
accepted outcome, not a bug: web is a dev convenience with no gate, and this
spec does not promise web parity.

**The type scale, decided 2026-09-22.** The accepted target was drawn across
thirteen sizes (`8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 17 · 18 · 19 · 23`)
against a shipped scale of seven, and `rawFontSize` is enforced at budget 0 — so
the target could not be built as drawn. Resolved as a scale revision rather than
a pile of exceptions: **one rung added (`xxs` 10), nothing else moved.** The
target's other sizes snap onto rungs that already exist — `15→16`, `17→18`,
`19→18`, `23→24` — and the `8`/`9` micro-labels lift to `10`, which was the
right call independently: 8px body-adjacent text was poor for accessibility.

These are the *target's drawn sizes* snapping onto the shipped scale, which is a
different operation from the 2026-09-19 collapse of the old scale recorded in
`ux-rules.md` §9a.1 (where `15` folded into `14` and `17` into `16`). The two
lists disagree on purpose: one maps a design onto today's rungs, the other
records how today's rungs were arrived at.

Eight rungs: `10 · 11 · 12 · 13 · 14 · 16 · 18 · 24`. The guardrail budgets in
`apps/mobile/scripts/ui-guardrails.config.js` stay at 0 — raising one is never
the fix for a screen the scale cannot express; changing the scale is.

**The 38pt metric column holds, measured on device 2026-09-22** (iOS
simulator, 390pt): a 1RM up to `999.9` is 36pt in Plex Mono 500 at 12, and a
five-digit volume (`10240`) is 33pt at 11. Only a four-digit 1RM overflows
(`1021.5`, 43pt), which no lifter produces. The 10px legends are 25pt (`1RM`)
and 24pt (`VOL`), so the metric block is ~67pt and the weight × reps column
still fits `160.0 × 64` at 390pt.

**Weight, decided 2026-09-22 on device:** the target's weights read too heavy
on iOS, so realised figures and option labels sit one embedded weight lighter
than drawn, keeping sizes on the scale. Running figures (weight × reps, the
inline 1RM, VOL) are Plex Mono **500**; a `record` figure is **700**, which
stands out from them. Sheet option labels are Archivo **600**, the selected one **700**.
Headline figures (summary, records) stay Plex Mono 700, micro-labels Archivo
700, sheet titles Archivo 800.

## 4. Surfaces

- **No shadows.** Depth is a hairline plus a ground-colour change, never an
  elevation ramp. `uiElevation` stays unused unless a screen proves it needs it.
- Cards are `surface` on `paper`, 1px `rule`, radius 6.
- Sheets are bottom-anchored with a dimmed backdrop (`scrim`), top radius 16
  and a 38×4 `rule-strong` handle. **Tapping outside dismisses; sheets carry no
  Cancel button.**
- Tap targets ≥44. The iOS status bar and the tab tray are never redrawn in
  content.
- **Geometry lives in `uiGeometry`** (`apps/mobile/components/ui/tokens.ts`,
  added 2026-09-22): the card and sheet radii, the 44pt tap target, the 38pt
  metric column, the sheet handle, and micro-label tracking (0.1em, one value
  for the target's 0.06–0.12 range). Step 4 (2026-09-23) added a **control
  radius 4** — input fields, a segmented selector and an outline button; the
  target drew 4 and 5, a difference with no name — and a **labelled-field
  height 50** (micro-label above a large figure: the logger's Weight / Reps /
  Effort). The logger's other widths derive from these: Reps is one field
  height wide, Effort two tap targets, the tick one tap target. It sits beside the legacy `uiRadius` /
  `uiSpace` rather than in them — 6 beside 8 would be two radii with no nameable
  difference (`ux-rules.md` §9a.5) — so the legacy scales can be retired
  wholesale once no screen uses them. Spacing the target draws off-scale snaps to `uiSpace`
  (sheet gutters 20→16, sheet rows ≥60, list rows ≥44).
- The primitives implementing this are `Card`, `Stat`, `ListRow`, `Sheet` and
  `ActionButton` (`components-catalog.md`).

## 5. Emphasis

**One primary action per screen**, in `accent`. Everything else is an outline or
a plain text button. Two saturated buttons on one screen is a bug.

**One superlative: `record`.** A figure that beats the lifter's all-time best is
bold `record`, and earns a band on the containing card where the screen has one
(the session view's cards). Every other figure takes its row's colour and
weight — **no screen bolds the best value in the current context.** Decided on
device 2026-09-23: per-column bold "best today" figures read as noise, first on
the session view, then aligned on the exercise page; `Stat` no longer offers a
`best` emphasis (`ux-rules.md` §14a.4, §14b.4).

**State is carried by a control glyph**, not by a word: a filled check means
done, an `accent` ring means current, a dashed ring means planned. Planned items
additionally render faded (§6).

## 6. Presenting data

- **`1RM` everywhere**, never `e1RM`. Computed by `estimateOneRepMax` (Mayhew)
  in `apps/mobile/src/exercise-calculations/index.ts`.
- **No thousands separators.** `2560`, not `2 560`.
- **No unit suffix inside an input.** The unit belongs in the field label.
- **Show a figure wherever it can be computed**, including for values that are
  not yet realised — a planned set shows its projected 1RM and volume faded:
  values in `ink-faint`, legends in `planned` (decided on device 2026-09-22;
  `planned` for the values themselves read too faint to use).
- **Warm-ups are presented exactly like working sets**, including a real 1RM.
  They count toward 1RM and records, but not toward working sets (kept as
  shipped, decided 2026-09-23): `isWorkingSetType`
  (`src/session-insights/calculations.ts`) feeds only the working-set count.
  The full rule is `ux-rules.md` §5.11.
