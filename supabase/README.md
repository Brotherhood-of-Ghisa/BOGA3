# Supabase Local Runtime (M5 Baseline)

This folder is the backend root for M5 (`Supabase` local-first development and testing).

## Purpose (T-20260220-08)

- Provide a reproducible local backend runtime scaffold.
- Prove migration + reset/seed flow from a clean local state.
- Expose a health endpoint for explicit API-surface smoke checks.
- Establish backend-local smoke test and fixture conventions for follow-on M5 tasks.

## Prerequisites

- Docker-compatible container runtime (Docker Desktop verified in this repo session).
- On macOS with Colima, see `RUNBOOK.md` for the local Supabase preflight.
- `npx`/`npm` available (repo scripts use `npx supabase@2.76.15` by default).
- Optional: install Supabase CLI globally (`supabase`) if preferred, but repo scripts do not require it.

## Local environment configuration strategy

- Run `./scripts/worktree-setup.sh` from the repo root before local runtime use.
- Checked-in Supabase config is `supabase/config.toml.template`.
- Generated per-worktree config is `supabase/config.toml` and is gitignored.
- Local script overrides: `supabase/.env.local`
  - setup links this to `~/.config/boga/supabase/cli.env`
  - currently used for script-level config like `SUPABASE_CLI_VERSION`
- Local function env vars: `supabase/functions/.env.local`
  - setup links this to `~/.config/boga/edge-functions/env.shared`
  - used by `supabase functions serve --env-file ...`
- Hosted placeholders (no secrets committed): `supabase/.env.hosted`
  - setup links this to `~/.config/boga/supabase/env.hosted`
  - detailed hosted env/deployment command path is owned by `T-20260220-09`

## One-command local startup path

For an iOS Simulator, run from repo root:

```bash
./supabase/scripts/local-runtime-up.sh
```

What it does:

1. Starts the Supabase local stack (`supabase start` via pinned `npx`).
2. Opportunistically sweeps completed worktree Supabase infra before startup.
3. Starts the local Edge Function server for `health` (background process).
4. Waits until `GET /functions/v1/health` responds.

For a physical device pointed at local Supabase over the Mac LAN IP:

```bash
./supabase/scripts/use-local-mobile-lan-env.sh
```

For a physical device pointed at hosted Supabase:

```bash
./supabase/scripts/use-hosted-mobile-env.sh
```

Stop the local runtime:

```bash
./supabase/scripts/local-runtime-down.sh
```

Sweep completed/orphaned worktree Supabase infra:

```bash
./scripts/worktree-sweep.sh
```

## Deterministic local reset/seed path

Run from repo root:

```bash
./supabase/scripts/reset-local.sh
```

This wraps `supabase db reset --local --yes` and applies:

- `supabase/migrations/*` (baseline schema/bootstrap)
- `supabase/seed.sql` (deterministic test fixtures)

## Local smoke checks

Health endpoint:

```bash
./supabase/scripts/smoke-health.sh
```

Seed fixture baseline (via local Supabase REST API):

```bash
./supabase/scripts/smoke-seed.sh
```

Combined fast backend-local check (current baseline for this task):

```bash
./supabase/scripts/test-fast.sh
```

Shared runtime baseline preflight for real-instance contract/E2E flows:

```bash
./supabase/scripts/ensure-local-runtime-baseline.sh
```

Behavior:

1. If local Supabase is not running, it starts the stack, resets/seeds DB, and provisions deterministic auth fixtures.
2. If local Supabase is already running, it reuses that instance as-is (no reset), verifies baseline seed fixtures, and reprovisions auth fixtures idempotently.
3. Bootstrap/reset path is lock-protected so concurrent callers on one machine do not race startup.

Current coverage:

- local stack bring-up
- migrations + reset + seed
- DB lint (`supabase db lint --fail-on error`)
- Edge health endpoint smoke
- deterministic fixture seed smoke

## M5 auth/authz baseline (implemented in `T-20260220-10`)

Current auth posture for backend/API work:

- `Supabase Auth` + Postgres `RLS`
- `email + password` sign-in for provisioned users
- public self-signup disabled (`[auth].enable_signup = false`)
- email provider kept enabled for password logins (`[auth.email].enable_signup = true`)
- user-owned sync tables live in `app_public` and are protected by `RLS`
- `gyms`, `sessions`, `session_exercises`, and `exercise_sets` are user-private in MVP

### Key boundaries (must keep)

- `anon` key is client-safe and used with user JWTs for normal app data access.
- `service_role` is server/admin only (provisioning, maintenance, tightly scoped backend tasks).
- Never expose `service_role` to mobile/client code.

## Auth provisioning (controlled users, no self-signup)

Provision deterministic local auth fixtures (`user_a`, `user_b`) after local reset:

```bash
./supabase/scripts/auth-provision-local-fixtures.sh
```

Provision or update one user (local, or any environment where `API_URL` + `SERVICE_ROLE_KEY` or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are exported):

```bash
./supabase/scripts/auth-provision-user.sh \
  --email user@example.test \
  --password 'StrongPassword!234'
```

Notes:

- Uses the Supabase Auth Admin API (service-role only).
- Hosted provisioning requires the legacy JWT `service_role` key. Do not use a publishable key (`sb_publishable_...`) or secret key (`sb_secret_...`) for this script.
- Local fixture provisioning also syncs `public.dev_fixture_principals` aliases (`user_a`, `user_b`) to the real local auth user UUIDs for deterministic ownership tests.

