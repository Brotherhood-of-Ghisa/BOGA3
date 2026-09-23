# Testing Strategy (Deep Companion)

> **Owns:** testing strategy, the per-entry-point catalog (purpose/infra/when), cross-cutting test policies. **Not here:** gate ladder + lane matrix → `02`; Maestro runtime contract → `11`; per-feature coverage policies → the README of the test directory they govern. **Load when:** adding or changing a test lane, or doing deep test-strategy work.

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
| `npm run lint:ui-guardrails` | Design-token guardrail (`scripts/check-ui-guardrails.js`) over `apps/mobile/app/**` and `components/**`. Blocks raw color literals (hex / `rgb(a)`) outright; holds raw `fontSize` / spacing / `borderRadius` counts to the budgets in `scripts/ui-guardrails.config.js`, which fail both over AND under so they can only fall (`--update-budgets` lowers them; `--verbose` lists violations). Separate from ESLint — it is the `ui-guardrails` lane of the fast gate and a CI step, not part of `npm run lint`. | none | Any `apps/mobile/app/**` or `apps/mobile/components/**` change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm run typecheck` | Regenerates router types (`router:types`) then `tsc --noEmit`. | none | Any `apps/mobile/**` TS change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm test` | Full Jest unit/integration suite. Bare `jest` — deliberately **no `--forceExit`** (see *Unit-test hang safety*). Excludes infra-dependent sync tests (they live behind `test:sync:infra`). | none | Any `apps/mobile/**` change. Part of the fast gate (`./boga test fast`) and CI. |
| `npm run test:sync` | `jest app/__tests__/sync` — the sync-focused subset (still infra-free; the infra-dependent files in that dir fail fast without an endpoint and are normally run via `test:sync:infra`). | none | Targeted feedback while editing mobile sync code under `apps/mobile/app/__tests__/sync/**` or the sync runtime it covers. |
| `npm run test:sync:infra` | Runs the four **infra-dependent** sync tests by path: `drift-check.test.ts` (shells out to `check:sync-drift --strict`), `cycle-round-trip.test.ts` (real push→server-LWW→pull→local-LWW round trip, incl. a wiped-client reinstall re-pull), `cycle-multidevice-lww.test.ts` (two local DBs sharing one server: end-to-end LWW collisions, multi-device convergence, future-clock-clamp reconciliation), and `auth-required-envelope.test.ts` (unauthenticated cycle is a clean no-op). | local Supabase + Docker. Reads `SYNC_TEST_SUPABASE_URL` / `SYNC_TEST_SUPABASE_ANON_KEY` — these normally point at **this worktree's own local stack** (`API_URL`/`ANON_KEY` from `supabase status -o env`); it is **runnable locally, not a deferred/remote lane**. | Changes to the mobile sync cycle, client Drizzle schemas, the migration bundle, or the wire contract under `apps/mobile/src/**` sync code and `apps/mobile/app/__tests__/sync/**`. |
| `npm run test:handles` | Open-handle guard: `jest --detectOpenHandles --silent`, serial. Surfaces any leaked handle (unclosed connection, lingering timer, real Supabase transport) with a stack after tests pass. Can be scoped (e.g. `-- sync-cycle`). | none | Any change that touches timers, connections, async teardown, or test fixtures. Part of CI; **not** in any gate aggregate — run `./boga test handles` before opening a PR. |
| `npm run db:generate` | `drizzle-kit generate` + `tsx scripts/bundle-migrations.ts`: regenerates `drizzle/*.sql` AND the committed runtime bundle `drizzle/migrations.generated.ts`. Idempotent. | none | Any schema change under `apps/mobile/src/data/**` / `apps/mobile/drizzle/**`. Run it and commit the regenerated artifacts. |
| `npm run db:generate:canary` | Alias of `db:generate`. Intended as a migration-artifact drift canary: re-run it and confirm a clean working tree (no uncommitted diff) to prove the generated SQL/bundle match the schema. NOT wired into any gate or CI. | none | Same triggers as `db:generate`; use when you want to *verify* (rather than write) that the bundle is current. |
| `npm run check:sync-drift` | `tsx scripts/check-sync-schema-drift.ts`: resets local Postgres, introspects server schema vs the client Drizzle schemas, and asserts no client/server drift (universal index, triggers, permissive/restrictive RLS policy inventory + body hashes, soft-delete + sync columns, topo FK order). `--strict` promotes warn-only (exit 2) to failure. | local Supabase + Docker (it drives a DB reset). | Changes to `apps/mobile/src/data/**` schemas, `supabase/migrations/**`, or sync columns/RLS. Run with `--strict` as the `sync-drift` lane of `boga test backend`; also exercised by `test:sync:infra`. |
| `npm run test:e2e:ios:smoke` | `scripts/maestro-run-lane.sh smoke` → runs `smoke-launch.yaml` with a `full` reset. Cold-launch + navigation smoke on the freshly-installed dev client (infra-free config). Captures `01-app-launch`, `02-session-recorder-visible`. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | UI/runtime changes that need fresh real-simulator smoke evidence (see *iOS UI smoke policy*). Part of `boga test frontend`. |
| `npm run test:e2e:ios:data-smoke` | `scripts/maestro-run-lane.sh data-smoke` → runs `data-runtime-smoke.yaml` with a `data` reset. Validates real `expo-sqlite` migration + smoke write/read, backend-less starter-catalog seeding, post-submit traversal through the completion presentation's Done action, and the recorder-write → Stats-exercise-list read-back (the only on-device check of that path: `stats-screen-ux` asserts the same list from fixture rows inserted straight into SQLite, which bypass the recorder). Captures `03-data-runtime-smoke-start`, `04-data-runtime-smoke-success`, `05-data-runtime-smoke-exercise-list`. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | See *iOS simulator data smoke policy* (bootstrap/migrations/drizzle/native-runtime changes). Part of `boga test frontend`. |
| `npm run test:e2e:ios:gates` | `scripts/maestro-ios-gates.sh` — convenience: runs smoke + data-runtime-smoke against **one** provisioned sim + Metro (pays the ~55-60s boot/warm overhead once). Reset semantics preserved (provision `full`; data-smoke self-resets in-flow). | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | When you want both infra-free iOS gates faster; the per-flow lanes above remain the canonical individual lanes. |
| `npm run test:e2e:ios:ui-regression` | `scripts/maestro-run-lane.sh ui-regression` (lane `ios-ui-regression`) — the **infra-free UI regression lane**: `stats-screen-ux` (empty state, exercise table + local sorting, 7→30-day rescale, muscle breakdown, and both history overlays with their metric inventories and Daily/Weekly switching), `session-completion-states-fixture` (one-PR, no-PR catalog-error, unmapped, safe-exit completion, and the completed edit through the session view: the completed session's `Edit`, a set changed on the exercise page, an invalid then valid Start with the autosave-paused notice, `Done`, and the read-back), `exercise-block-history-fixture` (the current-session insights golden path: live mapped load, PR appearance/reversal, simultaneous multi-PR completion, session/working-set and exercise-volume summaries, image share preview plus retryable native-sheet launch/cancellation, the consolidated muscle-set breakdown, and Done), and `settings-dev-wipe-local` (the developer wipe-local affordance: the card renders on a dev build, the wipe succeeds, and the app re-bootstraps to a usable data screen), and `settings-new-screens-toggle` (the new exercise/session screens preference: harness `newScreens=off` shows Off in Settings, the Off/On row flips it, and `reset=data` restores the default, On). All five reset their own data in-flow through the maestro-harness deep link, so they share **one** provisioned sim + Metro via `maestro-ios-run-flows.sh` with a `data` reset. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | UI/screen changes under `apps/mobile/app/**` or `components/**`; the session-insights, completion-presentation, Stats, or Settings surfaces. Part of `boga test frontend`. |
| `npm run test:e2e:ios:exercise-page` | `scripts/maestro-run-lane.sh exercise-page` (lane `ios-exercise-page`) — the exercise page (redesign step 4) on its own `exercise-page` harness fixture, with the new-screens setting at its default (On): the accepted target's states (`V5-Quiet`, `V5-Records`, `V5-Last`, `V5-Effort`, `V5-Menu`, each captured), logging the current set with a changed effort and reps, `+ Add set`, Complete's discard warning (Cancel, then Complete), and a re-open proving the discarded planned sets are kept as not performed. Self-resets in-flow with `reset=data`, `data` reset. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | Changes to the exercise page (`app/session/**`, `components/exercise-page/**`, `src/session-recorder/**`) or the design-language primitives it composes. Part of `boga test frontend`. |
| `npm run test:e2e:ios:session-view` | `scripts/maestro-run-lane.sh session-view` (lane `ios-session-view`) — the **session view** (exercise/session redesign step 5), the default since step 6a: `session-view` (with the setting at its default, Train's Resume opens the session view; the summary card and one read-only card per exercise with its done count and 1RM record band; a card links to the exercise page; the ⋮ menu sheet; picking a gym from the Gym stat's sheet; `+ Add exercise` through the recorder's picker; Finish through one combined cleanup prompt for the empty set and exercises to the completion screen) and `session-view-abandon` (⋮ → Abandon session → confirmation → back on Train with no active session). Both seed with `?reset=data&fixture=session-view` (the setting at its default) and share one sim + Metro with a `data` reset. | iOS simulator + Metro + Maestro dev-client. **No** Supabase. | Changes to the session view (`app/session/**`, `components/session-view/**`), the shared picker/session model, or the active-session entries. Part of `boga test frontend`. |
| `npm run test:e2e:ios:auth-profile` | `scripts/maestro-run-lane.sh auth-profile` — a Supabase-configured iOS lane. Runs one flow with a `full` reset: `auth-profile-happy-path`. Validates login-on-start enforcement (cold launch → sign-in gate; sign-out → back to gate), opens the signed-in Connected agents screen through its real Supabase grant-list path, and exercises the fixture-backed profile / username-update / sign-out happy path. Captures `05-…-gate-start`, `06-…-signed-in`, `07-…-signed-out-end`. The first-sync gate surfaces (pinned in-progress block + dismissal) are covered by jest `sync-gate-screen.test.tsx`; the real-cycle gate lift and the settings sync-status surface are proven on-device by the sync-e2e round-trip. | iOS simulator + Metro + Maestro dev-client **and** local Supabase + Docker (ensures baseline, exports `EXPO_PUBLIC_SUPABASE_*` from the running stack, signs in as `user_a` — its own fixture, per the one-user-per-flow rule). | See *iOS simulator auth/profile happy-path policy* (profile/Connected-agents route UI/state, auth bootstrap/session restore, local-Supabase auth wiring). Part of `boga test frontend`. |
| `npm run test:e2e:ios:sync` | `scripts/maestro-run-lane.sh sync-e2e` — the **UI↔server sync e2e lane** (a category of its own: real recorder UI + real sync cycle + real local Supabase). Runs `sync-first-run-log-and-roundtrip.yaml` as the dedicated `user_b` fixture (its own fixture, per the one-user-per-flow rule) with a `full` reset: (A) new-user sign-in → real bootstrap cycle lifts the first-sync gate, (B) one workout logged through the recorder UI and completed through the mandatory completion presentation's Done action, (C) forced sync drains "Pending changes" to 0 (run-specific upload proof) and the settings sync-status surface renders, (D) full device wipe + re-sign-in restores the workout from the remote DB. Exists because `test:sync:infra` (emulated storage, no UI) cannot catch UI-gating / NetInfo / session-handoff / trigger-wiring bugs — the classes that shipped during sync v2. Captures screenshots `16`–`20`. | iOS simulator + Metro + Maestro dev-client **and** local Supabase + Docker. | Any change under `apps/mobile/src/sync/**`, the scheduler, auth session wiring, or the sync RPCs. Part of `boga test frontend` (runs last). |
| `npm run test:e2e:ios:groups` | `scripts/maestro-run-lane.sh groups-e2e` (lane `ios-groups-e2e`) — the **two-user groups e2e lane** (a test layer of its own: two real accounts against one real local Supabase). Runs `groups-two-user-stream.yaml` with a `full` reset as device user `user_c`; the counterparty `user_d` is scripted over HTTP from `.maestro/scripts/groups-counterparty.js` (`runScript`: GoTrue sign-in, `group_join`, `sync_push`, `group_stream`). Covers the username prompt, create, invite code, join → "joined", a live "Training now" card with its metrics, completion + a later edit on the same card (duration, updated device-computed metrics), the read-only friend view, the M25 group exercises page (4b), leaderboards and the row detail (7b), a record card certified on the device with the Certified podium, boards, and history (7c, M25-T11), removal → "was removed", the former member's certified row (8b), and the removed member's `NOT_FOUND`. Captures `groups-01`…`groups-09` and logs the `sync_push` → card-visible, board, record, and certify latencies. Then runs `groups-link-exercise.yaml` (M25-T07) as device user `user_e`, whose own group and group exercise are created over HTTP by `.maestro/scripts/groups-link-setup.js`: links from the catalogue `⋮` Link screen, finds the group exercise in recorder picker search as "linked: …", and adds it (`groups-link-01`…`04`). | iOS simulator + Metro + Maestro dev-client **and** local Supabase + Docker; `supabase/scripts/groups-fixture-reset.sh` (service role) resets all three fixtures first. | Group client, group routes, group migrations (`scripts/triggers.tsv`), or the lane's fixtures/scripts. Part of `boga test frontend` (runs last). See *Two-user groups e2e policy*. |

## Repo-root quality wrappers (`scripts/`, run from repo root)

Gate aggregates are defined by the `gate` column of `scripts/lanes.tsv` and run
via `./boga test <gate>`; row order in the registry is execution order. The
legacy `./scripts/quality-fast.sh` / `./scripts/quality-slow.sh` forward here.

| Gate | Expands to (registry order) | Infrastructure | When to run |
|---|---|---|---|
| `./boga test fast` | `lint` + `typecheck` + `jest-full` + `docs-check` + `meta-tests` + `agent-auth-web` + `mcp-unit` + `backend-fast` | mobile/repository/consent/MCP lanes none; backend-fast local Supabase + Docker | Default local closeout fast gate. (`fast-frontend`, `fast-repo`, and `fast-backend` run the parts.) |
| `./boga test frontend` | `ios-smoke` + `ios-data-smoke` + `ios-ui-regression` + `ios-exercise-page` + `ios-session-view` + `ios-auth-profile` + `ios-sync-e2e` + `ios-groups-e2e` | iOS simulator + Metro + Maestro dev-client; auth-profile, sync-e2e, and groups-e2e additionally need local Supabase + Docker | Risk-triggered: UI/runtime/auth-profile/sync changes needing real-simulator evidence. |
| `./boga test backend` | `auth-authz` → `groups-contract` → `groups-leaderboards` → `agent-api` → `sync-v2-schema` → `sync-push-contract` → `sync-pull-contract` → `dev-wipe-my-data` → `sync-drift` → `sync-v2-e2e` → `sync-infra` → `mcp-smoke` | local Supabase + Docker (`run-suite.sh` ensures `ensure-local-runtime-baseline.sh`; the smoke also starts the local MCP process) | Risk-triggered backend work: `supabase/migrations/**`, `supabase/functions/**`, auth config/policies, sync RPC contracts/fixtures, or the MCP-to-API boundary. |

> The slow gate runs are not always mandatory. "When to run" is governed by the
> codebase areas/paths in the policies below; the always-load quickref
> (`02-quality-and-test-gates.md`) states what is mandatory.

## Repo meta lanes (`./boga test <lane>`, repo root, infra-free)

| Lane | Purpose | When to run |
|---|---|---|
| `docs-check` | `gen-docs.sh check`: generated doc blocks current (lane matrix; median column exempt from staleness), lane-name citations valid, relative `.md` links resolve, spec ownership headers present. | Any docs/registry/CI-definition change. Part of `boga test fast` and CI. |
| `meta-tests` | `scripts/tests/run-meta-tests.sh`: fixture-based self-tests for `gen-docs.sh`, `test-for.sh` (trigger matcher), `pr-check.sh` (PR Tests-table checker), the Android launchers (SDK discovery, evaluated Metro ports, matching local API reverse, argument forwarding and failure paths with stub adb/Expo), and the iOS simulator boot-wait (`ios-sim-boot.sh` fails within its deadline with a diagnosis, killing the blocked `simctl bootstatus`, with stub xcrun). | Any change to the meta-tooling under `scripts/`, or to `apps/mobile/scripts/ios-sim-boot.sh`. Part of `boga test fast` and CI. |
| `agent-auth-web` | `scripts/test-agent-auth-web.sh`: clean locked install, production-dependency audit, consent authorization-state tests, typecheck, and Vite production build. | Any `apps/agent-auth-web/**` change. Part of `boga test fast` and CI. |
| `mcp-unit` | `scripts/test-boga-mcp.sh`: clean locked install, production-dependency audit, typecheck, MCP discovery/tool translation/security-contract tests, and production build. | Any `services/boga-mcp/**` change. Part of `boga test fast` and CI. |

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
| `groups-contract` | `tests/groups-contract.sh` | The M22 group domain (`docs/specs/tech/groups-contract.md` §8). Record half: the share rule across join/leave/rejoin and offline-late sessions, `group_stream` (All dedupe, per-group scope, membership items) and `group_session_detail` (every live set as raw synced text, no GPS), edit/tombstone/undelete flow-through, and share-trigger failure isolation (`sync_push` stays `ok`). Membership half: catalog ground rules (RLS on, no policies or direct grants, no `owner_user_id`, no Sync v2 FK), every RPC success path and error token, the owner/admin/member role matrix, leave/rejoin periods, removal, transfer, invite normalization/regeneration, non-member ≡ nonexistent `NOT_FOUND`, `AUTH_REQUIRED` (anon) and `AGENT_FORBIDDEN` (`client_id` token) on every RPC, and direct PostgREST denial on every group table. Hermetic: provisions and deletes its own per-run users. | local Supabase + Docker | Any group-domain migration/RPC change under `supabase/**`. Part of `boga test backend`. |
| `groups-leaderboards` | `tests/groups-leaderboards.sh`, then `tests/groups-boards.sh`, then `tests/groups-certification.sh` (helpers shared with `groups-contract` via `tests/lib/groups-fixtures.sh`) | **`groups-boards.sh` (M25-T05, §2.11, §4.5):** every row of the design's board change table (records and lead changes, voids on edit / unperformed / delete, edit up, session delete and undelete, link / unlink / retarget with no record cards, Certified boards empty, load-mode rescale, leave, archive and unarchive catch-up, silent rules recompute); the provisional rule for active sessions; D6 conversion; P7 ties; rejoin catch-up; the per-group advisory lock (a blocked apply times out); apply failure isolation; the three board reads' shapes, paging, and error tokens; and `group_stream`'s record / void / link items across every page. **`groups-certification.sh` (M25-T06, §2.12, §4.6):** every certify / withdraw / cancel rejection (auth, agent, non-member, removed, self, archived, non-record set, former lifter, `CONFLICT`); certify (idempotent), withdraw, admin cancel, re-certify after cancel; evaluator voids on edit (completed and active) and on set and session delete with no revival; unlink, load mode, and rules recompute void nothing; Certified entries, `lead_change{certification}`, and `certified` on BoardRow, podium, stream, and history; frozen-board cancel; enqueue failure isolation and repair. **`groups-leaderboards.sh`:** the M25 group evaluator pipeline (`docs/specs/tech/groups-contract.md` §2.8–§2.10, §8), kept apart from `groups-contract` so the async path fails on its own. **Direct-drain mode:** the run unsets the pg_net kick URL and POSTs to the `group-eval` Edge Function itself, so every assertion is deterministic; only the sweep and pg_net smoke sections turn the kick on. Proves:<br>• queue/facts posture, service-role-only evaluator RPCs, and the secret's 401;<br>• facts through real `sync_push` (performed rule, parsing, per-side entered mode, e1RM, live/fingerprint through edits, tombstones, undeletes, and a hard delete);<br>• target resolution and every inert-link case (non-uuid, unknown, foreign, archived, member left) plus unarchive, load mode, retarget, and unlink;<br>• coalescing, the claim generation guard, lease expiry, and the rules requeue;<br>• forced enqueue, kick, and evaluator failures that never break `sync_push`;<br>• the pg_cron sweep and one kick per push.<br>Hermetic: per-run users; restores the kick URL, sweep job, and probe constraints. | local Supabase + Docker (Edge Runtime, pg_net, pg_cron) | Evaluator migration, `supabase/functions/group-eval/**`, or the TS it loads (`src/groups/set-facts.ts`, `src/exercise-calculations/**`, `src/session-recorder/set-semantics.ts`). Part of `boga test backend`. |
| `agent-api` | `tests/agent-api-contract.sh` | Real Supabase OAuth dynamic registration + authorization code/PKCE + consent and dedicated API proof: owner-only reads, cross-owner/nonexistent 404 equivalence, profile privacy, canonical calculations, limits/cursors, invalid/expired/revoked 401, direct RLS/write and `sync_push` denial, and metadata-only audit. | local Supabase + Docker | Agent auth/RLS migration, OAuth config, or `supabase/functions/agent-api/**`. Part of `boga test backend`. |
| `sync-v2-schema` | `tests/sync-v2-schema-smoke.sh` | Sync-v2 clean-room schema shape (the columns/indexes/triggers/RLS the migration ships). | local Supabase + Docker | `supabase/migrations/**` sync-v2 schema changes. Part of `boga test backend`. |
| `sync-push-contract` | `tests/sync-push-contract.sh` | `sync_push` RPC contract: LWW, clamp, undelete, envelope, batch caps, FK closure, auth/RLS. | local Supabase + Docker | `sync_push` RPC / sync push contract changes under `supabase/**`. Part of `boga test backend`. |
| `sync-pull-contract` | `tests/sync-pull-contract.sh` | `sync_pull` RPC contract: per-layer cursor protocol — snapshot pull, paginated drain, layer→type partition, RLS isolation, tombstones, empty-page echo, same-ms tiebreak, limit/layer bounds, AUTH_REQUIRED. | local Supabase + Docker | `sync_pull` RPC / pull contract changes under `supabase/**`. Part of `boga test backend`. |
| `dev-wipe-my-data` | `tests/dev-wipe-my-data-contract.sh` | Developer-only `dev_wipe_my_data` RPC: auth guard, non-production environment guard, owner-scoped deletion (caller's rows removed, second user's rows survive). | local Supabase + Docker | Changes to the `dev_wipe_my_data` RPC or its guards. Part of `boga test backend`. |
| `sync-v2-e2e` (`test-sync-v2-e2e.sh`) | `tests/sync-v2-*.sh` group | Integration-level plan-outcome assertions across the as-built stack: `sync-v2-clean-room.sh`, `-deferrable-fk.sh`, `-rls-cross-owner.sh`, `-push-roundtrip.sh`, `-pull-drain.sh`, `-pull-fk-closure.sh`, `-drift-synthetic.sh`, `-drift-asbuilt.sh`, `-spec-rule.sh`. Includes the independent push→pull parity assertions across all data-scope entities (incl. soft-delete tombstone visibility). | local Supabase + Docker | Any cross-cutting sync-v2 backend change; milestone/release closeout for sync. Part of `boga test backend` (runs after the per-task wrappers, before `test-sync-infra.sh`). |
| `sync-infra` (`test-sync-infra.sh`) | `apps/mobile` jest `test:sync:infra` (`drift-check` + `cycle-round-trip` + `cycle-multidevice-lww` + `auth-required-envelope`) | Mobile **cross-stack** sync proof: drives the real `runSyncCycle` against THIS worktree's slot-isolated local Supabase. Ensures the baseline, reads `API_URL`/`ANON_KEY`, exports them as `SYNC_TEST_SUPABASE_URL`/`ANON_KEY`, then runs the lane — zero manual env setup. The one lane whose test body is frontend but whose infra is backend. | local Supabase + Docker | Mobile sync cycle / client Drizzle schema / migration bundle / wire-contract changes. Part of `boga test backend` (**runs last**); also runnable standalone (`npm run test:sync:infra` with the env exported). |
| `mcp-smoke` | `scripts/smoke-boga-mcp.sh` | Real protocol-to-data proof: provisions an owned workout, obtains a Supabase OAuth token through PKCE consent, starts the MCP service, discovers and calls exactly four tools, checks returned fixture IDs/account-data exclusion, and cleans grant/data/audit artifacts. | local Supabase + Docker plus a local Node process | Any MCP server, agent API, OAuth consent helper, or boundary change. Part of `boga test backend`; also required by the MCP path trigger. |
| `ensure-local-runtime-baseline.sh` | — | Shared runtime preflight (not a test): lock + conditional bootstrap/reset + deterministic fixture enforcement. If runtime is down: start + reset/seed + provision auth fixtures. If up: reuse as-is (no reset), refresh stale Edge Function routing when needed, apply pending migrations, verify baseline rows, and re-provision auth fixtures idempotently. | local Supabase + Docker | Invoked automatically by every real-instance wrapper above and by `test:e2e:ios:auth-profile`. Run it directly before any real-instance slow test. |

Supporting (non-test) backend scripts: `local-runtime-up.sh` (start stack + Edge
Function serving), `reset-local.sh` (migrate/bootstrap + deterministic seed),
`db-lint-local.sh` (fast schema lint), `smoke-health.sh` (health endpoint smoke),
`smoke-seed.sh` (fixture baseline smoke via REST), `auth-provision-*.sh` (fixture
identities), `auth-fixture-constants.sh` (fixture credentials).

## Maestro iOS helper scripts (`apps/mobile/scripts/`)

The `test:e2e:ios:*` lane npm scripts above are thin wrappers over these. The
shared runtime plumbing — `maestro-ios-run-flow.sh` (one flow, own sim + Metro),
`maestro-ios-run-flows.sh` (several flows, ONE shared sim + Metro),
`maestro-ios-runtime.sh`,
`maestro-ios-provision.sh`, `maestro-ios-launch.sh`, `maestro-ios-teardown.sh`,
`maestro-env.sh`, `ios-sim-boot.sh` — provisions/launches/tears down the sim +
Metro and is owned operationally by
`docs/specs/11-maestro-runtime-and-testing-conventions.md`. One-time setup:
`maestro-ios-dev-client-build.sh` builds the dev-client `.app` (per worktree).

**Every committed flow belongs to a lane.** A flow that no lane runs is covered
by no gate and no CI, so nothing tells you when it stops matching the app: it
silently rots and is then discovered broken at the moment someone needs it. That
is not hypothetical — of the six unlaned flows this repo accumulated, four were
already failing when they were finally run: stale prose assertions, chip ids that
no longer exist, heatmap cells pinned to calendar dates months in the past, and
one that could no longer reach the screen it tested. They were either wired into
`ios-ui-regression` or deleted. So: a new flow either earns a lane in
`scripts/lanes.tsv` or it does not get committed — run it ad hoc from a branch
instead (`maestro-ios-run-flow.sh --flow …`, see `RUNBOOK.md`) and delete it.
`scripts/tests/maestro-flow-lanes.test.sh` enforces this in the `meta-tests`
lane: it fails if any `apps/mobile/.maestro/flows/*.yaml` is named by no
runner.

Three rules follow, and each is load-bearing for a lane flow:

1. **Assert, don't only screenshot.** A flow whose steps are `takeScreenshot`
   with `optional: true` taps between them goes green while the screen behind it
   breaks. Screenshots are evidence *for a human*; the lane's verdict must come
   from `assertVisible` / `assertNotVisible` on real ids.
2. **No hard-coded calendar dates.** The heatmap cell ids are
   `<prefix>-heatmap-cell-<weekStartDateKey>`, and the
   `exercise-block-history` fixture seeds sessions relative to *now*
   (`daysAgo`), so a literal date in a flow is a time bomb. Assert the
   date-independent surface instead (see the week-banner note in
   `stats-screen-ux.yaml`).
3. **Every scroll whose next step taps or asserts the SAME element carries
   `centerElement: true`.** That is the flag
   that does the work: it forces the scroll to keep going until the target is
   centred, instead of stopping the moment Maestro calls it visible. Without it
   a `scrollUntilVisible` can no-op on an element the hierarchy already reports,
   leaving it past the fold — the following `tapOn` then hits nothing, or the
   following `assertVisible` / `assertNotVisible` passes vacuously.
   `visibilityPercentage: 100` is Maestro's **default** (verified against
   `YamlScrollUntilVisible` in maestro-orchestra 2.8.0), so spelling it out is
   readability, not behaviour — do not credit it with the fix. Drop below 100
   only for a target taller than the viewport, and say why in a comment (see
   `exercise-block-history-fixture.yaml:91`). Both flags share one limit:
   Maestro computes visibility from the view hierarchy, **not** from occlusion,
   so an element centred inside a scroll container that fixed chrome overlays
   still counts as visible while the tap lands on the chrome. When a target sits
   under fixed chrome, drive the screen some other way — see the documented gap
   at the end of `stats-screen-ux.yaml`. A scroll that only positions the screen
   for a screenshot or for an assertion on a *different* element is outside this
   rule; centring the wrong element can push the one you care about off-screen
   (`exercise-block-history-fixture.yaml:157`).

Run the insights flows on the supported small and large phone viewports when
closing changes to those presentations; their timestamped artifact roots and
screenshots are the visual evidence.

---

# CI posture

- `.github/workflows/ci.yml` runs one job (`frontend`) on every push and pull
  request to `main`.
- It runs `docs-check` and `meta-tests`, installs the mobile workspace, runs
  mobile lint/typecheck/Jest, runs the locked `agent-auth-web` and `mcp-unit`
  wrappers in their workspaces, then runs the mobile open-handle guard. These
  are all infra-free lanes marked CI-enabled in the registry.
- **Not in CI:** the iOS Maestro slow gates (`boga test frontend`) and the
  local-Supabase agent/sync/MCP contract suites (`boga test backend`) are local-only,
  along with `db:generate:canary`. **Local-only means you
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

## Per-feature coverage policies (colocated with the tests)

Per-feature coverage policies live in the README of the test directory they
govern — read them when editing tests there (rule in `AGENTS.md`):

- `apps/mobile/app/__tests__/sync/README.md` — sync integration coverage policy
  (cycle, cursors, dirty bits, quarantine, AUTH_REQUIRED, reinstall re-pull, and
  the UI↔server e2e requirement).
- `apps/mobile/app/__tests__/README.md` — GPS gym-location, exercise-tag, auth
  bootstrap, and profile-management coverage policies.

This document keeps only the cross-cutting policies below.

## iOS UI smoke policy (Maestro)

- Jest / RNTL remains the default for component logic, state transitions, and
  CI-safe assertions. Maestro is for simulator-integrated UI smoke that confirms
  core screens are reachable and visibly intact.
- In the standard local gate matrix, current Maestro checks are `frontend + slow`
  and run via `./boga test frontend` (smoke + data-smoke +
  auth-profile + sync-e2e + groups-e2e).
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
- Session submission in this flow traverses the mandatory completion
  presentation through Done before asserting the post-submit history state.

## iOS simulator auth/profile happy-path policy (Maestro)

- Purpose: validate the real local-Supabase login/profile happy path (plus
  login-on-start enforcement, the first-sync gate, the signed-in Connected
  agents grant-list screen, and settings sync status) on the iOS simulator with deterministic fixture credentials
  (`test:e2e:ios:auth-profile`, also covered by `boga test frontend`).
- Setup: `full reset` so each run starts logged out with no restored session;
  preflight `./supabase/scripts/ensure-local-runtime-baseline.sh`; use the
  deterministic fixture credentials (`user_a` by default) from
  `supabase/scripts/auth-fixture-constants.sh`; use a per-run username so repeated
  runs still exercise the username-save path.
- Required when any of these are true: milestone/release closeout needs fresh
  auth/profile proof; profile or Connected-agents route UI/state semantics change; auth
  bootstrap/session-restore behavior changes; local-Supabase auth/profile wiring
  changes.
- Evidence: command result + artifact root, plus screenshots
  `05-auth-profile-logged-out-start`, `06-auth-profile-signed-in`,
  `07-auth-profile-signed-out-end`.

## Two-user groups e2e policy (Maestro)

- Purpose: prove, on a real simulator against local Supabase, that data one
  user produces reaches **another** user's device through the group record
  (M22; `docs/specs/tech/groups-contract.md` §8). This is a separate test layer
  from the single-user sync e2e lane: it is the only lane where two accounts
  interact. Lane `ios-groups-e2e`, part of `boga test frontend`.
- Scripted counterparty pattern: the device drives the UI as one fixture user;
  the second user is driven over HTTP from Maestro `runScript`
  (`apps/mobile/.maestro/scripts/*.js`) with the same RPCs its app would call.
  One simulator, no second device. The counterparty is bound through a
  `MAESTRO_*_COUNTERPARTY_EMAIL` var, so it is a dedicated fixture under the
  one-user-per-flow rule (`docs/specs/11`).
- Hermeticity: the lane runner resets both fixtures with the service role
  before the run (`supabase/scripts/groups-fixture-reset.sh`: their groups,
  their Sync v2 rows, the device user's username), so repeated runs in one
  slot need no Supabase reset. It must pass twice in a row.
- Timing: "after a refresh" is one pull-to-refresh; the counterparty script
  logs the observed `sync_push` → card-visible time (`GROUPS_E2E_LATENCY` in
  `maestro-debug/**/maestro.log`). It is observed data, not a latency promise.
- Out of scope: offline and airplane-mode behaviour (simulator networking
  cannot be toggled reliably; offline is proven in jest).
- Required when: the group client (`apps/mobile/src/groups/**`), group routes
  or components, group migrations, or this lane's fixtures/scripts change
  (`scripts/triggers.tsv`; UI paths already require `frontend`, which includes
  it).
- Evidence: command result + artifact root, screenshots `groups-01`…`groups-09`,
  and the logged latency.

## iOS lane configuration contract (infra-free vs Supabase-configured)

- The committed iOS lanes run the **same** dev-client build in two deliberately
  exclusive configurations, selected by whether the app sees Supabase credentials
  (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`):
  - **infra-free** — `smoke`, `data-runtime-smoke` (and combined `gates`): no
    Supabase. The app runs local-only with the login-on-start gate disabled, which
    keeps these gates fast, backend-free, and focused on the local SQLite runtime.
    `data-runtime-smoke` additionally proves the backend-less build seeds its own
    starter exercise catalog at boot.
  - **Supabase-configured** — `auth-profile`, `sync-e2e`, `groups-e2e`: a real local Supabase is provisioned
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
  `auth-authz`, `groups-contract`, `groups-leaderboards`, `sync-v2-schema`, `sync-push-contract`,
  `sync-pull-contract`, `dev-wipe-my-data`, `sync-v2-e2e`,
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
  `./boga worktree doctor` if a backend suite appears to hit the wrong local
  Supabase instance.

## Worktree isolation testing policy

- The worktree lifecycle, slot lease, and runtime isolation are owned by
  `docs/specs/12-worktree-config-and-isolation.md`.
- Every local gate requires this worktree's slot lease: run `./boga worktree start`
  first; gates, Supabase helpers, and Maestro scripts fail hard without it.
  Diagnostic entrypoint: `./boga worktree doctor`. No gate cleans up other
  worktrees; the owner runs `./boga worktree release` after its PR merges, and
  leftovers follow `docs/procedures/worktree-cleanup.md`.
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
