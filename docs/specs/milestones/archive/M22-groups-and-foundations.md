# M22 - Groups and Foundations

## Milestone metadata

- Milestone ID: `M22`
- Title: Milestone: Groups and Foundations
- Status: `completed` (archived by M22-T07)
- Supersedes: `M18` (marked `outdated`)

## Parent references

- Project directives: `AGENTS.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing and gates: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- UX standard and current UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- API authorization: `docs/specs/10-api-authn-authz-guidelines.md`
- Project structure: `docs/specs/09-project-structure.md`
- **Technical design (authoritative for M22):** `docs/specs/tech/groups-contract.md`
- Origin (non-authoritative working notes):
  `docs/brainstorms/2026-09-10-group-activity-stream.md` (Parts A–C)

## Milestone objective

Friends can form a private group and see each other's training. They create a
group, invite and join by code or link, manage members and roles, and browse a
stream of co-members' sessions in full detail. This is the first time data
flows from the server to *other* users' devices.

## Product decisions carried into M22

Numbers refer to the brainstorm decision log.

| # | Decision |
| --- | --- |
| 2 | No maximum group size. |
| 4 | When a member leaves, everything they shared stays. |
| 5 | All of a member's sets are visible to their groups. |
| 9, 19 | A new member sees the group's whole record. A session belongs to the groups the member was in when they started it, so pre-join and post-leave sessions are never shared. |
| 10 | Offline: group screens show an offline marker and the last fetched data. |
| 11 | Member identity is the username only. |
| 13 | Former members stay in the record, and rejoining restores them as a current member. |
| 15 | Gym names are visible to the group; GPS is never shared. |
| 16–18 | Sessions are shared into the group record at start, keep updating until complete, and later edits and deletes flow through. |
| 20 | The stream shows one collapsed card per session, sorted by start time. |
| C7.1 | Usernames stay **non-unique**. |
| C7.2 | An in-progress session shows **"Training now" for as long as it is active**, with no staleness cutoff. |
| C7.3 | Removal shows as **"X was removed"**; leaving shows as "X left the group". |
| C7.4 | Only the **owner and admins** can see and share the invite code. |

## In scope

1. Server group domain: groups, membership periods with roles, invites, the
   group session record (share ledger), stream and session reads — all
   server-enforced (tech design §2–§5).
2. Username prerequisite for create/join (inline prompt).
3. Groups bottom tab with the stream (All + per-group filter), My groups,
   Create group, Join group.
4. Create/edit group; invite code/link with share sheet and regenerate; join
   by code or `boga3://` link with preview.
5. Group screen (Stream + Members); members and roles: promote/demote admin,
   transfer ownership, remove, leave.
6. Stream: one card per session (username, gym, start time, "Training now" or
   completed + duration, performed sets, total volume kg, exercise count, PR
   highlights) and membership items (joined / left / was removed).
7. Friend's session view (read-only, performed sets only).
8. Local cache with offline marker and "last updated"; refresh on focus,
   periodically while visible, and pull-to-refresh.
9. Tests: backend contract lane, mobile unit tests, a two-user Maestro lane.
10. Spec updates (see Deliverables).

## Out of scope

Group delete/restore; group image; live follow (Realtime); group exercises and
links; leaderboards and group gyms; certification; push notifications;
comments/reactions; sharing controls; web client; weight units other than kg.

## Functional requirements

Brainstorm Part C3 is the detailed source. It is adopted as written, with the
defaults it marks **[default]** and the C7 answers above, except for the
clarifications below. The tech design maps each requirement to a mechanism.

1. **Username (C3.1).** Create and join require a non-blank username, checked
   both client-side and server-side (`USERNAME_REQUIRED`).
2. **Groups tab (C3.2).** Signed-out or auth-unconfigured builds show a
   sign-in-required state.
3. **Group rules (C3.3).** Name is 1–50 characters after trimming, description
   at most 280. Owner and admins can edit. Changes need a connection.
4. **Invites (C3.5).**
   - One active, multi-use, non-expiring code per group; regenerating it
     invalidates the old one.
   - The preview shows only name and member count.
   - Joining when already a member opens the group.
   - A former member rejoins as a plain member.
5. **Roles (C3.6).** The owner can remove anyone else; admins can remove
   members only. The owner promotes, demotes, and transfers (the previous owner
   becomes admin). The owner — including a sole owner — cannot leave in M22.
6. **Stream (C3.7).**
   - Newest first by session start time.
   - In All, a session shared into several of my groups appears once.
   - My own sessions appear too.
   - Deleted sessions disappear.
   - Infinite scroll with no depth limit.
   - Tapping a membership item opens its group.
7. **PR highlight.** It uses the recorder's existing rule: a strict
   estimated-1RM (Wathan) improvement over the member's own completed history
   for that exercise, measured against their full history (tech design §5.2).
8. **Friend's session view (C3.8).** It uses the View Session layout without
   owner actions. An in-progress session shows the last refreshed state, and
   the detail is available offline once opened.
9. **Offline (C3.10).** Group writes fail clearly and change nothing. Personal
   logging and sync never depend on groups.

## Deliverables

1. Supabase migration(s): group tables, share trigger, RPCs, SQL metric
   helpers (tech design §2–§5).
