# Components Catalog

> **Owns:** which reusable component to reach for, which folder owns each UI
> area, and where a new component belongs. **Not here:** a component's props,
> variants and testIDs — the component file and the names of its Jest tests are
> its specification; colour, type and surface recipes → `design-language.md`;
> cross-screen semantics → `ux-rules.md`; a screen's own behaviour →
> `screen-map.md` and the screen's components.
> **Load when:** you are building or changing UI and need to find the component
> that already exists. Update this doc when a reusable component is added,
> removed, renamed or changes role (`README.md` "Maintenance rules") — the
> `docs-check` lane fails until a new primitive or component folder is named
> here, so the inventory cannot quietly go stale.

Two standing rules:

1. **Build screens from the primitives in `apps/mobile/components/ui/`**,
   imported from the barrel (`apps/mobile/components/ui/index.ts`). A
   hand-styled `View` / `Text` / `Pressable` where a primitive fits is a
   defect, and the `ui-guardrails` lane rejects raw colour, size, spacing and
   radius literals in `app/` and `components/` either way (`ux-rules.md`
   "Styling guardrails").
2. **Look here before adding a component.** Duplicating a shared row, card,
   sheet, summary line or state panel is the failure this catalog exists to
   prevent.

## Primitives (`apps/mobile/components/ui/`)

| You need | Reach for |
| --- | --- |
| The page ground; a scrolling page body with the gutter and card gap | `Screen` / `ScreenScroll` (`screen.tsx`) |
| A container for content | `Card` (`card.tsx`) — with `onPress` the whole card is one labelled link |
| A legend plus a figure | `Stat` (`stat.tsx`) — `stacked` or `inline`; its only emphasis is `record` |
| A row in a list, a card or a sheet | `ListRow` (`list-row.tsx`) |
| A picker or menu: row actions, options, a choice of one value, a short form | `Sheet` (`sheet.tsx`) |
| A sub-page over the current screen: a browser, an editor, a preview | `PageSheet` (`page-sheet.tsx`); its `PageSheetHeader` also heads the exercise picker route |
| The screen's one primary action, or an outline / text button; `size="compact"` for a row-level action | `ActionButton` (`action-button.tsx`) |
| An icon-only control | `IconButton` (`icon-button.tsx`) |
| A glyph | `Icon` (`icon.tsx`, geometry in `icon-glyphs.ts`) |
| One choice from a few: a filter, a breakdown, a view | `SegmentedControl` (`segmented-control.tsx`) — `fill` / `fit` / `inline`, `density="compact"` and icon segments for two controls sharing a row |
| A loading, empty, message or error state — whole-screen or inside a card | `StatePanel` (`state-panel.tsx`) |
| The inline outcome of an action | `Notice` (`notice.tsx`) |
| A labelled text or figure input | `FormField` (`form-field.tsx`) |
| A search input | `SearchField` (`search-field.tsx`) |
| One choice from a few | `SegmentedControl` (`segmented-control.tsx`) — neutral or fixed black/white filter selection |
| One filter of two values where a row of them cannot afford both labels | `ToggleChip` (`toggle-chip.tsx`) — the value in force plus the `swap` glyph; a tap swaps it |
| Wrapping pills, single- or multi-select | `ChipGroup` (`chip-group.tsx`) |
| One view option on or off, in a sheet (`Show deleted sessions`) | `SwitchRow` (`switch-row.tsx`) |
| A static label naming a state (`Archived`, `Deleted`, a role) | `Tag` (`tag.tsx`) |
| A tab screen's in-content title, or a section heading | `PageHeader` / `SectionHeader` (`page-header.tsx`) |
| Colour roles, fonts, geometry, spacing, type and icon sizes | `tokens.ts` — `uiRoles`, `uiFonts`, `uiGeometry`, `uiSpace`, `uiTypography`, `uiIconSize`, `uiBorder`; theme seeds in `theme.ts`, `theme-presets.ts`, `theme-launch.ts` |

Rules the code cannot state for itself:

- A primitive draws on `uiRoles` / `uiFonts` / `uiGeometry` only — never a
  feature module, never a literal. Values: `apps/mobile/components/ui/tokens.ts`;
  the rules that govern them: `design-language.md`.
- **There is no elevation token and no second palette.** The legacy vocabulary
  (`uiColors`, `uiRadius`, `uiElevation`, `UiText`, `UiSurface`, `UiButton`,
  `SegmentedChips`) was deleted 2026-09-26 and the `legacyVocabulary` guardrail
  blocks its return.
- `ListRow`'s trailing control sits in a fixed tap-target-wide column, so every
  row's control shares one vertical axis; it is a slot, so the row itself
  carries no icon dependency.
- `Sheet` never grows past the top of the screen: a taller body shrinks so a
  full 44pt dismissal target stays below the status bar. It has no Cancel and
  no Close; its handle and title row drag it down, by the release rule in
  `sheet-gesture.ts` (`ux-rules.md` "Sheets"). Use `onDismissed` when a native
  `Alert` must follow a choice made in the sheet, so the two never stack.
- `PageSheet` is in-route state, not a route. A host's `onDismiss` must close
  it, because an iOS swipe has already taken it off screen; to refuse while a
  write is in flight, pass `dismissDisabled`.
- `Icon`'s `name` is a closed union. A glyph is decorative by default — hidden
  from assistive tech and never takes touches — until given a `label`. Geometry
  is vendored from **Lucide 1.47.0** (ISC; notice in `LICENSE.lucide`) plus a
  few BoGa glyphs; add new icons from that same release and name them by role.
  `apps/mobile/__tests__/ui-icon.test.tsx` fails if a retired Unicode glyph
  returns anywhere in `app/`, `components/` or `src/` — no file is exempt.
- Coverage for the whole set:
  `apps/mobile/__tests__/ui-design-primitives.test.tsx`.

## Shared components by area

One folder under `apps/mobile/components/` per area. Reach into another area's
folder rather than re-implementing its row, card or sheet.

