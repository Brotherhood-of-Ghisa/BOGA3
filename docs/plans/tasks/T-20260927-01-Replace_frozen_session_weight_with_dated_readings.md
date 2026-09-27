# T-20260927-01 — Replace frozen session weight with dated readings

- Status: `in review` ([PR #387](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/387))
- Depends on: none
- Milestone: none; follow-up to the merged bodyweight and group-comparison work
- Areas: cross-stack (mobile, sync, Supabase, groups, agent API, MCP, docs); UI impact: yes

## Objective

Remove the historical "Fill missing session weights" feature and the frozen,
session-only bodyweight model it depends on. A session's bodyweight-dependent
calculations must use the latest applicable dated weight reading. Treat every
numeric weight on a bodyweight exercise as added weight. Use total resistance
for volume and the Wathan estimate, then express RM in added-weight terms.
Keep raw set data unchanged.

## Scope

- In: dated reading entry/history; personal and shared-session projections;
  group scoring, rankings and certification; local and server schema/sync;
  agent API and MCP projections; removal of assisted/unquantified load handling;
  a focused weight-entry/RM/volume Maestro flow; UI target and owning specs;
  a coordinated update-required rollout.
- Out: a future-reading estimate, interpolation, automatic conversion of old
  session-only values into readings, rewriting raw external loads, changing the
  Wathan equation, or exposing private weigh-in history to a group.
- Keep the unrelated server `group_events_backfill()` mechanism; it does not
  fill session weights.

## Decided

- For a session, use the latest nondeleted reading on or before its recorded
  date. Never use a later reading as an estimate. Resolve ties deterministically
  and use the same date/time rule on device and server. Missing or malformed
  applicable context leaves bodyweight-dependent metrics unavailable, not zero.
- Adding, editing, redating, deleting or restoring a reading changes affected
  past calculations. Resolve personal metrics on read rather than saving a
  replacement session value; refresh visible results after local writes and
  sync pulls.
- Do not convert a saved manual/session-only value into a reading. A session
  without an applicable dated reading remains usable for logging and for
  bodyweight-independent metrics, but needs a user-entered dated reading for
  calculations requiring bodyweight.
- Existing TestFlight builds need not keep syncing after the cutover. Require
  an app update and give older builds an explicit update-required response
  before removing obsolete sync fields.
- A numeric weight on a bodyweight exercise always means added weight. Interpret
  existing null, assisted and unquantified mode tags the same way without
  rewriting stored values. Remove assisted/unquantified entry, review,
  confirmation and conversion UI; there is no negative or assisted load mode.
- For bodyweight exercises, total resistance is
  `bodyWeight × coefficient + addedWeight × externalFactor`, where
  `externalFactor` is 2 only for per-side input. Volume is total resistance
  times reps. Apply the existing Wathan equation to total resistance, then
  subtract the bodyweight contribution and divide by `externalFactor` to
  report RM as added weight. A projection that needs negative added weight is
  unavailable. The loading calculator keeps this convention.

## Accepted implementation decisions (2026-09-27)

- UI: retain the existing layouts/tokens; remove historical fill and session-only
  correction. Show read-only session kg and “Reading from <date/time>”. Missing
  context shows “No reading on or before this session” and “Add dated reading”,
  prefilled with the session start date/time. Friends remain read-only. Do not
  warn that a reading will change past workouts or group results.
- Time: compare stored epoch milliseconds, `measuredAt <= startedAt`; equal
  timestamps use ascending ID in binary/code-point order. Local date/time input
  becomes an instant once, and viewing timezone never changes selection.
- Rollout: release the isolated compatibility commit first so existing users
  have UPDATE_REQUIRED handling in setup and Settings. Then apply the guarded
  breaking server migration, deploy matching functions, and release the dated
  client. API cutoff precedes any obsolete-field access. No hosted deployment
  is authorized by this task; provide operator commands and local stage proof.

## Deliverables and acceptance

1. Remove the pure/transactional historical-fill planners, Settings fill
   sheet, session-only correction action, `historical_estimate` and manual
   snapshot provenance, their fixtures/tests/Maestro flow, and obsolete copy.
   Keep ordinary dated reading add/edit/delete and make its date required.
2. Introduce one as-of reading resolver and batch it into session graphs,
   history, Stats, records, insights, loading estimates, share previews and
   the coaching API. Use total resistance for bodyweight volume and Wathan,
   with RM and calculator targets expressed as added weight. Keep completeness
   rules. A reading edit changes affected views without mutating sessions or
   raw sets; unrelated sessions and conventional exercises retain their results.
3. Add forward SQLite and Supabase migrations that remove the session snapshot
   tuple and its session-only hydration marker; remove the tuple from Sync v2
   push/pull and new import/export packages. Do not edit applied migrations.
   Existing package versions may still import, but their saved snapshot fields
   cannot drive calculations or manufacture readings. Keep
   `body_weight_measurements` in sync scope.
4. Resolve the owner's applicable reading in the server group source graph,
   shared-session RPCs and strength-performance pins. Group strength RM uses
   the same total-resistance estimate and added-weight result; relative RM is
   that added-weight result divided by bodyweight. Reading changes enqueue all
   affected shared comparisons through the failure-isolated evaluator. Rankings
   and record events follow its existing recompute/diff rules; affected strength
   certifications void, while reps-only attestations remain valid. Do not
   expose the owner's reading timeline through group APIs.
5. Update agent API and MCP metric projections to use the same resolved
   context and added-weight convention. Any calculation revision, source hash
   or cache version affected by the new meaning must change so stale results
   are not reused.
6. Enforce the app update at rollout, verify local and hosted migration/function
   deployment order, and give the release operator exact commands/checks in
   the implementation PR or runbook. No hosted deployment occurs merely from
   executing this card.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Enter a past weight | Settings → Body weight → add/edit a dated reading | Applicable sessions show derived weight and updated RM/volume | Future/invalid value is rejected; no earlier reading leaves dependent results unavailable |
| Log a bodyweight set | Enter a numeric weight, reps and a dated bodyweight reading | Weight is added; volume uses total resistance and RM displays added weight | Without an applicable reading, dependent RM/volume stays unavailable; no assisted or unquantified control appears |
| Inspect a session | Open an active or completed session → inspect bodyweight source | Show the applicable reading and its date; provide a route to dated entry when missing | No manual session-only override or fill preview; friend views stay read-only |
| Edit or delete a reading | Change a reading's value/date or delete it → revisit history and group board | Affected sessions and published comparisons update after local write/sync | Unaffected dates retain their results; strength certifications dependent on changed weight void |
| Old app build | Attempt sync after the breaking rollout | Clear app-update requirement | No unexplained missing-function or schema-cache error |

## Specs and coverage to update

- `docs/specs/tech/bodyweight-load-contract.md`, `docs/specs/05-data-model.md`,
  `docs/specs/03-technical-architecture.md` and
  `docs/specs/tech/sync-v2-server-contract.md` — replace frozen tuple/fill
  rules with dated read-time context and the forward schema contract.
- `docs/specs/tech/groups-contract.md`,
  `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md` and agent
  API/MCP contracts — reevaluation, source pins, authorization and rollout.
- `docs/specs/ui/design-targets/bodyweight.md` and the owning UI/quality docs
  — revised target, copy, screen map and focused bodyweight lane. Keep this
  review card while PR #387 is open; remove it before the work ships.
- Keep targeted unit and contract coverage for dated resolution, sync,
  total-resistance arithmetic, added-weight RM, group scoring, privacy and
  agent API/MCP parity.
- Keep the native bodyweight lane to one short flow: enter a dated weight and
  check its effect on a bodyweight exercise's added-weight RM and total-load
  volume. Do not retain separate native backfill, analytics or review flows.

## Gates

Use `./boga test for` on the implementation diff. Expected: `fast`, `backend`,
`frontend`, `ios-sync-e2e`, `ios-groups-e2e` and `mcp-smoke`, with any additional
path-triggered lanes. Run the required gates locally to green and record their
evidence in the PR body; do not infer a test duration.
The implementation sweep passed at `d2034531`. This documentation-only
decision update does not require another test run.
