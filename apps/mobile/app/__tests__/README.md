# Mobile test directory — per-feature coverage policies

> Colocated per `AGENTS.md`: editing tests in this tree ⇒ read this first (and
> `sync/README.md` for anything sync). Strategy and the entry-point catalog stay
> in `docs/specs/06-testing-strategy.md`; gates in
> `docs/specs/02-quality-and-test-gates.md`.

## GPS gym-location coverage policy

- Applies to foreground location service and gym-coordinate matching work.
- Required coverage should include:
  - foreground permission/service normalization (granted, denied, unavailable,
    timeout, read failure, unexpected native error, successful read),
  - pure matcher assertions (Haversine distance; missing/invalid/archived/deleted
    coordinate rejection; low-accuracy rejection; no-match; ambiguous tie),
  - no background permission APIs, background tasks, geofencing, or continuous
    background updates for these GPS flows,
  - GPS gym-coordinate sync coverage for `gyms`: local + backend range/shape
    validation, coordinate-bearing upsert payloads, bootstrap fetch/merge/
    convergence, and reinstall restore parity,
  - the gym UI's reads with an injected position reader: the gym sheet's
    nearby suggestion (one confident match only; nothing on denial, services
    off, low accuracy, no match, a tie, a read failure or the 1.5 s timeout;
    never a preselect) and `Save current location` (accuracy gate, inline
    failures) — `gym-location-reads.test.ts`, `session-view-screen.test.tsx`,
    `gyms-screen.test.tsx`. The simulator cannot fake a location reliably, so
    the suggestion row has no Maestro step.
- Use deterministic Jest coverage for service wrappers and matching logic. Add
  simulator/manual or Maestro evidence when UI permission flows are introduced or
  native permission behavior is being validated.

## Exercise-tag coverage policy

- Applies to exercise-tag schema/sync/read work in the mobile local runtime.
  Tags are read-only in the app since redesign 6b (the tag editor went with the
  old recorder): they arrive by sync, and completed sessions and exercise
  history show them.
- Required coverage should include:
  - schema/migration assertions for `exercise_tag_definitions`,
    `session_exercise_tags`, and durable
    `session_exercises.exercise_definition_id` linkage,
  - the reader (`listSessionExerciseAssignedTags`) hiding tombstoned
    assignments,
  - session-graph rebuilds re-dirtying a preserved assignment and tombstoning
    one whose exercise changed.

## Mobile auth bootstrap coverage policy

- Applies to mobile auth/session-foundation work under `apps/mobile/src/auth/**`
  and root wiring.
- Required coverage should include: launch with no stored session; launch with a
  stored session; session-restore failure falling back to a safe logged-out state
  with inline error; explicit sign-out / session-clear; missing auth config /
  auth-disabled bootstrap path.
- Prefer deterministic Jest coverage, then add real local-Supabase + Maestro proof
  via `test:e2e:ios:auth-profile` once the user-facing flow exists.
- Rule: auth bootstrap must remain non-blocking for local-only tracker routes
  while logged out or when auth config is missing.

## Mobile profile-management coverage policy

- Applies to authenticated profile UI/data work under `apps/mobile/src/auth/**`
  and the profile route.
- Required coverage should include: sign-in success + invalid-credentials/
  validation feedback; profile load when a row exists; lazy profile provisioning
  when `user_profiles` is missing; idempotent provisioning under concurrent
  first-write races; username save success + inline failure; email update
  validation + success vs pending-confirmation; password update success/failure
  with field clearing; backend-unavailable/profile-fetch failure staying inline
  without signing the user out.
- Prefer deterministic Jest coverage for the service wrappers and profile-route
  state transitions, then add local-Supabase + Maestro proof for the full happy
  path with deterministic fixture credentials.

## Design-token coverage policy

