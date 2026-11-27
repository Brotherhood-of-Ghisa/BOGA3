# Meets

### meets.linking · definition · accepted

A session counts toward a meet only after its member explicitly joins that
session to the meet (the meet's own Join is separate and only adds the member to
the roster). It counts while the link is live, the session is shared into the meet's group, and
it overlaps the meet window: `started_at < ends_at`, and its end (or now, while
the session is running) `> starts_at`. A session can count toward meets in
several groups. The roster is the members who joined plus members with a live
counting link. A session that does not overlap the window cannot be attached.

Why: results must come from deliberate choices, never from whatever a member
happened to train that day.
Code: `apps/mobile/src/data/session-meet-links.ts`;
`supabase/migrations/20261127213000_session_meet_links.sql`.
Pending: the app's session Join controls and meet scoring are not built yet.

### meets.results · definition · accepted

Meet results stay live until `ends_at` + 24 hours. At that cutoff the server
snapshots every set of every counting link, and results come only from that
snapshot. Any challenge added, edited or removed rescores the snapshot. An
admin's Refresh results re-snapshots the linked sessions as they stand now.
Deleting an account deletes that user's snapshot rows and trophies. Tied scores
share a place and the next place skips (competition ranking, as `groups.medals`
does); the podium is places 1–3.

Why: a final result must not drift when an old session is edited later, except
by an explicit refresh.
Code: `supabase/functions/group-eval/`.
Pending: the cutoff snapshot and refresh are not built yet.
