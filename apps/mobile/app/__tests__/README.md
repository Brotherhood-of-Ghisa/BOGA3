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
