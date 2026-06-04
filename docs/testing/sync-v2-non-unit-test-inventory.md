# Sync v2 launch — non-unit test inventory

This document inventories the **non-unit** tests that the Sync v2 sync-stack
work introduced — the whole effort, not just the final launch batch. That work
deleted the previous-generation client sync stack and rebuilt it: the four-state
foreground scheduler, the iOS background-task cycle, the monotonic clock, the
dirty-bit-per-write contract, the FK-layered cycle, soft-delete everywhere, the
first-sign-in bootstrapper, the manual local-wipe runbook, login-on-start, the
first-sync gate, sign-out/account-switch local wipe, the Settings sync-status
surface, the dev-gated wipe affordances, the schema-drift contract, and the
end-to-end verification suite. It exists because that body of work introduced
many non-unit tests under time pressure against repeatedly-flaky lanes; this is
the keep/drop + principles-conformance review of that whole test set.

**Scope boundary (git-established, not plan-PR-scoped).** A test is in scope iff
git shows it was *added* across the Sync v2 effort — the design wave from roughly
2026-05-25 onward, through the launch batch. The add commit of every file below
was checked with `git log --follow --diff-filter=A`. In particular the large
verification suite added 2026-05-31 ("end-to-end verification suite for the v2
client sync stack", and the follow-ups that renamed it under `sync/` and
addressed review) is in scope in full — the live-endpoint round-trip /
auth-envelope / drift suites it introduced are **not** pre-existing and are
inventoried here, not dismissed. The boundary is the *introduction* of a test by
this effort, not whether a later plan PR happened to touch it.

"Non-unit" here means the three categories below — it deliberately excludes the
pure mock/logic unit tests, which are covered by the fast `jest` lane and are
out of scope for this review. One borderline mock-driven suite
(`sync/scheduler-state-table.test.ts`) is included anyway: it is the
state-machine walk introduced by the same verification suite, so it is listed for
completeness with its nature called out honestly.

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

- **Reviewed set: 33 non-unit tests** — 5 Maestro iOS flows, 6 Supabase /
  live-endpoint (infra) suites (the three reinstall-parity launch suites plus the
  round-trip, auth-envelope, and drift suites), 11 in-memory SQLite suites,
  8 source-level guard suites (incl. one borderline mock-driven scheduler walk
  listed for completeness), 2 first-sync-gate progress component suites, and the
  dev-affordances component gate.
- **Net decision: 0 drops, 1 fix.** Every non-unit test in this set asserts a
  distinct, load-bearing behaviour; none is genuinely redundant, dead, or
  mislabeled. The launch end-to-end suites, the per-behaviour suites, and the
  source-level guards are coverage that must not be reduced. This tally now
  reflects a review of the **full** introduced set (the 9 verification-suite
  tests and the two live-endpoint round-trip/auth suites that an earlier draft
  omitted are all reviewed below), not a subset.
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

These suites exercise a **real** Postgres + PostgREST + RLS endpoint — by
signing in and running the real cycle/RPCs, or (the drift suite) by shelling out
to the drift checker that resets and reads the live schema. They are all
introduced by the Sync v2 effort and run in one of two infra lanes; **none is
pre-existing**:

- The **`npm run test:sync:infra`** lane (config in `apps/mobile/package.json`)
  runs `drift-check`, `cycle-round-trip`, and `auth-required-envelope`. The two
  live-endpoint suites read the endpoint from `SUPABASE_BRANCH_URL` /
  `SUPABASE_BRANCH_ANON_KEY` through the shared helper
  `apps/mobile/app/__tests__/sync/helpers/live-branch.ts`, which **fails hard
  when either is unset**; `drift-check` shells out to `check:sync-drift --strict`
  and needs a local Postgres/Supabase stack. None passes vacuously without infra.
- The **reinstall-parity** lane (`jest.integration.config.js`, invoked by
  `scripts/test-sync-reinstall-restore-parity.sh` /
  `npm run test:sync:reinstall-parity`) runs the three launch sign-in suites
  below; the wrapper enforces the local Supabase baseline via
  `supabase/scripts/ensure-local-runtime-baseline.sh` and injects the branch env.

All live-endpoint suites are excluded from the fast CI `jest` lane via
`jest.config.js` `testPathIgnorePatterns`. Each one that writes uses a unique
per-run id prefix and wipes the fixture user's rows first, satisfying the
shared-Supabase parallel-run contract.

