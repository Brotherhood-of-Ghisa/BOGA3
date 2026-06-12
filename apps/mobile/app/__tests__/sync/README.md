# Sync test directory — coverage policy

> Colocated per `AGENTS.md`: editing tests here ⇒ read this first. Strategy and
> the entry-point catalog stay in `docs/specs/06-testing-strategy.md`; gates in
> `docs/specs/02-quality-and-test-gates.md`. The infra-dependent suites in this
> directory run via `./boga test sync-infra` (never defer — it uses THIS
> worktree's local Supabase).

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

