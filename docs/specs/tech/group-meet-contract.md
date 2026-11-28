# Group Meet Contract

> **Owns:** the implementation boundary for group meets: storage, the
> session↔meet link, challenges, scoring snapshot and refresh, the meets
> leaderboard, notification delivery and client reads.
> **Not here:** product rules (they live in [[meets.linking]], [[meets.results]]
> and [[notifications.meets]]), and what the code states (columns, SQL, wire
> shapes, messages, tests). **Status:** storage, challenges, the roster, the
> session link, the stream kind, scoring, the snapshot, refresh, the meets
> leaderboard and the results screens are built; the other sections are filled by the cards that build
> them. **Load when:** changing meets, meet challenges, the
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
  and refresh. Only the opt-in `group_competition_stream_v7` page
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

Implements [[meets.results]]. The cutoff snapshot is the accepted exception
to [groups-contract.md](groups-contract.md)'s "Nothing is copied".

**Scores are the evaluator's** ([[meets.challenge-metrics]]). A set scores
on the group exercise its exercise is live-linked to in the meet's group. 1RM, Volume and seconds are
its published counting comparison scores (the TS scorer under the strict
group policy: effort, units, bodyweight), at the current revision and only
while they still describe the live set; a rebuilding comparison or an edit not
yet evaluated scores nothing yet. Weight is that Volume per rep: the
total-load kg halved for a per-side comparison or, normalized, the added load
%BW the set display shows. Max reps are the set facts' for a performed working
set. SQL computes no load, bodyweight or 1RM from raw values: its only
arithmetic is that per-rep derivation from the published Volume, as
`group_competition_set_display` derives added load; if changing these, load
[group-competition-contract.md](group-competition-contract.md).

**Ranking.** Each member's best qualifying set per challenge (a member's own
ties break in board order), placed on the full-precision value as
[[meets.results]] says.

**Live, then the snapshot.** Until the snapshot exists, results are computed
on each read from the counting links. Server finality, never the clock, makes
them final: the results read's own state says so, while the embedded meet's
clock-derived state can already read final.

**✓** follows [[meets.results-display]]: live, the set's witness (any of its
certifications matching one of its current scores, so one certification marks
every metric of the set); final, stored with the snapshot's scores.

**Timed transitions.** Each group-eval run, after its queues, fires what is
due: the `on` item at `starts_at`, `results` at `ends_at`, the snapshot at the
cutoff. The kick or the hourly sweep starts the run, so a transition can lag
by up to an hour; items sort at their boundary. The worker advances one meet
per call, so each meet commits in its own transaction under its group then
meet row locks, with a marker on the meet: a crash or failure rolls back and
retries after a backoff (parked, and logged, at the evaluator's attempt cap),
a concurrent run skips a meet or group another holds, and nothing fires
twice. A cancelled meet or deleted group fires nothing. The
snapshot waits (a minute at a time) while the evaluator still has unparked
work for a counting session, a counting member's targets or the group's
comparisons, checked again after it is taken.

**The snapshot** copies every live set of every counting session (all
exercises; unlinked ones keep a null mapping) with its raw values, mapping and
qualifying scores, then ranks every challenge into stored standings. Results
then come only from it. Adding, editing or removing a challenge reranks that
challenge from it; deleting a member's rows (account deletion cascades,
`dev_wipe_my_data` deletes them) reranks their meets.

**Refresh results** (owners and admins, from the cutoff) re-snapshots the
counting sessions as they stand now, reranks, and writes one
`results_refreshed` item per call. Before the cutoff results are still live,
and while the evaluator is behind, so both are `CONFLICT`; so is a cancelled
meet.

**Reads** (current members): one meet's results, per live challenge its ranked
rows with the set, value, unit and ✓, a caption state (`scheduled`, `live`,
`so_far` with the final time, `final`, `refreshed` with when and who,
`cancelled`), the counting sessions, and the group records set in them, read
live ([[meets.results-display]]). Every read applies
[[groups.kg-disclosure]] per row, plus a kg score's exercise now counting
bodyweight (as CoW): hidden kg figures are null with `unavailable`, places
kept, and the raw weight is withheld whenever the rule hides kg.

## Meets leaderboard

Implements [[meets.leaderboard]] for current members. A trigger keeps one
trophy tally per member and group from the stored standings, so rescoring,
Refresh and deletion update it without a job and the leaderboard reads one
row per member. Each member's trophies, with their meets and challenges, are a
separate keyset page, newest meet first.

## Notifications

Start and end push delivery on the existing notification pipeline, and the per-group Meets preference.

## Mobile reads and writes

`api.ts` is the only RPC caller; `meet-wire.ts` decodes closed shapes before
caching. Meet lists and detail reads use `useGroupResource` with versioned,
account/group-scoped cache keys; older archive pages remain online-only.
Group access loss evicts meet entries; a missing meet evicts only its entry.
The stream opts into v7 with a new cache suffix, discarding older cursors.

Roster rows decode `joined`, nullable `joined_at_ms` and `linked`: the going
list shows every roster row, joined or link-only.

Results reads are online-only and never cached: full standings are not
(`useMeetResults`, one page of `useGroupOnlinePages`), as is a member's
trophies page. The leaderboard is one row per trophy holder and is cache-first
under its own versioned key, evicted with the group. The caption comes from
the results read's own state, never the clock. `Refresh results` (owners and
admins, offered from `ends_at`) uses `useGroupAction`; a `CONFLICT` before the
cutoff or while the evaluator is behind is shown, not retried. Today's meet
card reads the cached meet list and shows the live meet, else the nearest
(an upcoming meet before a past one at equal distance), from 7 days before its
start to 7 days after its end, never a cancelled one.

Meet/challenge/roster writes use `useGroupAction`, refused offline and never
queued. Editors retain input across refresh and conflict; explicit status
review rebases the expected version, while uncertain creates retain their UUID.
Metadata locks at the end; challenge actions remain available. The session
link path belongs to [[meets.linking]].

Address checks call the existing native geocoder on blur, never requesting
permission: iOS geocodes directly, Android only with an existing foreground
grant. Unmatched/offline text saves without coordinates; changing the text
clears coordinates and ignores older checks. Maps uses coordinates when
present, otherwise an escaped address search. Group-zone wall times reject
nonexistent daylight-saving times rather than silently shifting them.

## Verification ownership

`supabase/tests/groups-meets.sh` (lane `groups-contract`) proves "Storage and
lifecycle", "Challenges" and online Join and Leave against the local stack:
posture, the role and denial matrix, versions and retries, state refusals,
`DUPLICATE`, concurrent adds, the cutoff, list paging and the stream items.
`supabase/tests/groups-meet-links.sh` (same lane) proves the counting cases and
the roster union; the `sync-v2-*` lanes prove the link's sync behaviour, and
`apps/mobile/__tests__/session-meet-links-repository.test.ts` the client join,
leave and overlap check. `supabase/tests/groups-meet-scoring.sh` (lane
`groups-competitions`) proves "Scoring, snapshot and refresh" and "Meets
leaderboard" against evaluator-published scores: every metric, the window,
ties, the transitions, the snapshot's once-only write, Refresh, rescoring,
deletion, access and disclosure.
