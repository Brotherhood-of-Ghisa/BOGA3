---
task_id: M22-T04-Mobile_groups_tab_stream_group_screen_and_friend_session
milestone_id: "M22"
status: completed
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md, docs/specs/08-ux-delivery-standard.md, docs/specs/tech/groups-contract.md"
---

# M22-T04 — Mobile: Groups tab, stream, group screen, friend's session view

## Task metadata

- Task ID: `M22-T04-Mobile_groups_tab_stream_group_screen_and_friend_session`
- Status: `completed`
- Depends on: `M22-T03`
- Precedes: `M22-T05`, which adds the create, join, invite, and manage
  actions onto these screens

## Parent references (required)

- Milestone spec: `docs/specs/milestones/M22-groups-and-foundations.md` (FR 2,
  6, 7, 8, 9)
- **Contract:** `docs/specs/tech/groups-contract.md`
  - §6.3: routes, tab, and friend view;
  - §7: freshness and the offline marker.
- UX standard: `docs/specs/08-ux-delivery-standard.md`; UI docs:
  `docs/specs/ui/README.md`
- Existing layout to compose: `SessionContentLayout`
  (`apps/mobile/components/session-recorder/`), used by
  `apps/mobile/app/completed-session/[sessionId].tsx`

## Objective

Ship the read side of groups in the app:

- the fourth **Groups** tab, with the stream and group filter chips;
- the My groups list;
- the group screen (header plus Stream and Members, read-only in this task);
- the read-only friend's session view;
- the signed-out, empty, offline, and lost-access states.

## Scope

### In scope

- **Tab:** `TopLevelTabs` gains a `groups` tab (`top-level-tab-groups`), and
  `app/(tabs)/_layout.tsx` gains the route and `resolveActiveTab`.
- **Routes:** `app/(tabs)/groups.tsx`, `app/group/mine.tsx`,
  `app/group/[groupId]/index.tsx`, and
  `app/group-session/[memberId]/[sessionId].tsx`, registered with titles in
  `app/_layout.tsx`.
- **Components:** new `components/groups/`:
  - a stream session card;
  - a membership item;
  - the group filter chips (reuse `SegmentedChips`);
  - an offline banner;
  - a member row.
- **Pull-to-refresh:** `RefreshControl` on the stream lists.

### Out of scope

Create, join, edit, invite, share, the username gate, and member management
actions (`M22-T05`). The empty state's Create and Join buttons and the header
actions land in `T05`; this task leaves their slots.

## UX Contract

### Key user flows

1. **Browse the stream**
   - Trigger: tap the Groups tab while signed in with at least one group.
   - Steps:
     1. The cached stream renders at once.
     2. A refresh runs on focus and every 30 s while focused.
     3. The chips switch between All and a single group.
     4. Pull-to-refresh forces a refresh.
   - Success outcome:
     - newest-first cards, each showing username, gym, start time, status
       ("Training now" or "Completed · duration"), performed sets, total kg,
       exercise count, and PR highlights;
     - membership items ("X joined / left the group / was removed").
   - Failure/edge outcome: the offline marker with "last updated"; the offline
     empty state when there is no cache; an inline error with Retry on a
     non-network error.
2. **Open a friend's session**
   - Trigger: tap a session card.
   - Steps: the friend view loads the detail (cache first) and renders
     exercises with performed sets (kg, reps, effort).
   - Success outcome: the View Session layout with no edit, delete, or append.
     "In progress" shows for an active session. Pull-to-refresh updates it.
   - Failure/edge outcome: `NOT_FOUND` shows "This session is no longer
     available" and evicts the cache; offline shows the cached detail with the
     marker.
3. **Open a group**
   - Trigger: tap a membership item, or a group in My groups.
   - Steps: the header shows name, description, member count, and my role; the
     Stream and Members segments load; members are sorted by role, then
     username.
   - Success outcome: that group's stream and member list.
   - Failure/edge outcome: after removal, "You're no longer a member of this
     group", with cached data hidden (C3.6.8).
4. **Signed out or no groups**
   - Trigger: open the Groups tab.
   - Success outcome:
     - signed-out or auth-unconfigured shows a sign-in-required state;
     - no groups shows the explanatory empty state (its Create/Join actions
       come in `T05`).

### Interaction + appearance notes

- Reuse `UiSurface`, `UiText`, `UiButton`, `SegmentedChips`, and tokens. Add
  no raw color literals (`npm run lint:ui-guardrails`).
- Session cards are collapsed summaries: the collapsible summary card pattern
  without an expand, where a tap navigates.
- **The fourth tab must fit on the smallest supported phone.** Capture a
  screenshot, and if the labels truncate, record the adjustment.
- New patterns (the stream card, the offline marker, pull-to-refresh) are
  added to the 08 UX patterns.

## Acceptance criteria

1. Flows 1–4 are implemented, and each has jest/RNTL happy-path and
   failure-path assertions (AC5, AC6, AC12, AC14 UI side).
2. The friend view renders no owner action testIDs (AC6).
3. Screens use documented tokens and primitives, with no raw colors.
4. The UI docs are updated (below). `navigation-contract.md` lists the new
   routes and transitions.

## Docs touched (required)

- UI docs update required: **yes**.
  - `ui/screen-map.md` — the new screens;
  - `ui/navigation-contract.md` — routes, params, and transitions;
  - `ui/components-catalog.md` — the `components/groups/*` components;
  - `ui/ux-rules.md` — pull-to-refresh and the offline marker.