| Suite | Lane | What it covers | Decision | Conformance |
|-------|------|----------------|----------|-------------|
| `app/__tests__/sync/launch-reinstall-restore.test.ts` | reinstall-parity | Same-device reinstall → login → every one of the eight syncable entity families is restored within the one-minute foreground window; the starter-catalog seeder no-ops on a non-empty pull (proven via the seed marker staying at zero). | KEEP | Conforms. Live endpoint via `live-branch.ts` (fails hard when unset); local store via the shared in-memory fixture; unique run prefix; wipes server rows per run; closes the fixture in `afterEach`. Run by the integration config. |
| `app/__tests__/sync/launch-second-device-restore.test.ts` | reinstall-parity | A fresh second device (its own store, never primed by the writer) logs into the same account and restores every family within the window; seeder no-ops. Distinct outcome from same-device reinstall (the restoring store never wrote the data). | KEEP | Conforms (same mechanism as above). **Not redundant** with the reinstall suite — it proves cross-device restore, where the restorer is a genuinely separate store. |
| `app/__tests__/sync/no-v1-server-objects.test.ts` | reinstall-parity | The retired previous-generation server RPCs and tables are absent on the real endpoint, **and** a current sync RPC still resolves — so the absence check is non-vacuous (not every call simply errors). | KEEP | Conforms. Live endpoint; behavioural (probes PostgREST), not a grep of migration text; explicit non-vacuity guard. Run by the integration config. |
| `app/__tests__/sync/cycle-round-trip.test.ts` | `test:sync:infra` | The full cycle converges local + server state over a real push → server-side LWW → pull → local LWW loop, authenticated as a real RLS-enforced user: push convergence across a four-layer FK chain, a wiped client re-pulling everything via the layered drain, a no-op re-run moving nothing, and the push-in-flight race preserved end to end. The only suite that exercises the live wire contract (request shape, RPC schema, server LWW, real cursors, RLS) — it is what caught the schema-targeting bug every stubbed cycle test missed. | KEEP | Conforms. Live endpoint via `live-branch.ts` (fails hard when unset); local store via the shared in-memory fixture; wipes the test user's server rows first. Introduced 2026-05-31 by the v2 verification suite — **in scope, not pre-existing.** (A latent FK-ordering bug in this suite is being fixed under separate work; the inventory verdict is unaffected — the coverage it provides is load-bearing and kept.) |
| `app/__tests__/sync/auth-required-envelope.test.ts` | `test:sync:infra` | An unauthenticated cycle (anon client, no JWT) is a clean no-op: the cycle recognises the server's structured `AUTH_REQUIRED` envelope, returns without throwing, leaves every dirty bit set so pending edits re-push once a session exists, and mutates no local SQLite row (row count + pull cursor unchanged). | KEEP | Conforms. Live endpoint via `live-branch.ts` (fails hard when unset); local handle is the shared in-memory fixture, server handle the anon client. Introduced 2026-05-31 by the v2 verification suite — **in scope, not pre-existing.** |
| `app/__tests__/sync/drift-check.test.ts` | `test:sync:infra` | Shells out to `check:sync-drift --strict` and asserts exit 0 — the client Drizzle schemas (the two local-only sync columns + the per-entity soft-delete column) line up with the server schema with no drift. The checker resets and materialises the server schema, so it needs a local Postgres/Supabase stack. | KEEP | Conforms. Infra-dependent (shells the drift checker against a real stack); excluded from the fast lane. Its infra-free companion — that the server-only exemption is gone from the schema-extras file — lives in `drift-exemption-removed.test.ts` (Section 3 source guards). Introduced 2026-05-31 by the v2 verification suite — **in scope, not pre-existing.** |

**Lane-split rationale (verified, conforms):** the three reinstall-parity suites
are kept OUT of `npm run test:sync:infra` on purpose — that lane's `drift-check`
runs `supabase db reset`, which drops the auth fixture mid-run and would strand
any sign-in suite sharing the process. They run instead under
`jest.integration.config.js` via the reinstall-parity wrapper. The `test:sync:infra`
lane holds the suites that tolerate (or perform) that reset: `drift-check`
itself, and the two cycle suites that authenticate per-test rather than depending
on a long-lived shared auth fixture. This is a deliberate, documented lane
separation consistent with the shared-Supabase runtime contract, not an
oversight.

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
| `app/__tests__/sync/dirty-bit-per-entity.test.ts` | Every repo write path marks the row it touches dirty in the **same transaction** as the data write — asserted once per entity table (all eight) across the canonical create / update / soft-delete path, checking `local_dirty = 1` and a positive monotonic `local_updated_at_ms`. Explicitly covers the sibling-set reorder case (both rows must dirty together or a half-applied reorder ships). Drives the real repo write paths via `bootstrapLocalDataLayer` pointed at the in-memory DB, not a stand-in. | KEEP | Conforms. Uses the shared `createInMemoryDatabase()` fixture (migration bundle, no hand-rolled DDL); closes the fixture in `afterEach`. Distinct from the composer/bridge suites — it asserts the write-side dirty contract per entity. |
| `app/__tests__/sync/now-monotonic-cross-restart.test.ts` | The monotonic clock never goes backwards, including across a simulated cold start: 100 values across 100 transactions with `Date.now()` frozen strictly increase, and after the in-memory cache is cleared (cold-start sim) the next value still exceeds the 100th — proving continuation comes from the persisted high-water mark, not the wall clock. | KEEP | Conforms. Uses the shared `createInMemoryDatabase()` fixture; restores `Date.now` and closes the fixture in `afterEach`. Guards the LWW ordering invariant the server relies on. |

### Source-level guard tests (infra-free, not DB-backed)

These run in the fast lane and assert source/structure invariants by reading or
walking the source tree (plus one mock-driven state-machine walk). They are
non-unit in style (whole-tree scans / structural single-source-of-truth guards)
but need no device DB or live endpoint; listed for completeness.

| Suite | What it covers | Decision | Conformance |
|-------|----------------|----------|-------------|
| `app/__tests__/no-v1-sync-paths.test.ts` | The previous-generation client sync **code paths** are gone: the engine/outbox source files are absent and no event-type / sequence-counter / batch-envelope identifier survives in bundled source. Includes a non-vacuity guard (scans > 50 source files) and pins the four retired **server** object names as a literal cross-reference to the infra-lane absence check. | KEEP | Conforms. Complements `sync/no-v1-server-objects.test.ts` (client bundle vs. server objects — different surfaces, not redundant). |
| `app/__tests__/soft-delete-guard.test.ts` | No disallowed hard `db.delete(<entity>)` remains across the source tree outside the exempt dev/fixture sites. | KEEP | Conforms. Source-grep guard; the documented launch outcome for soft-delete-everywhere. |
| `app/__tests__/sync/v1-deletions.test.ts` | The old sync stack is gone two ways: the deleted engine/outbox/bootstrap/runtime/profile-status source files no longer exist (the one same-path exception, `scheduler.ts`, is asserted to be the **new** four-state machine, not the old engine), and none of the old call-site symbols (event-enqueue, outbox flush, transport-state setters, backoff constants, cadence helper) survives anywhere under `src/`/`app/`. | KEEP | Conforms. Source-grep guard scoped to production roots (excludes the test tree, which names the deleted symbols as literals). Complements `no-v1-sync-paths` — different deleted-symbol set and the new-scheduler positive assertion. |
| `app/__tests__/sync/topo-order-imported.test.ts` | The FK-layer partition has a single source of truth: `TOPO_LAYERS` is declared once in `src/sync/topo-order.ts`, and the cycle + scheduler **import** it (never re-declare or inline a layer-array literal). Also pins the canonical partition to its expected four-layer shape. | KEEP | Conforms. Structural single-source-of-truth guard; reads the two consumer sources and the real exported partition. Guards silent drift the next time the FK graph changes. |
| `app/__tests__/sync/migration-wrapper-no-inlined-sql.test.ts` | The runtime migration wrapper (`src/data/migrations/index.ts`) re-exports the generated migration bundle and inlines no DDL of its own — so the SQL the app ships and the SQL the generator produces stay one and the same (the drift checker compares schemas, not the wrapper, so a hand-copied `CREATE TABLE` would otherwise drift unnoticed). | KEEP | Conforms. Pure source read; asserts the generated-bundle import is present and no DDL token (`CREATE/ALTER TABLE`) appears. |
| `app/__tests__/sync/drift-exemption-removed.test.ts` | The drift checker's server-only exemption for the soft-delete column is gone from `src/data/schema/sync-extras.json` (the key must be absent entirely, not emptied) — its removal is part of the contract now that the client declares the column. The infra-free half of the drift coverage; the full `--strict` checker run lives in `drift-check.test.ts` (Section 2). | KEEP | Conforms. Pure file read, fast lane; non-vacuous (asserts the exemption key is undefined, not merely empty). |
| `app/__tests__/sync/manual-wipe-doc-exists.test.ts` | The one-time local-DB wipe is a documented human runbook, not in-app auto-wipe code: the runbook `docs/manual-wipe-v1-to-v2.md` exists and covers each platform (iOS Simulator, Android Emulator, physical device, TestFlight as Markdown headings), and no `*boot-marker*` / `*version-marker*` module was re-introduced under `src/data` (which would mean the manual procedure had been silently turned into code). | KEEP | Conforms. Doc-existence + source-absence guard; matches platform headings as real Markdown headings so a buried prose mention does not satisfy it. |
| `app/__tests__/sync/scheduler-state-table.test.ts` | The foreground scheduler as a four-state machine (OFFLINE / LONG_TIMEOUT / SHORT_TIMEOUT / RUNNING) walked cell-by-cell across both transition tables: the external-input table (4 states × 3 inputs = 12 cells) and the internal-event table (4 states × 2 events = 8 cells), plus the guard that the network-reachability projection is the sole online/offline authority. | KEEP | **Borderline — listed for completeness, not strictly non-unit.** It is mock-driven (stubs `runSyncCycle`, NetInfo, AppState; fake timers) rather than DB-/endpoint-backed, so by the strict definition it is a logic suite. Included because the reviewer asked for the full introduced set and because the exhaustive state-table walk is load-bearing scheduler coverage. Teardown restores real timers in `afterEach` (hang-safe). |

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

