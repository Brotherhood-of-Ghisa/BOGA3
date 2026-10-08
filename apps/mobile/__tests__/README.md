# Mobile test directory — per-feature coverage policies

> Colocated per `AGENTS.md`: editing tests in this tree ⇒ read this first (and
> `sync/README.md` for anything sync). Strategy and the entry-point catalog stay
> in `docs/specs/06-testing-strategy.md`; gates in
> `docs/specs/02-quality-and-test-gates.md`.

## Test shapes (read before adding a test)

- Calculations, formatting and decision rules: pure unit tests, no database,
  no render.
- Screens: render the production route over real data with
  `helpers/local-data.ts` (reference: `stats-screen-local-data.test.tsx`), not
  with `jest.mock('@/src/data')`. Fake the data layer only for states real data
  cannot produce (loading, a failed read, a race), and name that state.
- Rule and rationale: `docs/specs/06-testing-strategy.md`, "Jest test shapes".

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
  `uiBorder`; `docs/specs/ui/design-language.md` §2–§4).
- `ui-design-tokens.test.ts` asserts, by whole-object equality: the eight type
  rungs and their line-heights, the colour roles named in §2, the geometry of
  §4 and the embedded faces of §3; and that `record !== accent` and `record`
  clears 4.5:1 on `paper`, `surface` and `record-wash`; and that `tokens.ts`
  exports exactly that vocabulary. Change a value there and in the spec
  together — never loosen the test to make an unrelated change pass.
- `ui-theme.test.ts` gates every theme preset
  (`components/ui/theme-presets.ts`): the generator rules for its seeds, plus
  `record` ≥ 4.5:1 on `paper`, `surface` and `record-wash`, `record` ≥ 30° of
  hue from `accent`, and `surface` ≥ 4.5:1 on `accent`. A new preset passes
  these or does not ship. `ui-theme-launch.test.ts` covers the stored choice:
  resolution, the default fallback for an unknown id or an unreadable store,
  and that each fallback is logged.
- The retired legacy vocabulary (the `uiColors` / `uiRadius` / `uiElevation`
  scales and the `UiText` / `UiSurface` / `UiButton` / `SegmentedChips`
  primitives, removed 2026-09-26) is blocked by the `legacyVocabulary` rule in
  `scripts/check-ui-guardrails.js`, proven by `ui-guardrails-script.test.ts`.


## Dated bodyweight coverage

`bodyweight-as-of.test.ts` must fix exact-instant ordering, binary Unicode ID ties,
DST equivalence, malformed-row skipping, and edit/move/delete/restore intervals.
`bodyweight-data.test.ts` must run populated old-schema upgrades and prove kg
conversion plus retained row IDs, clocks, readings, history and contributions;
superseded storage columns disappear. Reading
mutations must recalculate consumers without modifying sessions or sets. Sync
must cover LWW/reinstall, the private preference and post-commit invalidation.
UI tests (`bodyweight-screen.test.tsx`, over real data) must cover
kg entry/history, validation and failed-write input retention; no session surface
may render a reading, prompt or history action.

## Optional bodyweight calculation coverage

Pure tests must cover explicit `ordinary`, `personal` and `group` policies;
preference off/on; contribution 0/decimal/100; exact seed defaults; kg
total/per-side math; blank/zero; personal missing-reading fallback; strict group
missing-reading omission; invalid/overflow values; Wathan projection; and zero
record/ranking exclusion. No test may infer contribution from an exercise name.

`bodyweight-logging-ui.test.tsx` renders the exercise page and session view over
real data (the `bodyweight-rm-volume` fixture). It must cover one kg Weight field,
numeric-zero display, repeated off/on persistence, silent recalculation when a
reading changes and ordinary Weight/1RM/Volume copy. It must assert absence of unit
selectors, calculation-only fields and session prompts. The editor's conditional
contribution field is covered in `exercise-catalog-screen.test.tsx`.

## Personal bodyweight analytics coverage

`bodyweight-analytics-parity.test.ts` must run preference/contribution/per-side,
missing/invalid and zero vectors through the
logger, rows, records, exercise/muscle/catalogue/weekly projections and session
models. Retain aggregate overflow and independent zero/count distinctions.
`bodyweight-analytics-data.test.ts` must use real migrated SQLite to prove repository
context parity (including malformed-row fallback), later-reading isolation and refresh
after reading/preference/contribution changes.
`bodyweight-analytics-formatting.test.ts` must keep extreme-but-finite volumes from
rendering an infinite or nonsensical percentage, across the stats-history delta, the
completion comparison card and `formatVolume`. Existing History/Stats/heatmap,
completion and share tests must prove Top weight remains raw and missing personal
reading never creates an unavailable state.

## Strict group bodyweight coverage

`groups-metric-contract.test.ts`, `groups-performance-score.test.ts` and
`groups-metric-evaluation.test.ts` must cover independent group preference and
contribution, raw Weight, strict 1RM/Volume, kg total/per-side input, missing or
invalid reading omission, performed eligibility and zero ranking exclusion.
Retained protocol-3 mode-mismatch vectors keep Weight raw, derive source-mode
1RM before target conversion, and leave legacy aggregate Volume unconverted.
Current protocol-4 vectors convert ordinary single-set Volume/1RM to the target
and use physical total load for normalized percentages; mode changes rebuild. Off/zero vectors must prove no private-reading lookup or invalidation;
positive+missing must rebuild when a first applicable reading arrives. Personal
preference/contribution must never affect group results.

`groups-metric-wire-guards.test.ts` must fail closed if any reading
value/date/id/provenance or dependency digest enters a comparison's rules.
Cache tests must prove old projections are evicted.
`groups-competition-presentation.test.ts` must prove a session's permitted raw
activity survives an absent derived score.

`groups-comparison-form.test.tsx` must cover admin/member control, off/on persistence
and stale edits. Retained protocol-3 screen assertions preserve historical Weight units. Current
competition screen tests cover Volume/1RM scope switching, rebuilding,
generic absent-score copy, certification invalidation and offline reopen without
private context. These do not replace three-size rendering or two-user device proof.

## Versioned protocol-4 group competition coverage

`groups-competition-contract.test.ts` fixes Volume/1RM mode-specific units,
single-set Volume, effective total-load 1RM normalization with the same dated B,
physical source distribution, ordinary target conversion, missing/invalid/zero
omission, full-precision scores and exact public allowlists. Nested kg/private
fields, dependency digests and unsupported units/versions must fail decoding.
`groups-cache.test.ts` proves group-scoped version-5 session keys and account-only
whole-group-cache eviction across generations. The backend competition fixture
runs the actual negotiation response through the mobile decoder and proves
anonymous/OAuth/outsider/unsupported-protocol denial.
`groups-competition-evaluation.test.ts` covers complete versioned graphs, shared-kernel precision, eligibility and private-context
short-circuiting. `groups-competition-readers.test.ts` covers every exact nested
reader shape, scope coherence, request-local capability headers, normalized kg
rejection and server-normalized write responses.
The backend competition fixture tests both-metric selected-reading corrections,
exact witness audit, SQL-seeded protocol-3 history, paired-reader privacy and
publication failure/fence behavior. Current safe UI tests cover explicit units,
normalized details/full sessions,
account and generation races, unknown disclosure retirement, SQL cleanup failure,
positive/c=0 rule review, decimal name-only saves and saved confirmation guards.
`groups-competition-api-live.test.ts` runs every safe client RPC against the
local protocol-4 server inside `groups-api-live`. Three-size runtime rendering
and integrated human acceptance remain separate evidence requirements.
