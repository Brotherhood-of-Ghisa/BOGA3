# Sync v2 launch — non-unit test inventory

This document inventories the **non-unit** tests that landed with the Sync v2
launch work (login-on-start, the first-sync gate, the first-sign-in
bootstrapper, soft-delete, sign-out/account-switch local wipe, the Settings
sync-status surface, the dev-gated wipe affordances, and the launch end-to-end
verification). It exists because that batch of work introduced many non-unit
tests under time pressure against repeatedly-flaky lanes; this is the
keep/drop + principles-conformance review of that test set.

"Non-unit" here means the three categories below — it deliberately excludes the
pure mock/logic unit tests, which are covered by the fast `jest` lane and are
out of scope for this review:

1. **Maestro iOS e2e flows** (`apps/mobile/.maestro/flows/*.yaml`) and their
   runner wiring (`apps/mobile/scripts/maestro-ios-*.sh`).
2. **Supabase / live-endpoint (infra) tests** — suites that hit a real
   Postgres + PostgREST + RLS endpoint, under `apps/mobile/app/__tests__/sync/**`.
3. **Mock-device-DB tests** — tests that drive a real local SQLite engine
   in-memory via the shared fixture `apps/mobile/app/__tests__/helpers/in-memory-db.ts`.

The conformance column verifies each test against the authoritative testing
architecture in `docs/specs/06-testing-strategy.md` (the in-memory SQLite shared
fixture, the iOS lane configuration contract, the Maestro contract ownership
rule, the shared-Supabase runtime contract, and the two-lane local-data policy)
plus `docs/specs/11-maestro-runtime-and-testing-conventions.md`. The principles
are authoritative; this review verifies against them and does not redesign them.

## Summary

- **Net decision: 0 drops.** Every non-unit test in this set asserts a distinct,
  load-bearing behaviour; none is genuinely redundant, dead, or mislabeled. The
  launch end-to-end suites and the per-behaviour suites are coverage that must
  not be reduced.
- **1 principle violation fixed.** The developer-wipe Maestro flow
  `apps/mobile/.maestro/flows/settings-dev-wipe-local.yaml` was committed but
  wired into **no** runner script — an orphaned flow that never ran in any lane
  (it violated Maestro contract ownership: a committed flow must be owned by a
  lane). It is real, infra-free coverage for the dev-gated wipe affordance, so
  the fix is to **wire it into the infra-free gates runner**
  (`apps/mobile/scripts/maestro-ios-gates.sh`), not to drop it.
- **One partial overlap noted, both kept.** Two suites assert the first-sync
  gate's phase/activity/offline rendering. They are kept because they test
  different layers (component contract with a forced progress prop vs. the real
  progress producer→consumer wiring); see the Maestro/in-memory sections below.

## 1. Maestro iOS e2e flows

The committed iOS lanes run the **same** dev-client build in two deliberately
exclusive configurations selected by whether the app sees Supabase credentials:
**infra-free** (no Supabase; local-only; the login-on-start gate is disabled)
and **Supabase-configured** (a real local Supabase is provisioned, so login +
sync are exercised). That selection is pinned per-lane by the runner scripts via
a managed `apps/mobile/.env.local`; **no flow hand-edits `.env.local`** (verified
— grep finds zero `.env.local` references inside `.maestro/flows/`). Each flow
below consumes only runner-injected environment variables.

| Flow | Lane | Runner | What it covers | Decision | Conformance |
|------|------|--------|----------------|----------|-------------|
| `.maestro/flows/launch-requires-sign-in.yaml` | Supabase-configured | `scripts/maestro-ios-auth-profile.sh` | A configured build with no restored session lands on the dedicated sign-in screen before any data screen renders; only a successful sign-in reaches data screens. | KEEP | Conforms. Auth-configured lane; uses injected `MAESTRO_AUTH_PROFILE_*` / dev-client deep-link env; no `.env.local` edit. Owned by the auth-profile runner. |
| `.maestro/flows/sync-gate-first-cycle.yaml` | Supabase-configured | `scripts/maestro-ios-auth-profile.sh` | The full-screen first-sync block sits below the auth guard, shows progress while the first cycle runs, and lifts once the cycle drains. | KEEP | Conforms. Auth-configured lane; harness-driven gate state via `boga3://maestro-harness?gate=...`; no `.env.local` edit. Owned by the auth-profile runner. |
| `.maestro/flows/settings-sync-status.yaml` | Supabase-configured | `scripts/maestro-ios-auth-profile.sh` | The Settings sync-status panel renders after sign-in (last sync, dirty count, error/network state). | KEEP | Conforms. Auth-configured lane; injected fixture credentials; no `.env.local` edit. Owned by the auth-profile runner. |
| `.maestro/flows/auth-profile-happy-path.yaml` (modified) | Supabase-configured | `scripts/maestro-ios-auth-profile.sh` | Fixture-backed sign-in → signed-in profile → username update → sign-out, adapted to the launch login-on-start contract. | KEEP | Conforms. Auth-configured lane; owned by the auth-profile runner; injected env only. |
| `.maestro/flows/settings-dev-wipe-local.yaml` | infra-free | **was: NONE → now: `scripts/maestro-ios-gates.sh`** | The developer-only "Wipe local & re-bootstrap" affordance renders (proving the dev-mode gate is true on the dev build), drives the wipe, asserts success feedback, and confirms the app re-bootstraps back to a usable data screen. | KEEP + FIX | **Was a Maestro-contract-ownership violation: orphaned, owned by no lane, never ran.** Fixed by wiring it into the infra-free gates runner. The flow itself conforms (infra-free harness teleport, self-resets via `?reset=data`, no `.env.local` edit). |