- Applies to the design-language vocabularies in
  `apps/mobile/components/ui/tokens.ts` (`uiRoles`, `uiFonts`, `uiGeometry`) and
  the type scale (`docs/specs/ui/design-language.md` §2–§4, `ux-rules.md` §9a).
- `ui-design-tokens.test.ts` asserts, by whole-object equality: the eight type
  rungs and their line-heights, the colour roles named in §2, the geometry of
  §4 and the embedded faces of §3; and that `record !== accent` and `record`
  clears 4.5:1 on `paper`, `surface` and `record-wash`. Change a value there
  and in the spec together — never loosen the test to make an unrelated change
  pass.
- The redesign's temporary "additive only" snapshots of the legacy scales
  (`uiColors`, `uiSpace`, `uiRadius`, `uiBorder`, `uiElevation`) were retired
  with the redesign's close-out: the legacy scales may now change as screens
  move to the design language.


## Historical bodyweight fill coverage (M27)

`bodyweight-backfill.test.ts` must retain pure prior/earliest-later selection,
local calendar bounds, SQLite-compatible same-time ID ties, unknown/invalid
context, stale reading/session membership, explicit-override preservation,
selected soft/hard deletion, repeat no-ops and transaction rollback/retry.
Its real serializer/pull restoration case keeps source IDs as provenance and
proves later source deletion and ordinary row LWW cannot refresh a frozen tuple.
`bodyweight-backfill-ui.test.tsx` covers nonwriting preview/cancel, stale refresh,
busy/dismiss guards and waiting for native iOS dismissal before Add reading.
Device behavior belongs to the third flow in `ios-bodyweight`, including small
and large phone evidence; these unit tests do not replace that gate.


## Offline legacy load review coverage (M27)

`bodyweight-load-review.test.ts` runs the real old-schema upgrade, explicit
rule/session setup, independent actual/planned review, ordinary draft save and
wire/pull restoration. Preserve no-write preview/cancel, partial-review refusal,
concurrent hydration rejection, conventional unknown units and empty counterpart
coverage. Missing sync bookkeeping must never be treated as proof of local-only
data. `bodyweight-logging-ui.test.tsx` verifies queued choices and explicit Apply;
the logging Maestro flow captures the offline review on all three phone sizes.

## Personal bodyweight analytics coverage (M27)

`bodyweight-analytics-parity.test.ts` runs weighted/unweighted/assisted, unit,
coefficient/per-side, missing/invalid/legacy and hydration vectors through the
logger, rows, records, exercise/muscle/catalogue/weekly projections and session
models. Retain aggregate overflow and independent zero/count distinctions.
`bodyweight-analytics-data.test.ts` uses real migrated SQLite to prove repository
context parity (including positive B with malformed provenance), frozen
historical B after a new reading and refresh after
explicit B/coefficient/mode changes. Formatter tests cover incomplete totals
and nonfinite percentage output. Existing History/Stats/heatmap tests retain
coverage and raw-versus-total labels.

`bodyweight-loading-estimate-ui.test.tsx` covers source choice, target-session
B, explicit current reading, positive assistance/lb, validation, one-rep/high-rep
notes, retry, dismissed reads and invalid restored reading context. Numerical
forward/inverse vectors remain in the kernel tests. Device evidence belongs to
the fourth ios-bodyweight flow on all three phone sizes, plus the full frontend
gate; unit/typecheck success never substitutes for rendered evidence.

## Target-specific group score coverage (M27)

`groups-metric-contract.test.ts`, `groups-performance-score.test.ts` and
`groups-metric-evaluation.test.ts` cover explicit metric/default/unit families,
movement/loading compatibility, source distribution and group coefficient
independence, the 60+20 versus 90+20 ranking reversal, strict performed eligibility,
assistance, missing/invalid B and historical-estimate provenance. Preserve the
separate source counting flag, duplicate/missing-pin refusal and explicit invalid
weight payloads. These pure tests do not replace backend queue/publication,
certification, legacy-reader or two-user device proofs.
