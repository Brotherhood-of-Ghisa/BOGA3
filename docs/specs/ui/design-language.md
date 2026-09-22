# Design Language (Pending / planned)

> **Owns:** the visual and interaction language of the mobile UI — colour roles,
> type, surface rules, emphasis, and how data is presented. Screen-agnostic.
> **Not here:** how a particular screen is laid out → the owning build spec,
> then `screen-map.md` / `ux-rules.md` once shipped; component inventory →
> `components-catalog.md`; design-source policy → `ai-design-policy.md`.
> **Load when:** building or reviewing any screen.

**Status: `Pending / planned`.** Approved direction, accepted 2026-09-21, not
yet implemented. The shipped app still uses the scales in
`apps/mobile/components/ui/tokens.ts` and the semantics in `ux-rules.md`. Each
build PR graduates part of this doc to `Current behavior`.

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
| `ink-faint` | `#9B948A` | mini legends, tertiary labels |
| `planned` | `#B3ABA0` | not-yet-realised values |
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

**`accent` vs `record`, decided 2026-09-22:** the two shared `#C2410C`, so "your
best ever" and "the button that commits" read identically. **`record` moved** —
`accent` appears on every screen and `record` on few, so moving the rarer role
is the smaller change. Brass `#8A6516` sits at hue 41° against `accent`'s 17°:
far enough to read as a different mark, still inside the warm family the ground
is built from. It clears WCAG AA as text on both grounds it lands on —
**4.83:1 on `paper`, 5.31:1 on `surface`** — because `record` marks figures, not
just a band. `record-wash` / `record-rule` moved with it, keeping the same hue
relationship to `record` that the orange pair had to `accent`.

The floor is a gate, not a note: `apps/mobile/app/__tests__/ui-tokens-additive.test.ts`
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

None of these are installed: the app is system-font only today.

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

**Still owed on device:** the mini legends (`1RM` / `VOL`) were drawn at 8px
inside a 38px metric column. At 10px that block grows, so the set row needs a
width re-check when it is built (build spec, step 3/4) — the rung is committed,
the column width is not.

## 4. Surfaces

- **No shadows.** Depth is a hairline plus a ground-colour change, never an
  elevation ramp. `uiElevation` stays unused unless a screen proves it needs it.
- Cards are `surface` on `paper`, 1px `rule`, radius 6.
- Sheets are bottom-anchored with a dimmed backdrop. **Tapping outside
  dismisses; sheets carry no Cancel button.**
- Tap targets ≥44. The iOS status bar and the tab tray are never redrawn in
  content.

## 5. Emphasis

**One primary action per screen**, in `accent`. Everything else is an outline or
a plain text button. Two saturated buttons on one screen is a bug.

**Superlatives are two-level and must not be mixed:** bold `ink` marks the best
value *in the current context*; `record` marks an all-time best, and earns a
band on the containing card.

**State is carried by a control glyph**, not by a word: a filled check means
done, an `accent` ring means current, a dashed ring means planned. Planned items
additionally use `planned` text.

## 6. Presenting data

- **`1RM` everywhere**, never `e1RM`. Computed by `estimateOneRepMax` (Mayhew)
  in `apps/mobile/src/exercise-calculations/index.ts`.
- **No thousands separators.** `2560`, not `2 560`.
- **No unit suffix inside an input.** The unit belongs in the field label.
- **Show a figure wherever it can be computed**, including for values that are
  not yet realised — a planned set shows its projected 1RM and volume in
  `planned`.
- **Warm-ups are presented exactly like working sets**, including a real 1RM.
  They remain excluded from records and working-set statistics by
  `isWorkingSetType` (`src/session-insights/calculations.ts`). This divergence
  between what is shown and what counts is deliberate, and must be stated
  wherever records are explained to a user.
