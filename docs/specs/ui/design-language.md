# Design Language

> **Owns:** the visual and interaction language of the mobile UI — colour roles,
> type, surface rules, emphasis, and how data is presented. Screen-agnostic.
> **Not here:** how a particular screen is laid out → `screen-map.md` and its
> design target; cross-screen semantics → `ux-rules.md`; component inventory →
> `components-catalog.md`; design-source policy → `ai-design-policy.md`.
> **Load when:** building or reviewing any screen.

The app's one styling vocabulary, on every screen: the tokens in
`apps/mobile/components/ui/tokens.ts` (`uiRoles`, `uiFonts`, `uiGeometry`,
`uiSpace`, `uiTypography`, `uiIconSize`, `uiBorder`) and the primitives in
`apps/mobile/components/ui/` (`components-catalog.md`). This doc states the
rules; the token files hold the values. The retired legacy vocabulary is
blocked by a guardrail (`ux-rules.md` "Styling guardrails").

## 1. What the app is

Two modes, one language. **In-workout** is one-handed, mid-set, glanceable: one
obvious action, large figures, no decoration. **Out-of-workout** is exploratory:
dense, information-rich, scannable. The split is carried by *density and
emphasis*, never by a different visual vocabulary.

The voice is a brotherhood of geeks — the numbers are the point. Estimated 1RM,
volume and effort are shown wherever they are known, not hidden behind a detail
tap.

## 2. Colour roles

Semantic roles, not a palette: **a screen names the role, never the hex.** The
values are generated per theme, so neither a doc nor a screen may hold one —
`uiRoles` is the only source, and `UiRoles` in
`apps/mobile/components/ui/theme.ts` documents what each role is for.

Invariants, gated by `apps/mobile/__tests__/ui-design-tokens.test.ts`:

- **One value per role.** Two roles that cannot be told apart are one role.
- **`record` is never `accent`**, and clears 4.5:1 as text on `paper` and
  `surface` — it marks figures, not just a band, so "your best ever" and "the
  button that commits" must not read as the same mark.
- **The neutrals are one hue** (75–95 at chroma ≤ 10), in the series `ink` →
  `ink-muted` → `ink-faint` → `ink-ghost`. `scrim` follows `ink`, at 42%.
- **A wash is a tint of its role**, within 10° of its hue, so the edited row
  carries the accent's hue rather than the ground's.

**Four seeds make a theme.** `generateRoles(seeds)` turns `ground`, `accent`,
`record` and `viz` into every role, synchronously at module load so every
module-scope `StyleSheet.create` keeps working. A seed sets hue and chroma; the
role sets its own fixed L\* — contrast depends on lightness, so the text floors
hold whatever the seed. `accent` and `record` are used as given, so their floors
are the seed's to meet. **Light only:** `app.config.ts` pins
`userInterfaceStyle: "light"` (`ux-rules.md` "Appearance"); a dark theme would
be a second ladder, not different seeds.

**Choosing one.** Four presets or a custom hue, per device, resolved when
`tokens.ts` first evaluates (`theme-presets.ts`, `theme-launch.ts`); an unknown
id or unreadable store opens in the default and is logged. `record` stays a
brass across presets, so "your best ever" keeps one look. For a custom hue,
`seedsFromHue` (`theme-hue.ts`) fixes every seed's L\* and chroma so the floors
hold at all 360 hues by construction rather than by checking afterwards. Hue is
the one thing that moves: `record` keeps the brass unless the picked accent
lands within 35° of it, then steps 35° away on the far side — that step is what
makes the `record`-to-`accent` floor hold, so do not "simplify" it away.
`ui-theme.test.ts` gates the generator and every preset.

**Data visualisation:** one sequential ramp, one meaning — **more**. `viz0` is
empty / rest, `viz1`…`viz4` the lightest to the strongest intensity; the steps
are even in lightness, so each bucket reads as "more" without relying on hue,
and no step is `accent` or `record`. **Text on a `viz` ground is `ink`**,
legends and deltas included (`ink-muted` is 3.3:1 on `viz2`); `Stat` takes
`ground="viz"`. **Colour is never the only channel** — counts and accessibility
labels still say how much. Marks on a cell are `ink`; an empty `viz0` cell takes
a `rule` hairline, being only 1.18:1 against `surface`. The operator-authorized
Progress selectors also use the strongest palette grade for selection; if
changing them, load `design-targets/progress-tables.md`.

## 3. Typography

| Family | Weights | Use |
| --- | --- | --- |
| Archivo | 600/700/800 | headings, control labels, buttons, micro-labels |
| Source Sans 3 | 400/600 | body and prose |
| IBM Plex Mono | 500/600/700 | **every number** |

Figures are monospaced so digits align down a column — any list of measurements
depends on it. Micro-labels are Archivo 700 at **10px**
(`uiTypography.size.xxs`), tracked 0.1em, and carry units and legends.

