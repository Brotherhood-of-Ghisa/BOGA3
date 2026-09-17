---
task_id: M25-T10-Mobile_stream_items_and_certify
milestone_id: "M25"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend (includes ios-groups-e2e)"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md, docs/specs/08-ux-delivery-standard.md"
---

# M25-T10 — Mobile stream record items, row detail, certify

## Task metadata

- Task ID: `M25-T10-Mobile_stream_items_and_certify`
- Status: `planned`
- Depends on: `M25-T06` (PR #297, merged), `M25-T09` (PR #296, merged)
- Uses (merged): `M25-T05` (PR #294): stream board kinds; `M25-T08` (PR
  #290): group page; `M25-T07` (PR #292): linking
- Unblocks: `M25-T11` (with T07)
- Open elsewhere: the four-tab navigation PR #295 (not merged at card time).
  It moves tab files and edits `groups-screens.test.tsx`, but no group route.
  T10 adds no route, so if #295 lands first, T10 rebases and resolves the
  test-file conflict.

## Parent references

- Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Product: `docs/plans/group-exercises-and-leaderboards.md`: P10–P18,
  D1–D5, D15, D16, E2, E3
- Design: `docs/plans/group-exercises-tech-design.md` §4 (stream kinds,
  record ordering), §6 (certification), §7 (mobile)
- Contract: `docs/specs/tech/groups-contract.md` §2.11 (provisional
  records, voids), §2.12, §4 (error tokens incl. `CONFLICT`), §4.2 (`record`
  / `record_voided` / `link` items), §4.5 (`BoardRow.certification`), §4.6
  (the three RPCs, `Certification`, check order), §6.1–§6.3 (T08/T09
  as-built), §7
- As-built inputs: `src/groups/api.ts` (`callGroupRpc`, `expectShape`,
  `RENDERED_STREAM_KINDS`, `isGroupExerciseNotFound`), `types.ts`
  (`UnrenderedStreamKind`), `use-group-stream.ts`, `stream-view-model.ts`,
  `board-view-model.ts`, `use-group-online-pages.ts`, `use-group-action.ts`,
  `components/groups/{group-stream-list,stream-session-card,group-board-row,group-action-sheet,write-notice}.tsx`,
  `app/group/[groupId]/leaderboards/[exerciseId]/index.tsx`
- UX: `docs/specs/08-ux-delivery-standard.md` patterns 3, 6–9;
  `docs/specs/ui/ux-rules.md` §14

## Objective

The stream renders the three board kinds the client drops today: record
cards (E3, P14, P15), record-removed items (P17, D15), and link items (P16,
D16). A record card sits with its session, and the session card counts its
records. Board rows and record cards open one shared row detail sheet (E2).
From there, and from the record card, members certify a record set; a
certifier removes their own certification, and the owner and admins cancel
any (P10–P13, D3–D5). All three writes are online-only (P18, 08 pattern 9).

## Accepted design target (`docs/specs/ui/ai-design-policy.md`)

- **Target:** repo-native brief. It is the product sketches E2 (row detail)
  and E3 (record card) plus bullets P14–P17 in
  `docs/plans/group-exercises-and-leaderboards.md`. No Figma or Claude
  Design artifact exists for this card.
- **Brief:** existing group primitives (`UiSurface`, `UiText`, `UiButton`,
  `GroupActionSheet`'s modal, `GroupWriteNotice`, the state panels), with no
  new tokens. Text carries every state (`PR · Weight`, `Group record ·
  e1RM`, `Voided · set edited`, `Session in progress`, `✓ Certified by …`,
  `○ Not certified yet`), so color is never the only signal.
- **States** to capture (iPhone 17 Pro): jest-rendered states are proven in
  jest; the running app captures a link item in the stream, the row detail
  sheet from a board row (uncertified, with `Certify`, and for a former
  member without it). Record cards, voided cards, and a certified sheet on
  device are T11's two-user extension.
- **Deliberate differences from the sketches** (need approval with this
  card):
  1. **Record cards sit directly below their session card**, not in server
     order. The server sorts a record at its session's start with `kind`
     ascending, so it arrives just above its session. The view model moves
     it under the session card. A record whose session card is not loaded
     (not yet paged in, or the session was deleted) renders where the server
     put it.
  2. **The session card's `N records` highlight is a label, not a link.** The
     records already sit right below the card. Tapping the card still opens
     the session.
  3. **No 🏆 emoji.** The card header reads `Dave — group record` or `Dave —
     PR` with a text badge. No emoji is used anywhere in the group UI.
  4. **Record-removed and link items are light rows** (like membership
     items, pattern 6), not cards, and not pressable.
  5. **Every board a record lists reads `PR · <metric>`, plus `Group record
     · <metric>` when `group_record` is set.** This matches the E3 example,
     where a group record also lists its PR.
  6. **After a certify, the sheet notes `Certified boards update in a few
     seconds`.** The All row's ✓ is read live, but the Certified entry waits
     for the evaluator (§2.12), so without the note the Certified board
     looks broken for a few seconds.
  7. **Provisional records** (session still active) show a muted `Session in
     progress` line. The card may still change or disappear silently
     (§2.11 step 3). Certify stays offered, as the server allows it.

## Scope

### In scope

1. **Error token.** Add `CONFLICT` to `GROUP_SERVER_ERROR_CODES`
   (`types.ts`), so `matchGroupErrorToken` maps it.
2. **Wire types** (`types.ts`, §4.2 / §4.6):
   - `StreamRecordItem` (`kind: 'record'`: `group`, `member`,
     `group_exercise { group_exercise_id, name, load_input_mode }`,
     `session_id`, `set_id`, `weight_kg`, `reps`, `e1rm_kg`,
     `entered_weight_kg`, `load_factor`, `achieved_at_ms`, `boards[]`,
     `provisional`, `voided | null`, `certified`, `certification | null`
     typed as `GroupBoardCertificationRef`);
   - `StreamRecordVoidedItem` (`record_key`, `reason: 'edited' | 'deleted'`,
     `record`, `leaders: [{ metric, leader: BoardHolder | null }]`);
   - `StreamLinkItem` (`event: 'link' | 'unlink'`, `exercises[]` with
     nullable names, `effects: [{ metric, before, after }]`, each side
     `{ rank, value_kg } | null`);
   - `StreamItem` becomes the union of all five kinds.
     `UnrenderedStreamKind` is removed. `StreamCursor.kind` becomes
     `StreamItem['kind'] | (string & {})`, so a later server kind never
     breaks paging;
   - `GroupCertification` (§4.6, incl. `pinned` and the end fields),
     `GroupCertifyResult { certification, created }`, and
     `GroupCertificationEndResult { certification }`.
3. **API** (`api.ts`), through `callGroupRpc`; the three names join
   `GroupRpcName`, and every call sends every `p_*` argument:
   - `certifyGroupSet({ groupId, groupExerciseId, memberUserId, setId })` →
     `group_certify`. Shape: `isRecord(certification)`, a string
     `certification_id`, and a boolean `created`.
   - `withdrawGroupCertification(groupId, certificationId)` and
     `cancelGroupCertification(groupId, certificationId)`. Shape:
     `isRecord(certification)` with a string `certification_id`.
   - Message helpers, like `isGroupExerciseNotFound`, match §4.6 exactly:
     `isGroupNotFound` (`group not found`; the only one that evicts),
     `isRecordSetNotFound`, `isCertificationNotFound`,
     `isGroupMemberNotFound`.
   - `getGroupStream` keeps its filter, widened to all five kinds. A kind the
     build does not know is still dropped, with the server's `next_cursor`
     kept.
   - Items of a known kind are trusted as typed, as session items are today.
     The server shape is asserted by `groups-leaderboards`.
4. **Stream cache: no clear needed.** `stream:*` entries written by earlier
   builds hold the same top-level shape with the board kinds filtered out: a
   valid subset of the new payload. They render correctly and are replaced
   on the next refresh (focus, which is immediate when online). Offline, the
   missing record items stay missing until the next refresh, exactly like
   any stale cache. So there is **no** `drizzle` clear migration (unlike
   `0005_clear_group_cache.sql`, which guarded a real shape break), and the
   sync gates are not triggered. Paging (`mergeStreamPages`,
   `compareStreamOrder`) is kind-agnostic already. Jest proves an old
   filtered cache renders and a new page with all kinds merges.
5. **View model** (`stream-view-model.ts`, pure):
   - **Record card** `StreamRecordCardViewModel`:
     - `title`: `<name> — group record` when any board has `group_record`,
       else `<name> — PR`.
     - `exerciseLabel`: the group exercise name; `valueLabel`: `140 kg × 1`,
       plus ` · e1RM 142.5 kg` when an e1RM board is listed.
     - `badges`: per listed board in Weight, then e1RM order, `PR ·
       Weight` then `Group record · Weight` when flagged.
     - `status`: `voided` → `Voided · set edited|set deleted`; else
       `certified` → `✓ Certified by <name>` (`✓ Certified` when the
       certifier is null; `by you` for me); else `○ Not certified yet`.
     - `provisionalLabel`: `Session in progress` when `provisional` and not
       voided.
     - `canCertify`: not voided, not certified, and the lifter is not me.
     - `groupName` (shown in All).
   - **Record-removed row**: `<name>'s <exercise> record removed (<w> kg × <r>)
     — set edited|deleted`, then for each metric with a leader, `· Now #1 on
     <Weight|e1RM>: <leader> <v> kg`, or `· No one holds #1 on <metric>`. My
     name reads `You` / `Your`.
   - **Link row**: `<name> linked <A, B> to <exercise>` / `<name> unlinked <A>
     from <exercise>`, then the effects: `— now #N on Weight and e1RM` when
     both metrics share a rank, else `— now #1 on e1RM, #2 on Weight`, and
     `off the <metric> board` for an `after: null` effect. No effects: the
     sentence alone. A null exercise name reads `an exercise`.
   - **Session card** gains `recordsLabel`: `1 record` / `N records` counts
     the non-voided record items for that `(member, session)` in the loaded
     items, deduplicated by `set_id`. Null when zero.
   - **Grouping** `buildStreamViewModel(items)`: a record item whose
     `(member.user_id, session_id)` session card is in the loaded items is
     emitted directly after that card, keeping the records' server order.
     Otherwise it stays in place. Other kinds keep server order.
6. **Row detail model** (`record-set-view-model.ts`, pure, barrel-exported):
   `RecordSetDetail` is built from a `BoardRow` + board `GroupExercise`
   (`recordSetFromBoardRow`) or from a `StreamRecordItem`
   (`recordSetFromStreamRecord`). It holds `groupId`, the group exercise (with
   `archived` when known: the board payload has it, the stream item does
   not), the member, values, `entered_weight_kg`, `load_factor`,
   `achieved_at_ms`, `session_id`, `set_id`, `exercise_name` (board only),
   `certification`, `voided`, `provisional`, and `former` (board only).
   - **Header**: `<name> · <group exercise>`.
   - **Value**: `140 kg × 1 (e1RM 142.5 kg)`; with a null e1RM, the set alone.
   - **Logged** (only when `load_factor !== 1`): factor 2 → `Logged 70 kg per
     side · counted as 140 kg total`; factor 0.5 → `Logged 140 kg total ·
     counted as 70 kg per side`.
   - **Date / gym**: local `12 Sep 2026` (always with the year), `· <gym>`
     when known.
   - **`Logged as "<name>"`**: `exercise_name`, else the session detail's
     exercise holding `set_id`, else hidden.
   - **Certification line**: `✓ Certified by <name> · 12 Sep` / `○ Not
     certified yet` / `Voided · set edited|deleted`.
   - **Actions** `recordSetActionsFor(detail, myUserId, myRole)`:
     - `certify`: not certified, not voided, not archived, not former, and
       I am not the lifter;
     - `withdraw` (`Remove my certification`): certified and I am the
       certifier;
     - `cancel` (`Cancel certification`): certified, my role is owner or
       admin, and I am not the certifier;
     - otherwise none. A lifter viewing their own uncertified set sees `Other
       members can certify this set.`
     - Jest walks every combination.
   - **Error wording** `describeCertificationError(error, action)`:
     - `CONFLICT`: `This set changed since it loaded. Nothing was certified —
       refresh and try again.`
     - record set not found: `This set is no longer a record. Nothing was
       certified.`
     - member not found: `<name> is no longer a member, so this set can't be
       certified.`
     - certification not found: `This certification no longer exists.`
     - `FORBIDDEN`: `Only owners and admins can cancel a certification.` /
       `Only the certifier can remove it.`
     - `VALIDATION` archived: `This exercise is archived. Its boards are
       read-only.`; any other `VALIDATION`, the server message.
     - group not found: lost access.
     - `NETWORK` / offline: the existing §14 rule 7 wording. `INTERNAL`: a
       generic message with nothing changed.
7. **Hook** `src/groups/use-record-set-certification.ts`: wraps the three
   writes in `useGroupAction`, so offline is refused before any request and
   nothing is queued or retried. It returns `{ certify, withdraw, cancel,
   pending, error, notice }` and never touches `group_cache`.
   - **On success** it calls the host's `onChanged()`. The host refreshes
     what it shows:
     - group screen: the stream resource, and the podiums when that segment
       is open;
     - Groups tab: the All stream;
     - full board: its online pages (first page).
     The sheet shows the returned `certification` at once (not optimistic:
     the server's result). `created: false` reads `Already certified by
     <name>`. A withdraw or cancel that returns an already-ended
     certification reads `This certification was already removed`.
   - **On `CONFLICT`, record set / certification / member not found, or
     `FORBIDDEN`**: the inline error, plus `onChanged()`, so the host
     re-reads.
   - **On group `NOT_FOUND`**: `evictGroup` and `onLostAccess()`, so the host
     shows its lost-access state (the Groups tab falls back to All, as
     today).
8. **Row detail sheet** `components/groups/record-set-sheet.tsx`: an in-route
   `Modal` like `GroupActionSheet`, testID prefix `group-record-sheet`.
   - It renders the lines of Scope 6 and the actions. `Remove my
     certification` and `Cancel certification` confirm first with
     `Alert.alert` (destructive style, pattern 3); `Certify` does not
     (nothing is lost).
   - The error or notice shows inline above the actions (`GroupWriteNotice`).
     `Certified boards update in a few seconds` follows a certify.
   - `View full session` pushes `/group-session/[memberId]/[sessionId]`.
     Hidden when the record is voided with reason `deleted`, or when the
     session detail read returns `NOT_FOUND`.
   - **Gym and `Logged as`** come from `getGroupSessionDetail` through
     `useGroupResource` under the existing `session:<memberId>:<sessionId>`
     key (cache-first, shared with the friend view, no group eviction). While
     it loads, or offline with no cache, those lines are hidden; the rest of
     the sheet does not wait on it.
   - **`myRole`**: group screen and full board from `group:<groupId>`
     (`useGroupResource`, cache-first; the board route gains this read); the
     Groups tab from `groups:mine` for `item.group.group_id`. An unknown role
     hides `Cancel` (the server enforces it regardless).
9. **Stream rendering** (`group-stream-list.tsx`):
   - `components/groups/stream-record-card.tsx`: a `UiSurface` card and one
     press target (opens the sheet). It holds the title, exercise and value,
     badges, the provisional line, status, the group name in All, and an
     inline `Certify` button (`canCertify`, same hook) whose error shows
     inside the card. A voided card uses the muted surface, with its status
     text first.
   - `stream-record-removed-item.tsx` and `stream-link-item.tsx`: light rows
     like `stream-membership-item.tsx`, not pressable, with the group name
     in All.
   - The session card shows `recordsLabel` under its metrics.
   - Paging, pull-to-refresh, offline marker, and footer are unchanged.
   `onPressRecord` is a new required prop, wired on the group screen and the
   Groups tab.
10. **Board rows pressable** (`group-board-row.tsx`): the row becomes a
    `Pressable` (`accessibilityRole="button"`, hint `Opens the set`) that
    opens the sheet on the full board route. The podium cards are unchanged
    (they open the board). The history rows stay inert.
11. **Maestro** (extend `ios-groups-e2e`; no new fixture user, no new
    counterparty step):
    - **Step 7b**, after the counterparty's existing `link-board`: on the
      group screen's Stream, the link row reads `<user_d> linked Bench Press
      to Prowler Push — now #1 on Weight and e1RM`. On the All · Weight
      board, tapping row 1 opens the sheet: `51.25 kg × 5`, `Logged 102.5 kg
      total · counted as 51.25 kg per side`, `Logged as "Bench Press"`, `○
      Not certified yet`, and a visible `Certify` (the device is the owner,
      not the lifter). The flow closes the sheet without certifying.
      Screenshots `groups-07b-6-stream-link-item` and
      `groups-07b-7-row-detail`.
    - **Step 8b**: the former member's row opens the sheet with no
      `Certify`. Screenshot `groups-08b-2-row-detail-former`.
    - **Why only this:** it proves the new stream kind and the sheet against
      real server payloads (conversion, `Logged as`, role gating) at almost
      no runtime cost. Certifying, record cards, and the Certified board
      update need the counterparty to push a new record set, which is T11's
      two-user extension. Any existing assertion the new link row displaces
      (step 8's session-card visibility) is re-checked, and fixed by
      scrolling if needed.

### Out of scope

- Server changes (none), `src/sync/**` (untouched), a `group_cache` clear
  migration (Scope 4). Group code never runs in the sync cycle.
- T11: the two-user certification e2e (a record card on device, certify, the
  Certified board update) and the milestone closeout.
- Certification lists or audit views, disputes (P19), and push
  notifications.
- History rows opening the sheet (history holders carry no certification).

## UX Contract

### Key user flows

1. **See records in the stream**
   - Trigger: a member's shared set becomes a record, is voided, or a link
     moves a board.
   - Steps: the stream refreshes (focus, poll, or pull).
   - Success: a record card under its session card with PR / group-record
     badges and certification status. The session card reads `N records`.
     A void keeps the card, marked `Voided · set edited|deleted`, and adds a
     record-removed row naming the new holder. A link adds a link row with
     the board effect.
   - Edge: a provisional record reads `Session in progress` and may change
     or vanish on refresh. Offline shows cached items with the marker.
     Records whose session card is not loaded render in server position.
2. **Open a row detail**
   - Trigger: tap a record card or a full-board row.
   - Steps: the sheet opens with values, the logged value when converted,
     the date (and gym and `Logged as` once the session detail is read),
     and the certification line.
   - Success: the actions match my relationship to the set.
     `View full session` opens the friend view.
   - Edge: offline with no session cache hides gym and `Logged as`. A
     deleted session hides `View full session`. A voided or former member's
     set offers no `Certify`.
3. **Certify a record set**
   - Trigger: `Certify` on a record card or in the sheet (I am a member, not
     the lifter).
   - Steps: tap once, with no confirmation; the button shows pending.
   - Success: the sheet or card shows `✓ Certified by you` (plus the
     Certified-boards note in the sheet), and the host refreshes.
     `created: false` reads `Already certified by <name>`.
   - Failure: offline is refused before any request. `NETWORK`, `CONFLICT`,
     a no-longer-record set, a former lifter, archived, or lost access each
     show inline wording saying nothing changed. The data-state errors also
     refresh the host. Nothing is queued.
4. **Remove my certification / cancel a certification**
   - Trigger: in the sheet, `Remove my certification` (the certifier) or
     `Cancel certification` (owner or admin, not the certifier).
   - Steps: confirm the destructive `Alert`.
   - Success: `○ Not certified yet`; the host refreshes, and the Certified
     board and podium drop the entry on that refresh.
   - Failure: as flow 3. Dismissing the Alert does nothing.

### Interaction + appearance notes

- A record card is one press target (pattern 6) with a nested `Certify`
  button (a ≥44 pt target); the button's press does not open the sheet.
- Voided, provisional, certified, and group-record state are text labels;
  color is only supplemental.
- Destructive certification removals confirm (pattern 3); every write
  follows pattern 9, with inline errors and no queue.
- New 08 pattern **"Record set detail sheet"**: one sheet shared by every
  surface showing a record set, with actions derived from role and
  relationship (added to 08 in this task).

## Acceptance criteria

1. `CONFLICT` maps from `CONFLICT: the set changed; refresh and try again`.
   The three wrappers send every `p_*` arg, reject malformed payloads as
   `INTERNAL`, and map `NETWORK`. The message helpers tell apart group /
   record set / certification / member `NOT_FOUND` (api jest).
2. `getGroupStream` returns `record`, `record_voided`, and `link` items,
   still drops an unknown kind, and keeps the server `next_cursor`. A cached
   first page from the old filtered shape renders, and paging merges pages
   that mix all kinds (api + stream hook jest).
3. The view model produces every Scope 5 string, including provisional,
   voided (both reasons), certified by a null / other / me certifier, both
   link directions, same- and mixed-rank effects, `off the … board`, and
   null names. It groups records under their loaded session card, leaves
   orphans in place, and counts `N records` deduplicated by `set_id`,
   excluding voided records (view-model jest).
4. `recordSetActionsFor` matches Scope 6 for every combination of lifter /
   certifier / owner / admin / member × certified / uncertified / voided /
   archived / former (view-model jest).
5. The sheet renders both sources. The logged line shows only for factor ≠
   1, and gym and `Logged as` appear from the session detail. `View full
   session` navigates, and is hidden for deleted or `NOT_FOUND` sessions
   (screen jest).
6. Certify, withdraw, and cancel:
   - offline refuses with no RPC;
   - success shows the returned state and calls the host refresh;
   - withdraw and cancel confirm first, and a dismissed Alert sends nothing;
   - `CONFLICT` / record-set-not-found / `FORBIDDEN` show their wording and
     refresh the host;
   - group `NOT_FOUND` evicts and shows lost access;
   - no write touches `group_cache`.
   (hook + screen jest)
7. The record card's inline `Certify` runs the same write without opening
   the sheet, and the lifter never sees it (screen jest).
8. Full-board rows open the sheet with the row's certification. After a
   certify the board's first page is refetched (screen jest).
9. `ios-groups-e2e` passes with the step 7b and 8b additions. Its
   screenshots cover the link row and both sheet states.
10. Group RPCs are called only through `@/src/groups`; nothing in
    `src/sync/**` or `drizzle/**` changes; dev-only UI (if any) uses
    `isDevMode()`.

## Docs touched

- `docs/specs/tech/groups-contract.md`: §4 (the `CONFLICT` client mapping),
  §4.2 (clients render the board kinds; the old "drops them" note is
  replaced), §4.6 (the mobile wrappers replace "No client wrapper yet"),
  §6.1 (new modules, the widened stream filter), §6.2 (no cache clear, and
  why), §6.3 (as-built T10: stream items, sheet, certify), §7 (certification
  writes online-only), §8 (the step 7b / 8b additions).
- `docs/specs/ui/screen-map.md`: stream items on the Groups tab and group
  screen, the sheet on the full board.
- `docs/specs/ui/navigation-contract.md`: row → sheet (in-route) → `View
  full session` → `/group-session/…`.
- `docs/specs/ui/components-catalog.md`: record card, record-removed and
  link rows, record set sheet, pressable board row.
- `docs/specs/ui/ux-rules.md` §14: record/void/link items (rule 4
  extended), certification write rules and confirmations (new rule).
- `docs/specs/08-ux-delivery-standard.md`: pattern 11 "Record set detail
  sheet".
- Delete this card in the PR.

## Testing and verification

- Jest (new): `groups-certification-api.test.ts`,
  `groups-record-set-view-model.test.ts`, `groups-record-set-sheet.test.tsx`
  (sheet, hook, card certify). Extend `groups-api.test.ts` (stream kinds),
  `groups-stream-view-model.test.ts` (items, grouping, `N records`),
  `groups-screens.test.tsx` (stream rendering, card certify offline), and
  `groups-leaderboards-screens.test.tsx` (pressable rows). Read
  `apps/mobile/app/__tests__/README.md` first; it has no groups policy
  today.
- `./boga test for --diff origin/main` and every lane it prints (expected:
  `./boga test fast`, `./boga test frontend`, including `ios-groups-e2e`),
  plus `./boga test handles`.
- Known flake: `groups-link-exercise` at "Close filters". Re-run once and
  record it if it recurs.
- Durations only from `./boga timings`.

## Completion note

- What changed:
- What tests ran:
- What remains:
