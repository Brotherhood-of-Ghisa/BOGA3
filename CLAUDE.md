# CLAUDE.md

The session entrypoint is **`AGENTS.md`** — read it first. This file exists so the
`CLAUDE.md` name also resolves; the authoritative rules live in `AGENTS.md` and
`docs/specs/**`.

## Non-negotiable: tests are not optional

You have ALL of this repo's local infrastructure — **Supabase** (via `npx`,
self-bootstrapped by the e2e lanes), **Maestro**, and **iOS simulators**. Run
every locally-runnable test/gate your change touches to **green** before a PR is
done; a missing global (e.g. `which supabase` returning nothing) means
*bootstrap* (`npm install` + `./scripts/worktree-setup.sh`), not *unavailable*.

**Never ship — and never approve — a PR that skips a runnable test with an
excuse.** The only deferrable lanes are the genuinely cloud / branch-provisioned
ones (`test:sync:infra`, `test:sync:reinstall-parity`) when their remote env
(`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`) is unset.

**Mandatory slow-gate triggers, per change:** if a change has ANY UX component or
makes ANY assumption about device/runtime behaviour, it MUST run the slow FE gates
(iOS Maestro: `test:e2e:ios:gates`, + `test:e2e:ios:auth-profile` for signed-in/
sync paths). If it depends on backend/infra, it MUST run the slow BE gates
(`test:sync:infra`). The fast gate can't catch device-behaviour or backend-contract
bugs — "data-only" still triggers the slow FE gates if it changes boot/sync/auth
behaviour. This is per change AND on top of the periodic slow-gate checkpoints.

See `AGENTS.md` → "Testing is not optional" and `docs/specs/06-testing-strategy.md`.