**Embedded in the binary**, never loaded at runtime: the eight faces ship inside
the app via the `expo-font` config plugin (`apps/mobile/app.config.ts`), so the
OS registers them before JS runs — no loading step, no splash gate, no flash of
the system font reflowing a numeric column. A screen names a face as
`{ fontFamily, fontWeight }` from `uiFonts`, the same pair on iOS and Android.
Only the weights above are embedded; any other weight silently lands on the
nearest one that is. **Web gets system fonts** — config-plugin embedding is
iOS/Android only. That is accepted, not a bug: web is a dev convenience with no
gate, and this spec promises no web parity.

**The type scale is eight rungs** (`uiTypography.size`), and the raw-literal
budgets in `apps/mobile/scripts/ui-guardrails.config.js` stay at 0. A size a
screen cannot express is a case for revising the scale, here and in `tokens.ts`,
never for an exception (`ux-rules.md` "Styling guardrails"); a design target
drawn off the scale snaps onto it.

**The 38pt metric column holds** (`uiGeometry.metricValueWidth`, measured on
device at 390pt): a 1RM up to `999.9` and a five-digit volume both fit with
their 10px legends, and only a four-digit 1RM overflows, which no lifter
produces.

**Weight per figure.** Realised figures and option labels sit one embedded
weight lighter than the accepted target drew them, which read too heavy on iOS,
keeping sizes on the scale. Running figures (weight × reps, the inline 1RM, VOL)
are Plex Mono **500**; a `record` figure is **700**. Sheet option labels are
Archivo **600**, the selected one **700**; headline figures stay Plex Mono 700,
micro-labels Archivo 700, sheet titles Archivo 800.

## 4. Surfaces

- **No shadows.** Depth is a hairline plus a ground-colour change, never an
  elevation ramp; there is no elevation token.
- Cards are `surface` on `paper`, 1px `rule`, radius 6.
- Sheets are bottom-anchored with a dimmed backdrop (`scrim`), top radius 16
  and a `rule` handle. **Tapping outside or dragging the handle down
  dismisses; sheets carry no Cancel button.** A sub-page is the native iOS
  page sheet instead: grabber, title, X (`ux-rules.md` "Sheets").
- Tap targets ≥44. The iOS status bar and the tab bar are never redrawn in
  content.
- **Geometry lives in `uiGeometry`, spacing in `uiSpace`** — the one spacing
  scale — both in `apps/mobile/components/ui/tokens.ts`, which states what each
  value is for. **A screen derives its measures from these** instead of
  adding values (the logger's Reps field is one field height wide, Effort two
  tap targets), and spacing a design target draws off-scale snaps to the scale
  (sheet gutters 20→16, sheet rows ≥60, list rows ≥44).
- The primitives implementing all of this live in
  `apps/mobile/components/ui/` (`components-catalog.md`).

## 5. Emphasis

**One primary action per screen**, in `accent`. Everything else is an outline or
a plain text button. Two saturated buttons on one screen is a bug.

**One superlative: `record`.** A figure that beats the lifter's all-time best is
bold `record`, and earns a band on the containing card where the screen has one
(the session view's cards, the exercise page's set list). Every other figure
takes its row's colour and weight — **no screen bolds the best value in the
current context**, which read as noise on device; `Stat` offers no `best`
emphasis. Only the sets that took a record are highlighted, never every
qualifying row: the exercise page's set list and the session cards show every
record set, with one band line per record. Which sets those are, and
what beats a record, is `tech/training-metrics-contract.md` §3.

**State is carried by a control glyph**, not by a word: a filled check means
done, an `accent` ring means current, a dashed ring means planned. Planned items
additionally render faded (§6).

## 6. Presenting data

- **One vocabulary for every exercise:** `Weight`, `Top weight`, `1RM` and
  `Volume`, never `e1RM`, `Added`, `External weight` or `Effective load`.
  Bodyweight contribution and dated readings may alter the calculation when the
  applicable capability is enabled, but normal data surfaces never expose the
  arithmetic. All weights are kg. Valid zero renders as a number (`0.0` for a
  Weight or 1RM, `0` for Volume); `—` is reserved for invalid, failed or
  genuinely unavailable strict-group results. Long context wraps or gets a
  separate line instead of shrinking numeric figures.
- **One format per figure** — Weight `60.0`, 1RM `104.7`, Volume `2560` — on
  every screen (`tech/training-metrics-contract.md` §4, `format.ts`).
- **No thousands separators.** `2560`, not `2 560`.
- **No `k` compaction.** `123456`, not `123k`: a six-digit volume fits a Plex
  Mono column.
- **No unit suffix inside an input.** The unit belongs in the field label.
- **Show a figure wherever it can be computed**, including for values that are
  not yet realised — a planned set shows its projected 1RM and volume faded:
  values in `ink-faint`, legends in `ink-ghost` (the faintest ink read too faint
  for the values themselves).
- **Warm-ups are presented exactly like working sets**, including a real 1RM.
  That 1RM and volume describe the warm-up row alone: a warm-up is never a
  record (brass) and feeds no record, PR or best. The full rule is
  `tech/training-metrics-contract.md` "Counted set" (`isWorkingSet`).
