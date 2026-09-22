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
| `record` | `#C2410C` | an all-time best value |
| `record-wash` / `record-rule` | `#FDF0E6` / `#F6E2D2` | a band announcing a record |
| `danger` | `#A4262C` | destructive actions only |

**Unresolved:** `accent` and `record` are the same hex, so "your best ever" and
"the button that commits" read identically. Either `record` moves, or the
collision is accepted in writing with a reason. Decide before the tokens PR; do
not let the build settle it by accident.

**Light only.** No dark variants; `app.config.ts` pins
`userInterfaceStyle: "light"`. See `ux-rules.md` §9a.

## 3. Typography

| Family | Weights | Use |
| --- | --- | --- |
| Archivo | 600/700/800 | headings, control labels, buttons, micro-labels |
| Source Sans 3 | 400/600 | body and prose |
| IBM Plex Mono | 500/600/700 | **every number** |

Figures are monospaced so digits align down a column — any list of measurements
depends on it. Micro-labels are Archivo 700, 8–10px, `letter-spacing`
0.06–0.12em, and carry units and legends.

None of these are installed: the app is system-font only today.

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
