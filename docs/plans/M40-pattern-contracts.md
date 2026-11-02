# M40 — Approved pattern templates and implementation brief

- Status: template selection approved by the operator on 2026-11-02.
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`.
- Authority: build input for the remaining cards; delete with the milestone.
  Lasting rules belong to their owning specs and shipped components.

## Human template selection

The operator said: “Ok all ‘after’ are approved as templates”. This selects the
four native after previews shown in this Codex conversation: CompactCard,
ListCard, SortableTable and SummaryTile. Preserve SummaryTile's existing visual
appearance; its first migration is an extraction, with the period controls
outside the tile. This selects templates, not a shipped production migration.
The workflow, content/action boundaries and review scope below implement that
selection; API details still belong to each implementation task.

The accepted preview used a dedicated iPhone 17 Pro Max simulator on iOS 27.0:
440 × 956pt at 3× (1320 × 2868px), light appearance, font scale 1, fixed fixtures
and date (local noon, 30 October 2026). Base commit:
`727482247df84d623cb8e50b3021199ddaba2f55`, with a temporary native preview patch;
the after images are not the unmodified commit's production result.

Capture identity and the operator's acceptance are recorded in PR #1063. Native
artifacts remain local and gitignored under
`apps/mobile/artifacts/pattern-contracts/native/max-preview/`: screenshots,
source-proposed, the preview patch, capture flows and logs. The conversation
also retains the eight original PNGs and the before/after comparison.
No preview route, fixture override or temporary source change ships here.

## Accepted families and boundaries

| Family / working API | Fixed presentation | Feature-provided content and behavior |
| --- | --- | --- |
| CompactCard | Label/metadata header, subject, short facts; standalone or embedded container variant | Subject/metadata/facts and existing action callbacks; independent record actions remain reachable |
| ListCard | Shared header, optional column labels, shared rows, optional existing footer action | Stable row identity, rank/ties, names, formatted figures, selected/own state and existing board/row actions |
| SortableTable family, retaining StatsTable exports | Existing title-free table, column headers, shared rows, nested indentation/disclosure | Columns, sort state/callbacks, formatted values, grouping, separate history/disclosure actions and focus return |
| SummaryTile | Compact header and headline metric group; optional supporting section only when needed | Existing WeekFigure/Stat content and comparisons; no new chart/action slots for the first consumer |

None exposes arbitrary type, spacing or density styles. Reuse existing
primitives, text roles, formatting and feature models. Preserve whole-card,
board-region and independent-action boundaries instead of nesting controls
under one accessibility target.

### Accepted compact row recipe

| Rule | ListCard and StatsTable at the same density |
| --- | --- |
| Words / figures | `body` or `bodyStrong` for the existing semantic distinction; `figure` for row numbers; both use the existing 20pt base line height |
| Quiet metadata / headers | `meta` and `figureSmall` for supporting data; `label` for column headings; no local casing/type assembly |
| Vertical content inset | `uiSpace.xs` (4pt) above and below content, shared by both families |
| Passive row | No touch-target minimum: one 20pt content line plus its insets is 28pt, excluding the separator |
| Independently interactive row | At least `uiGeometry.tapTarget` (44pt); a 44pt child target is not wrapped in another 8pt of row padding |
| Wrapped / stacked content | Grow naturally; two base lines plus insets need 48pt. Keep existing table stacking when columns consume the name's floor; never shrink figures |
| Alignment / separators | Names start on one axis, numbers right-align in feature-sized columns; `uiBorder.width` / `uiRoles.ruleSoft` separators; nested contributors inherit the same vertical rhythm |

The passive and interactive variants differ only where touch targets demand it.
Current boards use 6pt vertical insets and compact passive rows; current
ListRow/table controls can stack to 52pt. The accepted 4pt content inset is the
implementation target; current production components still use their
pre-migration geometry.
Long board names keep the existing one-line ellipsis and full accessible name;
table names retain wrapping/stacking. A wrapping board variant needs a separate
parent/delta selection rather than silently changing the first migration.

### References, preview host and review states

- Compact: `components/groups/stream-session-card.tsx` and
  `group-metric-stream-card.tsx`; Today's `group-cow-summary.tsx` inside the
  unchanged `TodayGroupCard` board; also `CoWPreview` for timezone/metric states.
  Current CoW is a link; previous winners are passive; missing/error Retry is
  independent. Embedded summaries do not add another Card.
- List: `GroupHomeBoard` in `GroupGlancePage`, plus Today's weekly board.
  The former is passive; the latter has one board-region target separate from
  its group switch and CoW controls. Preserve bars, ties and own-member emphasis.
- Table: `ProgressTables` with expanded `ProgressContributionRows`, and the
  single-muscle contributors in `ProgressMuscleView`. Contributor headers inherit
  context; they do not gain independent sorting.
- Tile: `group-week-totals-card` in `GroupGlancePage`, headed **Group stats**.
  It always shows both Sets and PRs. The page metric changes the board/chart,
  not these two figures; period controls stay above the cards.
- Implementation review devices: iPhone SE (3rd generation), 375 × 667pt, and iPhone
  17 Pro, 402 × 874pt, on the pinned iOS 27 runtime. Use fixture-backed running
  native renders and linked captures for contracts; each later migration still
  needs its own before/after inspection and acceptance at the reviewed commit.
- Gallery host: a development-only sibling route reached by explicit
  harness/deep link, guarded with the existing `isDevMode`/store-client boundary.
  No ordinary navigation entry, release behavior or added hosting dependency.
- Initial guardrail scope: the migrated production consumers named above and
  their extracted TS style modules, plus the new shared pattern definitions.
  Foundation definitions may set role geometry; consumers may not override it.
  Existing display-art/native field-reading boundaries retain explicit treatment.
  Untouched screens are outside the initial claim; a touched consumer joins
  after its pattern/derivation is selected and accepted. No raised budget or
  new baseline entry is proposed.
- Later review fixtures: normal/long names and figures, multiline/stacked rows,
  own/selected states, current/past/pending/unavailable/absent CoWs, and relevant
  empty/loading/error/retry states. Show the same row content as list/table
  beside each other before accepting the shared implementation.

Production migrations still require their own coded-result review and acceptance
at the reviewed commit. The approved template selection is carried forward; only
a material deviation or new derivative needs a new template decision.