- `docs/specs/08-ux-delivery-standard.md`: UX patterns for the stream card and
  the offline marker.
- `docs/specs/tech/groups-contract.md`: **As-built** notes for §6.3 and §7.
- Tokens/primitives reuse plan: the primitives above; exceptions none planned.
- **Screenshots required:**
  - stream (All and one group);
  - offline marker;
  - empty state;
  - signed-out state;
  - friend view;
  - group screen;
  - the tab bar on a small phone.

## Testing and verification approach

- **Iterate** with `npx jest groups`.
- **Before the PR:** `./boga test fast` and `./boga test frontend`. The
  existing smoke lanes must stay green with the new tab. The two-user e2e is
  `M22-T06`.

## Evidence

- Jest (`apps/mobile/app/__tests__/groups-screens.test.tsx`, 21 tests; RPCs
  mocked, real `group_cache` on the in-memory SQLite fixture):
  - Flow 1: cache-first render, then newest-first cards and membership items;
    card fields; All/one-group chips (AC14); pull-to-refresh; the offline
    marker `Offline · last updated 09:05` over cached cards (AC12); the
    offline empty state; the error state plus Retry, and the inline error;
    infinite scroll.
  - Flow 2: the friend view shows kg, reps, and effort; `In progress` plus
    pull-to-refresh; `NOT_FOUND` → "no longer available" plus eviction;
    offline with cache. No owner testIDs render (AC6).
  - Flow 3: header, stream, members in role/username order; lost access
    hides and evicts the cache (C3.6.8).
  - Flow 4: signed out and unconfigured (no RPC); empty state; the fourth tab
    plus `resolveActiveTab`.
- Gates at `2a27df6` (rebased on `origin/main` with M22-T02), all green:
  - `./boga test fast`: all lanes exit 0, `backend-fast` 46.6 s;
  - `./boga test handles`: exit 0, 25.5 s;
  - `boga test frontend`, under `apps/mobile/artifacts/maestro/ad-hoc/`:
    - `ios-smoke`: `20260911-152422-6498`;
    - `ios-data-smoke`: `20260911-152513-8394`;
    - `ios-auth-profile`: `20260911-152801-14150`;
    - `ios-sync-e2e`: flow 1 m 15 s, `20260911-153003-17114`.
  - Earlier pre-rebase runs were also green.
- Screenshots (`apps/mobile/artifacts/m22-t04-screenshots/`, gitignored):
  - `m22t04-se-02-groups-signed-out-tab-bar.png`: the signed-out state on an
    iPhone SE (3rd gen, 375 pt).
  - `m22t04-se-01-tab-bar-history.png`: the tab bar on the SE.
  - `m22t04-default-tab-bar-pre-fix.png`: the default simulator.
  - **Small-phone result:** at first the labels clipped ("Histor", "Exerci",
    "Group"; even "Exercis" on the default simulator). `UiButton`'s
    shrink-to-fit does not engage on-device.
  - The adjustment, in `top-level-tabs.tsx`:
    - tab labels are a fixed `uiTypography.size.sm` (12), stretched and
      centered;
    - tab padding is `uiSpace.xxs` and the row gap `uiSpace.xs`;
    - cog padding is `uiSpace.sm`.
  - The re-capture shows all four labels whole on the SE:
    `m22t04-se-0{1,2}-*-final.png` (run
    `artifacts/maestro/m22-t04-screens/20260911-151511-96341`). The
    `-post-fix` captures are the intermediate attempt.
- **Real backend** (signed in as fixture `user_a`, local Supabase; run
  `m22-t04-screens/20260911-153208-19752`):
  - `m22t04-02-groups-empty-real-backend.png` (empty state);
  - `m22t04-02b-my-groups-empty-real-backend.png`.
- **Fixture-rendered** (same signed-in session; the four read RPCs swapped
  for fixtures by a temporary, uncommitted patch to `src/groups/api.ts`,
  since there is no seeded group data yet; run
  `m22-t04-screens/20260911-153318-22457`):
  - `m22t04-03-stream-all.png`;
  - `m22t04-04-stream-one-group.png`;
  - `m22t04-05-offline-marker.png` (the second All fetch fails with
    `NETWORK`);
  - `m22t04-06-friend-view.png`;
  - `m22t04-07-group-screen-stream.png`;
  - `m22t04-08-group-screen-members.png`.
  - The two-user lane (M22-T06) adds real-data captures.
- Harness notes:
  - Shared Docker hung for about 1 h mid-task, so runs paused until it
    recovered.
  - Two SE attempts stalled on the Maestro XCUITest driver, and the retries
    passed.
  - After the harness teleport, an iOS 26 stale tab frame made a tap on
    `top-level-tab-groups` land on Log. The screenshot flows open
    `boga3://groups` instead.

## Completion note

- What changed: the Groups tab, My groups, the group screen, and the friend's
  session view (read-only); `components/groups/*`; `useGroupStream`
  (paging); view-model formatters; the fourth tab; UI docs, 08 patterns 6–8,
  and the contract §6.3/§7 as-built notes.
- What tests ran: see Evidence.
- What remains: review and merge; real-data captures come with M22-T06.
- M22-T05 adds the create/join/invite/manage actions into the left slots.