| Folder | What it owns |
| --- | --- |
| `navigation/` | `MainTabBar` / `MainTabs` — the one bottom bar, drawn identically by the tab layout, the session view and exercise history; `MoreHubBackButton` (the `source=more` back action); the root stack and the auth route guard. The tab order, labels, routes and testIDs live in the non-visual model `apps/mobile/src/navigation/main-tabs.ts`, and presses go through `apps/mobile/components/navigation/use-open-main-tab.ts` so Train opens a workout in progress |
| `exercise-core/` | `ExerciseCoreFields` — the exercise name and weight-entry controls with `validateExerciseCore`, composed by both the personal editor and the group exercise form, so the two never diverge |
| `exercise-catalog/` | `ExerciseEditorModal` (create/edit, reused by the catalogue, the picker's `Add new`, group `Add as new`, the exercise page and the group exercises page) and `ExerciseListContent` / `ExerciseListPreferenceControls` — the shared list rows, family headers and filter row for every exercise list. The grouping, filtering, sorting, row stats and preference models are `apps/mobile/src/exercise-catalog/` |
| `exercise-page/` | the in-workout exercise page: top bar, `RecordsPanel`, `SetRow`, `SetLogger`, `SwipeSetRow`, `SetReorderHandle` / `SetReorderList` (the playlist-style set reorder), the effort and options sheets, and `ExerciseSwapSheet` (a `PageSheet` reusing `ExerciseListContent`). Rules live in `apps/mobile/src/session-recorder/exercise-page-model.ts` and `ux-rules.md` "Reordering sets in the recorder" |
| `session-recorder/` | the exercise picker (body of the `app/session/[sessionId]/add-exercise.tsx` page-sheet route — it only **adds**; swapping is the exercise page's `ExerciseSwapSheet`), `SessionInsightPresentation` (shared by live, completion and historical Summary) and the session / exercise / set / location types in `types.ts`. The folder name predates the session view |
| `session-view/` | the active session and completed-session edit: `SessionTopBar` (its `active` / `completed` / `complete` modes), `SessionSummaryCard`, `SessionTimesFields`, `SessionExerciseCard`, the gym and options sheets |
| `session-planner/` | the one-off plan surfaces: `PlanFormScreen` (the shared create/edit/duplicate editor), `PlanBlockEditor` (one block's target sets), `PlanExercisePickSheet` (the catalogue-in-a-sheet block picker), `PlanCardChoiceSheet` (the compatible-card choice when attaching a block finds several candidates), and `PlanSection` / `PlanSessionAction` / `usePlanSections` (the Sessions hub's planning sections and its persistent `Plan session` action). The domain behind them is `apps/mobile/src/session-planner/` |
| `session-detail/` | the read-only session cards — `SetSummaryRow`, `ExerciseSetsCard`, `SessionFactsCard` — shared by the session view, View Session, exercise history and the group session view. Row and card models: `src/session-recorder/session-view-model.ts`, `completed-session-detail-model.ts` |
| `session-complete/` | the post-submit presentation: `SessionCompletionScreen`, `SessionMuscleBreakdown` / `SessionSummaryContent` (shared with historical review), `PersonalRecordCard`, `ExerciseVolumeCard`, and `SessionShareSheet` / `SessionShareCard`. The share image is privacy-limited: all PRs and exercise comparisons, never gym or location data |
| `view-session/` | View Session's composition, top bar and sheets (route `app/completed-session/[sessionId].tsx`) |
| `session-list/` | `SessionSummaryLine`, `ActiveSessionRow`, `HistoryList` (Sessions' one virtualized `SectionList`, the hub blocks as its header: [[session.history-weeks]]), the week grouping (`history-weeks.ts`), and the `SessionListItem` types plus the `useSessionListData` hook and data client (`history-data.ts`, which attaches each session's PRs) |
| `today/` | the Today cards: `TodayProgressCard` with `WeekFigures`, `ShareBar` and `MonthPace`; the group card; and `SessionSummaryRow` + `TrainingNowMark`, the session row both cards and Sessions' history share. Reads: `apps/mobile/src/progress-summary/` |
| `train/` | `StartDisc`, Train's one action |
| `heatmaps/` | `DailyHeatmap` / `WeeklyHeatmap`, `HeatmapLegend` and their data and metric modules; semantics in `apps/mobile/components/heatmaps/README.md` |
| `stats/` | `HistoryView`, the body of the history page (`app/progress-history.tsx`) for one exercise definition or muscle: its view and metric selectors and the chosen view; the Timeline's week list (`week-set-list.tsx`, [[comparison.timeline-history]]) draws its cards with `ExerciseSetsCard`. Progress pushes it and restores focus to the launching row on return. `StatsTable` (`stats-table.tsx`) is the one table style both breakdowns are drawn with — a card, a micro-label header row over right-aligned figure columns, `ListRow` rows, no title. Comparison tables have one inline contribution accordion, and band a muscle family without a figure of its own |
| `gyms/` | `GymsScreen` and `GymEditor`; the gym directory and writes are `src/session-recorder/gym-options.ts`, location reads `src/location/gym-location-reads.ts` |
| `groups/` | every group surface, behind the barrel `apps/mobile/components/groups/index.ts`: stream session and membership items, `GroupStreamList`, boards (`GroupBoardRow`, `GroupMetricBoard`, `GroupMetricHistory` and its tap-to-cycle filter pill `GroupCycleButton`, `GroupPodiumCard`, `GroupLeaderboardsPage`), the record and action sheets, member and exercise rows, the group / comparison / details forms, `StandardExercisePicker`, `UsernameGate`, `GroupCertificationStatus`, `GroupSetCertification` (a record set's one status and action), `GroupOfflineBanner`, `GroupWriteNotice`, the feature state panels (thin `StatePanel` wrappers), `usePullToRefresh` and the `groupScreenStyles` page shell. Data comes from `apps/mobile/src/groups` |
| `bodyweight/` | `WeightEntrySheet`, `BodyWeightSettingsRow`, `BodyWeightScreen` — the only bodyweight entry surfaces. No session, logger or analytics component shows or edits a reading (`docs/specs/tech/bodyweight-load-contract.md`) |
| `sync-status/` | `SyncStatusPanel`, Settings' one Data & Sync card |
| `appearance/` | Settings' Appearance: the preset list, hue ring and theme preview |
| `preferences/` | the Settings preference editors (effort, Progress) and `NumberField` |
| `profile/` | the Profile cards and their panel and form hooks |

## Where a new component belongs

- **A feature folder by default.** A new *primitive* in `components/ui/` is
  added only when a screen asks for it and it has two or more consumers, built
  from the tokens above — not speculatively.
- **Non-visual models, data hooks and formatting go under
  `apps/mobile/src/**`,** paired with the feature folder (`src/exercise-catalog/`,
  `src/navigation/`, `src/session-recorder/`, `src/progress-summary/`,
  `src/groups/`). `src/**` may not import `components/**` or `app/**`
  (`AGENTS.md`, "Quality targets"), so a component holding its own rules cannot
  be tested or reused without the UI.
- **A route-level screen shell is not a catalog entry.**
  `ExerciseHistoryScreenShell` and `CompletedSessionDetailScreenShell` are
  exported from their route files so the surface can be wired from another
  route; they are route composition and test seams, not reusable building
  blocks. Document them in `screen-map.md` and `navigation-contract.md`.
