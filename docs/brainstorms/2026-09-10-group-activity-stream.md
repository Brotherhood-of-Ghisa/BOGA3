# Brainstorm — Groups, group exercises, leaderboards, and the group stream

- Date: 2026-09-10
- Status: `adopted — M22 shipped; phases 2–5 pending` (2026-09-12). Part A/C
  decisions carried into M22 are recorded in
  `docs/specs/milestones/archive/M22-groups-and-foundations.md` and
  `docs/specs/tech/groups-contract.md`. **[default]** = proposal awaiting confirmation;
  **[open]** = needs discussion; **[unreviewed]** = drafted, not yet reviewed.
- Branch: `claude/group-activity-stream-221a5c`
- Not source-of-truth. Adopted content graduates into `docs/specs/**`
  (`00-product.md`, `03`, `05`, `10`, new milestone specs).
- Session outputs: **(A) product spec → (B) phasing → (C) detailed spec of the
  first milestone.** Parts A (groups + foundations), B, and C are drafted.
  Next: resolve C7, then technical design and task breakdown for M22.
- The M18 milestone plan is set aside. The "all sets visible" decision (#5)
  reverses M18's privacy text in specs 05/10; those specs need revising when
  this spec is adopted.

## Decision log

| # | Date | Decision |
| --- | --- | --- |
| 1 | 2026-09-10 | Ignore the M18 milestone plan; spec groups from the product vision below. |
| 2 | 2026-09-10 | No maximum group size. |
| 3 | 2026-09-10 | Groups are soft-deleted, never hard-deleted. |
| 4 | 2026-09-10 | When a member leaves, everything stays: their events, leaderboard entries, and certifications. |
| 5 | 2026-09-10 | **All of a member's sets are visible to their groups** ("maximum banter"), not only sets on group exercises. |
| 6 | 2026-09-10 | Admins can duplicate standard-catalogue exercises into the group catalogue, analogous to a user editing a seed exercise. |
| 7 | 2026-09-10 | Member proposals for new group exercises are deferred. |
| 8 | 2026-09-10 | No weight-unit feature: the app has no unit support (everything is kg), so none is needed. |
| 9 | 2026-09-10 | **History on join:** a new member sees all of the group's previous history but contributes none of their own pre-join history. |
| 10 | 2026-09-10 | Offline: group screens show an offline marker and the last fetched data. |
| 11 | 2026-09-10 | Member identity is the username only (display name / avatar later). |
| 12 | 2026-09-10 | Soft-deleted groups can be restored by the owner. **Delete and restore are deferred** (not in the first milestones). |
| 13 | 2026-09-10 | Former members stay on leaderboards (marked as former); rejoining restores them. |
| 14 | 2026-09-10 | **Group exercise model:** a member either picks the group's exercise, or links one of their existing exercises to a group exercise, for any number of groups. Leaving a group does not change links. **First implementation: picking only.** |
| 15 | 2026-09-10 | Gym names are visible to the group. |
| 16 | 2026-09-10 | **Sessions are shared into the group.** When a member logs a session, it becomes part of each of their groups' permanent records. The group holds its own record of the session; groups are not built by querying members' private data. Storage/transport is a technical decision, deferred. |
| 17 | 2026-09-10 | A session enters the group record when it starts and keeps updating until it completes. |
| 18 | 2026-09-10 | Later edits and deletes by the member update the group record too; certified values stay pinned. |
| 19 | 2026-09-10 | A session belongs to the groups the member was in when they logged it (an offline session logged before joining is not shared). |
| 20 | 2026-09-10 | **Stream = one collapsed card per session**: start time, progress metrics (sets, total volume, …), and highlights (PRs, …). Cards sorted by session start time. |
| 21 | 2026-09-10 | C7.1: usernames stay **non-unique**. |
| 22 | 2026-09-10 | C7.2: an in-progress session shows **"training now" indefinitely** while active (no staleness cutoff). |
| 23 | 2026-09-10 | C7.3: removal shows as **"X was removed"** (leaving: "X left the group"). |
| 24 | 2026-09-10 | C7.4: invite code visible/shareable by **owner and admins only**. |
| 25 | 2026-09-10 | M22 adopted: `docs/specs/milestones/archive/M22-groups-and-foundations.md` + technical design `docs/specs/tech/groups-contract.md`. M18 marked `outdated`. |

---

# Part A — Product spec

## A1. Problem and vision

BoGa is a local-first personal tracker: data flows device → server for backup
only. Training with friends is social, and "no one can cheat on their PRs
again" (00-product) needs friends to see and vouch for each other's lifts.

Vision: small private groups of friends ("Brotherhoods") who see everything
each other lifts, share a curated set of exercises, compete on group
leaderboards backed by peer certification, and follow each other's training
as it happens.

## A2. Concepts

| Term | Meaning |
| --- | --- |
| **Group** | A private set of people. Invite-only, not discoverable. |
| **Owner** | The one member who controls the group's existence. Exactly one per group. |
| **Admin** | Member who can manage membership, group exercises, gyms, leaderboards. |
| **Member** | Anyone in the group, including owner and admins. |
| **Group record** | The group's own permanent record of the sessions its members logged while members (decision #16). |
| **Standard catalogue** | The bundled starter exercises (`seed_*` ids), identical ids for every user. |
| **Group exercise** | A "blessed" exercise owned by the group: duplicated from the standard catalogue or created custom. Basis for leaderboards. |
| **Link** | A member's own exercise marked as counting for a group exercise. Created by picking the group exercise, or (later) by linking an existing exercise. |
| **Group gym** | A gym defined by the group, used for leaderboard filters. |
| **Leaderboard** | Ranking of members on one group exercise by one metric, with filters and a certification rule. |
| **Certification** | Another member attesting that a specific set happened as logged. |
| **Stream** | Chronological feed of group events. |
| **Follow** | Watching another member's in-progress session live. |

## A3. Features

### F0 — Foundations (cross-cutting)

The capabilities every group feature relies on. None exist today.

1. **Group data on the device.** My groups, their members and roles, and the
   stream are delivered from the server to the device and readable offline
   once fetched.
2. **Member identity.** Co-members see each other's username (decision #11).
   Today usernames are optional and not unique
   (`supabase/migrations/20260304153000_m11_user_profiles.sql:13`), so group
   features must handle a missing username (see Part C questions).
3. **Reading other members' training.** A member can read the group's record:
   co-members' shared sessions, exercises, sets, and gym names. Only members
   can read it.
4. **Sessions are shared into the group** (decisions #9, #16).
   - A session a member logs becomes part of the record of every group they
     belong to at that time.
   - Sessions logged before joining, or after leaving, never enter that
     group's record.
   - A viewer sees the group's whole record, including sessions shared before
     the viewer joined.
   - Leaving doesn't remove anything from the record (decision #4).
   - **[open]** The session is in progress when first shared (needed for
     "session started" and follow). **[default]** The group's record keeps
     updating until the session completes.
   - **[open]** Later edits and deletes by the member. **[default]** They
     update the group's record too (it is the member's session, just
     shared); certified values stay pinned (F3.4).
   - **[open]** A session logged offline before joining, synced after:
     **[default]** it belongs to the groups the member was in when they
     logged it, so it is not shared.
5. **Freshness.** While the app is open, the stream updates without manual
   refresh; pull-to-refresh forces it.
6. **Offline behaviour** (decision #10). Group screens show an offline marker
   and the last fetched data. **[default]** Group writes (create, invite,
   join, leave, admin actions) need a connection and fail clearly when
   offline; training logs stay fully offline as today.
7. **Units.** No unit feature (decision #8). All weights are kg.

### F1 — Groups

1. A user can create a group (name required; description optional) and
   becomes its owner.
2. A user can belong to many groups. No maximum group size.
3. Joining is by invite: owner/admins generate an invite code/link; anyone
   holding it can join. **[default]** No approval step; codes can be revoked
   and regenerated.
4. Any member can leave. An owner must transfer ownership first.
5. Admins can remove members (not the owner). The owner can promote/demote
   admins and transfer ownership.
6. The member list shows each member's username and role.
7. When a member leaves or is removed, everything stays: their shared
   sessions, stream events, leaderboard entries (marked "former member"), and
   certifications given. Rejoining restores them as a current member.
8. Groups are soft-deleted by the owner and can be restored by the owner.
   **Deferred** (decision #12).

### F2 — Group exercises

1. Admins create group exercises in two ways:
   - **duplicate a standard exercise** — the group gets its own copy, keeping
     the standard exercise's identity; admins may rename/edit it, as a user
     can rename a seed exercise today (edits happen in place, the `seed_*` id
     is kept — `apps/mobile/src/data/exercise-catalog.ts:181-217`);
   - **create a custom exercise** — name and load mode.
   Admins can archive group exercises.
2. **Logging with group exercises** (decision #14). A member's exercise
   counts for a group exercise through an explicit **link**:
   - **Pick** — the member picks the group exercise in the exercise picker.
     This gives them a personal exercise linked to the group exercise and
     logs it. *First implementation.*
   - **Link existing** — the member marks one of their existing exercises as
     counting for a group exercise. *Later.*
   - Works for any number of groups. Leaving a group leaves links in place;
     they are simply inactive until the member rejoins.
   - See "F2.2 design notes" for the rules this implies.
3. All of a member's sets are visible to the group (decision #5). Group
   exercises matter for comparison: leaderboards, PRs, group records.
4. Proposals for new group exercises are deferred (decision #7).

#### F2.2 design notes (for the group-exercises milestone)

- **One mechanism.** Picking is a shortcut for "create or reuse a personal
  exercise, then link it". Picking and linking produce the same link record,
  so there is only one rule for "does this set count".
- **Link cardinality.** **[default]** Within one group, a personal exercise
  links to at most one group exercise; a group exercise can have several of a
  member's exercises linked (e.g. "Bench" and an older "Bench (gym 2)").
- **What counts.** A set counts for a group exercise when (a) its exercise is
  linked to that group exercise and (b) its session is in the group's record
  (F0.4). **[default]** Linking later also counts earlier sets already in the
  group's record: a link says "these are the same exercise", not "from now".
- **Picking a standard-derived group exercise you already have.**
  **[default]** If the group exercise was duplicated from a standard exercise
  that the member still has, picking it links their existing copy instead of
  creating a duplicate "Barbell Bench Press" in their catalogue.
- **Naming.** The stream shows the member's exercise name; leaderboards show
  the group exercise name.
- **Storage.** A link is member-owned data that the server needs for
  leaderboards. Whether it joins Sync v2 as a new synced entity is decided in
  that milestone. Note: the local integrity rule "client FKs only reference
  synced parents" (spec 05) means a link cannot have a local FK to a group
  exercise.

### F3 — Group leaderboards **[unreviewed]**

1. Admins create a leaderboard on a group exercise with:
   - **metric** — **[default]** heaviest weight for ≥1 rep; estimated 1RM as
     a second option;
   - **gym filter** — all gyms, or a chosen subset of group gyms;
   - **certification rule** — how many certifications a set needs (0 = none
     required) and optionally "certifier must have been at the same group gym
     that day".
2. Group gyms: admins define them; members link their own gym(s) to one.
3. A member's entry is their best qualifying set. Sets that don't yet meet the
   certification rule show as **pending** and don't rank. Former members stay
   listed, marked "former member" (decision #13).
4. **Certification**
   - Any member other than the lifter can certify a set, from the stream or
     from the leaderboard, or when the lifter asks for it.
   - A certification pins the set's value at attestation time. If the lifter
     later edits that set, certifications on it are voided.
   - A certifier can withdraw their certification.
5. Leaderboards show rank, member, value, date, gym, and certification status.

### F4 — Group stream **[unreviewed]**

1. Events:
   - **Session started** — member, time, gym.
   - **Session completed** — duration, exercises, sets, gym.
   - **PR** — a member beats their own best on a leaderboard metric.
   - **Group record** — a new #1 on a leaderboard.
   - **Certification** — requested, and granted.
   - **Membership** — member joined / left.
2. Newest first. **[default]** One combined feed across all your groups, with
   a per-group filter.
3. **Follow a session.** From a "session started" event, a member can open the
   live view of that session and see exercises and sets as they're logged,
   until it completes.
4. A late-arriving offline session shows in its correct time position, and its
   started and completed events merge into one item.
5. Sharing controls: **[open]** with "all sets visible", is a per-group "share
   my activity" switch and per-session hide still wanted?

## A4. Privacy principles

1. Members see everything a co-member logs while a member: sessions,
   exercise names (as the member named them), all performed sets, gym names.
2. Never shared: GPS coordinates; planned/unperformed/partial set rows (they
   were not performed); sessions logged before joining or after leaving.
3. Every group read is enforced on the server by membership, never only by
   the app UI. Non-members see nothing.
4. Agent (OAuth) tokens get no group access (M21 boundary).

## A5. Non-goals (for this product scope)

- Public profiles, group discovery, or following people outside a group.
- Global/cross-group leaderboards or exercise catalogues.
- Direct messages. **[default]** Comments and reactions deferred.
- Web client for groups.
- Weight units other than kg.
- **[default]** Push notifications deferred; in-app stream only at first.

---

# Part B — Phasing

| Phase | Name | Contents |
| --- | --- | --- |
| 1 | **Groups + foundations** | F0 complete; F1 except delete/restore; stream with session started/completed showing full session content, and membership events. |
| 2 | **Follow a session** | Live view via Realtime; latency measured. |
| 3 | **Group exercises** | Duplicate standard / custom exercises; archive; picking a group exercise (links, F2.2). |
| 4 | **Leaderboards + PRs** | Group gyms; leaderboards; PR and group-record events. |
| 5 | **Certification** | Certify, withdraw, void on edit; certification events. |

Deferred beyond phase 5: group delete/restore, linking existing exercises,
push notifications, comments/reactions, time-windowed boards, exercise
proposals.

---

# Part C — Milestone M22: Groups + foundations (draft)

- Proposed milestone ID: `M22` (next free after M21).
- Status: `draft` — product-level spec. Technical design and the task
  breakdown come after sign-off.
- Destination when adopted: `docs/specs/milestones/archive/M22-groups-and-foundations.md`
  (template `docs/specs/templates/milestone-spec-template.md`).

## C1. Objective

Friends can form a private group and see each other's training: create a
group, invite and join by code or link, manage members and roles, and browse a
stream of co-members' sessions with full detail. This is the first time data
flows from the server to *other* users' devices.

## C2. User stories

1. As a lifter, I create a group for my friends and invite them with a link.
2. As a friend, I open the link (or type the code) and join in a couple of taps.
3. As a member, I open the Groups tab and see who is training now and what
   everyone did recently.
4. As a member, I tap a friend's session and see every exercise and set.
5. As an owner or admin, I manage who is in the group and who helps run it.
6. As a member, I can leave a group; what I shared stays.
7. Offline, I can still browse what I last saw, clearly marked as offline.

## C3. Functional requirements

### C3.1 Username prerequisite

1. Creating or joining a group requires a username. If the user has none, an
   inline prompt asks for one and the create/join flow continues after saving.
2. **[default]** Usernames stay non-unique (see C7.1).

### C3.2 Groups tab

1. New bottom tab **Groups** beside History, Session Recorder, Exercise
   Catalog.
2. Content: the stream (C3.7) with a group filter — **All** plus one chip per
   group.
3. Header actions: **My groups**, **Create group**, **Join group**.
4. No groups yet: an empty state explaining groups, with Create group and
   Join with code as the primary actions.
5. **[default]** Signed-out or auth-unconfigured builds show a sign-in-required
   state on this tab.

### C3.3 Create and edit a group

1. Name required (non-empty after trimming). Description optional.
   **[default]** Name ≤ 50 characters, description ≤ 280.
2. The creator becomes owner and lands on the new group's screen with the
   invite action prominent.
3. **[default]** Owner and admins can edit the name and description.
4. Needs a connection; offline shows a clear error and creates nothing.

### C3.4 Group screen

1. Shows name, description, member count, and my role.
2. Sections: **Stream** (this group only) and **Members**.
3. Actions by role: Invite and Edit (owner/admin), Leave (anyone; owner rules
   in C3.6).

### C3.5 Invites and joining

1. Owner and admins can see the group's invite code, share it through the
   share sheet as a code plus a `boga3://` link, and regenerate it (the old
   code stops working).
2. **[default]** One active code per group; multi-use; no expiry. Only owner
   and admins can see or share it.
3. Joining: enter the code on the Join screen, or open the link, which opens
   the Join screen prefilled.
4. Before joining, a preview shows the group name and member count; the user
   confirms.
5. Invalid or regenerated code: clear error. Already a member: opens the
   group.
6. A former member with a valid code is restored as a current member
   (decision #13). **[default]** They come back as a plain member.
7. Joining adds a "joined" item to the stream.
8. The new member sees the group's whole record; their own earlier sessions
   are not shared (decisions #9, #19).

### C3.6 Members and roles

1. Member list: username and role (Owner / Admin / Member). **[default]**
   Sorted by role, then username.
2. **[default]** The owner can remove anyone else; admins can remove members
   but not admins or the owner.
3. The owner promotes members to admin and demotes admins.
4. The owner can transfer ownership to another member, with confirmation.
   **[default]** The previous owner becomes an admin.
5. Any member except the owner can leave, with confirmation. The owner must
   transfer ownership first. **[default]** A sole owner cannot leave in M22
   (delete is deferred); the UI explains why.
6. **[default]** Leaving and removal both show as "left the group" in the
   stream.
7. Everything already shared stays (decision #4).
8. A removed or departed user loses access to the group — stream, members,
   sessions — from their next refresh, and its cached data is hidden.
9. All role rules are enforced by the server, not only by the UI.

### C3.7 Stream

1. Item types: **session card** and **membership item** (member joined /
   member left).
2. **One collapsed card per session** (decision #20), showing:
   - username, gym name if set, and **session start time**;
   - status: "training now", or completed with duration;
   - **progress metrics**: performed sets, total volume (weight × reps over
     performed sets, in kg), and number of exercises;
   - **highlights**: PRs set in the session. **[default]** A PR uses the
     app's existing "New PR" rule — a strict estimated-1RM improvement over
     the member's own completed history for that exercise, as the recorder
     shows today — measured against the member's full history, not only what
     was shared. Later phases add group records (phase 4) and certifications
     (phase 5) as highlights.
3. The card updates while the session is in progress and becomes the
   completed card; there are no separate "started" and "completed" items
   (decision #17).
4. Session cards are sorted by session start time, newest first; membership
   items sit at their own time. Offline sessions that sync late appear at
   their start time.
6. **[default]** In the All view, a session shared into several of my groups
   appears once.
7. The member's later edits and deletes show after a refresh; a deleted
   session disappears (decision #18).
8. **[default]** More items load while scrolling; no history depth limit.
9. **[default]** My own sessions appear too, so I see what my friends see.
10. Tapping a session opens the friend's session view (C3.8). **[default]**
    Tapping a membership item opens the group screen.

### C3.8 Friend's session view

1. Read-only: username, gym, date, start time, duration (or "in progress"),
   and exercises in order with the member's exercise names and performed sets
   (weight in kg, reps, effort).
2. Only performed sets; planned or unperformed rows are never shown (A4.2).
3. **[default]** Same layout as the existing View Session screen, with the
   owner's actions (edit, delete, append) hidden.
4. An in-progress session shows its state as of the last refresh;
   pull-to-refresh updates it. Live updates come with follow (phase 2).
5. **[default]** A session's detail is available offline once opened.

### C3.9 What is shared (summary)

- Every session a member logs while in the group enters the group record at
  start and keeps updating until it completes (decisions #16, #17).
- Edits and deletes flow through (#18).
- Sessions logged before joining or after leaving are never shared (#9, #19).
- Shared: sessions, the member's exercise names, performed sets, gym names.
  Never shared: GPS coordinates; planned or unperformed rows (A4).
- **[default]** No sharing controls in M22: everything in scope is shared.

### C3.10 Offline and freshness

1. When offline, or when a refresh fails, group screens show the last fetched
   data with an offline marker. **[default]** The marker includes "last
   updated" time.
2. **[default]** Refresh happens when the Groups tab or a group screen opens
   or regains focus, periodically while visible, and on pull-to-refresh.
   Live push arrives with follow (phase 2).
3. Group actions need a connection; offline attempts show a clear error and
   change nothing. No queuing.
4. First open while offline with nothing cached: an offline empty state.
5. Groups never block or slow personal logging or personal sync.

### C3.11 Access

1. Only members can read a group's record, stream, and member list.
2. Before joining, an invite shows only the group name and member count.
3. Former members lose read access.
4. Agent (OAuth) tokens have no group access (M21 boundary).

## C4. Out of scope (M22)

Group delete/restore; group image; live follow; group exercises;
leaderboards; certification; push notifications; comments and reactions;
sharing controls; group gyms; web client.

## C5. Acceptance criteria

1. A signed-in user with a username can create a group and is its owner.
2. A user without a username is prompted and completes create/join after
   setting one.
3. An owner or admin shares an invite; a second user opens the link or enters
   the code, sees the preview, joins, and both see "joined".
4. After regenerating the code, the old code fails with a clear error.
5. When member A starts a session, member B sees one card for it marked
   "training now" after a refresh, with sets, total volume, and exercises so
   far; when A completes it, the same card shows as completed with duration,
   final metrics, and any PRs as highlights.
6. B opens A's session and sees exercises and performed sets only, with no
   edit, delete, or append actions.
7. A's sessions from before joining never appear; sessions after leaving
   never appear; sessions shared before leaving stay visible to members.
8. A's later edit or delete of a shared session shows in the group after a
   refresh.
9. A non-member cannot read any group's record, stream, members, or invite
   code — proven by server-side tests, not only by UI.
10. Role rules hold: members can't invite, remove, or promote; admins can't
    promote, transfer, or remove the owner or admins; the owner can do all
    of these; a sole owner can't leave.
11. A removed member loses access on their next refresh.
12. Offline: the Groups tab shows the cached stream with an offline marker;
    create, join, and leave show a clear error and change nothing.
13. Personal logging and sync behave exactly as before when group features
    fail or are unreachable.
14. A user in several groups sees All and per-group filters working.
15. The required local gates are green, including a two-user end-to-end flow.

## C6. Deliverables

1. Server group domain: groups, memberships with roles and join/leave
   history, invites, the group session record, the stream — with
   server-enforced access.
2. Mobile: Groups tab, group screen, create / join / invite / members flows,
   friend's session view, local cache with offline marker.
3. Tests: server authorization and negative-path tests; mobile unit tests;
   Maestro flows including a two-user flow (each flow with its own dedicated
   users, per the hermetic-fixture rule).
4. Docs: `00-product` (group decisions), `03` (architecture decision for the
   group record and delivery), `05` (new entities + sync impact decision),
   `10` (group authorization, replacing the M18 text), sync contract §B.11,
   `ui/screen-map` and `ui/navigation-contract` (new routes), `08` UX patterns
   (stream item, offline marker if new), `06` if two-user e2e is a new test
   layer.
5. Mark M18 `outdated`, pointing at M22.

## C7. Open questions

1. Username uniqueness: are two members both called "Dave" acceptable, or
   must usernames be unique (globally or per group)?
2. Abandoned sessions: a session left "in progress" for days — show it as
   training indefinitely, or stop after some time?
3. Stream wording for removal: "left" for both (default), or "was removed"?
4. Invite visibility: owner/admins only (default), or any member can share?

## C8. Risks / dependencies

- Two-user end-to-end tests: Maestro flows are one user per flow today; a
  second user must be driven hermetically (seeded or scripted per flow).
- "Training now" freshness depends on the athlete's sync timing (not
  measured) plus the viewer's refresh. The navigation contract's "10 s
  recorder / 60 s general" cadence text appears stale: the scheduler has no
  recorder-route cadence (`SESSION_RECORDER_ROUTE_SEGMENT` not found in
  `apps/mobile/src/sync/`).
- The M18 text in specs 05, 10, and the sync contract contradicts decision
  #5 and must be rewritten in this milestone.
- A fourth bottom tab needs to fit the bottom tray.

---

# Appendix 1 — What is already implemented (verified 2026-09-10)

## Group domain — nothing in code

| Area | State | Evidence |
| --- | --- | --- |
| Supabase migrations for any group table | **none** | `supabase/migrations/` — latest is `20260725175643_m21_agent_access_boundary.sql` |
| RLS / `is_group_member` / `is_group_admin` helpers | **none** (named in spec only) | `docs/specs/10-api-authn-authz-guidelines.md` rules 15–17 |
| Mobile service layer / UI for groups | **none** | no matches for `group_membership`, `group_exercise`, `is_group_member` in `apps/mobile`, `services`, `supabase` |
| Supabase Realtime usage | **none** (enabled in config, unused) | `supabase/config.toml.template` `[realtime] enabled = true`; no `channel(` calls |
| Edge functions | `agent-api`, `health` only | `supabase/functions/` |
| Open branches/PRs for groups | none | only merged docs PRs #224, #234, #261 |

Group content that exists only as docs: M18 milestone + T01/T02 cards (six
entity names and prose rules; no column-level schema or tested RLS), and M18
text in specs 05, 10, and the sync contract §B.11.

## Foundations the stream can build on

| Capability | State | Evidence |
| --- | --- | --- |
| Sync v2 push/pull, 9 per-user tables, LWW, composite PK `(owner_user_id, id)` | adopted | `docs/specs/tech/sync-v2-server-contract.md`, `apps/mobile/src/sync/cycle.ts` |
| Active sessions reach the server during the workout | yes — `saveDraftGraph` dirties the whole session graph and calls `notifyLocalWrite()` post-commit | `apps/mobile/src/data/session-drafts.ts:788-848` |
| Scheduler cadence | 1 s debounce after a write nudge, 60 s idle backstop, foreground only | `apps/mobile/src/sync/scheduler.ts:35-38` (constants, **not measured** end-to-end) |
| Session lifecycle on server | `sessions.status` (`active`/`completed`), `started_at`, `completed_at`, `gym_id` | contract §A.2.2 |
| Logged exercise keeps its own display name | `session_exercises.name` (+ `machine_name`) | contract §A.2.3 |
| Stable set identity across saves | yes | spec 05 §Sync v2 #7 |
| Confirmed-set semantics | only valid, confirmed actual rows count as performed | spec 05 §Sync v2 #6 |
| Standard catalogue identity | `seed_*` slug ids, identical for every user (393 seed rows in the bundle file; M20 plans to prune) | `apps/mobile/src/data/exercise-catalog-seeds.ts`, `docs/specs/milestones/M20-prune-starter-exercise-catalog.md` |
| Exercise edits | in place, same id (a renamed seed keeps its `seed_*` id) | `apps/mobile/src/data/exercise-catalog.ts:181-217` |
| Weight units | none in app; implicitly kg; server `training_unit` constrained to `'kg'` | `supabase/migrations/20260725175643_m21_agent_access_boundary.sql:12-18` |
| Usernames | optional (`username text`, nullable), not unique; owner-only RLS | `supabase/migrations/20260304153000_m11_user_profiles.sql:11-47` |
| Tabs | History, Session Recorder, Exercise Catalog (+ hidden Settings) | `apps/mobile/app/(tabs)/_layout.tsx:53-56` |
| Gyms | private per-user rows, optional private GPS | spec 05 invariant 7 |

No server → other-user delivery path exists today: every read is scoped to
the caller's own rows.

# Appendix 2 — Technical notes (draft, for milestone speccing)

## Direction (technical model deliberately not defined yet)

Decision #16: the group holds its own permanent record of shared sessions (a
duplicate/projection of each member's session), rather than the stream being
assembled by querying members' private data by join date. Whether that needs
a separate push from the app or is produced from the existing sync is a
technical choice for the milestone spec.

```
member device ──(shared into)──▶ group record (per group, permanent)
                                        │
member devices ◀── read / refresh ──────┘   local cache, offline marker
```

Notes that still apply whichever way the record is produced:

- Every autosave re-pushes the whole session graph today, so updating the
  group record must diff rather than treat each save as new activity.
- A group-side failure must never break personal sync.
- The server's copy is the source of truth; any live channel is a hint.
- Only performed (confirmed) sets; never GPS columns.
- Co-member usernames need a membership-scoped read (today `user_profiles` is
  owner-only).
- Local group cache is local-only, disposable, `out of sync scope`.

## Risks to carry into milestone specs

1. Edits and deletes after sharing must reach the group record (F0.4
   default), and in-progress sessions must keep updating it.
2. Gym filters need group gyms (no shared gym key today).
3. Certification must pin the attested value; edits void it.
4. Late offline "started" events — order by event time, merge.
5. Live-follow latency is unmeasured — measure before promising "live";
   athlete's app must be foregrounded.
