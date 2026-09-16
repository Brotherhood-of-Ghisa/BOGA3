---
task_id: M25-T09-Mobile_leaderboards
milestone_id: "M25"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend (includes ios-groups-e2e)"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M25-T09 — Mobile leaderboards: podium page, full board, history

## Task metadata

- Task ID: `M25-T09-Mobile_leaderboards`
- Status: `planned`
- Depends on: `M25-T05` (PR #294, merged), `M25-T08` (PR #290, merged)
- Uses (merged): `M25-T07` (PR #292): local links and the linking flow the
  e2e reuses
- Unblocks: `M25-T10` (with T06)

## Parent references

- Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Product: `docs/plans/group-exercises-and-leaderboards.md`: P6–P9, D11,
  D12, E1.1–E1.3
- Design: `docs/plans/group-exercises-tech-design.md` §7 (`boards:<groupId>`
  for the podium page; full boards and history load online, like older
  stream pages)
- Contract: `docs/specs/tech/groups-contract.md` §2.11 (ranks, `former`,
  archived boards), §4 (errors), §4.5 (the three reads), §6.1–§6.3, §7
- As-built inputs: `apps/mobile/src/groups/api.ts` (`callGroupRpc`,
  `expectShape`), `use-group-resource.ts`, `use-group-stream.ts` (the paging
  pattern), `cache.ts` (`groupCacheKeys`, `evictGroup`),
  `stream-view-model.ts` (kg formatting, `formatOfflineMarker`),
  `app/group/[groupId]/index.tsx` (the Leaderboards segment's T08 empty state)
- UX: `docs/specs/08-ux-delivery-standard.md` patterns 4, 7, 8;
  `docs/specs/ui/ux-rules.md` §14

## Objective

The group page's Leaderboards segment shows one podium card per group
exercise on Certified · e1RM (P8, D11). Tapping a card opens the full board
with the Weight / e1RM × Certified / All toggles (P6, P7), and the board links
to its lead-change history (P9, D12). The podium page is cached. Full boards
and history are read online and paged.

As built by T05, `certified` is always `false` and every Certified board is
empty until T06. The UI must therefore handle "No certified sets yet · N
uncertified" everywhere.

## Accepted design target (`docs/specs/ui/ai-design-policy.md`)

- **Target:** repo-native brief. It is the product sketches E1.1 (podium
  cards), E1.2 (full board), and E1.3 (history) in
  `docs/plans/group-exercises-and-leaderboards.md`. No Figma or Claude
  Design artifact exists for this card.
- **Brief:** existing group-screen primitives (`UiSurface`, `UiText`,
  `SegmentedChips`, the group state panels, `GroupOfflineBanner`), with no
  new tokens. Text carries every state (rank, `former`, ✓ / ○, Archived), so
  color is never the only signal.
- **States** to capture from the running app (Maestro screenshots, iPhone
  17 Pro): podium page with an uncertified count and an archived card; full
  board Certified empty; full board All with a ranked, uncertified row; the
  same row marked `former`; history with one item.
- **Deliberate differences from the sketches** (need approval with this
  card):
  1. History is its own route, opened from a `History` button in the board
     header, not a section under the rows. Two infinite lists on one screen
     would hide history behind every board page.
  2. A void reads "X now #1", not "X back to #1". A history item does not say
     whether X held #1 before.
  3. Board rows are not pressable yet. The row detail sheet (E2) is T10.
  4. The full board's empty Certified state reads "No certified sets yet"
     with a `See all sets` button that switches the toggle. `group_board`
     carries no uncertified count; only the podium payload does.
  5. My own rows read "You" (the sketch says "Me"), matching "You: Nth".

## Scope

### In scope

1. **Wire types** (`src/groups/types.ts`, §4.5): `GroupBoardMetric =
   'weight' | 'e1rm'`, `BoardRow`, `BoardHolder` (`Holder + member`),
   `GroupBoardPodiumExercise`, `GroupBoardPodiumsResult`, `GroupBoardCursor`
   (`{ value_kg, achieved_at_ms, member_user_id }`), `GroupBoardResult`,
   `GroupBoardHistoryItem`, and its `related` union (`record` /
   `record_voided` / `link`, or null). `reason` is typed `'record' | 'void'
   | 'link' | 'certification'` plus `string`, so a future reason renders the
   fallback and never crashes. Adds `GroupBoardHistoryCursor` (`{ seq }`) and
   `GroupBoardHistoryResult`.
2. **Client wrappers** (`src/groups/api.ts`), through `callGroupRpc`. Each
   always sends every `p_*` argument, and the three RPC names join
   `GroupRpcName`:
   - `getGroupBoardPodiums(groupId)`: `p_metric: 'e1rm'`, `p_certified:
     true`. Shape: `Array.isArray(exercises)`.
   - `getGroupBoard({ groupId, groupExerciseId, metric, certified, after =
     null, limit = 50 })`. Shape: `isRecord(exercise)`, `Array.isArray(rows)`,
     boolean `has_more`.
   - `getGroupBoardHistory({ groupId, groupExerciseId, metric, certified,
     before = null, limit = 20 })`. Shape: `Array.isArray(items)`, boolean
     `has_more`.
   - Errors use the existing mapping: a token prefix, `NETWORK`, or
     `INTERNAL`, with a malformed payload also `INTERNAL`.
   - `isGroupExerciseNotFound(error)` tells `NOT_FOUND: group exercise not
     found` apart from `NOT_FOUND: group not found`. It matches the §4.5
     message, so a missing exercise never evicts the group.
3. **Cache policy.**
   - **Podiums: cache-first** under the new key **`boards:<groupId>`**
     (`groupCacheKeys.boards`). It holds the Certified · e1RM payload only,
     read through `useGroupResource`: focus, 30 s poll, and pull-to-refresh.
     The group screen enables it only while the Leaderboards segment is open
     (a `null` key otherwise), the same as Exercises. `evictGroup` also
     deletes it, and the sign-out wipe already covers `group_cache`.
   - **Full board and history: online, never cached.** A new hook,
     `src/groups/use-group-online-pages.ts`, serves both. It loads the first
     page on mount, on a toggle change, on focus, and on pull-to-refresh, with
     no 30 s poll. A refresh discards older pages. `loadMore` uses the last
     `next_cursor` on end-of-list, is never requested offline, and a failure
     shows a footer with `Retry`. It dedupes by member (board) or `key`
     (history), keeping the first seen, so a rank shift between pages never
     shows a member twice. A response for a stale (user, group, exercise,
     metric, certified) identity is dropped. Offline with nothing loaded
     shows the offline empty state. Loaded pages stay visible with
     `Offline · last updated HH:MM`, stamped when the first page last loaded.
4. **View model** (`src/groups/board-view-model.ts`, pure, barrel-exported):
   - `formatOrdinal` (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd,
     101st, 111th, 112th).
   - Member label: my row is `You`; a null username is `Unnamed member`; a
     former member gets ` (former)`.
   - Value: e1RM rows show `142.5 kg` with a muted `140 kg × 1`. Weight rows
     show `140 kg × 1`. Kg uses the stream's formatter (at most two
     decimals).
   - Date: local `12 Sep`, plus the year when it is not the current year.
   - Certified mark, on All only: `✓` (a11y "certified") or `○ uncertified`.
     There is no mark on Certified.
   - **Podium card**, `buildPodiumCards(payload, myUserId)`, in server order
     (archived exercises come last, per §4.5):
     - a title plus an `Archived` tag, and the view label `Certified · e1RM`;
     - up to 3 rows (rank, name, value, date);
     - **`You: Nth`** when `me` is ranked below 3rd; **`You: not ranked`**
       when `me` is null and the board has entries; nothing when I'm on the
       podium;
     - an empty podium reads **`No certified sets yet · N uncertified`**
       (N = `all_entry_count` > 0), or `No sets yet` when N = 0.
   - **History sentence**, `describeHistoryItem(item, metric, myUserId)`,
     after E1.3 (L = leader, P = previous, v = value):
     - `record`, no P: `L set the first record · v`
     - `record` with P: `L took #1 · v (from P, pv)`
     - `link`: `L took #1 · v (linked A, B)`
     - an unlink: `L took #1 · v (P unlinked A)`
     - `void`: `L now #1 · v (P's pv removed — set edited|set deleted)`
     - `void` with no leader: `No one holds #1 (P's pv removed — set deleted)`
     - `certification`: `L took #1 · v (certified)`
     - an unknown reason or null `related`: `L took #1 · v`
     - A null link-exercise name reads `an exercise`. When P is me, it reads
       `your`.
5. **Leaderboards segment** (`components/groups/group-leaderboards-page.tsx`)
   replaces the T08 empty state.
   - The podium cards are `UiSurface`s and each whole card is one press
     target. Its a11y label joins title, archived, podium, and You line.
   - Pressing a card pushes `/group/[groupId]/leaderboards/[exerciseId]`.
   - No group exercises: `No group exercises yet`, with body "Owners and
     admins add them on the Exercises page".
   - Missing data, offline, and inline error use the existing group state
     components.
   - `NOT_FOUND` shows the group screen's lost-access state, and the hook
     evicts.
6. **Full board route** `app/group/[groupId]/leaderboards/[exerciseId]/index.tsx`,
   with query `metric=weight|e1rm` and `scope=certified|all`. Missing or
   invalid values fall back to `e1rm` and `certified`, which is the card's
   view (E1.2).
   - Header: exercise name (also the stack title), `Archived · read-only`
     when archived, two joined `SegmentedChips` (`Weight | e1RM`,
     `Certified | All`) that switch in place, and a `History` button.
   - Rows in rank order show rank, member label, value, date, and the mark
     on All. A `FlatList` pages on end-of-list.
   - Empty Certified shows `No certified sets yet` plus `See all sets`,
     which sets scope to All. Empty All shows `No sets yet`.
   - `NOT_FOUND` group: `evictGroup`, then the lost-access state.
     `NOT_FOUND` exercise: "This exercise isn't in this group", with no
     eviction. `INTERNAL`: inline error with `Retry`.
7. **History route**
   `app/group/[groupId]/leaderboards/[exerciseId]/history.tsx`, with the same
   query params from the board's current toggles.
   - The subtitle is the view label (e.g. `All · Weight`). Items are newest
     first, each with a date and the sentence.
   - It pages on end-of-list. With no items it shows `No lead changes yet`.
     Offline, lost-access, and error states are the same as the board.
8. **Titles** in `app/_layout.tsx`: `Leaderboard` (replaced by the exercise
   name once loaded) and `History`.
9. **Maestro**: extend `ios-groups-e2e` (`groups-two-user-stream.yaml` +
   `.maestro/scripts/groups-counterparty.js`, same fixture users, no new
   user).
   - After step 6, a new counterparty step, `link-bench`, `sync_push`es an
     `exercise_group_links` row. It links user_d's pushed Bench Press
     definition to the device's active custom group exercise, `Prowler Push`
     (per side). The evaluator turns the existing completed sets into a board
     entry (a link effect).
   - **Step 6b:** open Leaderboards.
     - The `Prowler Push` card reads `No certified sets yet · 1 uncertified`,
       and the archived `Barbell Bench Press` copy sits below it marked
       Archived.
     - Open the card, then Certified empty, then `See all sets`: row 1 is the
       counterparty, marked `○ uncertified`.
     - Toggle Weight: row 1 is still the counterparty, and `51.25 kg × 5`
       proves D6 conversion (102.5 kg total logged → per side).
     - History shows `<user_d> took #1 · … (linked Bench Press)`.
     - Waits use pull-to-refresh retries within the lane's timeouts. The
       30 s `pg_cron` sweep backs up the `pg_net` kick.
   - **Step 8b**, after the counterparty is removed: the All board row reads
     `<user_d> (former)`.
   - Each state gets a screenshot, which is the visual evidence.

### Out of scope

- Row detail, certify, remove, cancel (E2), stream record / void / link
  items (E3): T10. Certified data: T06.
- Server changes: none. `src/sync/**`: untouched. Group code never runs in the
  sync cycle.
- Board-as-of-date views and time windows (D12, P19).

## UX Contract

### Key user flows

1. **Scan the podiums**
   - Trigger: group screen → Leaderboards.
   - Steps: cards render from cache at once, then refresh silently.
   - Success: one card per group exercise in server order, archived last and
     tagged. Each shows the top 3 on Certified · e1RM and `You: Nth` when I'm
     outside the podium.
   - Edge: no certified sets gives `No certified sets yet · N uncertified`.
     No exercises gives the empty state. Offline shows cached cards plus the
     banner, or the offline empty state. Removed from the group gives lost
     access.
2. **Open a full board and switch views**
   - Trigger: tap a card.
   - Steps: the board opens on Certified · e1RM; tap `All` and/or `Weight`.
   - Success: rows reload in place with absolute ranks, `(former)`, and ✓ / ○
     on All. Scrolling to the end loads the next 50.
   - Edge: empty Certified offers `See all sets`. Offline with nothing loaded
     shows the offline empty state. Loaded rows stay visible with the banner.
     A failed next page shows a `Retry` footer.
3. **Read the history**
   - Trigger: `History` on the board.
   - Steps: the history for the current toggles opens.
   - Success: newest-first lead changes worded per reason (E1.3), paged.
   - Edge: none yet gives `No lead changes yet`. Offline and error states are
     the same as the board.

### Interaction + appearance notes

- Cards are whole-card press targets (pattern 6 rules: one target, no
  expand). The toggles and `History` meet the 44 pt target.
- The two toggle rows fit a 375 pt phone without wrapping.
- Pull-to-refresh on all three surfaces (pattern 8). Offline marker (pattern
  7). No writes here.

## Acceptance criteria

1. The three wrappers send every `p_*` arg with the pinned defaults, reject
   malformed payloads as `INTERNAL`, and map `NOT_FOUND` / `VALIDATION` /
   `NETWORK`. `isGroupExerciseNotFound` separates the two `NOT_FOUND`
   messages (api jest).
2. The podium page reads `boards:<groupId>` cache-first only while the
   segment is open. It renders cached cards offline with the banner, shows
   the offline empty state with no cache, and `evictGroup` deletes the key
   (screen + cache jest).
3. Podium cards follow the view-model rules: server order with archived
   tagged; top 3; `You` on my own row; `You: Nth` only below 3rd; `You: not
   ranked` only when unranked on a non-empty board; `No certified sets yet ·
   N uncertified` / `No sets yet`. Ordinal edge cases are covered (view-model
   jest).
4. The full board opens on e1RM · Certified by default and honours valid
   query params. Each toggle refetches the first page with the matching args
   and discards older pages. Board rows show the metric-specific value,
   `(former)`, and ✓ / ○ on All only (screen + view-model jest).
5. Paging: end-of-list sends `next_cursor` verbatim as `p_after` / `p_before`.
   It is not requested offline or when `has_more` is false. A failure shows
   `Retry`, which retries the same cursor. Duplicates across pages are
   dropped. A stale response after a toggle change is ignored (hook jest).
6. The full board and history are never written to `group_cache` (jest
   asserts no cache write).
7. A group `NOT_FOUND` evicts and shows lost access. An exercise `NOT_FOUND`
   shows the exercise-missing state without eviction (screen jest).
8. History renders every sentence in Scope 4, including the unknown-reason
   fallback, and passes the board's toggles through its route params
   (view-model + screen jest).
9. `ios-groups-e2e` passes with steps 6b and 8b, and its screenshots cover
   the design-target states.
10. Group RPCs are called only through `@/src/groups`; nothing in
    `src/sync/**` changes; dev-only UI (if any) uses `isDevMode()`.

## Docs touched

- `docs/specs/tech/groups-contract.md`: §4.5 (the mobile wrappers replace "No
  client wrapper yet"), §6.1 (board view model, online pages hook), §6.2
  (`boards:<groupId>`, eviction), §6.3 (leaderboard routes, as-built T09),
  §7 (online-only boards and history), §8 (steps 6b / 8b).
- `docs/specs/ui/screen-map.md`: Leaderboards segment content, board and
  history screens.
- `docs/specs/ui/navigation-contract.md`: the two routes, `metric` / `scope`
  params, and the transitions (card → board, History → history, Back).
- `docs/specs/ui/components-catalog.md`: podium card, board row, history
  item, leaderboards page.
- `docs/specs/ui/ux-rules.md` §14: online-only paged reads (no cache, offline
  empty state, no poll).
- `docs/specs/08-ux-delivery-standard.md`: only if a genuinely new pattern
  emerges (none expected).
- Delete this card in the PR.

## Testing and verification

- Jest (new): `groups-board-api.test.ts`, `groups-board-view-model.test.ts`,
  `groups-online-pages.test.tsx`, `groups-leaderboards-screens.test.tsx`;
  extend `groups-cache.test.ts` and the group screen's segment test. Read
  `apps/mobile/app/__tests__/README.md` (and any sub-README) first.
- `./boga test for --diff origin/main` and every lane it prints (expected:
  `./boga test fast`, `./boga test frontend`, including `ios-groups-e2e`),
  plus `./boga test handles`.
- Durations only from `./boga timings`.

## Completion note

- What changed:
- What tests ran:
- What remains:
