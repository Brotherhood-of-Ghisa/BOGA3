# T-20260930-01 — Keep zero-contribution group boards stable

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: backend; UI impact: yes (existing leaderboard states)
- Issue: [#411 — Group bodyweight toggle resets zero-contribution leaderboards](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/411)

## Objective

Changing a group's Bodyweight calculations preference currently starts a new rules revision for every active group exercise. A comparison with 0% group bodyweight contribution uses ordinary scoring in either mode, so its board should remain ready and its certifications should remain valid. Limit preference-triggered revision and rebuild work to comparisons whose **group** contribution is positive.

## Scope

- In: a forward backend migration for group preference changes; coherent current and historical rule metadata; targeted group contract coverage; the owning group specification.
- Out: changing positive-contribution calculations or certification policy, using a member's personal contribution to decide group behavior, and redesigning leaderboard screens.

## Decided

- A missing dated reading can omit a bodyweight-dependent 1RM only when the group preference is on **and that group exercise's contribution is positive**. At zero contribution, ordinary 1RM remains eligible and Weight remains the raw entered value.
- Toggling the group preference must leave zero-contribution comparisons' scores, publication state, active certifications, and lead-change history intact. Positive-contribution comparisons continue to rebuild atomically under a new rules revision.
- Personal bodyweight settings and personal exercise contributions do not affect group scores.

## Deliverables and acceptance

1. Save Off → On and On → Off with both zero- and positive-contribution group exercises. Zero-contribution comparisons stay `ready`, retain their effective rules revision, ranked All and Certified entries, active certifications, and prior history. They do not emit a spurious rules-change event or require a dated reading for 1RM.
2. Positive-contribution comparisons still enter `rebuilding`, publish a coherent new revision, apply the correct 1RM calculation or missing-reading omission, and invalidate affected certifications under the existing contract. Weight remains raw.
3. Public exercise and revision payloads describe the current group preference and past rule snapshots accurately, without exposing private reading data or mixing rule revisions. Resolve the current coupling between the group preference in rule JSON and the zero-contribution revision before changing the update loop.
4. Extend the group backend contract test to cover both comparison types and repeated preference toggles, including certification retention, revision/queue state, and history. Keep the existing positive-contribution and privacy checks green.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Zero-contribution group leaderboard | An owner/admin saves a changed group Bodyweight calculations preference, then opens Leaderboards | Existing podium, All and Certified rows remain visible with unchanged scores and certifications | No transient `Recalculating under the new rules` state; missing personal reading does not remove 1RM |
| Positive-contribution group leaderboard | The same save changes its effective calculation policy | Board shows the existing rebuilding state, then publishes all new rows together | Without an applicable valid reading while enabled, only dependent scores are omitted |

## Specs to update

- `docs/specs/tech/groups-contract.md` §11 — narrow preference-triggered revision and certification behavior to comparisons whose group contribution makes the preference effective.

## Gates

Run `./boga test for` on the implementation diff; it is authoritative. A forward group migration, backend test, and spec update currently trigger `./boga test backend`, `./boga test docs-check`, and `./boga test ios-groups-e2e`; add `fast` and other lanes if the final paths trigger them. Run every required lane to green before opening the implementation PR.
