# tFINAL: launch end-to-end verification

**Type:** build

**Problem:** Verify the launch contract end-to-end. This card is the contract
with the human: its tests must fail if any launch outcome is missed. It asserts
this plan's own outcomes AND the five cross-cutting outcomes from the design
wave's plan (`docs/plans/sync-v2/plan.md` `## Outcomes`) 1:1.

**Inputs:**
- All other tasks merged (t1–t10, including any t7 split). The coordinator
  enforces this via the DAG.
- The launch contract to assert verbatim — the five cross-cutting outcomes from
  `docs/plans/sync-v2/plan.md` `## Outcomes`:
  1. Reinstall on the same device → login → all exercises/sessions/sets/gyms/tags
     restored within one minute of foreground.
  2. Login on a fresh second device with remote data present → same restore
     within the window.
  3. All v1 sync code paths and v1 server objects are gone (cross-checked
     against plans 1 + 2).
  4. Drift checker passes on the integration branch.
  5. Wipe-local and wipe-remote-for-me work behind the `isDevMode()` gate.
  Plus this plan's own `## Outcomes` (login gate, sync gate, bootstrapper-after-
  cycle, slug rename, bundle-migration loop, muscle-group idempotency, soft-
  delete everywhere, sign-out local wipe, Settings sync-status surface).
- Test-lane conventions (as-built; follow exactly):
  - Live round-trip / two-device restore / reinstall-parity go in the INFRA lane
    (branch-provisioned, excluded from CI's fast `npm test`): `npm run
    test:sync:infra` and `npm run test:sync:reinstall-parity`. Infra tests live
    at `apps/mobile/app/__tests__/sync/` and fail hard when
    `SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY` are unset.
  - Maestro flows run via `npm run test:e2e:ios:gates` (combined smoke +
    data-smoke runner). Flows live under `apps/mobile/.maestro/flows/`.
  - Fast infra-free assertions run in `./scripts/quality-fast.sh frontend` /
    `npm test`.
  - Drift: `npm run check:sync-drift -- --strict` (only meaningful if an entity
    Drizzle schema changed — unlikely here; still assert it passes).

**Outcomes:**
- Outcome 1 (reinstall same-device restore ≤ 1 min): an infra-lane test
  (`test:sync:reinstall-parity` / a round-trip test under
  `app/__tests__/sync/`) asserts that after a local wipe + re-bootstrap on a
  populated server, all exercises/sessions/sets/gyms/tags restore within the
  window.
- Outcome 2 (fresh second device restore ≤ 1 min): an infra-lane test asserts a
  second client bootstrapping against the same remote account restores the same
  entities within the window.
- Outcome 3 (no v1 paths/objects): an automated check (grep/guard test +/-
  server-object check) asserts the v1 sync code paths
  (`engine.ts`/`outbox.ts`/v1 event types/sequence counters/batch envelopes) and
  v1 server objects (`sync_apply_projection_event`, `sync_events_ingest`,
  `sync_device_ingest_state`, `sync_ingested_events`) are absent — cross-checked
  against plans 1 + 2.
- Outcome 4 (drift passes): the drift checker passes on the integration branch.
- Outcome 5 (dev-gated wipes): a test asserts both wipe affordances are gated by
  `isDevMode()` and perform their wipe (mirrors / consumes t10).
- This plan's surface outcomes are each asserted by a Jest unit/integration test
  and/or a Maestro flow:
  - Login gate: launch-with-no-session lands on sign-in, renders no data screen
    (Maestro + Jest).
  - Sync gate: fresh install → sign-in → block visible → dismisses after the
    first cycle within 1 min of foreground (Maestro).
  - Bootstrapper-after-cycle, slug rename, bundle-migration loop, muscle-group
    idempotency, soft-delete everywhere, sign-out local wipe, Settings
    sync-status surface — each asserted by a test (Jest where infra-free, infra
    lane / Maestro where it needs the device or server).
- Every assertion maps to exactly one launch outcome (1:1 or a coherent group),
  so the audit can verify coverage. A failing test surfaces a real outcome miss.
- All non-infra tests run in `./scripts/quality-fast.sh frontend`; infra tests
  run in `test:sync:infra` / `test:sync:reinstall-parity`; Maestro flows in
  `test:e2e:ios:gates`.

**Output artifact:**
- Infra-lane tests under `apps/mobile/app/__tests__/sync/` (e.g.
  `launch-reinstall-restore.test.ts`, `launch-second-device-restore.test.ts`)
  added to the `test:sync:infra` runner list in `apps/mobile/package.json`, plus
  `apps/mobile/scripts/test-sync-reinstall-restore-parity.sh` coverage.
- A v1-removal guard test (e.g.
  `apps/mobile/app/__tests__/no-v1-sync-paths.test.ts`) and a server-object
  absence check.
- Maestro flows under `apps/mobile/.maestro/flows/` for the login gate, the
  sync gate, and (dev build) the wipe affordances, wired into
  `test:e2e:ios:gates`.
- Jest specs under `apps/mobile/app/__tests__/` covering the infra-free surface
  outcomes.
- Each test file lists, in a comment or test name, which launch outcome it
  asserts (self-contained — no plan/card/design id references).

**Out of scope:**
- Bundling unrelated test improvements.
- Tests that exercise individual task internals already covered on their own
  cards (this card asserts the plan-level outcomes end-to-end, not unit-level
  internals).
- Adding new product behaviour — verification only.