**Out of this scope (observed, not acted on):** `stats-heatmap-ux.yaml`,
`stats-view-toggle-ux.yaml`, `exercise-heatmap-evidence.yaml`, and the
pre-existing `exercise-block-history-fixture.yaml` are exercise-stats/heatmap
feature flows from separate, out-of-band feature work, not part of this launch
batch. They are also currently unowned by a runner, but they fall outside this
inventory; flagging them here so a future stats-feature hygiene pass can decide
whether to wire or retire them.

## 2. Supabase / live-endpoint (infra) tests

These suites sign in / call RPCs against a **real** Postgres + PostgREST + RLS
endpoint. They read the endpoint from `SUPABASE_BRANCH_URL` /
`SUPABASE_BRANCH_ANON_KEY` through the shared helper
`apps/mobile/app/__tests__/sync/helpers/live-branch.ts`, which **fails hard when
either is unset** — so they never pass vacuously without an endpoint. They are
excluded from the fast CI `jest` lane via `jest.config.js`
`testPathIgnorePatterns`, and are run by the dedicated integration config
`jest.integration.config.js`, invoked by `scripts/test-sync-reinstall-restore-parity.sh`
(`npm run test:sync:reinstall-parity`), which enforces the local Supabase
baseline via `supabase/scripts/ensure-local-runtime-baseline.sh` and injects the
branch env. Each uses a unique per-run id prefix and wipes the fixture user's
rows first, satisfying the shared-Supabase parallel-run contract.

| Suite | What it covers | Decision | Conformance |
|-------|----------------|----------|-------------|
| `app/__tests__/sync/launch-reinstall-restore.test.ts` | Same-device reinstall → login → every one of the eight syncable entity families is restored within the one-minute foreground window; the starter-catalog seeder no-ops on a non-empty pull (proven via the seed marker staying at zero). | KEEP | Conforms. Live endpoint via `live-branch.ts` (fails hard when unset); local store via the shared in-memory fixture; unique run prefix; wipes server rows per run; closes the fixture in `afterEach`. Run by the integration config. |
| `app/__tests__/sync/launch-second-device-restore.test.ts` | A fresh second device (its own store, never primed by the writer) logs into the same account and restores every family within the window; seeder no-ops. Distinct outcome from same-device reinstall (the restoring store never wrote the data). | KEEP | Conforms (same mechanism as above). **Not redundant** with the reinstall suite — it proves cross-device restore, where the restorer is a genuinely separate store. |
| `app/__tests__/sync/no-v1-server-objects.test.ts` | The retired previous-generation server RPCs and tables are absent on the real endpoint, **and** a current sync RPC still resolves — so the absence check is non-vacuous (not every call simply errors). | KEEP | Conforms. Live endpoint; behavioural (probes PostgREST), not a grep of migration text; explicit non-vacuity guard. Run by the integration config. |

**Lane-split rationale (verified, conforms):** these three suites are kept OUT
of `npm run test:sync:infra` on purpose — that lane's drift checker runs
`supabase db reset`, which drops the auth fixture mid-run and would strand any
sign-in suite sharing the process. They run instead under
`jest.integration.config.js` via the reinstall-parity wrapper. This is a
deliberate, documented lane separation consistent with the shared-Supabase
runtime contract, not an oversight.

**Pre-existing infra suites (out of scope, unchanged):**
`app/__tests__/sync/cycle-round-trip.test.ts`,
`app/__tests__/sync/auth-required-envelope.test.ts`, and
`app/__tests__/sync/drift-check.test.ts` predate this launch batch and remain in
the `npm run test:sync:infra` target; they were not introduced here.

## 3. Mock-device-DB (in-memory SQLite) tests

The architecture requires in-memory SQLite tests to drive the schema from the
shared fixture `createInMemoryDatabase()`
(`apps/mobile/app/__tests__/helpers/in-memory-db.ts`), which applies **all**
generated migrations in journal order — never hand-rolled DDL — except the
explicit negative-space exception (a deliberately partial schema to assert a
missing-table guard). **Every in-memory SQLite test introduced by this launch
batch uses the shared fixture**; none hand-rolls DDL. (The only hand-rolled-DDL
in-memory test in the tree, `app/__tests__/clock.test.ts`, is the documented
negative-space exception and was **not** introduced or modified by this batch.)
All of these call `createInMemoryDatabase()` in `beforeEach` and `close()` in
`afterEach`, matching the unit-test hang-safety rule.

