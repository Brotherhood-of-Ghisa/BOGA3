# Meets

### meets.linking · definition · accepted

A session counts toward a meet only after its member joins that session to the
meet (the meet's Join only rosters them). It counts while the link
is live, the session is shared into the meet's group, its member remains in
it, the meet is not cancelled, and the session overlaps the window:
`started_at < ends_at`, and its end (now while running) `> starts_at`. A session can count in several groups' meets. The
roster is the members who joined plus members with a counting link. A session
that can no longer overlap cannot be attached. Leaving a meet detaches the
sessions this device holds after one sync; one linked only on another device
counts until left from its own page. Every join and leave closes at the
[[meets.results]] cutoff.

Why: results must come from deliberate choices, never from whatever a member
happened to train that day.
Code: `apps/mobile/src/data/session-meet-links.ts`;
`supabase/migrations/20261127213000_session_meet_links.sql`;
`supabase/migrations/20261127202908_group_meet_storage.sql` (online Join);
`apps/mobile/src/groups/session-meets.ts` (recorder and session-page Join/Leave).

### meets.challenge-exercise · definition · accepted

An exercise in a session is a challenge exercise of a meet when the session is
joined to that meet and the exercise's live group link names a live challenge's
group exercise in the meet's group. Session cards show it with a `Challenge` tag.

Why: a member sees which of today's exercises count toward a meet without
opening it.
Code: `apps/mobile/src/groups/session-meets.ts`.

### meets.results · definition · accepted

Meet results stay live until `ends_at` + 24 hours. The server's first run
after that cutoff, once its evaluation has caught up (usually within an hour),
snapshots every set of every counting link; until then results stay live and
are not final. Results then come only from that snapshot. Any challenge added,
edited or removed rescores the snapshot. From the cutoff, an owner's or
admin's Refresh results re-snapshots the linked sessions as they stand now.
Deleting an account deletes that user's snapshot rows and trophies, and the
members below move up. Tied scores share a place and the next place skips
(competition ranking, as `groups.medals` does); the podium is places 1–3.

Why: a final result must not drift when an old session is edited later, except
by an explicit refresh.
Code: `supabase/migrations/20261127223000_group_meet_scoring.sql`;
`supabase/functions/group-eval/` (runs the timed transitions).

### meets.results-display · presentation · accepted

A ranked set shows ✓ while it holds an active [[groups.certification]], as
context, never eligibility; final results keep the ✓ the snapshot took until
Refresh. Results also list the group records set in the counting sessions as
those records stand now; they are not snapshotted.

Why: a ✓ belongs to the frozen result it was seen on; records are group
history, already in the stream.
Code: `group_meet_set_scores` and `group_meet_records_json` in
`supabase/migrations/20261127223000_group_meet_scoring.sql`.

### meets.challenge-metrics · calculation · accepted

A challenge ranks each member's best single qualifying set. 1RM, Volume and
Hold seconds are the group comparison's own scores. Weight is that set's
load in the comparison's terms: per side on a per-side comparison, added load
as %BW on a bodyweight-normalized one (no added load does not score). Reps
are the most reps in one performed working set ([[set.eligibility]]).

Why: a meet compares the same performances the group's boards do, in the same
units.
Code: `group_meet_set_scores` in
`supabase/migrations/20261127223000_group_meet_scoring.sql`.

### meets.leaderboard · calculation · accepted

The Meets leaderboard counts trophies (a live challenge's places 1–3) across
the group's final, non-cancelled meets. Members with a trophy rank by gold,
then silver, then bronze; equal tuples share a rank, ordered by name then ID.
Members without a trophy are not listed. Former members stay, marked; deleted
accounts leave. Rescoring and Refresh update it. It is separate from
[[groups.medals]].

Why: compare who wins meets, not who holds boards.
Code: `group_meet_leaderboard`, `group_meet_trophies` and the
`group_meet_standings_tally` trigger in
`supabase/migrations/20261127223000_group_meet_scoring.sql`.
