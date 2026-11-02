# M40-T01 — Agree pattern contracts and human acceptance

- Status: `in_progress` — contract proposal awaiting human selection
- Depends on: none
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: docs, frontend discovery; UI impact: no shipped UI in this task

## Objective

Make the four pattern contracts concrete enough to implement and review. Agree
compact density and the human acceptance process against current native screens,
including the exact At a glance tile and leaderboard references.

## Scope and decided

Follow milestone D1–D6. Inventory existing foundations and callers before
proposing exports; reuse Card, ListRow, Stat and StatsTable. This task captures
and agrees targets and updates workflow docs; production components and screen
migrations belong to later cards. The HTML sketches are conceptual inputs only.

## Open — resolve with the human before implementation

- Confirm working component names, their content/action slots and bounded
  variants. Show the four references and get the human's selection.
- Agree a compact row recipe for ListCard and SortableTable: exact token roles,
  vertical insets, text/number alignment, multiline growth, nested rows and any
  passive/interactive variant. Preserve full touch targets without stacking
  duplicate minimum heights. Do not assume a passive row must be 44pt tall.
- Identify the At a glance headline Group stats tile separately from the period
  controls; confirm what the human meant by the top tile.
- Agree the small/normal native viewports, initial gallery host and how the human
  will inspect builds. Identify the first guardrail scope and any art/native
  boundary exceptions that require explicit treatment.

## Deliverables and acceptance

1. Recheck current main; capture and inspect the actual Stream, leaderboard,
   Progress Muscle/contributor and At a glance references. Keep captures under
   the gitignored artifact tree and link them from the PR.
2. Record the agreed contracts and native design targets, including fixed
   styling versus feature-provided content/behavior, in the task/PR. Show the
   shared row recipe for list/table side by side. Highlight conflicts with
   existing semantics instead of silently resolving them from the mocks.
3. Publish the workflow rule: recommend existing patterns and ask the human to
   choose; present a parent/delta proposal before a new derivative is built.
4. Publish a human acceptance checklist requiring explicit acceptance of coded
   components and migrated screens at the reviewed commit before each migration
   ships. Approval of this task does not accept the later coded result.
5. Update the remaining cards with settled references and contract decisions.
   Human acceptance of the contracts is required before T02 starts.

## Proposed contract and native target — awaiting human selection

Freshness: checked against `96f9fd41f174554fcf5c4cf35221de8e306d82c7`.
The production presenters below are unchanged. Native discovery renders use
representative fixtures, with CoW read hooks replaced only in the temporary
capture runtime; they do not claim live server, auth or navigation validation.
The capture host and read replacement are removed before the final diff.
Artifacts: `apps/mobile/artifacts/pattern-contracts/`; each native viewport has
`glance`, `today`, `table`, `cow`, `stream` and `-long` PNGs. Both visibility-checked
capture runs passed. Fixture date: local noon, 30 October 2026. These capture
current production presentation, not the proposed new row geometry.

| Native references | Small (375pt) | Normal (402pt) |
| --- | --- | --- |
| Headline tile and passive board | `native/small/glance.png` | `native/normal/glance.png` |
| Embedded CoW and weekly board | `native/small/today.png` | `native/normal/today.png` |
| Muscle and expanded contributors | `native/small/table.png` | `native/normal/table.png` |
| Long content and figures | `native/small/table-long.png`, `native/small/today-long.png` | `native/normal/table-long.png`, `native/normal/today-long.png` |

Paths in this table are relative to the artifact root above. Native rendering
confirms the existing distinction between passive board rows and independent
table controls. The 375pt long-content table stacks its values without shrinking.
Today's fixed-width figure cells currently split five-digit counts over lines;
the shared row should reserve enough value width (and stack when necessary)
before allowing a figure to break. Preserve one-line board names with their
complete accessible labels; this is a sizing correction, not numeric compaction.

### Recommended families and boundaries

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

### Recommended compact row recipe

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
ListRow/table controls can stack to 52pt. The proposed 4pt content inset is a
design choice to accept, not a measured property of today's components.
Long board names keep the existing one-line ellipsis and full accessible name;
table names retain wrapping/stacking. A wrapping board variant needs a separate
parent/delta selection rather than silently changing the first migration.

### Exact references, preview host and review states

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
- Proposed review devices: iPhone SE (3rd generation), 375 × 667pt, and iPhone
  17 Pro, 402 × 874pt, on the pinned iOS 27 runtime. Use fixture-backed running
  native renders and linked captures for contracts; each later migration still
  needs its own before/after inspection and acceptance at the reviewed commit.
- Proposed gallery host: a development-only sibling route reached by explicit
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

Human selection is pending for this proposal. Do not mark the contracts agreed,
delete this card, or start T02 on the strength of these discovery captures.

## Specs to update

- `docs/specs/08-ux-delivery-standard.md` — selection and human acceptance workflow.
- `docs/specs/ui/ai-design-policy.md` — native target/acceptance evidence if its
  existing visual comparison rule needs clarification; keep one owner per rule.
- `docs/specs/ui/design-language.md` — agreed compact composition/row principles.
- `docs/specs/ui/components-catalog.md` — selection guidance; label unimplemented
  families as planned, with no claim that new exports already exist.
- `AGENTS.md` — concise load trigger/required selection step, pointing to owners.

## Gates and closeout

Start from `./boga test for`; expected docs-only lane: docs-check. Agree the
final set with the independent reviewer and run the repository's required
quality targets. Run fast if production or test code enters the diff. Capture
work uses the slot-isolated native runtime; run doctor and repair prerequisites
before declaring it unavailable. Run independent code and product reviews.
Delete this card and mark it completed in the milestone in the shipping PR;
downstream work begins only after the human-approved PR merges.
