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

**Reuse before adding.** Build from `apps/mobile/components/ui/index.ts`.
Token guardrails apply to every composition (`ux-rules.md`, "Styling guardrails").

## Coded compositions

CompactCard/CompactHeader serve Stream and embedded CoW headers; SummaryTile
serves Group stats. ListCard and compact ListRow serve the two weekly boards.
StatsTable now composes the compact row foundation for Muscle/contributor tables.
For a new block or derivative, follow the selection and review workflow in
`docs/specs/08-ux-delivery-standard.md` before building.

| Family | Reuse / reference | Boundary to preserve |
| --- | --- | --- |
| CompactCard / CompactHeader | `compact-card.tsx`: fixed compact Card and shared label/metadata header; Stream and CoW | Embedded summaries reuse only the header inside their existing container; Card accessibility actions retain nested record callbacks |
| ListCard / ListCardHeader | `list-card.tsx` and compact `list-row.tsx`; GroupHomeBoard and Today's weekly board | Passive rows and a whole-board action differ from independent row controls |
| SortableTable family | `stats/stats-table.tsx`: StatsTable, compact StatsTableRow/Name/Disclosure and comparison columns; Muscle list/contributors | Keep sorting with its current owner, separate history/disclosure targets and responsive stacking |
| SummaryTile | `summary-tile.tsx`: shared header and existing metric content; At a glance's Group stats | Both Sets/GR remain visible; period controls stay outside and metric controls govern the board/chart |

### Promoted templates

New registrations live in this machine-readable inventory. The four families
above retain their existing checker inventory. For promotion, contract schema
and executable examples, load `docs/specs/08-ux-delivery-standard.md` and
`apps/mobile/__tests__/ui-template-promotion.test.ts`. This change promotes none.

```ui-template-catalog
[]
```

## Existing primitives (`apps/mobile/components/ui/`)