2. Backend contract lane `groups-contract` + parity vectors.
3. Mobile `src/groups/` module, `group_cache` local table, account-wipe
   integration.
4. Mobile routes and UI (tech design §6.3), including the fourth tab.
5. Maestro lane `ios-groups-e2e` with dedicated fixture users `user_c` and
   `user_d`; lane/trigger registries and spec 02/06/11 updates.
6. Spec updates in the same PRs as the behavior they describe:
   - `00-product` — the group product decisions;
   - `03` — flip the planned group-record decision to `Adopted`;
   - `05` — the new entities and their sync-impact decisions;
   - `10` — the group authorization rules;
   - sync contract §B.11;
   - `ui/screen-map`, `ui/navigation-contract`, `ui/components-catalog`,
     `ui/ux-rules`;
   - `08` UX patterns — the stream card, the offline marker, and
     pull-to-refresh;
   - `06` and `02` — the new lanes;
   - `09` if the new paths need it.
7. Closeout: archive this spec, and archive M18 as outdated.

## Acceptance criteria

1. A signed-in user with a username can create a group and is its owner.
2. A user without a username is prompted and completes create/join after
   setting one.
3. An owner or admin shares an invite; a second user opens the link or enters
   the code, sees the preview, joins, and both see "joined".
4. After regenerating the code, the old code fails with a clear error.
5. **Live card.** When member A starts a session, member B sees one card for it
   marked "training now" after a refresh. The card shows sets, total volume,
   and exercises so far. When A completes the session, the same card shows as
   completed with duration, final metrics, and any PRs as highlights.
6. B opens A's session and sees exercises and performed sets only, with no
   edit, delete, or append actions.
7. **Sharing window.** A's sessions from before joining never appear, and
   sessions after leaving never appear. Sessions shared before leaving stay
   visible to members.
8. A's later edit or delete of a shared session shows in the group after a
   refresh.
9. A non-member cannot read any group's record, stream, members, or invite
   code — proven by server-side tests, not only by UI.
10. **Role rules.**
    - Members can't invite, remove, or promote.
    - Admins can't promote, transfer, or remove the owner or admins.
    - The owner can do all of these.
    - An owner cannot leave.
11. A removed member loses access on their next refresh.
12. Offline: the Groups tab shows the cached stream with an offline marker;
    create, join, and leave show a clear error and change nothing.
13. Personal logging and sync behave exactly as before when group features
    fail or are unreachable.
14. A user in several groups sees All and per-group filters working.
15. The required local gates are green, including the two-user end-to-end lane.

## Task breakdown

Each card is one PR. Cards point at the technical design sections rather than
restating them.

1. `docs/tasks/complete/M22-T01-Backend_group_membership_invites_and_authz.md` —
   groups, membership periods, invites, all membership/invite RPCs, and the
   new `groups-contract` backend lane (`completed`).
2. `docs/tasks/complete/M22-T02-Backend_group_record_share_trigger_and_stream_reads.md`
   — the share ledger and trigger, `group_stream`, `group_session_detail`, the
   SQL metric helpers, and the SQL/TS parity vectors (`completed`).
3. `docs/tasks/complete/M22-T03-Mobile_groups_client_cache_and_hooks.md` — the
   `src/groups` client, the `group_cache` local table, the account wipe, and
   the resource/action hooks (`completed`).
4. `docs/tasks/complete/M22-T04-Mobile_groups_tab_stream_group_screen_and_friend_session.md`
   — the Groups tab, the stream, My groups, the group screen, and the friend's
   session view (`completed`).
5. `docs/tasks/complete/M22-T05-Mobile_create_join_invite_and_member_management.md` —
   create, edit, join (deep link), invite and share, the username gate, and
   members and roles (`completed`).
6. `docs/tasks/complete/M22-T06-Two_user_groups_Maestro_lane.md` — the `ios-groups-e2e`
   lane with fixture users `user_c`/`user_d` (`completed`).
7. `docs/tasks/complete/M22-T07-Milestone_closeout.md` — the full gate run, the AC
   matrix, the as-built specs, and the archive (`completed`).

Dependency graph (parallel where arrows allow):

```text
T01 ──► T02 ─────────────┐
T03 ──► T04 ──► T05 ─────┼──► T06 ──► T07
```

- T01 and T03 start in parallel.
- T02 runs alongside T04/T05.
- T06 needs T02 and T05.

## Risks / dependencies

- **A fourth bottom tab must fit the tray on small phones.** It is verified by
  screenshot in the UI task.
- **"Training now" freshness** depends on the athlete's sync timing plus the
  viewer's poll. It is not measured today; the Maestro lane records the
  observed behaviour.
- **The share trigger runs inside `sync_push`.** It is failure-isolated and
  logged (tech design §2.5), and its cost is one indexed insert-select per
  session row write.
- **The SQL metric helpers mirror TS semantics.** Drift is guarded by the
  shared parity vectors (tech design §5.3).
- **The two-user Maestro flow scripts the counterparty over HTTP** from
  `runScript`. If Maestro's JS HTTP proves unreliable, the fallback is a
  lane-runner shell step between two flow halves (decided in the lane task).
- **Invite links opened while signed out** lose the code at the sign-in
  redirect. This is documented as a known limitation.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
