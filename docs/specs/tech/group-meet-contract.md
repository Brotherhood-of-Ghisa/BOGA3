# Group Meet Contract

> **Owns:** the implementation boundary for group meets: storage, the
> session↔meet link, challenges, scoring snapshot and refresh, the meets
> leaderboard, notification delivery and client reads.
> **Not here:** product rules (they live in [[meets.linking]], [[meets.results]]
> and [[notifications.meets]]), and what the code states (columns, SQL, wire
> shapes, messages, tests). **Status:** storage, challenges, the roster, the
> session link and the stream kind are built; the other sections are filled by
> the cards that build them. **Load when:** changing meets, meet challenges, the
> meet session link, or `supabase/functions/group-eval/` meet scoring.

## Storage and lifecycle

Meets, their challenges and their roster are server-only group storage under
groups-contract "Server rules" 1–4, reached only through `group_meet_*` RPCs
that follow its "Authorization" and "RPC conventions" (load
[groups-contract.md](groups-contract.md) when changing meet posture or
tokens): every mutation locks the group row `FOR UPDATE` before its role
check, reads take `KEY SHARE`. Like every group reader, they refuse a client without
Hold support in a group with a Hold comparison (`UPDATE_REQUIRED`). Times travel as epoch ms; the app shows them in
the group's calendar zone, which the meet read carries (null for a group
without one) and the server never applies.

- **Writes.** Owners and admins create, edit and cancel. Create is idempotent
  on a caller-held UUID: an identical retry returns the stored meet; the same
  ID with other fields is `CONFLICT`. Edit and cancel send the expected
  `version`; a stale one is `CONFLICT` and changes nothing; an identical retry
  of the last successful write returns the meet, a superseded one conflicts.
- **Window.** The end defaults to start + 3 h, must be after the start and in
  the future, and lies within 7 days of it; a start is at most 400 days ahead.
- **States** derive from the clock: Scheduled before `starts_at`, Live to
  `ends_at`, Finalizing to the [[meets.results]] cutoff, then Final; or
  Cancelled. Fields are editable until `ends_at`, except that a started
  meet's start cannot move past now; cancel only before `starts_at`, keeping
  the row with who and when. A cancelled meet refuses
  edits, joins and challenge writes; lists leave it out, a read by ID returns it.
- **Refusals.** A write the meet's state no longer allows (ended, started,
  cancelled, past the cutoff) is `CONFLICT`, like a stale version: refresh and
  retry. Malformed input is `VALIDATION`.
- **Reads** (current members, every field): a group's upcoming meets (not yet
  ended, soonest first, the first 50) and a keyset page of past ones (latest
  first); one
  meet with its live challenges, its joined roster and the viewer's role and
  join.
- **Stream.** Meet items are `group_events` rows of kind `meet`, written in
  the transaction of the change, holding definition snapshots only (never
  scores or private context). `scheduled`, `cancelled`, `on` and `results`
  are written once per meet; `results_refreshed` and `challenge_changed` once
  per write. `on`, `results` and `results_refreshed` belong to the timed jobs
  and refresh, which are not built yet. Only the opt-in `group_competition_stream_v7` page
  lists them; earlier pages are unchanged.

## Challenges

- Any current member adds a challenge (group exercise + metric) before, during
  or after the meet; its author or an owner/admin edits or removes it; anyone
  else is `FORBIDDEN`. A meet holds at most 20.
- **Metrics** follow the exercise's comparison ([[groups.hold-ranking]]):
  `seconds` for a Hold, else `e1rm`, `weight`, `reps` or `volume`. The
  exercise must be a live (unarchived) exercise of the group. The group
  boards rank only `e1rm`, `volume` and `seconds`; meet scoring defines
  `weight` and `reps`.
- **Uniqueness.** One live challenge per exercise + metric on a meet; a second
  add or an edit onto that pair is `DUPLICATE`. Adds are keyed by a client ID
  (an identical retry returns it, even once the exercise is archived), so concurrent adds of different challenges
  both commit; edits and removals send the challenge's `version`; saving a challenge
  unchanged changes nothing.
- **Removal** is soft: a removed challenge leaves every read and frees its
  pair for a re-add under a new ID; removing it again succeeds.
- Each add, edit or removal at or after the cutoff writes one
  `challenge_changed` stream item with the challenge's definition (and, for an
  edit, the previous one). Rescoring is under "Scoring, snapshot and refresh".

## Roster and session links

**Online Join and Leave.** Any current member joins or leaves a meet with an
online RPC until its cutoff; a cancelled meet refuses joins. Both are
idempotent.

**Session links.** A member joins one of their sessions to a meet with the
Sync v2 entity `session_meet_links` (load
[sync-v2-server-contract.md](sync-v2-server-contract.md) when changing it), so
it works offline. Only the member's client writes it: the server never writes
a member's Sync v2 rows, so detaching all of a member's sessions from a meet is
the client tombstoning the links it holds (`leaveMeetSessions`; pull first to
reach links made on another device). The client refuses joins and leaves past
the cutoff ([[meets.linking]]) and a session that can
no longer overlap the window (it started at or after `ends_at`, or ended at or
before `starts_at`); the server accepts every link and decides at read time.

**Counting.** `group_meet_counting_links` applies [[meets.linking]]: the link
and its session are live, the session is in the share ledger for the meet's
group, its owner is a current member, the meet is not cancelled, and the
session overlaps the window. A session's end is `completed_at`; while it runs,
now; a completed session without one ends where it started. No trigger reacts
to a link, so a link that does not count never fails `sync_push`; it is kept
and ignored. Scoring reuses the same helper.

**Roster.** The meet read lists joined members ∪ members with a counting link
(`group_meet_roster_members`): `joined` and `joined_at_ms` are the explicit
join (null for a member there by a link only), `linked` marks a counting link,
and `current_member` is false for joined members who have since left the
group (a member there only by a link drops off when they leave, as their links
stop counting). Joined members
come first, in join order.

## Scoring, snapshot and refresh

Live scoring, rescoring on challenge change and Refresh results, under [[meets.results]]. The [[meets.results]] cutoff snapshot is the accepted exception to [groups-contract.md](groups-contract.md)'s "Nothing is copied".

## Meets leaderboard

Medal counting across final meets, tie ranking and former-member handling.

## Notifications

Start and end push delivery on the existing notification pipeline, and the per-group Meets preference.

## Mobile reads and writes

Client RPCs, cache keys, the online-only write rule for meet actions, and the offline link path.

## Verification ownership

`supabase/tests/groups-meets.sh` (lane `groups-contract`) proves "Storage and
lifecycle", "Challenges" and online Join and Leave against the local stack:
posture, the role and denial matrix, versions and retries, state refusals,
`DUPLICATE`, concurrent adds, the cutoff, list paging and the stream items.
`supabase/tests/groups-meet-links.sh` (same lane) proves the counting cases and
the roster union; the `sync-v2-*` lanes prove the link's sync behaviour, and
`apps/mobile/__tests__/session-meet-links-repository.test.ts` the client join,
leave and overlap check.
