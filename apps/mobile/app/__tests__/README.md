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

- Applies to the one token vocabulary in `apps/mobile/components/ui/tokens.ts`
  (`uiRoles`, `uiFonts`, `uiGeometry`, `uiSpace`, `uiTypography`, `uiIconSize`,
  `uiBorder`; `docs/specs/ui/design-language.md` §2–§4, `ux-rules.md` §9a).
- `ui-design-tokens.test.ts` asserts, by whole-object equality: the eight type
  rungs and their line-heights, the colour roles named in §2, the geometry of
  §4 and the embedded faces of §3; and that `record !== accent` and `record`
  clears 4.5:1 on `paper`, `surface` and `record-wash`; and that `tokens.ts`
  exports exactly that vocabulary. Change a value there and in the spec
  together — never loosen the test to make an unrelated change pass.
- The retired legacy vocabulary (the `uiColors` / `uiRadius` / `uiElevation`
  scales and the `UiText` / `UiSurface` / `UiButton` / `SegmentedChips`
  primitives, removed 2026-09-26) is blocked by the `legacyVocabulary` rule in
  `scripts/check-ui-guardrails.js`, proven by `ui-guardrails-script.test.ts`.


## Dated bodyweight coverage

`bodyweight-as-of.test.ts` fixes exact-instant ordering, binary Unicode ID ties,
DST equivalence, malformed latest context, and edit/move/delete/restore intervals.
`bodyweight-data.test.ts` runs populated old-schema upgrades and proves obsolete
session columns disappear while raw data, clocks and readings survive. Entry
and analytics repository tests prove reading mutations recalculate every consumer
without modifying sessions or sets. Sync covers LWW/reinstall and post-commit
invalidation despite later failure. Import tests reject v3 snapshots and discard
old ones without manufacturing readings. UI tests cover required dated entry,
read-only known/friend context, missing-context prefill and failure feedback.
Backend SQL/device parity and real group/coaching contracts complement these
checks; native `ios-bodyweight` covers one dated-entry change to RM and volume at the
accepted phone sizes.

## Added bodyweight load coverage

`bodyweight-added-load.test.ts` preserves seed/rule/hydration checks and proves
that old null/assistance tags and numeric values need no conversion or writes.
`bodyweight-logging-ui.test.tsx` covers the single added-weight field, unit
selection, added-RM display, total-load volume, missing B and planned/actual
preservation. No assistance selector or legacy review sheet is offered.

## Personal bodyweight analytics coverage (M27)

`bodyweight-analytics-parity.test.ts` runs weighted/unweighted/legacy-tag, unit,
coefficient/per-side, missing/invalid/legacy and hydration vectors through the
logger, rows, records, exercise/muscle/catalogue/weekly projections and session
models. Retain aggregate overflow and independent zero/count distinctions.
`bodyweight-analytics-data.test.ts` uses real migrated SQLite to prove repository
context parity (including malformed applicable readings), later-reading isolation and refresh
after reading/coefficient/mode changes. Formatter tests cover incomplete totals
and nonfinite percentage output. Existing History/Stats/heatmap tests retain
coverage and raw-versus-total labels.

`bodyweight-loading-estimate-ui.test.tsx` covers source choice, target-session
B, explicit current reading, added pounds and below-bodyweight unavailable targets, validation, one-rep/high-rep
notes, retry, dismissed reads and invalid restored reading context. Numerical
forward/inverse vectors remain in the kernel tests.

## Target-specific group score coverage (M27)

`groups-metric-contract.test.ts`, `groups-performance-score.test.ts` and
`groups-metric-evaluation.test.ts` cover explicit metric/default/unit families,
movement/loading compatibility, source distribution and group coefficient
independence, the 60+20 versus 90+20 ranking reversal, strict performed eligibility,
legacy mode reinterpretation, missing/invalid B and historical-estimate provenance. Preserve the
separate source counting flag, duplicate/missing-pin refusal and explicit invalid
weight payloads. These pure tests do not replace backend queue/publication,
certification, legacy-reader or two-user device proofs.

`groups-metric-api.test.ts` checks the v2 RPC request/response boundary:
metric/unit/revision and requested-scope coherence, malformed known stream
items, future-kind pagination, rebuilding emptiness and attestation dependency
coverage. Cache tests retain upgrade eviction of both old and versioned keys.
`groups-session-metrics.test.ts` separately proves the personal shared-session
projection, raw units/modes, incomplete volume, strict performed status and
malformed derived-context handling. Never substitute that personal coefficient
for the target group's coefficient in ranking tests.

`groups-comparison-form.test.tsx` covers review/stale-edit behavior.
`groups-metric-screens.test.tsx` runs the real cache/paging hooks around mocked
RPCs for unit/scope switching, rebuilding, missing/estimated B, revision history,
self/former/archive restrictions, stale certification refusal and offline stream
reopen. Linking tests preserve personal coefficient independence and reject
incompatible reviewed new-exercise inputs. These tests do not replace three-size
render comparisons or two-user Maestro proof.