| You need | Reach for |
| --- | --- |
| The page ground; a scrolling page body with the gutter and card gap | `Screen` / `ScreenScroll` (`screen.tsx`) |
| A compact summary or an embedded label/date header | `CompactCard` / `CompactHeader` (`compact-card.tsx`); feature content and actions retain their owners |
| A headline metric tile | `SummaryTile` (`summary-tile.tsx`); fixed frame/header, feature-owned WeekFigure or Stat content |
| A container for content | `Card` (`card.tsx`) — with `onPress` the whole card is one labelled link |
| A legend plus a figure | `Stat` (`stat.tsx`) — `stacked` or `inline`; its only emphasis is `record` |
| A compact board with a shared header, optional columns and footer | `ListCard` / `ListCardHeader` (`list-card.tsx`); standalone or embedded, action limited to its board region |
| A row in a list, a card or a sheet | `ListRow` (`list-row.tsx`); `compact` shares the list/table content rhythm and preserves full control targets |
| A picker or menu: row actions, options, a choice of one value, a short form | `Sheet` (`sheet.tsx`) |
| A title switching sibling pages | `HeaderTitleMenu` (`header-title-menu.tsx`) |
| A sub-page over the current screen: a browser, an editor, a preview | `PageSheet` (`page-sheet.tsx`); its `PageSheetHeader` also heads the exercise picker route |
| The screen's one primary action, or an outline / text button; `size="compact"` for a row-level action; `variant="link"` for a heading's link | `ActionButton` (`action-button.tsx`) |
| A line of words with figures in it (`2 exercises · 3 sets`) | `FigureText` (`figure-text.tsx`) |
| An icon-only control | `IconButton` (`icon-button.tsx`); optional `nativeHeader` uses the native button host |
| An on-demand explanation, optionally beside a heading | `Information` (`information.tsx`) — owns the info trigger, prose and standard `Sheet` |
| A glyph | `Icon` (`icon.tsx`, geometry in `icon-glyphs.ts`) |
| A filter, breakdown, view or compact history links | `SegmentedControl` (`segmented-control.tsx`) — `fill` / `fit` / `inline`, `density="compact"` and icon segments for two controls sharing a row; navigation mode reuses the frame as links |
| A loading, empty, message or error state — whole-screen or inside a card | `StatePanel` (`state-panel.tsx`) |
| The inline outcome of an action | `Notice` (`notice.tsx`) |
| A labelled free-text input (a form's name or title) | `FormField` (`form-field.tsx`) |
| A form's section (optional `title`, `footnote`) and its rows: a choice that opens a picker (optional leading `icon`), a short figure in place, an action (`ActionRow` `kind`: `navigate` chevron, `act` accent, `danger`), a section error | `FormSection`, `ChoiceRow`, `InputRow`, `ActionRow`, `FormError` (`form-section.tsx`; `ux-rules.md` "Forms") |
| A Settings row: one of ≤3 options under its label, the one chosen of many (radio, optional `meta` swatch), several (checkbox), a read-only value (one accessible element unless it has a `valueTestID`; optional glyph, `danger` tone), a number on a stepped track (`SliderRow`) | `SegmentRow`, `RadioRow`, `CheckRow`, `ValueRow` (`form-rows.tsx`), `SliderRow` (`slider-row.tsx`; `ux-rules.md` "Settings pages") |
| A search input | `SearchField` (`search-field.tsx`) |
| Full-width pages swiped between under tabs that name them (UX pattern 15) | `SwipePages` (`swipe-pages.tsx`) |
| One choice from a few | `SegmentedControl` (`segmented-control.tsx`) — neutral, or `selection` for filters (black; white in dark) |
| One filter of a few values where a row of them cannot afford every label | `ToggleChip` (`toggle-chip.tsx`) — the value in force plus the `swap` glyph; a tap steps to the next |
| Wrapping pills, single- or multi-select | `ChipGroup` (`chip-group.tsx`) |
| One option or setting on or off, in a sheet (`Show deleted sessions`) or a form card (`Track each gym separately`, `density="list"`, optional `description`) | `SwitchRow` (`switch-row.tsx`) |
| A static label naming a state (`Archived`, `Deleted`, a role) | `Tag` (`tag.tsx`) |
| A tab screen's in-content title, or a section heading | `PageHeader` / `SectionHeader` (`page-header.tsx`); every other page takes the native header (`ux-rules.md` "Pages") |
| Live theme colours: a stylesheet, a colour prop, the mode | `makeStyles`, `useUiRoles`, `useUiMode` (`theme-context.tsx`), `useUiText` (`text-roles.ts`) |
| Fonts, geometry, spacing, type and icon sizes | `tokens.ts` — `uiFonts`, `uiGeometry`, `uiSpace`, `uiTypography`, `uiIconSize`, `uiBorder`; theme seeds in `theme.ts`, `theme-presets.ts`, `theme-launch.ts` |

### Gallery and adoption scope

Open `app/ui-gallery.tsx` by explicit development-only deep link:
`boga3://ui-gallery?family=<family>&review=1`. Families are `compact`, `list`,
`table` and `summary`; `sample=summary` also works.
Omit `review=1` for controls; `long=1` selects long content.
Use list/table `sample=rows` to compare identical passive, wrapped, own/selected
and independent-control rows. Compact samples cover Stream, CoW and embedded summaries. Route and navigator share `isUiGalleryAllowed`.

Adoption lists in the four `apps/mobile/scripts/*-pattern-guardrail.js`
modules protect Stream/CoW, both weekly boards, Muscle/contributor tables and
Group stats. New or changed JSX/presentation additionally declares template reuse or
custom design in its PR UX Contract; spec 08 owns that process and review.
Missing declarations fail the existing guardrail lane. Template selections extend
the checks to new consumers, including TS/TSX style companions and
imported/re-exported style modules. Cases:
`apps/mobile/__tests__/ui-pattern-selection.test.ts` and
`apps/mobile/__tests__/pattern-adoption-guardrail.test.ts`.

Foundation definitions own geometry and retain their component tests. Template consumers
cannot override their selected family's type/casing or pattern style props;
compact list/table consumers cannot add row insets/minimums. Page/chart layout,
CoW podiums and record targets retain their existing contracts. Figure widths
remain feature-owned. Existing compositions keep their recipes; new or
changed JSX cannot silently opt out. Other catalog primitives are useful parents
for custom design; they do not make it an approved template. Gallery fixtures
are parents only inside the existing guarded development route.

Use `template` for approved families/variants, `custom` for everything beyond
them. Custom use follows normal PR review; only reusable-template promotion
needs separate human acceptance in spec 08. Humans decide semantic fit. No new
suppression or increased budget substitutes for fixing drift.

### List pattern adoption

`GroupHomeBoard` owns its standalone ListCard; callers do not add another Card.
Today embeds the list inside its existing card, keeping the group header and
CoW controls outside the board action. Readers retain ranking, ties, formatting
and full accessible names. Long board names keep one-line ellipses. For row
geometry, load `design-language.md` §4. Enforcement scope is above.

### Table pattern adoption

Muscle list and single-muscle contributors reuse StatsTableRow on compact
ListRow, with StatsTableName and StatsTableDisclosure owning their presentation.
Now / Prev / Δ headers reserve only the active sort arrow; nested contributors
inherit them, while standalone contributors keep a passive header. Stacked
history targets speak their figures. The Exercise table retains its existing density.
Enforcement scope is above.

Rules the code cannot state for itself:

- A primitive draws on `useUiRoles` / `uiFonts` / `uiGeometry` only — never a
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
| `pattern-gallery/` | Development-only gallery of production pattern presenters with fixed fixtures, including board/table references and compact list/table rows; deep-link only, access owned by `src/utils/isUiGalleryAllowed.ts` |
| `rm-curve/` | `RmCurveScreen` / `RmCurveContent`, the experimental reps–load scatter, fitted temporal curves, model/scope controls, dated set inspection and `RmCurveHelp` explainer; reads `src/rm-curve/`, hosted by `app/rm-curve.tsx` |
| `navigation/` | `MainTabBar` / `MainTabs` — the one bottom bar, drawn identically by the tab layout, a completed session's edit, exercise history and `TabOwnedPage`; `TabOwnedPage` (a root-stack page that keeps the tab bar under its native header: Exercises, Groups, Settings); the root stack and the auth route guard. The tab order, labels, routes and testIDs live in the non-visual model `apps/mobile/src/navigation/main-tabs.ts`, and a press on a page over the tabs goes through `apps/mobile/components/navigation/use-open-main-tab.ts`, which closes it with no animation |
| `exercise-core/` | `ExerciseNameField` and `ExerciseWeightSection` (weight entry, `Uses bodyweight` and its share) with `validateExerciseCore`, composed by both the personal editor and the group exercise form, so the two never diverge |
| `exercise-catalog/` | `ExerciseMerge` (catalogue-only browser/confirmation controller) and `ExerciseEditorScreen` (the `/exercise-edit` page, with `ExerciseLinksSection`), opened by `useOpenExerciseEditor` (`exercise-editor-request.ts`, which carries a caller's prefill and save callbacks) from the catalogue, the picker's `Add new`, group `Add as new`, the exercise page, the group exercises page and a shared exercise and `ExerciseListContent` / `ExerciseListPreferenceControls` — the shared list rows, family headers and filter row for every exercise list. The grouping, filtering, sorting, row stats and preference models are `apps/mobile/src/exercise-catalog/` |
| `exercise-page/` | the in-workout exercise page: top bar, `RecordsPanel`, `SetRow`, `SetLogger`, `SetEntryFields` (also used by plan/programme targets), `SwipeSetRow`, the effort and options sheets, and `ExerciseSwapSheet` (a `PageSheet` reusing `ExerciseListContent`). Rules live in `apps/mobile/src/session-recorder/exercise-page-model.ts` and `ux-rules.md` "Swipes on the exercise page" |
| `session-recorder/` | `RestTimerBar` with `RepeatingTimerFocus` (the session/exercise timer strip and its fullscreen repeating presentation; state in `apps/mobile/src/session-recorder/rest-timer.ts`), the exercise picker (body of the `app/session/[sessionId]/add-exercise.tsx` page-sheet route — it only **adds**; swapping is the exercise page's `ExerciseSwapSheet`), `SessionInsightPresentation` (shared by live, completion and historical Summary) and the session / exercise / set / location types in `types.ts`. The folder name predates the session view |
| `session-view/` | the active session and completed-session edit: `SessionViewScreen` (on the Train tab, or as the edit page), `SessionTopBar` (its `active` / `completed` / `complete` modes), `SessionSummaryCard`, `SessionTimesFields`, `SessionExerciseCard`, the gym and options sheets |
| `session-planner/` | the planning surfaces: `PlanFormScreen` (the shared create/edit/duplicate one-off plan editor), `PlanScheduleSheet` (native date/time picker sheet with clear action), `PlanBlockEditor` (one block's target sets), `PlanSetAddForm` (count-only copies of the last target, shared by both editors), `PlanExercisePickSheet` (the catalogue-in-a-sheet block picker), `PlanCardChoiceSheet` (the compatible-card choice when attaching a block finds several candidates), `ProgrammeFormScreen` / `ProgrammeSessionEditSheet` (the multi-session programme editor and focused child-session editor sheet), `ProgrammeDetailHeader` / `NextProgrammeBlockCard` / `ProgrammePlanList` (programme detail summary, next unresolved block card, child plans list with reordering), and `PlanSection` / `PlanSessionAction` / `NewProgrammeAction` / `usePlanSections` (the Sessions hub's planning sections and persistent authoring actions). The domain behind them is `apps/mobile/src/session-planner/` |
| `session-detail/` | the read-only session cards — `SetSummaryRow`, `ExerciseSetsCard`, `SessionFactsCard` — shared by the session view, View Session, exercise history and the group session view. Row and card models: `src/session-recorder/session-view-model.ts`, `completed-session-detail-model.ts` |
| `session-complete/` | the post-submit presentation: `SessionCompletionScreen`, `SessionBreakdownPager` (two pages, `By muscle` then `By exercise`), `SessionMuscleBreakdown` / `SessionSummaryContent` (shared with historical review), `PersonalRecordCard`, `ExerciseVolumeCard` (drawn only with a distribution) with `ComparisonUnavailableCard` pooling the rest by name, and `SessionShareSheet` / `SessionShareCard`. The share image is privacy-limited: all PRs and drawn comparisons, never gym or location data |
| `view-session/` | View Session's composition, top bar and sheets |
| `session-list/` | `SessionSummaryLine`, `ActiveSessionRow`, `HistoryList` (Sessions' one virtualized `SectionList`, the hub blocks as its header; one section per calendar week, newest first), the week grouping (`history-weeks.ts`), and the `SessionListItem` types plus the `useSessionListData` hook and data client (`history-data.ts`, which attaches each session's PRs) |
| `today/` | the Today cards: `TodayProgressCard` (the progress card with `WeekFigures`, `ShareBar` and `PeriodPace`, over `TodaySessionCard`); the group's board (headed by `TodayGroupHeader`: the group's name and `TodayGroupSwitch`) and sessions cards; `StepAround`; and `SessionSummaryRow` + `TrainingNowMark`, the session row Sessions' history uses. The pager: `TodayCards` on `SwipePages`, and `TodayPanel`. Reads: `apps/mobile/src/progress-summary/` |
| `train/` | `StartDisc` |
| `heatmaps/` | `DailyHeatmap` / `WeeklyHeatmap`, `HeatmapLegend` and their data and metric modules; semantics in `apps/mobile/components/heatmaps/README.md` |
| `stats/` | `HistoryView`/`HistoryTitle` own history and focus return; `HistoryPeriodDetail` reuses Timeline’s cards for muscle/exercise day/week sets. `MuscleBodyCard` draws the rotatable model with [[comparison.colour-scale]]. `ProgressMuscleView` selects list or body presentation; both reuse `ProgressContributionRows`. `StatsTable` owns the table frame/rows, `comparison-columns.tsx` responsive figures, `comparison-format.ts` formatting and `ui/change-tone.ts` colour. `ProgressFilters` owns grouping, secondary-set and gym choices. |
| `gyms/` | `GymsScreen`, `GymEditor` and `GymPicker` (a view's gym filter, [[gym.view-filter]]: a button naming the scope, opening a sheet of radio rows, never a chip per gym; a header places `GymPickerButton` and `GymPickerSheet` apart; a sheet holding other choices draws `GymScopeChoices`, its rows); the gym directory and writes are `src/session-recorder/gym-options.ts`, location reads `src/location/gym-location-reads.ts` |
| `groups/` | every group surface, behind the barrel `apps/mobile/components/groups/index.ts`: stream session and membership items, `GroupStreamList`, `CoWStreamCard` (lifecycle link to its challenge), boards (`GroupBoardRow`, `GroupMetricBoard`, `GroupMetricHistory`, `GroupRecordsLogRow`, `GroupBoardTitle`, `GroupCycleButton`, `GroupPodiumCard`, `GroupLeaderboardsPage`), `GroupCoWsPage` (browser shared by Groups tab and standalone route), record and action sheets, member and exercise rows, group / comparison / details forms, `StandardExercisePicker`, `UsernameGate`, `GroupCertificationStatus`, `GroupSetCertification`, `GroupOfflineBanner`, `GroupWriteNotice`, feature state panels, `usePullToRefresh` and `useGroupScreenStyles` page shell. Data comes from `apps/mobile/src/groups` |
| `bodyweight/` | `WeightEntrySheet`, `BodyWeightSettingsRow` (Settings' row), `BodyweightCalculationsRow`, `BodyWeightScreen` — the only bodyweight entry surfaces. No session, logger or analytics component shows or edits a reading (`docs/specs/tech/bodyweight-load-contract.md`) |
| `injuries/` | `InjuriesScreen` (`/injuries`), `InjuryRow`, `InjuryEditorSheet` (editor/check-in sheet) and `InjuriesSettingsRow` (Settings row) |
| `sync-status/` | `SyncStatusPanel` (Settings → Data & sync), with `ExerciseMergeReviewScreen` (its Review changes page) for current/saved changes and uncertain operation recovery and the snapshot hook behind its Settings row's status |
| `settings/` | The home rows' status strings, the sub page screens (`SubPage`), Everything else, Data & sync's `BackupPanel` |
| `more/` | More's connected-agent read for `Connect an AI` |
| `notes/` | `NotesScreen` (`/notes`), its form and rows |
| `appearance/` | Settings' Appearance pages; launcher reconciliation and the shared figure's calendar hook implement [[appearance.november]] |
| `notifications/` | Settings' Notifications page and the group mute row; server-confirmed state comes from `src/notifications` |
| `preferences/` | Settings editors (rest timer, effort, Progress); full muscle setup/target pages and their numeric fields |
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

### SummaryTile reference

Group stats in GroupGlancePage uses the fixed headline tile frame with existing
WeekFigure metrics. Native gallery sample `summary` renders the same page with
period/metric controls and fixed ready, past, large, zero, no-baseline, held,
loading, error/retry and offline fixtures. Read state stays outside the tile.
