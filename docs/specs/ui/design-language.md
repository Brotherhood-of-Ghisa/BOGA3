# Design Language

> **Owns:** the visual and interaction language of the mobile UI — colour roles,
> type, surface rules, emphasis, and how data is presented. Screen-agnostic.
> **Not here:** how a particular screen is laid out → `screen-map.md` /
> `ux-rules.md` (§14a/§14b for the session screens); component inventory →
> `components-catalog.md`; design-source policy → `ai-design-policy.md`.
> **Load when:** building or reviewing any screen.

**Status: `Current behavior`** for the whole app. Accepted 2026-09-21; every
screen was moved onto it by 2026-09-26. It is the app's one styling vocabulary:
the tokens in `apps/mobile/components/ui/tokens.ts` (`uiRoles`, `uiFonts`,
`uiGeometry`, `uiSpace`, `uiTypography`, `uiIconSize`, `uiBorder`) and the
primitives in `components-catalog.md`. The retired legacy vocabulary is blocked
by a guardrail (`ux-rules.md` §9a).

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

Semantic roles, not a palette. A screen names the role, never the hex. The
values are generated from four seed colours ("Derivation" below) of the theme
the user chose ("Presets"), so the table shows the default theme, Warm.

| Role | Value | Use |
| --- | --- | --- |
| `ink` | `#1B1712` | primary text, chrome, realised values |
| `ink-muted` | `#6B6358` | secondary text |
| `ink-faint` | `#9B948A` | mini legends, tertiary labels, not-yet-realised values |
| `ink-ghost` | `#BAB2A7` | legends of not-yet-realised values, absent values, placeholders, disabled controls |
| `paper` | `#F7F4EF` | page ground; a pressed control and an action strip inside a card |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `rule` | `#E4DBD0` | card borders, control borders, sheet handle |
| `rule-soft` | `#F0E9E0` | dividers inside a card or panel |
| `accent` | `#C2410C` | the one primary action on a screen |
| `accent-wash` | `#FFF4F0` | the row or field being edited (`accent`'s hue at L* 97) |
| `record` | `#8A6516` | an all-time best value |
| `record-wash` / `record-rule` | `#FEF2E2` / `#F3DDBE` | a band announcing a record |
| `danger` | `#A4262C` | destructive actions only |
| `scrim` | `rgba(27, 23, 18, 0.42)` | the dimmed backdrop behind a sheet (`ink` at 42%) |

**`accent` vs `record`, decided 2026-09-22:** the two shared `#C2410C`, so "your
best ever" and "the button that commits" read identically. **`record` moved** —
`accent` appears on every screen and `record` on few, so moving the rarer role
is the smaller change. Brass `#8A6516` sits at hue 41° against `accent`'s 17°:
far enough to read as a different mark, still inside the warm family the ground
is built from. It clears WCAG AA as text on both grounds it lands on —
**4.83:1 on `paper`, 5.31:1 on `surface`** — because `record` marks figures, not
just a band. `record-wash` / `record-rule` moved with it, keeping the same hue
relationship to `record` that the orange pair had to `accent`.

The floor is a gate, not a note: `apps/mobile/__tests__/ui-design-tokens.test.ts`
fails if `record` ever equals `accent` again or drops below 4.5:1.

**Rationalised 2026-09-27.** The roles were picked by eye and had drifted into
near-duplicates, which also blocks deriving them from a few seed colours later.
Measured in CIE LCh:

- **Two neutrals that cannot be told apart are one role.** `rule-strong`
  (L* 86) folded into `rule` (88), and `rule-faint` (95) into `rule-soft` (93).
  `planned` (70) and `disabled` (77) became one `ink-ghost` (73), completing
  the ink series `ink` → `ink-muted` → `ink-faint` → `ink-ghost`.
  `surface-subtle` (98) folded into `paper` (96): an action strip or a pressed
  control inside a `surface` card now reads as the page showing through.
  Chosen from an on-device before/after capture of every `frontend-ui` state:
  23 roles became 19, and 13 greys became 9.
- **The neutrals are one hue.** Every neutral sat at hue 77–94 except `ink`,
  a cool near-black at 271°; `ink` moved to `#1B1712` (same L* 8 and chroma 4,
  hue 77), invisible at that darkness. `scrim` follows `ink`.
- **A wash is a tint of its role.** `accent-wash` was a warm neutral (hue 78)
  rather than a tint of `accent` (47); it is now `accent`'s hue at L* 97
  (hue 53 after sRGB rounding), so the edited row carries the accent's hue.

Gated by `ui-design-tokens.test.ts`: no two roles share a value, every neutral
sits within hue 75–95 at chroma ≤ 10, and `accent-wash` stays within 10° of
`accent`'s hue.

### Derivation: four seeds

**Decided 2026-10-01.** The roles are generated, not hand-picked:
`generateRoles(seeds)` in `apps/mobile/components/ui/theme.ts` turns four seed
colours into every role, and `uiRoles` is the shipped seeds generated. A theme
is four colours.

| Seed | Shipped | Generates |
| --- | --- | --- |
| `ground` | `#6B6358` | every neutral — `ink`, `ink-muted`, `ink-faint`, `ink-ghost`, `paper`, `rule`, `rule-soft`, `viz0` |
| `accent` | `#C2410C` | `accent` (as given), `accent-wash` |
| `record` | `#8A6516` | `record` (as given), `record-wash`, `record-rule` |
| `viz` | `#A4866B` | `viz1`…`viz4` |

`surface` (white), `danger` and `scrim` (`ink` at 42%) are the same in every
theme.

- **A seed sets hue and chroma; the role sets lightness.** Each generated role
  sits at its own fixed L* — the L* it was picked at — on its seed's hue, with
  the seed's chroma scaled by a per-role factor. Contrast depends on lightness,
  so the text floors hold whatever the seed.
- **`accent` and `record` are used as given**, so their own floors (`record`
  ≥ 4.5:1 on `paper`, a different hue from `accent`) are the seed's to meet.
- **Out-of-gamut steps lose chroma**, keeping lightness and hue.
- **Light only.** The lightness ladder is a light ground; a dark theme would be
  a second ladder, not different seeds.

The shipped seeds reproduce the 2026-09-27 palette within ΔE*ab 3 (a
just-noticeable difference side by side is ~2.3): 13 of 19 roles exactly.
`paper`, `rule`, `rule-soft` and `accent-wash` moved by ΔE ≤ 1, because the
picked grounds sat at hue 90–94 against the ground seed's 81. `record-wash` and
`record-rule` moved most, by ≤ 3: they were picked at hue 90 against `record`'s
81.

Gated by `apps/mobile/__tests__/ui-theme.test.ts`: `uiRoles` equals the
shipped seeds generated, every role stays within ΔE*ab 3 of the picked palette,
and for every shipped preset ("Presets" below) and three seed sets no preset
ships (a teal, an indigo, a rose) the rules above still hold — distinct values,
the neutrals in a fixed lightness order on the ground's hue, `ink` and
`ink-muted` ≥ 4.5:1 on both grounds, `ink` legible on the ramp, even ramp
steps, and each wash tinted from its own role.

### Presets

**Decided 2026-10-01.** The user chooses a theme from four presets in
Settings → Appearance (`apps/mobile/components/ui/theme-presets.ts`), picked
from a mock of six candidates on the exercise page, one per hue family:

| Preset | `ground` | `accent` | `record` | `viz` |
| --- | --- | --- | --- | --- |
| Warm (default) | `#6B6358` | `#C2410C` | `#8A6516` | `#A4866B` |
| Slate | `#5B6470` | `#1F6FB2` | `#8A6516` | `#5F7F96` |
| Forest | `#5E6659` | `#2F7D4F` | `#8C5A12` | `#6E8A62` |
| Plum | `#665D66` | `#8E3B8A` | `#7A6A12` | `#8A6F8A` |

- **`record` stays a brass** in every preset, so "your best ever" keeps one
  look whatever the accent.
- **Each preset's `accent` and `record` meet their floors**, since they are
  used as given: `record` ≥ 4.5:1 on `paper`, `surface` and `record-wash`;
  `record` ≥ 30° of hue from `accent` (the default sits 33° apart); and the
  primary action's `surface` label ≥ 4.5:1 on `accent`.
- **Chosen per device, applied at launch.** `tokens.ts` resolves the stored
  preset id to seeds when it first evaluates (`theme-launch.ts`, read
  synchronously from `expo-sqlite/kv-store`); an unknown id or an unreadable
  store falls back to Warm and is logged. Behaviour: `ux-rules.md` §9b.

Gated by `ui-theme.test.ts`: every preset passes the generator rules above and
these floors, and Warm is the default seeds.

### Data visualisation

One sequential ramp, one meaning: **more**. Heatmap cells and bars, and the
Progress failure-intensity rows, all use it.

| Role | Value | L* | Use |
| --- | --- | --- | --- |
| `viz0` | `#F0ECE7` | 94 | empty / rest (a heatmap day with no training) |
| `viz1` | `#E7D7CA` | 87 | the lightest intensity |
| `viz2` | `#D3BDAB` | 78 | |
| `viz3` | `#BCA18A` | 68 | |
| `viz4` | `#A4866B` | 58 | the strongest intensity |

**Picked on device 2026-09-25** (DLM-T08, "B2", from a gallery of a teal, a
warm monochrome and a green, then three warmer takes on the monochrome): a
bronze taupe at LCh hue 68, chroma 9–20. It sits between `accent` (hue 47,
chroma 73) and `record` (hue 81, chroma 47) but at a fraction of their chroma
and far lighter, and `record` is only ever a text colour, never a ground. The
steps are even in lightness (L* 87 / 78 / 68 / 58) so each bucket reads as
"more" without relying on hue.

- **Text on a `viz` ground is `ink`**, legends and deltas included: `ink-muted`
  is 3.3:1 on `viz2` and 1.7:1 on `viz4`, while `ink` clears 5.2:1 on `viz4`.
  `Stat` takes `ground="viz"` for this.
- Colour is never the only channel: counts and accessibility labels still say
  how much.
- Marks on a `viz` cell are `ink`: today a 1px ring, selected a 2px border
  (G2; the heatmaps, DLM-T09). An empty `viz0` cell takes a `rule` hairline,
  since `viz0` is only 1.18:1 against `surface`.

Gated by `ui-design-tokens.test.ts`: the steps darken monotonically with
ΔL* ≥ 6 between neighbours, `viz1` sits ≥ 10 L* below `surface`, `ink` on
`viz4` ≥ 4.5:1, `ink` on `viz1` ≥ 3:1, and no step equals `accent` or
`record`.

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
are embedded; any other weight lands on the nearest one that is.

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
  elevation ramp; there is no elevation token.
- Cards are `surface` on `paper`, 1px `rule`, radius 6.
- Sheets are bottom-anchored with a dimmed backdrop (`scrim`), top radius 16
  and a 38×4 `rule` handle. **Tapping outside dismisses; sheets carry no
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
  height wide, Effort two tap targets, the tick one tap target. A **pill
  radius** (`radius.pill`, 999) was added 2026-09-24 for handles, tags and
  chips. `uiSpace` is the one spacing scale: spacing the target draws off-scale
  snaps to it (sheet gutters 20→16, sheet rows ≥60, list rows ≥44).
- The primitives implementing this are `Card`, `Stat`, `ListRow`, `Sheet`,
  `ActionButton`, `IconButton`, `StatePanel`, `Screen` / `ScreenScroll`,
  `FormField`, `SearchField`, `SegmentedControl`, `ChipGroup`, `Tag` and
  `Notice` (`components-catalog.md`).

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

- **One vocabulary for every exercise:** `Weight`, `Top weight`, `1RM` and
  `Volume`, never `e1RM`, `Added`, `External weight` or `Effective load`.
  Bodyweight contribution and dated readings may alter the calculation when the
  applicable capability is enabled, but normal data surfaces never expose the
  arithmetic. All weights are kg. Valid zero renders `0`; `—` is reserved for
  invalid, failed or genuinely unavailable strict-group results. Long context
  wraps or gets a separate line instead of shrinking numeric figures.
- **No thousands separators.** `2560`, not `2 560`.
- **No `k` compaction.** `123456`, not `123k`: a six-digit volume fits a Plex
  Mono column (decided for Progress, DLM-T08-D2).
- **No unit suffix inside an input.** The unit belongs in the field label.
- **Show a figure wherever it can be computed**, including for values that are
  not yet realised — a planned set shows its projected 1RM and volume faded:
  values in `ink-faint`, legends in `ink-ghost` (decided on device 2026-09-22;
  the faintest ink for the values themselves read too faint to use).
- **Warm-ups are presented exactly like working sets**, including a real 1RM.
  They count toward 1RM and records, but not toward working sets (kept as
  shipped, decided 2026-09-23): `isWorkingSessionSetType`
  (`src/data/set-types.ts`) feeds only the working-set count.
  The full rule is `ux-rules.md` §5.11.
