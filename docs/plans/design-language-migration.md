# Design-language migration: every remaining screen, then delete the legacy vocabulary

Status: **approved by the user on 2026-09-24.** Every global decision (G1–G12)
and every card decision (T*-D*) is decided as recommended, including the
behaviour changes T10-D4 (confirm before discarding an active session) and
T10-D6 (Retry on the Sessions error state), and the visible changes T07-D1,
T08-D2, T11-D2, T13-D1 and T14-D4.

Task cards: `docs/plans/tasks/DLM-T01` … `DLM-T15`, one per PR. This file is the
index. The cards carry the per-screen inventory, decisions, UX contract, gallery
states, Maestro/jest changes, doc graduations and gates.

## Objective

Move every screen still on the legacy styling vocabulary onto the design
language (`docs/specs/ui/design-language.md`: `uiRoles` / `uiFonts` /
`uiGeometry` and the `components/ui/` primitives). Then **delete the legacy
vocabulary**, with a guard that stops it coming back. This is the same kind of
work as the exercise/session redesign and the View Session restyle (#333, #337,
#339), applied to the rest of the app.

**End state (DLM-T15):**

- `apps/mobile` has no reference to `uiColors`, `uiRadius`, `uiElevation`,
  `UiText`, `UiSurface`, `UiButton` or the legacy `SegmentedChips`. Their exports
  are deleted from `components/ui/`.
- The `ui-guardrails` lane fails if any of them comes back.
- The docs describe one vocabulary.

**User decision, 2026-09-24:** the two languages do not need to live side by
side. There is no new-screens setting and no additive-only token period. Screens
are restyled in place, and legacy tokens are deleted as soon as nothing uses
them. `main` stays shippable after every PR.

## Context freshness

- Branch `claude/sweet-gould-264b9d`, rebased on `origin/main` `5493cc3`
  (#340). Slot 2 leased.
- Read: `AGENTS.md`; specs `02`, `03`, `09`, `08`;
  `ui/{README,ai-design-policy,design-language,ux-rules,components-catalog}.md`;
  the route list of `ui/screen-map.md` and the header list of
  `ui/navigation-contract.md`;
  `ui/design-targets/{exercise-session-v5,view-session,group-exercise-unlink}.md`;
  `docs/plans/README.md` and the task-card template. The View Session card
  (`T-20260923-02`, from git history) served as the format precedent.
- Open PR **#336** (session-summary insights, by bozothegrey) edits
  `app/sessions.tsx`, `app/completed-session/[sessionId].tsx`,
  `app/session/[sessionId]/index.tsx` and
  `components/session-recorder/session-{completion,insight}-presentation.tsx`.
  #337 already deleted the last of those files on `main`, so #336 needs a rebase
  whatever happens here. Overlap with this plan: `app/sessions.tsx`
  (DLM-T10). See G10.

## Inventory (measured 2026-09-24 at `5493cc3`)

`grep -rlE 'uiColors|uiRadius|uiElevation|UiText|UiSurface|UiButton|SegmentedChips'`
over `apps/mobile/{app,components,src}`, excluding `__tests__`, finds **77
files**: 21 route files, 49 component files, 1 `src` file (`src/sync/SyncGate.tsx`)
and the 6 legacy definitions in `components/ui/`. Of the 49 component files, 4
are design-language files that use only `uiRadius.full` (for pills and handles).

| Card | Screens / routes | Legacy files (lines) | Maestro screenshots today |
| --- | --- | --- | --- |
| T01 | none: primitives + tokens | `ui/{sheet,icon}`, `exercise-page/set-logger`, `session-complete/exercise-volume-card` (`uiRadius.full` only) | the DL lanes, as a no-change proof |
| T02 | frame: tab tray, tabs, stack headers | `navigation/{bottom-tray,main-tabs,more-hub-back-button,auth-route-guard}` (442) + `app/_layout.tsx` screen options | every capture (the frame) |
| T03 | Today, Train | `(tabs)/{today,train}`, `session-list/session-summary-line` (1,139) | `01-m26-today`, `02-m26-train`, `05-m26-session-view-empty` |
| T04 | More, Settings, Logs, harness | `(tabs)/{more,settings}`, `sync-status/sync-status-panel`, `dev-logs`, `maestro-harness` (1,310) | `04-m26-more`, `06/07-settings-*`, `0x-dev-wipe-local-*` |
| T05 | Sign-in, sync gate, Profile, Connected agents | `sign-in`, `src/sync/SyncGate`, `profile`, `connected-agents` (1,415) | `05-auth-profile-gate-start`, `06/07-auth-profile-*`, `16-first-run-*` |
| T06 | exercise list + session-view picker (+ exercise page swap sheet body) | `exercise-catalog/exercise-list-controls`, `session-recorder/exercise-picker`, `groups/picker-group-section` (1,174) | `groups-link-03-picker-search` only |
| T07 | Exercise catalogue + editor | `(tabs)/exercise-catalog`, `exercise-catalog/exercise-editor-modal`, `exercise-core/exercise-core-fields` (1,781) | **none** (catalogue, Filters, Actions menu, editor all uncaptured) |
| T08 | Progress / Stats: summary, controls, tables, failure-intensity rows; **introduces the data-viz roles** | `(tabs)/stats-history` (screen body, ≈1,300 of its 2,373) | `00`–`04` of `stats-screen-ux`, `03-m26-progress`, `05-data-runtime-smoke-exercise-list` |
| T09 | Progress history overlays + heatmaps | `(tabs)/stats-history` (overlays, ≈700), `heatmaps/*` (652) | `05`–`07` of `stats-screen-ux` |
| T10 | Exercise history, Sessions | `exercise-history`, `sessions`, `session-list/{history-list,active-session-row}` (1,683) | `04-data-runtime-smoke-success`, `20-first-run-*` (Sessions); **none** of exercise history |
| T11 | Groups tab: stream, record sheet, group shell and state panels | `(tabs)/groups`, 15 `components/groups/*` (≈1,500) | `groups-05/06/07b-6/07c-*` |
| T12 | Leaderboards | `group/[groupId]/leaderboards/*`, board components (≈660) | `groups-07b-1..5`, `07c-3..6`, `08b-*` |
| T13 | Group management | `group/{mine,join,new}`, `group/[groupId]/{index,invite,members,edit}`, 6 components (1,473) | `groups-01..04`, `08`, `09` |
| T14 | Group exercises and linking | `group/[groupId]/exercises/*`, `exercise-link`, 6 components (1,667) | `groups-04b-*`, `groups-unlink-*`, `groups-link-01/02/06` |
| T15 | **cleanup**: delete the vocabulary, add the guard, update the docs | `ui/{button,surface,text,segmented-chips,tokens,index}` | every flow green |

Per-file detail (tokens used, flows, jest) lives in each card.

### Legacy machinery the cleanup removes or changes

| Item | Where | Fate |
| --- | --- | --- |
| `uiColors` (62 keys) incl. the heatmap (`heatmap*`) and failure (`failureBackground*`) palettes | `components/ui/tokens.ts` | deleted (T15). The data-viz palettes are replaced by `uiRoles` data-viz roles in T08 (G2). The `heatmapToday*` keys are already unused (measured) |
| `uiRadius` (`sm 8 / md 12 / full 999`) | `tokens.ts` | deleted (T15). `full` becomes `uiGeometry.radius.pill` in T01 |
| `uiElevation` + `UiSurface`'s `elevation` prop | `tokens.ts`, `surface.tsx` | **no screen uses it** (measured), so it is deleted in **T01**, not T15 |
| `UiText`, `UiSurface`, `UiButton`, `SegmentedChips` (`pills` + `joined`) | `components/ui/{text,surface,button,segmented-chips}.tsx` | deleted in T15. Their replacements come in T01 |
| `uiTokens` aggregate `.colors/.radius/.elevation` and types `UiColorToken` / `UiRadiusToken` / `UiElevationToken` / `UiTextVariant` / `UiSurfaceVariant` / `UiButtonVariant` | `tokens.ts`, `index.ts` | deleted (T15) |
| `Icon` default colour `uiColors.textPrimary` | `components/ui/icon.tsx:5,12` | `uiRoles.ink` in T01 (the two differ by less than 2% luminance) |
| `rawRadius` remedy "use `uiRadius.*`" | `scripts/check-ui-guardrails.js:43` | points at `uiGeometry.radius.*` (T15) |
| new rule `legacyVocabulary` | `scripts/check-ui-guardrails.js` + config | T15: budget 0, fails on any legacy identifier in `app/**`, `components/**` or `src/**` |
| `ui-primitives.test.tsx` (+ snapshot) | legacy primitive tests | deleted (T15) |
| `ui-design-tokens.test.ts` | the token gate | asserts `uiColors` / `uiRadius` / `uiElevation` are not exported, and covers the data-viz roles (T08, T15) |
| `ux-rules.md` §9a (legacy scales, "second, separate vocabulary"), §9 remedies, §9c.3, §11.5 (light-blue today), §12.13 (green/warm rows), "Pending / planned" 1–3 | spec | rewritten to one vocabulary (T15, and each card for its own section) |
| `components-catalog.md` entries 2–5 (`UiText` / `UiSurface` / `UiButton` / `SegmentedChips`), entry 1's legacy bullets, "Refactor convergence notes", stale `components/muscle-analytics/` location | spec | removed (T15). The Pending list shrinks as T01 builds its candidates |
| `design-language.md` status line ("every other screen still uses the legacy scales") and §4 (`uiElevation stays unused`, "beside the legacy `uiRadius`") | spec | "current behaviour" for the whole app (T15) |
| `03-technical-architecture.md:41` ("`uiColors` has no dark variants") | spec | reworded to `uiRoles` (T15) |
| `app/__tests__/README.md` mention of `uiRadius` / `uiElevation` | test docs | updated (T15) |

## Decisions (global, G1–G12): all decided as recommended, 2026-09-24

Card-specific behaviour decisions are numbered inside each card (for example
`T03-D2`). The cards reference these global ones.

| # | Question | Recommendation |
| --- | --- | --- |
| **G1** | **Which design target governs each group?** (`ai-design-policy` §2) (a) **repo-native brief**: a short `design-targets/<group>.md` holding the card's "Today → Becomes" table in the design-language vocabulary, plus the gallery states you accept, as View Session did. (b) **Claude Design artboards**, drawn and accepted on a canvas before build, as the exercise page and session view did. (c) **Mixed**: brief for most of the group, artboards for the states with no precedent | **(a) for every group except T08/T09 (Progress)**, where **(c)**: the tables and controls by brief, and the data-viz (heatmap ramp, today and selected marks, failure-intensity rows) by a palette gallery in T08's iteration 0. It shows 2–3 candidate ramps rendered on the real failure rows and heatmap. Every other group is built almost entirely from shipped primitives. Artboards remain an option for **Today (T03)**, the one screen whose composition has no design-language precedent. Per-group table below |
| **G2** | **Data-viz roles.** The design language has none. Today: a green 4-step heatmap ramp, a blue-grey neutral, a light-blue "today", a blue selected border, plus two 4-step failure-intensity row palettes (green for families, warm for muscles). Options: (a) **one sequential ramp in a new hue** outside `accent` (17°) and `record` (41°), e.g. a muted teal around 170–190°: `viz0` (empty) … `viz4`, today marked by an `ink` ring, selection by a 2px `ink` border plus the selected a11y state; failure rows use `viz1`…`viz4` for both families and muscles. (b) a **monochrome `ink` ramp** over `paper`. (c) keep **green**, retuned to the warm ground, and keep two row palettes | **(a).** One ramp, one meaning ("more effort"), in a hue that cannot be confused with the primary action or a record. Colour is never the only channel: counts and a11y labels stay. The values are picked in T08's palette gallery and gated by `ui-design-tokens.test.ts` (adjacent-step distinctness, `ink` legible on `viz4`). It also fixes a latent bug: **today and selected are both drawn `#0f5cc0` today**, so nothing tells them apart (`DailyHeatmap.tsx:160-167`, `WeeklyHeatmap.tsx:120-125`), and the light-blue `heatmapToday*` tokens that `ux-rules` §11.5 describes are unused. §11.5 is rewritten |
| **G3** | **Status colours** (success / warning / info). Measured uses: offline (sync panel, group offline banner), write success (profile, group write notice, dev feedback), the "Training now" status pill, the auth-disabled and dev-tools warning cards, the "restoring" info card, info-blue icon badges (More, Settings). Options: (a) **no new hues**: state is words plus a glyph on neutral ground (`surface-subtle` band, `rule` hairline). Offline gets a `wifi-off` icon, success a check icon in `ink`, errors stay `danger`, and decorative blue badges become `ink-muted` glyphs. (b) add `caution` / `caution-wash` and `positive` / `positive-wash` roles | **(a).** It matches `design-language` §5 (state rides a glyph, colour supplements) and keeps the palette small. It is built once as T01's `Notice` primitive. New Lucide glyphs (`wifi-off`, `circle-check`, `triangle-alert`) come from the vendored release. `danger` stays for errors only. "Current" states ("Training now", the active workout) use the `set-current` glyph, as the group session view already does. Stats deltas lose their green and red and keep the sign (`+`, `−`, `±0`, `new`) in `ink-muted` |
| **G4** | **Headers on stack routes.** Sessions, exercise history, Profile, Connected agents, Logs, every group route, Link exercise and Gyms use the native stack header, unstyled. The session view, exercise page and View Session draw their own top bar. (a) **keep native headers** and style them once in `app/_layout.tsx` (`paper` background, no shadow, Archivo 700 `ink` title, `ink` back chevron). (b) replace them all with an in-content `TopBar` primitive | **(a)**, in T02. It keeps native back gestures, VoiceOver and the Maestro back taps, and Gyms and the group session view already sit under a native header. In-content titles that duplicate the native one (Connected agents) are dropped in their card |
| **G5** | **Overlays.** Eleven legacy overlays become the design-language `Sheet`: backdrop, Android back and VoiceOver escape dismiss, and there is no Cancel or Close. They are the active-session overflow and the history menu (T10); the exercise picker (T06); the catalogue Filters and Actions menu, and the exercise editor (T07); the Stats history overlays (T09); `RecordSetSheet` (T11); `GroupActionSheet` (T13); and the pick and unlink sheets (T14). Five have an explicit Cancel/Close today (`group-record-sheet-close`, `<prefix>-cancel`, `group-unlink-cancel`, `group-pick-sheet-cancel`, and the catalogue's `Done` / "Close filters"). **`Alert.alert` confirmations stay** (OS chrome); their button labels are tapped by Maestro and must not change | **Yes.** Tests that press a Cancel press the backdrop (`<testID>-backdrop`) instead. Maestro flows tap the backdrop by point (the iOS 26 gotcha: the `Sheet` backdrop is hidden from accessibility). `Sheet` gains props only in the card that needs them: `keyboardAvoiding` and a header-actions slot (T06), and `onDismissed`, the iOS post-dismiss callback that the unlink chooser needs before it opens its native Alert (T14) |
| **G6** | **One primary per screen**, and at most one per sheet. The share sheet's `Share image` is the precedent (View Session V11). Measured double primaries: Train (`Start empty` + `Start planned`), the group screen (`Invite` + `Add exercise`), and the exercise editor (`Save` beside N filled red `Remove`s). The rest become `outline` or `text`. Destructive buttons become `outline` / `text` with `tone="danger"`, since the design language has no filled danger. `GroupInlineError`'s danger-styled `Retry` becomes `outline` | **Yes.** Each card names the one primary |
| **G7** | **Number presentation** (`design-language` §6) on the remaining screens: `1RM` never `e1RM` or `Est. 1RM`; no thousands separators; no unit suffix on a **figure** (the unit goes in the label or legend); every figure in Plex Mono. Measured: Stats uses `k` compaction (`2.5k`, T08-D2); exercise history says `Est. 1RM`; the group boards and stream say `e1RM` and `140 kg × 1`. That copy is built in `src/groups/{board,stream,record-set}-view-model.ts`, and editing those adds `ios-groups-e2e` (already in `frontend`). Options for the groups: (a) rename `e1RM` → `1RM` everywhere and drop `kg` from figure slots (values, board rows), keeping units in prose sentences ("now #1 on 1RM", "sam 138 kg"); (b) rename only; (c) leave the group copy alone | **(a).** One vocabulary for the same number app-wide. View keys, query params (`metric=e1rm`), RPC fields and testIDs are unchanged; this is display copy only. The Maestro label regexes, the view-model tests and `tech/groups-contract.md`'s quoted copy update in T11/T12 |
| **G8** | **Dev-only surfaces** (`dev-logs`, `maestro-harness`, Settings' Developer tools card) | **Mechanical token swap, no design target and no gallery acceptance.** They are captured in the gallery for information only |
| **G9** | **Typefaces.** Every restyled screen moves from the system font to `uiFonts` (Archivo / Source Sans 3 / Plex Mono). There is no behaviour change, but every screenshot changes | Accept as a consequence (no action). Listed so it is not a surprise |
| **G10** | **PR #336 overlap** (`app/sessions.tsx`, History→Summary routing) | **T10 goes last in the Progress chain.** If #336 merges first, T10 restyles its result. If it is still open when T10 starts, T10 leaves `sessions.tsx`'s structure alone and restyles only (3 `uiColors` uses), and #336's author is told about the conflict. This plan never builds on #336's branch |
| **G11** | **Accessibility of faded / muted text.** `ink-faint` (`#9B948A`) measures 2.73:1 on `paper` and 3.0:1 on `surface`, below AA for body text. It is fine for legends, but legacy screens put real content in `textSecondary` (5.30:1 on `paper`) | Map legacy secondary *content* to `ink-muted` (5.38:1 on `paper`, 5.91:1 on `surface`), and reserve `ink-faint` for legends and not-yet-realised values, as `design-language` §2 says |
| **G12** | **PR order and parallelism.** Sequential PRs with a gallery each, as for View Session, or parallel builder sessions per card (`spawn_task`, the user's builder workflow) once T01/T02 land | **T01 → T02 sequentially, then parallel lanes where the DAG allows**, with at most one simulator lane running at a time on this machine. Each card's gallery still needs its own acceptance |

### Design target per group (G1)

| Card | Target proposal | Record |
| --- | --- | --- |
| T01 | none: no visual change (the proof is identical before/after captures of the DL lanes) | — |
| T02 | brief + gallery | `design-targets/app-frame.md` |
| T03 | brief + gallery (**artboards optional**, since Today's composition has no precedent) | `design-targets/today-train.md` |
| T04 | brief + gallery (dev surfaces for information only, G8) | `design-targets/more-settings.md` |
| T05 | brief + gallery | `design-targets/account.md` |
| T06, T07 | brief + gallery | `design-targets/exercise-catalogue.md` |
| T08, T09 | **mixed**: brief for tables and controls, plus a data-viz palette gallery (G2) in iteration 0 | `design-targets/progress.md` |
| T10 | brief + gallery | `design-targets/progress.md` (extends) |
| T11–T14 | brief + gallery. The existing `group-exercise-unlink.md` is superseded for appearance only; its behaviour brief stays | `design-targets/groups.md` |

Each record follows the `view-session.md` shape: Target, Brief (≤6 bullets),
States (screenshot name → state). Commit no screenshots unless one
disambiguates.

## Primitives: what T01 builds, and who uses them

The extraction rule from the redesign still holds: a primitive is extracted when
a second screen needs it. Each one below has at least two consumers in this
plan. All are drawn from `uiRoles` / `uiFonts` / `uiGeometry` only, and are
covered by `ui-design-primitives.test.tsx`.

| Primitive (T01) | Extracted from (shipped DL code) | Replaces (legacy) | First consumers |
| --- | --- | --- | --- |
| `IconButton` (44pt icon control, a11y label, `tone`) | `session-top-bar`, `exercise-top-bar`, `view-session-top-bar`, `view-session-screen` | 28pt kebab and check buttons, `"≡"` / `"+"` text glyphs | T06, T07, T10, T13 |
| `StatePanel` (loading / message / error + optional outline action) | the session view, exercise page and View Session load states | `GroupStateView` family, ad-hoc `statePanel` styles | T03–T14 |
| `Screen` / `ScreenScroll` (`paper` ground, gutter) | the five DL screens | `surfacePage` + `uiSpace.xl` per screen | every card |
| `FormField` (micro-label, `fieldHeight`, `radius.control`, `danger` error below) | `session-times-fields`, `gym-editor` | profile, sign-in and `groupFormStyles` inputs | T05, T07, T13, T14 |
| `SearchField` | `exercise-swap-sheet` search | catalogue, picker, Stats, standard picker and Link-screen filters | T06, T07, T08, T14 |
| `SegmentedControl` (joined, equal width; `tablist`/`tab`, `selected`, `<prefix>-row` / `<prefix>-<value>` testIDs) | `records-panel` `Records` \| `Last` | `SegmentedChips variant="joined"`, hand-rolled selectors (date format, load mode) | T04, T07, T08, T09, T11, T12, T14 |
| `ChipGroup` (wrapping single- or multi-select pills, same testID contract) | none. Two or more consumers are measured, so it is built ahead of them | `SegmentedChips` pills, muscle/visibility filter pills, tag chips | T06, T07, T10, T11 |
| `Tag` (static pill: `Archived`, `Deleted`, role) | the completion's muscle pills | ad-hoc badges | T06, T11, T12, T13, T14 |
| `Notice` (band: `neutral` / `danger`, optional glyph, `alert` role and live region) | the session view's notice | offline banner, write notice, success/warning/info cards (G3) | T04, T05, T07, T10, T11, T13, T14 |

T01 also:

- adds `uiGeometry.radius.pill` and moves the four DL files off `uiRadius.full`;
- deletes `uiElevation`, which nothing uses;
- moves `Icon`'s default colour to `ink`;
- rebuilds the five DL screens on these primitives with no visible change.

## PR sequence and dependencies

```text
T01 foundation ──► T02 frame ──┬─► T03 Today/Train
                               ├─► T04 More/Settings
                               ├─► T05 Account (sync gates)
                               ├─► T06 list + picker ──► T07 catalogue ──┐
                               ├─► T08 Stats body + data-viz roles ──► T09 overlays/heatmaps ──► T10 history/Sessions (after #336, G10)
                               └─► T11 Groups stream/shell ─┬─► T12 Leaderboards
                                                            ├─► T13 Group management
                                                            └─► T14 Group exercises (after T07) ──┐
                                               all of T03–T14 ──► T15 cleanup ◄──────────────────┘
```

Hard edges, and the reason for each:

- **T01 → everything**: the new primitives.
- **T02 → screens**: every gallery shows the frame, so it must be settled first.
- **T06 → T07**: `ExerciseListContent` belongs to T06.
- **T07 → T14**: `ExerciseCoreFields` is restyled in T07, and T14's group
  exercise form renders it.
- **T11 → T12/T13/T14**: T11 owns the group page shell (`groupScreenStyles`) and
  the state panels.
- **T08 → T09**: same file, and T08 adds the data-viz roles the heatmaps use.
- **T09 → T10**: T10 reuses the history presentation, and G10 puts it last.
- **T06 ↔ T14**: the picker (T06) hosts `GroupExercisePickSheet` (T14), which stays legacy inside a restyled picker until T14 lands.

Everything else is independent. Between landings, a screen may show a restyled
shared piece inside a still-legacy screen. For example, Today's group activity
stays legacy until T11, and the Sessions list rows change with T03's
`SessionSummaryLine`. The user accepted this on 2026-09-24; `main` stays
shippable.

| Card | Title | Estimate (added + modified) | Gates (`./boga test for`) |
| --- | --- | --- | --- |
| T01 | Foundation primitives and tokens | ~1,400 | `fast` + `frontend` |
| T02 | App frame: tray, tabs, stack headers | ~500 | `fast` + `frontend` |
| T03 | Today and Train | ~1,100 | `fast` + `frontend` |
| T04 | More, Settings, Logs | ~1,100 | `fast` + `frontend` |
| T05 | Sign-in, sync gate, Profile, Connected agents | ~1,200 | `fast` + `frontend` + **`backend` + `ios-sync-e2e`** (`src/sync/SyncGate.tsx` = "sync runtime") |
| T06 | Exercise list and the session picker | ~1,000 | `fast` + `frontend` |
| T07 | Exercise catalogue and editor | ~1,400 | `fast` + `frontend` |
| T08 | Progress: summary, controls, tables | ~1,300 | `fast` + `frontend` |
| T09 | Progress: overlays, heatmaps, data-viz roles | ~1,200 | `fast` + `frontend` |
| T10 | Exercise history and Sessions | ~1,300 | `fast` + `frontend` |
| T11 | Groups tab: stream, record sheet, shell, state panels | ~1,500 | `fast` + `frontend` |
| T12 | Leaderboards | ~700 | `fast` + `frontend` |
| T13 | Group management | ~1,200 | `fast` + `frontend` |
| T14 | Group exercises and linking | ~1,400 | `fast` + `frontend` |
| T15 | Cleanup: delete the vocabulary, add the guard, docs | ~900 (mostly deletions) | `fast` + `frontend` (every flow) |

`frontend` includes `ios-groups-e2e` and `ios-auth-profile`. Every card's plan
file edit and deletion also triggers `docs-check`, which runs inside `fast`.
Estimates are line counts, not durations. Durations come only from
`./boga timings`.

## How each card is executed (the View Session way)

1. **Before-captures from `main`.** Run the card's lanes on `main` (or reuse the
   latest green run's artifacts) so every after-screenshot has its before beside
   it.
2. **Build the smallest slice**, then capture every state in the card's gallery
   list through the Maestro lane. States that no flow reaches get new flow steps
   (asserted UI, never screenshot-only: `maestro-run-lane.sh` rule). Seed them
   through the maestro-harness fixture where needed, one fixture user per flow.
3. **Send one rendered HTML gallery per iteration** (`SendUserFile`,
   `display: render`). Images are inlined as base64, and before and after sit
   side by side per state. Wait for acceptance, then record the accepted states
   in the card's `design-targets/*.md`.
4. **Keep testIDs stable** wherever the element survives. Removed elements lose
   theirs. The card lists every flow edit.
5. **Gates:** run the card's gates serially, never two simulator lanes at once.
   Run `./boga db reset` between `frontend` and `backend`. Put every lane's
   evidence path in the PR body (`./boga pr check --body`).
6. **Docs in the same PR**: `screen-map`, `navigation-contract`, `ux-rules`,
   `components-catalog`, `08` patterns, and the design-target record. Remove the
   card's own legacy mentions in those docs, so T15 has less left to do.
7. **Delete the card** in its PR. The last card (T15) deletes this plan.
8. **Target `main`, never a stacked base** (the lesson of #338). If a card must
   stack, retarget to `main` before merge, or re-land.
9. **Human review before merge**: open the PR, report evidence, and wait for
   explicit per-PR approval. After opening: `./boga db down`, then
   `./boga pr wait`. After merge: `./boga worktree release`.

### Known traps

- `groups-two-user-stream` failing at the counterparty's `link-board` ("no board
  row after the link push") means the worktree's `supabase_edge_runtime_*`
  container is not running: `./boga db down`, then re-run the lane.
- Touching `src/groups/set-facts.ts` or `app/__tests__/sync/` pulls in `backend`,
  groups and leaderboards gates. No card needs to, and any card that finds it
  must should say so in its PR.
- `src/sync/SyncGate.tsx` is "sync runtime" (T05): `backend` + `ios-sync-e2e`.
- After `npm install`, `expo lint` may report false `no-unresolved` from a stale
  `.expo/cache/eslint`. Verify with `--no-cache`.
- The `Sheet` backdrop is hidden from accessibility on iOS 26: Maestro taps it by
  point.

## Acceptance for the whole plan

1. T15's acceptance criteria hold (see its card): zero legacy references, the
   exports deleted, a failing guard, one vocabulary in the docs, every flow
   green, and this plan and all DLM cards deleted.
2. Every restyled screen's states were accepted by the user in a gallery and are
   recorded in `docs/specs/ui/design-targets/`.
3. Behaviour changed only where a decision (G*, T*-D*) says so.
