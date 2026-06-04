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

See `AGENTS.md` → "Testing is not optional" and `docs/specs/06-testing-strategy.md`.
