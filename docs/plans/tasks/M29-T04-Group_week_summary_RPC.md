# M29-T04-Group_week_summary_RPC — One read for Today's group card

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: backend + client API; UI impact: no

## Objective

A group RPC that returns, for one group and one local-week window, everything
Today's group card shows: each member's working sets and group records (`PRs`, D4), ranked, who is
training now, and the latest completed session — plus its typed client in
`src/groups/`. Authorised for current members only.

## Scope

- In: a Supabase migration (function + grants), RLS/authz per
  `docs/specs/10-api-authn-authz-guidelines.md`, the client wrapper and wire
  types, backend contract tests and a `groups-api-live` case.
- Out: UI (T05); changing the stream or the boards.

## Decided

- D2 working sets, D4 group card `PRs` = group records only, D7 one server
  read (milestone). No personal-PR computation on the server.
- Working sets use the same rule as the app (`set_type` RIR at or below the
  working-set threshold, performed and confirmed); the threshold must match
  `WORKING_SET_POLICY.maxRir`.
- The window is passed by the client (local Monday 00:00 → next Monday, as
  timestamps), so the server never guesses the user's time zone.

## Open — resolve with the user at session start

1. **Which group records count.** Records are `group_events` rows of kind
   `record` (`groups-contract.md` §2.10–§2.11): one per new-best set on the
   group exercise's boards (`weight`, `e1rm`). Settle:
   - **Scope:** every non-voided record, a member's own new best on the group
     board, or only those with `group_record = true` (the member took #1)?
   - **Provisional records:** those from a still-active session. Count them
     (they update or vanish with the session) or only final ones?
   - **Unit:** one per `record` event, so one set beating both boards counts
     once, but two sets in a session beating different boards count twice? Or
     at most one per (member, session, group exercise)?
   - **Window placement:** the event sorts at its session's `started_at`. Use
     the same stamp as the working-set window.
2. **Training now staleness.** Which active sessions count as training now
   (e.g. started within the last N hours)?
3. **Return shape.** All members ranked (client trims to three and finds
   `You`), or top three plus the caller's rank?
4. **Which sessions count for a group.** Sessions shared to that group (the
   share trigger) or all of a member's sessions in the window?
5. **Latest completed session**: return its card payload here, or its id for
   the existing group-session read?

## Deliverables and acceptance

1. Migration + function, granted to `authenticated`, rejecting non-members.
2. Contract tests: ranking, ties, a member with nothing this week, the caller
   outside the top three, several active sessions, a stale active session,
   a record at a window edge, a voided record, a provisional record (per Open
   1), a record on an unlinked exercise, a removed member.
3. Client wrapper + types + Jest; a `groups-api-live` case against the live
   local server.
4. `docs/specs/tech/groups-contract.md` documents the RPC.

## Specs to update

- `docs/specs/tech/groups-contract.md` — the new RPC.
- `docs/specs/10-api-authn-authz-guidelines.md` — only if a new authz pattern
  appears.

## Gates

Expected from `./boga test for`: `backend` + `groups-api-live` + `fast`;
`/security-review` (RPC + authz). Before the PR: `jest-coverage`,
`complexity`.