## Auth/authz contract tests (local Supabase)

Run the M5 auth/authz baseline suite:

```bash
./supabase/scripts/test-auth-authz.sh
```

This wrapper enforces the shared runtime baseline first (`ensure-local-runtime-baseline.sh`) and then runs the contract suite.

Coverage includes:

- password auth success/failure
- self-signup disabled path
- unauthenticated access denial on protected tables
- cross-user read/update denial (`RLS`)
- owner spoofing denial
- cross-user parent/child ownership mismatch rejection (DB constraint path)

## M5 sync API contract baseline (implemented in `T-20260220-11`)

Chosen API surface for the M5 sync baseline:

- `PostgREST` table routes on `app_public` (`gyms`, `sessions`, `session_exercises`, `exercise_sets`)
- auth via `anon` key + user JWT
- authorization via table `RLS` + FK/check constraints

Provider-neutral method catalog + Supabase mapping:

- `supabase/session-sync-api-contract.md`

Local sync contract suites (sync v2):

```bash
# run all backend slow suites together:
./scripts/quality-slow.sh backend
# or individually:
./supabase/scripts/test-sync-v2-schema-smoke.sh
./supabase/scripts/test-sync-push-contract.sh
./supabase/scripts/test-sync-pull-contract.sh
./supabase/scripts/test-sync-v2-e2e.sh
```

These enforce the shared runtime baseline first (`ensure-local-runtime-baseline.sh`) and then run the sync-v2 contract suites. The v1 `test-sync-api-contract.sh` / `test-sync-events-ingest-contract.sh` wrappers were retired with the M13 projection RPCs.

Coverage includes success read/write flows, validation failures, unauthenticated denial, and cross-user denial across all sync-domain entities, including session metadata parity fields (`session_exercises.exercise_definition_id`, `exercise_sets.set_type`).

Parallel-run note:

- each initialized BOGA worktree gets readable Supabase `project_id`, slot-derived ports, containers, and database volume.
- the sync/auth contract suites use per-run unique record IDs, so repeated runs in one slot do not collide.
- tests require the deterministic fixture baseline to exist but do not require empty app tables.
- run `./scripts/worktree-doctor.sh` when a backend suite appears to hit another worktree's local runtime.

## Accessing `app_public` via REST (local/manual testing)

`app_public` is exposed in the local API config. For direct `PostgREST` calls, send schema profile headers:

- `Accept-Profile: app_public`
- `Content-Profile: app_public` (writes)

## Hosted sync bootstrap and reset

Canonical hosted bootstrap is the checked-in migration chain (`supabase/migrations/*.sql`) applied via the Supabase CLI. The previous hand-curated bootstrap blob (`hosted-bootstrap-sync.sql`) was removed during the sync redesign clean-slate (`docs/tasks/fix-sync/plan.md`, T7) — it had drifted from the live schema and is not part of the supported path.

Standard hosted enablement on a fresh project:

1. `supabase link --project-ref <ref>` (one-time).
2. `supabase db push --linked --include-all` to apply every checked-in migration.
3. Keep `app_public` listed in Dashboard **Project Settings -> API -> Data API Settings -> Exposed schemas**.

Reset hosted to a known-good clean slate (when there is no data worth preserving): use Dashboard **Database -> Reset**, or `supabase db reset --linked --yes`. Both reapply `supabase/migrations/*.sql` in order against a fresh DB. See `RUNBOOK.md` for the operator-facing checklist.

Historical note: `supabase/hosted-hotfix-relax-session-exercise-definition-fk.sql` was a one-off hotfix retained for archival. The FK it relaxed no longer exists after the sync redesign, so the file is inert against the current schema.

For local parity before and after a hosted reset, run `./supabase/scripts/reset-local.sh`, `./supabase/scripts/ensure-local-runtime-baseline.sh`, `./scripts/quality-fast.sh backend`, and `./scripts/quality-slow.sh backend`. On WSL, verify Docker Desktop integration from this distribution first with `docker info`.

First repair task (historical, pre-redesign): `docs/tasks/complete/T-20260510-01-supabase-migration-history-repair.md`.

## Fixture baseline (deterministic)

`supabase/seed.sql` seeds `public.dev_fixture_principals` with named fixtures used by follow-on ownership/authz tests:

- `anonymous`
- `user_a`
- `user_b`
- `service_role_helper` (optional helper fixture)

These are dev fixtures only and do **not** lock the final auth linkage design for M5 auth/sync tasks.

## Health endpoint note

The `health` Edge Function is a local runtime smoke surface only. It exists to validate:

- local stack reachability
- local Edge Function serving path
- deterministic endpoint smoke checks

It does **not** lock the final sync API surface choice for `T-20260220-11` (`Edge Functions` vs `PostgREST/RPC` mix).

## Follow-on testing layers (documented now, implemented incrementally)

- `DB` tests: `pgTAP` (`supabase test db`) for policies/functions/constraints
- `Edge` unit tests: add when Edge logic beyond simple health exists
- `Supabase-local` integration/contract tests: required for auth/RLS/API tasks
- hosted smoke validation: owned by `T-20260220-09` (manual by default until CI exists)
- cross-stack `E2E`: strategy only in M5; repo-root `e2e/` reserved for later implementation
