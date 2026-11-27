# Group Meet Contract

> **Owns:** the implementation boundary for group meets: storage, the
> session↔meet link, challenges, scoring snapshot and refresh, the meets
> leaderboard, notification delivery and client reads.
> **Not here:** product rules (they live in [[meets.linking]], [[meets.results]]
> and [[notifications.meets]]), and what the code states (columns, SQL, wire
> shapes, messages, tests). **Status:** skeleton; sections are filled by the
> cards that build meets. **Load when:** changing meets, meet challenges, the
> meet session link, or `supabase/functions/group-eval/` meet scoring.

## Storage and lifecycle

Meet tables, states and the server-only rules that apply to them.

## Challenges

Challenge storage, metric choices, uniqueness, per-challenge versions and the stream items they write.

## Roster and session links

The synced session↔meet link entity, Join and Leave, roster derivation and the overlap check.

## Scoring, snapshot and refresh

Live scoring, rescoring on challenge change and Refresh results, under [[meets.results]]. The [[meets.results]] cutoff snapshot is the accepted exception to [groups-contract.md](groups-contract.md)'s "Nothing is copied".

## Meets leaderboard

Medal counting across final meets, tie ranking and former-member handling.

## Notifications

Start and end push delivery on the existing notification pipeline, and the per-group Meets preference.

## Mobile reads and writes

Client RPCs, cache keys, the online-only write rule for meet actions, and the offline link path.

## Verification ownership

Which lanes and tests prove each section above.