| Suite | What it covers | Decision | Conformance |
|-------|----------------|----------|-------------|
| `app/__tests__/sync-bootstrapper.test.ts` | First-sign-in bootstrapper: seeder runs only behind a zero-row first pull; `bootstrap_completed_at` is stamped last so a crash re-attempts cleanly. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/bundle-migrations.test.ts` | The bundle-migration runtime loop: short-circuit when applied ≥ current, ascending application each in its own transaction with atomic marker advance, resume after partial failure, empty array still advances the marker. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/seed-catalog-slug-shape.test.ts` | The seeded catalog bundle uses the current `seed_*` lineage slug shape; no legacy `sys_*` id remains; muscle-group ids stay bare slugs. | KEEP | Uses shared fixture (`{ foreignKeys: true }`); proper teardown. |
| `app/__tests__/muscle-group-bootstrap-idempotent.test.ts` | The muscle-group bootstrap inserts any bundle row whose id is absent locally (per-id, not all-or-nothing-on-empty), without overwriting existing rows. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/soft-delete-converted-paths.test.ts` | The converted hard-delete repo paths set `deleted_at` + flip the dirty bit via the normal repo path; readers filter `WHERE deleted_at IS NULL`. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/session-rebuild-soft-delete.test.ts` | The session-rebuild cascade soft-deletes then reconciles, preserving the order-index / PK invariants against the local unique index. | KEEP | Uses shared fixture (`{ foreignKeys: true }`); proper teardown. |
| `app/__tests__/account-switch-local-wipe.test.ts` | Sign-out / account-switch local wipe clears the eight entity tables and resets the runtime-state row, preserving `last_emitted_ms` + the muscle-group taxonomy; no server delete. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/sync-status-composer.test.ts` | The Settings sync-status composition (dirty count across the eight tables, error/network projection) computed against a real local schema. | KEEP | Uses shared fixture; proper teardown. |
| `app/__tests__/sync-gate-state-bridge.test.ts` | The bridge that derives first-sync gate state from the runtime-state row. | KEEP | Uses shared fixture; proper teardown. |

### Source-level guard tests (infra-free, not DB-backed)

These run in the fast lane and assert source/structure invariants by walking the
source tree. They are non-unit in style (whole-tree scans) but need no device DB
or live endpoint; listed for completeness.

| Suite | What it covers | Decision | Conformance |
|-------|----------------|----------|-------------|
| `app/__tests__/no-v1-sync-paths.test.ts` | The previous-generation client sync **code paths** are gone: the engine/outbox source files are absent and no event-type / sequence-counter / batch-envelope identifier survives in bundled source. Includes a non-vacuity guard (scans > 50 source files) and pins the four retired **server** object names as a literal cross-reference to the infra-lane absence check. | KEEP | Conforms. Complements `sync/no-v1-server-objects.test.ts` (client bundle vs. server objects — different surfaces, not redundant). |
| `app/__tests__/soft-delete-guard.test.ts` | No disallowed hard `db.delete(<entity>)` remains across the source tree outside the exempt dev/fixture sites. | KEEP | Conforms. Source-grep guard; the documented launch outcome for soft-delete-everywhere. |

### Overlap note: first-sync gate progress rendering

Two component-level suites assert the gate's phase label / advancing activity /
offline message:

- `app/__tests__/sync-gate-screen.test.tsx` renders the gate with a **forced /
  mocked** progress prop and asserts the component contract across all gate
  modes (block, dismiss, error+single-Retry, AUTH_REQUIRED→sign-in, offline,
  route-through).
- `app/__tests__/launch-sync-gate-progress.test.tsx` drives the **real**
  progress producer (`@/src/sync/progress` — unmocked) and the real connectivity
  projection into the same gate, asserting the producer→consumer wiring
  end-to-end.

The titles look near-identical for three assertions, but the suites test
different layers: one pins the component's rendering contract, the other proves
the live progress accessor actually feeds the gate. **Both kept** — dropping the
end-to-end one would remove the only assertion that the real progress wiring
reaches the gate.

## Cross-cutting conformance verdict

- **In-memory SQLite shared fixture:** every in-memory test introduced here uses
  `createInMemoryDatabase()`; zero hand-rolled DDL; the sole hand-rolled-DDL test
  in the tree is the pre-existing, documented negative-space exception.
- **iOS lane configuration contract:** no Maestro flow hand-edits `.env.local`;
  lane config is pinned by the runner scripts. Infra-free flows use the harness
  teleport; the Supabase-configured flows sign in against a provisioned local
  Supabase.
- **Maestro contract ownership:** after this review every launch-batch flow is
  owned by a runner lane (the one orphan was wired in).
- **Shared-Supabase runtime contract:** the live-endpoint suites fail hard when
  the branch env is unset, use unique per-run ids, wipe per run, and are kept out
  of the drift-reset lane that would strand sign-in suites.
- **Two-lane local-data policy:** fast `jest` (infra-free) excludes the
  live-endpoint suites via `testPathIgnorePatterns`; the live suites run in the
  branch-provisioned integration lane.
