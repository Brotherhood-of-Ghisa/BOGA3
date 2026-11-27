# Meets

### meets.linking · definition · accepted

A session counts toward a meet only after its member joins that session to the
meet (the meet's Join only adds them to the roster). It counts while the link
is live, the session is shared into the meet's group, its member is still in
the group, the meet is not cancelled, and the session overlaps the window:
`started_at < ends_at`, and its end (now while running; its start if none was
recorded) `> starts_at`. A session can count in several groups' meets. The
roster is the members who joined plus members with a counting link. A session
that can no longer overlap cannot be attached; a running one that started
earlier can. The recorder offers Join while its meet's window is open, and a
finished session's page offers it until the cutoff. Leaving a meet detaches
every session this device holds, after one sync; a session linked only on
another device keeps counting until it is left from its own page. Every join
and leave closes at the [[meets.results]] cutoff.

Why: results must come from deliberate choices, never from whatever a member
happened to train that day.
Code: `apps/mobile/src/data/session-meet-links.ts`;
`supabase/migrations/20261127213000_session_meet_links.sql`;
`supabase/migrations/20261127202908_group_meet_storage.sql` (online Join);
`apps/mobile/src/groups/session-meets.ts` (recorder and session-page Join/Leave).
Pending: meet scoring is not built yet.

### meets.challenge-exercise · definition · accepted

An exercise in a session is a challenge exercise of a meet when the session is
joined to that meet and the exercise's live group link names a live challenge's
group exercise in the meet's group. Session cards show it with a `Challenge` tag.

Why: a member sees which of today's exercises count toward a meet without
opening it.
Code: `apps/mobile/src/groups/session-meets.ts`.

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
