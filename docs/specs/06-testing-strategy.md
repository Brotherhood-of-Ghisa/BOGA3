# Testing Strategy (Deep Companion)

## Purpose

Define the testing stack, the per-entry-point catalog (what each script verifies,
what infrastructure it needs, and which code changes should trigger it), and the
coverage policies that govern how features are tested.

Scope boundary:

- **`docs/specs/02-quality-and-test-gates.md` is the always-load quickref** — it
  owns the at-a-glance gate ladder, what is mandatory, and the one-line summary of
  the local infrastructure you have. **Do not restate that here.** This document
  is its conditional deep companion: the comprehensive per-entry-point catalog
  plus the testing-strategy and coverage policies.
- App-specific UI route/component inventories and navigation summaries live in
  `docs/specs/ui/**` (entrypoint: `docs/specs/ui/README.md`) and should remain
  brief/source-linked.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md` is the authoritative
  Maestro runtime/testing contract (reset taxonomy, artifacts, per-worktree
  config). This document owns only the Maestro *testing policy* (when slow gates
  are required, which command wrappers are canonical, where evidence is expected).
- `docs/specs/12-worktree-config-and-isolation.md` owns the worktree slot model,
  port derivation, and runtime isolation.
- Durations are owned by the measured per-run records under
  `docs/testing/timings/records/` (written automatically by the gate wrappers).
  Read them with `./scripts/test-timings.sh` (median + a 3× "investigate above
  this" ceiling per lane); interpretation guide:
  `docs/testing/local-test-timings.md`. Cite the reader or re-measure; do not
  invent test durations. A run exceeding ~2-3× the recorded median is a signal
  something is wrong, not a normal slow run.

## Decisions and rationale

1. `Jest + jest-expo` for unit/integration and `React Native Testing Library` for
   UI/component tests. Reason: validates real screen behavior and logic-heavy
   parts (set/session calculations, sync state) with React Native-friendly tooling
   on a fast feedback loop.
2. `Data-layer integration tests` against a real in-memory SQLite engine
   (`better-sqlite3`) built from the shipped migration bundle. Reason: catches
   migration and persistence issues early in an offline-first app.
3. `Two-lane local data verification` for SQLite runtime confidence. Reason: keep
   the fast lane deterministic while still proving real-device migration and
   persistence behavior in the native Expo runtime.
4. `Backend auth/RLS + sync-v2 contract tests` against a local Supabase stack.
   Reason: prevents data-leak/security regressions and proves the real wire
   contract before hosted deployment.
5. `Maestro + iOS Simulator + Expo dev client` for end-to-end flows. Reason:
   practical mobile E2E coverage with lower setup cost than heavier alternatives.
6. `Quality gates` (fast/slow wrappers + a CI job) keep AI-generated changes safe
   and predictable as code volume grows.

---

# Entry-point catalog

> For the at-a-glance **lane → {gate, CI?, ~time}** matrix and the
> infra-dependency mental model, see the lane matrix in
> `02-quality-and-test-gates.md` (it owns CI membership). This catalog owns each
> entry point's PURPOSE / INFRASTRUCTURE / WHEN — not the CI column.

Every test / quality entry point in the repo, with three facts each: **PURPOSE**
(what it verifies), **INFRASTRUCTURE** (what it needs), and **WHEN TO RUN** (which
codebase areas/changes should trigger it — by path/area). Infrastructure values:

- **none** — pure Node/Jest; no external services. CI-safe.
- **local Supabase + Docker** — a running local Supabase stack (Postgres +
  PostgREST + RLS), ensured via `./supabase/scripts/ensure-local-runtime-baseline.sh`.
- **iOS simulator + Metro + Maestro dev-client** — a booted iOS simulator, the
  Expo dev client `.app`, a Metro dev server, and the Maestro CLI.

## Mobile npm scripts (`apps/mobile/package.json`, run from `apps/mobile/`)

| Script | Purpose | Infrastructure | When to run (paths/areas) |
|---|---|---|---|
| `npm run lint` | `expo lint` (ESLint flat config). Enforces the repo lint rules, including the `no-restricted-globals` ban on `__DEV__` (use `isDevMode()` instead). | none | Any `apps/mobile/**` source change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm run lint:ui-guardrails` | Standalone guardrail (`scripts/check-ui-guardrails.js`): flags raw color literals (hex / `rgb(a)`) in `apps/mobile/app/**` and `components/**`. NOT wired into `lint`, ESLint, any gate wrapper, or CI — invoke it directly. | none | UI/styling changes under `apps/mobile/app/**` or `apps/mobile/components/**` where the design-token guardrail matters. |
| `npm run typecheck` | Regenerates router types (`router:types`) then `tsc --noEmit`. | none | Any `apps/mobile/**` TS change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm test` | Full Jest unit/integration suite. Bare `jest` — deliberately **no `--forceExit`** (see *Unit-test hang safety*). Excludes infra-dependent sync tests (they live behind `test:sync:infra`). | none | Any `apps/mobile/**` change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm run test:sync` | `jest app/__tests__/sync` — the sync-focused subset (still infra-free; the infra-dependent files in that dir fail fast without an endpoint and are normally run via `test:sync:infra`). | none | Targeted feedback while editing mobile sync code under `apps/mobile/app/__tests__/sync/**` or the sync runtime it covers. |
| `npm run test:sync:infra` | Runs the four **infra-dependent** sync tests by path: `drift-check.test.ts` (shells out to `check:sync-drift --strict`), `cycle-round-trip.test.ts` (real push→server-LWW→pull→local-LWW round trip, incl. a wiped-client reinstall re-pull), `cycle-multidevice-lww.test.ts` (two local DBs sharing one server: end-to-end LWW collisions, multi-device convergence, future-clock-clamp reconciliation), and `auth-required-envelope.test.ts` (unauthenticated cycle is a clean no-op). | local Supabase + Docker. Reads `SYNC_TEST_SUPABASE_URL` / `SYNC_TEST_SUPABASE_ANON_KEY` — these normally point at **this worktree's own local stack** (`API_URL`/`ANON_KEY` from `supabase status -o env`); it is **runnable locally, not a deferred/remote lane**. | Changes to the mobile sync cycle, client Drizzle schemas, the migration bundle, or the wire contract under `apps/mobile/src/**` sync code and `apps/mobile/app/__tests__/sync/**`. |
| `npm run test:handles` | Open-handle guard: `jest --detectOpenHandles --silent`, serial. Surfaces any leaked handle (unclosed connection, lingering timer, real Supabase transport) with a stack after tests pass. Can be scoped (e.g. `-- sync-cycle`). | none | Any change that touches timers, connections, async teardown, or test fixtures. Part of CI; **not** in any gate aggregate — run `./boga test handles` before opening a PR. |
| `npm run db:generate` | `drizzle-kit generate` + `tsx scripts/bundle-migrations.ts`: regenerates `drizzle/*.sql` AND the committed runtime bundle `drizzle/migrations.generated.ts`. Idempotent. | none | Any schema change under `apps/mobile/src/data/**` / `apps/mobile/drizzle/**`. Run it and commit the regenerated artifacts. |
| `npm run db:generate:canary` | Alias of `db:generate`. Intended as a migration-artifact drift canary: re-run it and confirm a clean working tree (no uncommitted diff) to prove the generated SQL/bundle match the schema. NOT wired into any gate or CI. | none | Same triggers as `db:generate`; use when you want to *verify* (rather than write) that the bundle is current. |
| `npm run check:sync-drift` | `tsx scripts/check-sync-schema-drift.ts`: resets local Postgres, introspects server schema vs the client Drizzle schemas, and asserts no client/server drift (universal index, two triggers, four RLS policies w/ body hashes, soft-delete + sync columns, topo FK order). `--strict` promotes warn-only (exit 2) to failure. | local Supabase + Docker (it drives a DB reset). | Changes to `apps/mobile/src/data/**` schemas, `supabase/migrations/**`, or sync columns/RLS. Run with `--strict` as the `sync-drift` lane of `boga test backend`; also exercised by `test:sync:infra`. |
| `npm run test:e2e:ios:smoke` | `scripts/maestro-run-lane.sh smoke` → runs `smoke-launch.yaml` with a `full` reset. Cold-launch + navigation smoke on the freshly-installed dev client (infra-free config). Captures `01-app-launch`, `02-session-recorder-visible`. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | UI/runtime changes that need fresh real-simulator smoke evidence (see *iOS UI smoke policy*). Part of `boga test frontend`. |
| `npm run test:e2e:ios:data-smoke` | `scripts/maestro-run-lane.sh data-smoke` → runs `data-runtime-smoke.yaml` with a `data` reset. Validates real `expo-sqlite` migration + smoke write/read and that the backend-less build seeds its own starter exercise catalog at boot. Captures `03-data-runtime-smoke-start`, `04-data-runtime-smoke-success`. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | See *iOS simulator data smoke policy* (bootstrap/migrations/drizzle/native-runtime changes). Part of `boga test frontend`. |
| `npm run test:e2e:ios:gates` | `scripts/maestro-ios-gates.sh` — convenience: runs smoke + data-runtime-smoke against **one** provisioned sim + Metro (pays the ~55-60s boot/warm overhead once). Reset semantics preserved (provision `full`; data-smoke self-resets in-flow). | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | When you want both infra-free iOS gates faster; the per-flow lanes above remain the canonical individual lanes. |
| `npm run test:e2e:ios:auth-profile` | `scripts/maestro-run-lane.sh auth-profile` — the **only** Supabase-configured iOS lane. Runs five flows in order, each with a `full` reset: `launch-requires-sign-in`, `sync-gate-first-cycle` (pinned in-progress surfaces), `sync-gate-first-cycle-real` (real cycle lifts the gate, no harness stamp), `settings-sync-status`, `auth-profile-happy-path`. Validates login-on-start enforcement, the first-sync gate (both the deterministically-pinned in-progress block AND the real bootstrap cycle dismissing it against local Supabase), settings sync status, and the fixture-backed sign-in / profile / username-update / sign-out happy path. Captures `05-…-logged-out-start`, `06-…-signed-in`, `07-…-signed-out-end`. | iOS simulator + Metro + Maestro dev-client **and** local Supabase + Docker (ensures baseline, exports `EXPO_PUBLIC_SUPABASE_*` from the running stack, signs in as `user_a`). | See *iOS simulator auth/profile happy-path policy* (profile-route UI/state, auth bootstrap/session restore, local-Supabase auth wiring). Part of `boga test frontend`. Previously RED on a simulator connectivity issue, since fixed (scheduler keys off `NetInfo.isConnected`); not re-measured — see the timings-doc note. |
| `npm run test:e2e:ios:sync` | `scripts/maestro-run-lane.sh sync-e2e` — the **UI↔server sync e2e lane** (a category of its own: real recorder UI + real sync cycle + real local Supabase). Runs `sync-first-run-log-and-roundtrip.yaml` as the dedicated `user_b` fixture with a `full` reset: (A) new-user sign-in → real bootstrap cycle lifts the first-sync gate, (B) one workout logged through the recorder UI, (C) forced sync drains "Pending changes" to 0 (run-specific upload proof), (D) full device wipe + re-sign-in restores the workout from the remote DB. Exists because `test:sync:infra` (emulated storage, no UI) cannot catch UI-gating / NetInfo / session-handoff / trigger-wiring bugs — the classes that shipped during sync v2. Captures screenshots `16`–`20`. | iOS simulator + Metro + Maestro dev-client **and** local Supabase + Docker. | Any change under `apps/mobile/src/sync/**`, the scheduler, auth session wiring, or the sync RPCs. Part of `boga test frontend` (runs last). |

## Repo-root quality wrappers (`scripts/`, run from repo root)

Gate aggregates are defined by the `gate` column of `scripts/lanes.tsv` and run
via `./boga test <gate>`; row order in the registry is execution order. The
legacy `./scripts/quality-fast.sh` / `./scripts/quality-slow.sh` forward here.

| Gate | Expands to (registry order) | Infrastructure | When to run |
|---|---|---|---|
| `./boga test fast` | `lint` + `typecheck` + `jest-full` + `backend-fast` | jest lanes none; backend-fast local Supabase + Docker | Default local closeout fast gate. (`fast-frontend` / `fast-backend` run the halves.) |
| `./boga test frontend` | `ios-smoke` + `ios-data-smoke` + `ios-auth-profile` + `ios-sync-e2e` | iOS simulator + Metro + Maestro dev-client; auth-profile and sync-e2e additionally need local Supabase + Docker | Risk-triggered: UI/runtime/auth-profile/sync changes needing real-simulator evidence. |
| `./boga test backend` | `auth-authz` → `sync-v2-schema` → `sync-push-contract` → `sync-pull-contract` → `dev-wipe-my-data` → `sync-drift` → `sync-v2-e2e` → `sync-infra` | local Supabase + Docker (`run-suite.sh` ensures `ensure-local-runtime-baseline.sh` per lane) | Risk-triggered backend work: `supabase/migrations/**`, `supabase/functions/**`, auth config/policies, sync RPC contracts/fixtures. |

> The slow gate runs are not always mandatory. "When to run" is governed by the
> codebase areas/paths in the policies below; the always-load quickref
> (`02-quality-and-test-gates.md`) states what is mandatory.

## Backend lanes (`./boga test <lane>`; bodies under `supabase/tests/`)

Most backend lanes run through `supabase/scripts/run-suite.sh`, which calls
`ensure-local-runtime-baseline.sh` and then the lane's body under
`supabase/tests/` (lane → body mapping: `scripts/lanes.tsv`). Group/special
lanes keep their own wrapper scripts (`test-sync-v2-e2e.sh`,
`test-sync-infra.sh`).

| Lane | Body / target | Purpose | Infrastructure | When to run |
|---|---|---|---|---|
| `backend-fast` | `tests/local-runtime-smoke.sh` (no baseline preflight — the body manages the runtime itself) | Combined fast backend smoke: runtime up + reset (migrations + seed) + DB schema lint + health endpoint + deterministic seed-fixture presence. | local Supabase + Docker | Any `supabase/**` change. Backend half of the fast gate (`./boga test fast-backend`). |
| `auth-authz` | `tests/auth-authz-contract.sh` | Real auth context + RLS behavior: owner success, cross-user denial, validation/unauthorized paths (incl. `auth.users`-keyed profile tables and `public.app_logs` insert/read-deny). | local Supabase + Docker | `supabase/migrations/**` (RLS/policies/functions), auth config. Part of `boga test backend`. |
| `sync-v2-schema` | `tests/sync-v2-schema-smoke.sh` | Sync-v2 clean-room schema shape (the columns/indexes/triggers/RLS the migration ships). | local Supabase + Docker | `supabase/migrations/**` sync-v2 schema changes. Part of `boga test backend`. |
| `sync-push-contract` | `tests/sync-push-contract.sh` | `sync_push` RPC contract: LWW, clamp, undelete, envelope, batch caps, FK closure, auth/RLS. | local Supabase + Docker | `sync_push` RPC / sync push contract changes under `supabase/**`. Part of `boga test backend`. |
| `sync-pull-contract` | `tests/sync-pull-contract.sh` | `sync_pull` RPC contract: per-layer cursor protocol — snapshot pull, paginated drain, layer→type partition, RLS isolation, tombstones, empty-page echo, same-ms tiebreak, limit/layer bounds, AUTH_REQUIRED. | local Supabase + Docker | `sync_pull` RPC / pull contract changes under `supabase/**`. Part of `boga test backend`. |
| `dev-wipe-my-data` | `tests/dev-wipe-my-data-contract.sh` | Developer-only `dev_wipe_my_data` RPC: auth guard, non-production environment guard, owner-scoped deletion (caller's rows removed, second user's rows survive). | local Supabase + Docker | Changes to the `dev_wipe_my_data` RPC or its guards. Part of `boga test backend`. |
| `sync-v2-e2e` (`test-sync-v2-e2e.sh`) | `tests/sync-v2-*.sh` group | Integration-level plan-outcome assertions across the as-built stack: `sync-v2-clean-room.sh`, `-deferrable-fk.sh`, `-rls-cross-owner.sh`, `-push-roundtrip.sh`, `-pull-drain.sh`, `-pull-fk-closure.sh`, `-drift-synthetic.sh`, `-drift-asbuilt.sh`, `-spec-rule.sh`. Includes the independent push→pull parity assertions across all data-scope entities (incl. soft-delete tombstone visibility). | local Supabase + Docker | Any cross-cutting sync-v2 backend change; milestone/release closeout for sync. Part of `boga test backend` (runs after the per-task wrappers, before `test-sync-infra.sh`). |
| `sync-infra` (`test-sync-infra.sh`) | `apps/mobile` jest `test:sync:infra` (`drift-check` + `cycle-round-trip` + `cycle-multidevice-lww` + `auth-required-envelope`) | Mobile **cross-stack** sync proof: drives the real `runSyncCycle` against THIS worktree's slot-isolated local Supabase. Ensures the baseline, reads `API_URL`/`ANON_KEY`, exports them as `SYNC_TEST_SUPABASE_URL`/`ANON_KEY`, then runs the lane — zero manual env setup. The one lane whose test body is frontend but whose infra is backend. | local Supabase + Docker | Mobile sync cycle / client Drizzle schema / migration bundle / wire-contract changes. Part of `boga test backend` (**runs last**); also runnable standalone (`npm run test:sync:infra` with the env exported). |
| `ensure-local-runtime-baseline.sh` | — | Shared runtime preflight (not a test): lock + conditional bootstrap/reset + deterministic fixture enforcement. If runtime is down: start + reset/seed + provision auth fixtures. If up: reuse as-is (no reset), apply pending migrations, verify baseline rows, re-provision auth fixtures idempotently. | local Supabase + Docker | Invoked automatically by every real-instance wrapper above and by `test:e2e:ios:auth-profile`. Run it directly before any real-instance slow test. |

Supporting (non-test) backend scripts: `local-runtime-up.sh` (start stack + health
function serve), `reset-local.sh` (migrate/bootstrap + deterministic seed),
`db-lint-local.sh` (fast schema lint), `smoke-health.sh` (health endpoint smoke),
`smoke-seed.sh` (fixture baseline smoke via REST), `auth-provision-*.sh` (fixture
identities), `auth-fixture-constants.sh` (fixture credentials).

## Maestro iOS helper scripts (`apps/mobile/scripts/`)

The four `test:e2e:ios:*` npm scripts above are thin wrappers over these. The
shared runtime plumbing — `maestro-ios-run-flow.sh`, `maestro-ios-runtime.sh`,
`maestro-ios-provision.sh`, `maestro-ios-launch.sh`, `maestro-ios-teardown.sh`,
`maestro-env.sh`, `ios-sim-boot.sh` — provisions/launches/tears down the sim +
Metro and is owned operationally by
`docs/specs/11-maestro-runtime-and-testing-conventions.md`. One-time setup:
`maestro-ios-dev-client-build.sh` builds the dev-client `.app` (per worktree).

---

# CI posture

- `.github/workflows/ci.yml` runs one job (`frontend`, working directory
  `apps/mobile`) on every push and pull request to `main`.
- It runs, in order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`
  (5-minute step timeout), and `npm run test:handles` (open-handle guard, 5-minute
  step timeout). That is the **entire** CI surface today.
- **Not in CI:** the iOS Maestro slow gates (`boga test frontend`) and the
  backend Supabase contract suites (`boga test backend`) are local-only,
  along with `lint:ui-guardrails` and `db:generate:canary`. **Local-only means you
  run them on your dev machine — not that they can't be run: this environment boots
  the iOS simulator and local Supabase (verify + run per
  `02-quality-and-test-gates.md`). Do not record a slow gate as "deferred" because
  the sim/Supabase is "unavailable".** For work not covered by the CI job, the
  verification record must still document: what was run locally, whether a slow
  gate was required and its trigger, and what is genuinely deferred (e.g. hosted
  deployment smoke that has no local equivalent).
- **Keep-in-sync rule:** when CI coverage expands (e.g. backend or e2e gates land
  in CI), update this catalog and the always-load quickref
  (`docs/specs/02-quality-and-test-gates.md`) in the same change so gate ownership
  stays accurate. See `AGENTS.md` for the documentation-maintenance expectation.

---

# Testing practices and policies

## Default testing practice

- Every feature should include at least one success-path test and one
  offline/error-path test.
- Run a targeted test or gate after each meaningful change, then run
  `./boga test fast` before closeout. Run `./boga test
  backend|frontend` when the change touches the areas/paths its lanes cover (see the catalog
  and policies).
- For how long each lane actually takes, run `./scripts/test-timings.sh`
  (measured medians + 3× ceilings from the records the gates write). Do not
  invent durations.

## Local data two-lane policy

- **Lane 1 (CI-safe):** fast `apps/mobile` checks (`lint`, `typecheck`, `test`)
  plus the data-layer tests that validate migration/bootstrap orchestration and
  smoke insert/read using deterministic in-memory SQLite. Use `db:generate:canary`
  to confirm the migration bundle has no uncommitted drift.
- **Lane 2 (native runtime smoke):** the focused smoke flow on the Expo native
  runtime with real `expo-sqlite` (`test:e2e:ios:data-smoke`). Capture concise
  evidence: runtime environment, steps, migration success, smoke write/read
  success.
- **Rule:** Lane 1 is not a substitute for Lane 2 when validating runtime SQLite
  behavior; both are required for milestone-level local data confidence.

## In-memory SQLite unit tests (shared fixture)

- Unit tests that need a real local SQLite engine (rather than a mocked client)
  must use the shared fixture at
  `apps/mobile/app/__tests__/helpers/in-memory-db.ts`.
- The helper spins up an in-memory `better-sqlite3` database, applies **all**
  migrations from the generated bundle (`apps/mobile/drizzle/migrations.generated.ts`)
  in journal order, and returns the drizzle handle, the raw client, and a
  `close()` teardown.
- Rules:
  - do not hand-roll DB setup or copy DDL into individual tests; drive the schema
    from the generated bundle so every test tracks the real shipped schema when a
    new migration lands.
  - call `createInMemoryDatabase()` in `beforeEach` and `close()` in `afterEach`.
    Pass `{ foreignKeys: true }` when the test depends on FK enforcement.
- Exception: tests that intentionally create a deliberately partial schema to
  assert negative-space behavior (for example `clock.test.ts`, which builds only
  `sync_runtime_state` so a stray write to another table surfaces as a
  missing-table error) keep their bespoke setup; the shared full-schema fixture
  would erase that guard. Bespoke fixtures still close their connections in
  `afterEach` (see *Unit-test hang safety*).

## Unit-test hang safety

- `npm test` is bare `jest` with **no `--forceExit`** — by design. `--forceExit`
  masks leaks; it would hide the open-handle hang this policy exists to catch. Do
  not add it.
- Two distinct failure modes are covered separately:
  - a hung test or hook (unresolved `await`, infinite loop) is bounded by
    `jest.config.js` `testTimeout` (15s) so it fails loudly instead of stalling;
  - a leaked handle that keeps the process alive AFTER tests pass (unclosed
    connection, lingering timer, real Supabase transport) is caught by the CI step
    timeout (fast loud failure) and diagnosed by the open-handle guard.
- Open-handle guard: `npm run test:handles` runs the suite serially with
  `--detectOpenHandles`, surfacing any leaking handle with a stack. It is a
  dedicated CI step and can be scoped locally (e.g. `npm run test:handles -- sync-cycle`).
- Safe-by-default mocking: `apps/mobile/jest.setup.ts` mocks
  `@supabase/supabase-js` `createClient` to an inert client (no socket, no GoTrue
  auto-refresh timer), so no suite can construct a real Supabase transport by
  forgetting a local mock. Suites needing richer behavior override it with their
  own `jest.mock`.
- Any test that opens a real connection (e.g. a `better-sqlite3` `:memory:` handle)
  must close it in `afterEach`, mirroring the in-memory-db helper — even bespoke
  fixtures like `clock.test.ts`.

## Sync integration coverage policy

- Applies to mobile/frontend-backend sync work under `apps/mobile/**` sync code,
  `apps/mobile/app/__tests__/sync/**`, and the backend sync RPCs in `supabase/**`.
- Required coverage should include the relevant subset of:
  - first-enable bootstrap pull + local merge + convergence flush,
  - the full sync cycle converging local and server state over a real
    push → server-side LWW → pull → local LWW loop,
  - per-layer cursor protocol (snapshot pull, paginated drain, layer→type
    partition, tombstones, empty-page echo, same-ms tiebreak, limit/layer bounds),
  - dirty-bit ordering and idempotency behavior (v2 has no outbox),
  - already-logged-in journey and logged-out-then-login journey both converging,
  - auth missing/expired (AUTH_REQUIRED): unauthenticated cycle is a clean no-op,
    no mutation, dirty bits preserved,
  - offline / backend-unavailable retry/recovery with the locked backoff policy,
  - local FK enforcement for pull/apply and repository writes; pull-side local FK
    apply failures must be classified as `LOCAL_FK_VIOLATION`, must roll back the
    failed page without advancing that layer cursor, and must log sanitized
    diagnostics without masking the original cycle outcome,
  - push-side FK closure preflight: orphan dirty children must be detected before
    `sync_push`, valid parent/child graphs must not be falsely blocked, and a
    present-but-quarantined parent must cascade to its child,
  - sync quarantine: a FK-blocked dirty row must persist to `sync_quarantine`,
    be excluded from future push selection, survive database reopen, be
    idempotently updated on repeat detection, and allow independent valid dirty
    rows beside it to push and clear,
  - sync-cycle result semantics: `runSyncCycle` outcomes (`converged`,
    `auth-required`, `fk-violation`, `internal`) must be distinguished; the
    scheduler advances `lastSuccessAtMs` only for `converged`, and
    non-converged outcomes stay visible until a later converged cycle clears
    them,
  - response contract semantics and RLS cross-owner isolation,
  - projection/read-model correctness after ingest/replay,
  - wiped-client reinstall re-pull restoring every layer with FK integrity and
    advancing cursors.
- Use mocks/fakes for broad scenario coverage in the fast lane, then prove at
  least one real cross-stack path:
  - mobile side: `npm run test:sync:infra` (real round trip, AUTH_REQUIRED no-op,
    drift check) against a live endpoint;
  - backend side: `./boga test backend` (auth/RLS + schema smoke +
    push + pull + dev-wipe + drift + e2e + sync-infra). The push→pull parity /
    reinstall guarantee is proven
    by `sync-v2-push-roundtrip.sh` and `sync-v2-pull-drain.sh` inside the e2e
    wrapper.
- **The device-level proof is its own requirement and is NOT satisfied by the
  above:** `npm run test:e2e:ios:sync` (real recorder UI + real cycle + real
  local Supabase) is mandatory for changes to the sync cycle, scheduler, sync
  triggers, auth session handoff, or the first-sync gate. `test:sync:infra` is
  the breadth lane (LWW, multi-device, drift) — it bypasses the UI, NetInfo, and
  the scheduler wiring, so a green run there is not evidence for those layers.
- Current frontend baseline suites for this policy (Sync v2) include the
  `apps/mobile/app/__tests__/sync-cycle-*.test.ts` family
  (`-convergence`, `-pull`, `-push`, `-race`, `-wire`),
  `sync-cycle-push-preflight.test.ts`, `sync-cycle-quarantine.test.ts`,
  `sync-bootstrapper.test.ts`, `sync-status-composer.test.ts`,
  `sync-gate-decision.test.ts`, `settings-profile-navigation.test.tsx`, and the
  `app/__tests__/sync/**` directory (cycle-round-trip, cycle-multidevice-lww,
  drift-check,
  auth-required-envelope, dirty-bit-per-entity, scheduler-state-table,
  topo-order-imported, now-monotonic-cross-restart,
  manual-wipe-doc-exists).

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
    convergence, and reinstall restore parity.
- Use deterministic Jest coverage for service wrappers and matching logic. Add
  simulator/manual or Maestro evidence when UI permission flows are introduced or
  native permission behavior is being validated.

## Exercise-tag coverage policy

- Applies to exercise-tag schema/repository/UI work in the mobile local runtime.
- Required coverage should include:
  - schema/migration assertions for `exercise_tag_definitions`,
    `session_exercise_tags`, and durable
    `session_exercises.exercise_definition_id` linkage,
  - repository/domain assertions for normalized duplicate prevention, scoped
    attach validation, and assignment uniqueness,
  - assignment-history semantics (soft-deleted tag definitions hidden from default
    suggestions but existing assignments remain queryable),
  - recorder interaction assertions (add/select/create/manage rename/delete/
    undelete, chip removal) and completed-edit parity.
- Use targeted Jest coverage; require `./boga test frontend` when
  runtime-sensitive recorder tag behavior changes.

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

## iOS UI smoke policy (Maestro)

- Jest / RNTL remains the default for component logic, state transitions, and
  CI-safe assertions. Maestro is for simulator-integrated UI smoke that confirms
  core screens are reachable and visibly intact.
- In the standard local gate matrix, current Maestro checks are `frontend + slow`
  and run via `./boga test frontend` (smoke + data-smoke +
  auth-profile).
- Required smoke coverage: app launch visible state; session recorder visible
  state; logged-out profile state; fixture-backed sign-in; signed-in profile state;
  username update; sign-out back to logged-out. Reset policy: `full reset` (smoke
  is the cold-start lane), then `teleport` to the recorder once launch visibility
  is confirmed. Required smoke screenshots: `01-app-launch`,
  `02-session-recorder-visible` (capture automated by the flow; stored under the
  canonical artifact root).
- Require `./boga test frontend` when a change touches the committed
  smoke/data-smoke flows, Maestro runtime scripts, the dev-client/runtime
  handshake, harness setup behavior, or user-facing UI that needs fresh
  real-simulator smoke evidence.

## iOS simulator data smoke policy (Maestro)

- Purpose: validate runtime migration + smoke insert/read on real Expo iOS runtime
  (`expo-sqlite`) when change risk is runtime-sensitive (`test:e2e:ios:data-smoke`,
  also covered by `boga test frontend`). Reset policy: `data reset` then
  `teleport` to the recorder; avoid `full reset` unless cold-install evidence is
  needed.
- Required when any of these change:
  - `apps/mobile/src/data/bootstrap.ts`,
  - `apps/mobile/src/data/migrations/**`,
  - `apps/mobile/drizzle/**` migration artifacts or schema outputs,
  - `apps/mobile/package.json` Expo/SQLite/Drizzle dependency updates,
  - `apps/mobile/app/maestro-harness.tsx` or `apps/mobile/src/maestro/**`,
  - `apps/mobile/.maestro/**` or `apps/mobile/scripts/maestro*` where data-smoke
    setup/runtime orchestration is affected,
  - milestone/release closeout requiring fresh native runtime data evidence.
- Optional (recommended) when data-layer changes are low risk and local runtime
  confidence is desired before handoff. Usually not required when changes are
  limited to data-repository pure logic that does not alter runtime
  migration/bootstrap wiring and Lane 1 is green.
- Evidence: command result + artifact root under
  `apps/mobile/artifacts/maestro/<id-or-ad-hoc>/<timestamp>/`, plus screenshots
  `03-data-runtime-smoke-start`, `04-data-runtime-smoke-success`.

## iOS simulator auth/profile happy-path policy (Maestro)

- Purpose: validate the real local-Supabase login/profile happy path (plus
  login-on-start enforcement, the first-sync gate, and settings sync status) on the
  iOS simulator with deterministic fixture credentials
  (`test:e2e:ios:auth-profile`, also covered by `boga test frontend`).
- Setup: `full reset` so each run starts logged out with no restored session;
  preflight `./supabase/scripts/ensure-local-runtime-baseline.sh`; use the
  deterministic fixture credentials (`user_a` by default) from
  `supabase/scripts/auth-fixture-constants.sh`; use a per-run username so repeated
  runs still exercise the username-save path.
- Required when any of these are true: milestone/release closeout needs fresh
  auth/profile proof; profile-route UI/state semantics change; auth
  bootstrap/session-restore behavior changes; local-Supabase auth/profile wiring
  changes.
- Evidence: command result + artifact root, plus screenshots
  `05-auth-profile-logged-out-start`, `06-auth-profile-signed-in`,
  `07-auth-profile-signed-out-end`.

## iOS lane configuration contract (infra-free vs Supabase-configured)

- The committed iOS lanes run the **same** dev-client build in two deliberately
  exclusive configurations, selected by whether the app sees Supabase credentials
  (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`):
  - **infra-free** — `smoke`, `data-runtime-smoke` (and combined `gates`): no
    Supabase. The app runs local-only with the login-on-start gate disabled, which
    keeps these gates fast, backend-free, and focused on the local SQLite runtime.
    `data-runtime-smoke` additionally proves the backend-less build seeds its own
    starter exercise catalog at boot.
  - **Supabase-configured** — `auth-profile`: a real local Supabase is provisioned
    via `ensure-local-runtime-baseline.sh`, so login-on-start, fixture sign-in, and
    sync are exercised.
- The selection is driven by `apps/mobile/.env.local`, a durable per-worktree file
  Expo's dev server reads authoritatively. The runner pins each lane's config and
  restores the developer's file afterward. The mechanism is owned by
  `docs/specs/11-maestro-runtime-and-testing-conventions.md`; do not hand-edit
  `.env.local` to switch a lane.

## iOS simulator parallel-run policy (Maestro)

- Parallel local agents can collide on simulator selection and Expo dev-server
  ports. iOS Maestro runner scripts rely on explicit per-worktree config (no
  host-level lock): each worktree must own one Metro port and one simulator target.
- Configuration: `EXPO_DEV_SERVER_PORT` (generated default `8082 + worktree slot`;
  unique per workspace), `IOS_SIM_UDID` (preferred on a shared host),
  `IOS_SIM_DEVICE` (fallback when the name is unique), `IOS_SIM_AUTO_CREATE`
  (generated default `1` for setup-created env files).
- Parallel runs are safe only when each worktree uses a unique
  `EXPO_DEV_SERVER_PORT` and a unique simulator target; otherwise runners can
  clobber each other. Keep machine-specific overrides in
  `.maestro/maestro.env.local`, not in shared docs.

## Maestro contract ownership

- `docs/specs/11-maestro-runtime-and-testing-conventions.md` is the authoritative
  Maestro runtime/testing contract (reset taxonomy `full reset` / `data reset` /
  `teleport`, artifact root `apps/mobile/artifacts/maestro/<id-or-ad-hoc>/<timestamp>/`,
  minimum artifacts `runtime.env` / `provision.log` / `launch.log` / `teardown.log`
  / `expo-start.log` / `simulator-system.log` / `maestro-junit.xml`, and
  per-worktree config). This document owns only the testing policy: when Maestro
  slow gates are required, which command wrappers are canonical, and where evidence
  is expected. Runbooks (`apps/mobile/README-maestro.md`,
  `apps/mobile/README_HUMAN_TESTING.md`) stay operational and link back to the
  contract.

## Shared Supabase runtime contract (slow real-instance tests)

- Applies to local real-instance test commands that hit a running Supabase stack
  rather than mocked clients. Current required entrypoints (`./boga test <lane>`):
  `auth-authz`, `sync-v2-schema`, `sync-push-contract`, `sync-pull-contract`,
  `dev-wipe-my-data`, `sync-v2-e2e`,
  `npm run check:sync-drift -- --strict`, `npm run test:sync:infra`,
  `npm run test:e2e:ios:auth-profile`, and `npm run test:e2e:ios:sync`.
- Expected baseline state: a local Supabase runtime is reachable;
  `public.dev_fixture_principals` contains at least `anonymous`, `user_a`,
  `user_b`; deterministic auth fixtures for `user_a`/`user_b` are provisioned with
  known credentials from `supabase/scripts/auth-fixture-constants.sh`.
- Enforcement: use `./supabase/scripts/ensure-local-runtime-baseline.sh` before
  real-instance slow tests. If runtime is down: start + reset/seed + provision. If
  up: reuse as-is (no reset), apply pending migrations, verify baseline rows,
  re-provision auth fixtures idempotently.
- Data-shape contract: baseline rows must exist, but extra rows are allowed; suites
  must not assume empty tables beyond the baseline, and must use per-run unique
  entity IDs so repeated runs in one slot do not collide.
- Parallel-run contract (same machine): each initialized worktree has its own
  Supabase `project_id`, slot-derived port block, containers, and DB volume.
  Runtime bootstrap is serialized per worktree via a lock in
  `ensure-local-runtime-baseline.sh`. Avoid manual destructive operations
  (`db reset`, stack restart) in a worktree while another suite uses that slot. Use
  `./scripts/worktree-doctor.sh` if a backend suite appears to hit the wrong local
  Supabase instance.

## Worktree isolation testing policy

- Worktree setup and runtime isolation are owned by
  `docs/specs/12-worktree-config-and-isolation.md`.
- Before running local gates in a linked worktree, initialize it with
  `./scripts/worktree-setup.sh`. Diagnostic entrypoint: `./scripts/worktree-doctor.sh`.
  Completed-worktree Supabase cleanup: `./scripts/worktree-sweep.sh` (also run
  opportunistically by `./supabase/scripts/local-runtime-up.sh` before starting the
  current slot; limited to non-current slots past the grace period that match a
  completion signal enumerated in spec 12 — merge-into-main and branch-deleted
  signals are on by default, disable with `--no-merge-detection` or
  `BOGA_WORKTREE_SWEEP_DETECT_MERGED=0`).
- Placement rule: BOGA worktrees must not be nested inside another BOGA checkout;
  quality wrappers and runtime helpers fail before starting services when nested
  placement is detected.
- Dependency isolation: each worktree owns its own `apps/mobile/node_modules`;
  symlinked `node_modules` is refused by runtime guards.
- Supabase isolation: generated `supabase/config.toml` is per-worktree and
  slot-derived; tests consume local runtime values from `supabase status -o env` or
  project wrappers, not hardcoded ports.

## Backend / Supabase testing model

- Applies to `supabase/**`, backend helper workspaces, and cross-stack
  mobile+backend verification.
- Test layers (top-level ownership):
  - **DB tests** (pgTAP preferred, or equivalent SQL-level path): RLS policies, SQL
    functions, constraints, invariants. Required for policy/function/constraint
    changes.
  - **Edge unit tests** (runtime-native, e.g. `deno test`) when Edge Functions /
    custom runtime code exists: validation, mapping, pure logic.
  - **Supabase-local integration/contract tests** (required for backend auth/authz/
    API work): run against the local runtime; verify real auth context + RLS;
    cover success, validation failure, unauthorized, and cross-user denial; for
    `auth.users`-keyed profile tables cover owner success + cross-user denial; for
    operational tables like `public.app_logs` cover authenticated insert plus
    client-side read/update/delete denial.
  - **Hosted/deployed smoke validation**: environment-specific behavior
    (secrets/bindings, ingress, hosted auth/provider config, migration execution on
    the hosted instance). Manual by default until CI exists.
  - **Cross-stack E2E** (Maestro + local Supabase): `test:e2e:ios:auth-profile`
    plus the backend sync-v2 e2e wrapper.
- Deterministic fixture baseline: named fixture identities (`anonymous`, `user_a`,
  `user_b`; optional helper/service-role path), enforced through
  `ensure-local-runtime-baseline.sh`.
- Execution triggers (minimum): always run cheap tests for the changed layer(s);
  `./boga test fast-backend` is the default backend fast gate; run the
  Supabase-local integration/contract suites (grouped under
  `./boga test backend`) when changing `supabase/migrations/**`,
  `supabase/functions/**`, auth config/policies, or sync RPC contracts/fixtures
  (not every backend change requires every slow suite); run hosted smoke when
  changing deployment/env/secrets config, hosted-only behavior, or at
  milestone/release closeout needing fresh hosted evidence.
- Coverage policy for Supabase API surfaces: custom runtime code (Edge Functions)
  requires unit tests + local integration/contract tests; a mostly-PostgREST/RPC
  surface can have a small unit surface, compensated by stronger DB + local
  integration/contract coverage.

## Project structure conventions for testing assets

- `apps/mobile/.maestro/flows` — canonical Maestro flow definitions.
- `apps/mobile/.maestro/maestro.env.sample` — checked-in config sample;
  `apps/mobile/.maestro/maestro.env.local` — canonical per-worktree untracked
  config.
- `apps/mobile/src/auth/` — shared mobile auth client, storage, session-service,
  provider modules.
- Repo-root `e2e/` — reserved for cross-stack orchestration/tests.
- `supabase/` — backend root for migrations, seeds, functions, and backend-local
  test assets. `supabase/scripts/` — backend local runtime/test wrappers.
  `supabase/tests/` — backend-local smoke/integration test entrypoints (until a
  dedicated helper workspace is introduced).
- Do not couple backend work to a mobile test-directory refactor (e.g. moving
  `apps/mobile/app/__tests__`) unless a dedicated change scopes it.

---

## Planned next phase (UI quality and appearance)

1. Add visual regression testing for critical screens/components — catch layout
   and styling regressions (spacing, clipping, overlap) that behavior tests miss.
2. Define a lightweight UI contract per key screen (visibility, tap targets, no
   overlap, small-phone fit) — make visual correctness explicit for humans and AI.
3. Add screenshot checkpoints in end-to-end flows — verify real user journeys
   preserve expected appearance.
4. Establish a baseline-update policy for snapshots — ensure visual changes are
   intentional and reviewed.
5. Use visual diff output as AI iteration input — faster targeted UI fixes.
