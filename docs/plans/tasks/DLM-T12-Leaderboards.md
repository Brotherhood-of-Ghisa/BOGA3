---
task_id: DLM-T12-Leaderboards
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/tech/groups-contract.md (display copy), docs/specs/ui/design-targets/groups.md"
---

# DLM-T12 Leaderboards

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T11.
- Design target: extends `design-targets/groups.md`.
- Files (about 660 lines):
  - `app/group/[groupId]/leaderboards/[exerciseId]/{index,history}.tsx`;
  - `components/groups/{group-leaderboards-page,group-board-row,group-board-history-item}.tsx`;
  - `GroupPodiumCard`, which lives in `group-leaderboards-page.tsx`.

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| Podium card: pressable `UiSurface`; name + view label ("Certified · e1RM"); an **"Archived" pill** (`borderMuted`); up to three rows rank · member · value · date; **"me" shown by weight only** (:93); empty label; "You: …" | A link `Card`: name in Archivo 700, the view label as a micro-label, `Tag` "Archived". Rank rows in Plex Mono (rank, value, date) with the member in Source Sans. My row reads **"You"** in `ink` 700 (text, not weight alone). testIDs are kept (`group-podium-card-<id>` with `-name`, `-view`, `-archived`, `-row-<rank>`, `-empty`, `-you`); the Maestro accessibility-label regexes stay true under T12-D2 |
| Board header: name (title), "Archived · read-only" (subtitle), **History (secondary)**; metric chips "Weight / e1RM" and scope chips "Certified / All" (both joined) | Name as the native header title (it already replaces it). "Archived · read-only" in `ink-muted` (asserted :353). History a text `ActionButton`. Metric and scope → `SegmentedControl`s (`group-board-metric-*` / `group-board-scope-*` kept; labels "Weight" / "1RM", T12-D2) |
| `GroupBoardRow`: `UiSurface`; **my row on `panelMuted`**; rank (title), member, value, detail (`bodyMuted`), date, certification mark ("uncertified" on All) | A `ListRow density="list"` inside one board `Card`: rank and value in Plex Mono, member in Source Sans, detail `ink-muted`, and the date. **My row on `surface-subtle` + "You"** (T12-D1). Marks from T11 (`ink`). testIDs kept (`group-board-row-<rank>` with `-member`, `-value`, `-detail`, `-date`, `-mark`) |
| "No certified sets yet" + **See all sets (secondary)**; `NO_SETS_LABEL`; missing data; lost access; "This exercise isn't in this group" | `StatePanel`s (T11's wrappers). `See all sets` outline (`group-board-see-all-button` kept) |
| History: view label, list of `GroupBoardHistoryItem` (a `UiSurface` with date + sentence), footer | One `Card` of rows: date in Plex Mono micro, sentence in Source Sans. testIDs kept (`group-board-history-item-<seq>` with `-date`, `-sentence`) |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T12-D1 | My board row: the muted panel (which also meant "voided" before T11) | `surface-subtle` + "You" label |
| **T12-D2** | "e1RM" in the metric label and view labels ("Certified · e1RM"), built in `src/groups/board-view-model.ts:21,43,147` | **"1RM"**, with `kg` dropped from value slots (G7 (a)). The Maestro regexes matching "Certified · e1RM" and the board-row labels update in this PR. The `metric=e1rm` param, the `e1rm` key and testIDs are unchanged. `groups-board-view-model.test.ts` updates |

## UX contract

- **Scan podiums.** Trigger: the Leaderboards segment. Success: one card per
  group exercise on `Certified · 1RM`, the whole card opening the board. Edge:
  an empty Certified podium reads `No certified sets yet · N uncertified`.
- **Read a board.** Trigger: a podium card. Steps: metric → scope → rows.
  Success: rows; my row reads "You"; a row opens the record sheet (T11). Edge:
  empty Certified offers `See all sets`; offline shows loaded rows with the
  notice; nothing loaded offline shows the offline panel.
- **History.** Trigger: `History`. Success: lead changes, newest first.

## Gallery

`groups-two-user-stream`:

- `07b-1-podiums`, `07b-2-board-certified-empty`, `07b-3-board-all-e1rm`,
  `07b-4-board-all-weight`, `07b-5-history-link`;
- `07c-3-podium-certified`, `07c-4-board-certified-weight`,
  `07c-5-history-certified`;
- `unlink-06-certified-empty`, `unlink-07-restored-certified`;
- `08b-board-former-member`.

## Tests

- `groups-leaderboards-screens.test.tsx`:
  - :215 "Archived" and :353 "Archived · read-only" are kept;
  - :238, :391 offline text kept;
  - :292/:295 mark testIDs kept;
  - "e1RM" label assertions → "1RM" (T12-D2).
- `groups-board-view-model.test.ts`: if the view label is built there, update
  the string; this is display copy only.

## Docs

- `ux-rules.md` §14.12–13 (labels, "You").
- `components-catalog.md` (`GroupLeaderboardsPage`, `GroupPodiumCard`,
  `GroupBoardRow`, `GroupBoardHistoryItem`).
- `tech/groups-contract.md` display-copy mentions.
- `design-targets/groups.md`.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the listed files.
2. Gallery accepted.
3. Estimate: about 700 lines.