### Component gate test: dev-affordances visibility

| Suite | What it covers | Decision | Conformance |
|-------|----------------|----------|-------------|
| `app/__tests__/sync/dev-affordances-gate.test.tsx` | The developer-only wipe affordances (wipe-local, wipe-remote-for-me) on the Settings screen are gated on the **cross-build dev signal**, not the bare metro-only `__DEV__` global: with the dev signal false the screen renders neither button (nor the dev-tools card), with it true both render, and a source scan asserts the Settings + wipe-helper sources use no bare `__DEV__` token as a runtime guard. | KEEP | Conforms. Renders via `@testing-library/react-native` with the screen's collaborators (router, auth, sync-status panel, data/wipe helpers) stubbed so the suite stays focused on the gate; the `__DEV__`-token check is a source read. Guards the affordance from disappearing on the internally-distributed developer build (where `__DEV__` is false) — exactly the regression the dev-mode helper exists to prevent. |

## Cross-cutting conformance verdict

This verdict is re-stated against the **full** introduced set above (all six
live-endpoint/infra suites, all eleven in-memory suites, all five source guards,
the dev-affordances component gate, and the five Maestro flows) — not the subset
an earlier draft reviewed.

- **In-memory SQLite shared fixture:** every in-memory test introduced by the
  effort — including the two added in this review pass,
  `sync/dirty-bit-per-entity.test.ts` and `sync/now-monotonic-cross-restart.test.ts`,
  and the in-memory halves of the live-endpoint suites — uses
  `createInMemoryDatabase()` with zero hand-rolled DDL. The sole hand-rolled-DDL
  test in the tree is the pre-existing, documented negative-space exception, not
  introduced by this effort.
- **iOS lane configuration contract:** no Maestro flow hand-edits `.env.local`;
  lane config is pinned by the runner scripts. Infra-free flows use the harness
  teleport; the Supabase-configured flows sign in against a provisioned local
  Supabase.
- **Maestro contract ownership:** after this review every flow this effort
  introduced is owned by a runner lane (the one orphan was wired in).
- **Shared-Supabase runtime contract:** the live-endpoint suites
  (`cycle-round-trip`, `auth-required-envelope`, and the three reinstall-parity
  sign-in suites) fail hard when the branch env is unset, use unique per-run ids,
  wipe per run, and are split across `test:sync:infra` vs. the reinstall-parity
  lane so the drift-reset suite never strands a long-lived sign-in fixture.
- **Two-lane local-data policy:** fast `jest` (infra-free) excludes the
  live-endpoint and drift suites via `testPathIgnorePatterns`; those run in the
  `test:sync:infra` / branch-provisioned integration lanes. All in-memory and
  source-guard suites run in the fast lane.
- **Completeness:** every non-unit test git shows the Sync v2 effort *added*
  (`git log --follow --diff-filter=A`) is inventoried above with a description +
  KEEP/DROP + conformance row. No in-scope suite is dismissed as "pre-existing"
  on a claim git contradicts. Final tally: **0 drops, 1 fix** (the orphaned
  Maestro flow) — a conservative judgment over the complete set.
