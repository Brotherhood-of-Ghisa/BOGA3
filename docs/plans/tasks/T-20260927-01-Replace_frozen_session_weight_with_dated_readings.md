# T-20260927-01 — Replace frozen session weight with dated readings

- Status: `planned`
- Depends on: none
- Milestone: none; follow-up to the merged bodyweight and group-comparison work
- Areas: cross-stack (mobile, sync, Supabase, groups, agent API, MCP, docs); UI impact: yes

## Objective

Remove the historical "Fill missing session weights" feature and the frozen,
session-only bodyweight model it depends on. A session's bodyweight-dependent
calculations must use the latest applicable dated weight reading, so a newly
entered backdated reading recalculates affected past sessions and group results.
Keep the effective-load formula and raw set data unchanged.

## Scope

- In: dated reading entry/history; personal and shared-session projections;
  group scoring, rankings and certification; local and server schema/sync;
  agent API and MCP projections; tests, Maestro flows, UI target and owning
  specs; a coordinated update-required rollout.
- Out: a future-reading estimate, interpolation, automatic conversion of old
  session-only values into readings, rewriting raw external loads, changing the
  effective-load equation, or exposing private weigh-in history to a group.
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

## Open — resolve before coding

1. Pin the revised accepted UI target per `docs/specs/ui/ai-design-policy.md`:
   the historical-fill entry point disappears, session weight becomes a
   read-only derived fact, and missing-weight states link to dated entry.
2. Specify the exact same-day/timezone boundary for "on or before the session
   date" using the existing date-and-time entry model. Preserve one stable
   ordering across devices and the group evaluator, including equal timestamps.
3. Choose and document the client-version enforcement point and deployment
   order so old builds see an update-required result rather than a schema-cache
   or malformed-sync error.

## Deliverables and acceptance

1. Remove the pure/transactional historical-fill planners, Settings fill
   sheet, session-only correction action, `historical_estimate` and manual
   snapshot provenance, their fixtures/tests/Maestro flow, and obsolete copy.
   Keep ordinary dated reading add/edit/delete and make its date required.
2. Introduce one as-of reading resolver and batch it into session graphs,
   history, Stats, records, insights, loading estimates, legacy-load review,
   share previews and the coaching API. Preserve the pure effective-load
   kernel and completeness rules. A reading edit changes affected views without
   mutating sessions or raw sets; unrelated sessions and conventional exercises
   retain their results.
3. Add forward SQLite and Supabase migrations that remove the session snapshot
   tuple and its session-only hydration marker; remove the tuple from Sync v2
   push/pull and new import/export packages. Do not edit applied migrations.
   Existing package versions may still import, but their saved snapshot fields
   cannot drive calculations or manufacture readings. Keep
   `body_weight_measurements` in sync scope.
4. Resolve the owner's applicable reading in the server group source graph,
   shared-session RPCs and strength-performance pins. Reading changes enqueue
   all affected shared comparisons through the failure-isolated evaluator.
   Rankings and record events follow its existing recompute/diff rules;
   affected strength certifications void, while reps-only attestations remain
   valid. Do not expose the owner's reading timeline through group APIs.
5. Update agent API and MCP metric projections to use the same resolved
   context. Any calculation revision, source hash or cache version affected by
   the new meaning must change so stale frozen-weight results are not reused.
6. Enforce the app update at rollout, verify local and hosted migration/function
   deployment order, and give the release operator exact commands/checks in
   the implementation PR or runbook. No hosted deployment occurs merely from
   executing this card.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Enter a past weight | Settings → Body weight → add/edit a dated reading | Affected past sessions show the new derived weight and recalculated load/records | Future/invalid value is rejected; no earlier reading leaves dependent results unavailable |
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
  — revised target, copy, screen map and bodyweight lane. Delete this card in
  the implementation PR once those durable contracts are updated.
- Replace backfill tests with cases for no prior reading; backdated create;
  value/date edit, delete and restore; equal timestamps/timezones; malformed
  restored data; session-date edit; offline and cross-device sync; import;
  personal calculation coverage; shared-session privacy; group reranking,
  event diffs and metric-specific certification; agent API/MCP parity.

## Gates

Use `./boga test for` on the implementation diff. Expected: `fast`, `backend`,
`frontend`, `ios-sync-e2e`, `ios-groups-e2e` and `mcp-smoke`, with any additional
path-triggered lanes. Run the required gates locally to green and record their
evidence in the PR body; do not infer a test duration.
