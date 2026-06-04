# tGATE: slow-gate checkpoint — integration branch must pass the slow lanes

**Type:** build (gate checkpoint — per `AGENTS.md` "slow-gate checkpoint tasks")

**Problem:** CI runs only the fast gate (lint + typecheck + jest). The slow iOS
Maestro lanes and infra lanes are NOT in CI, so breakage accumulates on `main`
invisibly — confirmed this plan: several behaviour-changing "data-only" merges
(the bootstrapper especially) skipped the Maestro lanes, and `main` is currently
RED on the signed-in `test:e2e:ios:auth-profile` lane (the bootstrapper landed
without the sync-gate UI — a half-feature). This checkpoint makes the integration
branch's slow lanes green and is a BARRIER before tFINAL.

**Inputs:**
- Runs against the CURRENT integration branch (`origin/main` — the merged result,
  NOT a feature branch).
- The signed-in lanes self-bootstrap a local Supabase via npx (per `AGENTS.md`).
- Run as a DEDICATED / spawned session (these lanes are long; in-turn background
  sub-agents get killed at turn boundaries).
- The half-feature root cause: t2 (the sync-gate, `SyncGate.tsx`) is not yet on
  `main`; landing t2 is the likely fix (its card permits its stub accessor when
  t9 has not merged, so it can land independently).

**Outcomes:**
- `npm run test:e2e:ios:gates` (smoke + data-smoke) and
  `npm run test:e2e:ios:auth-profile` (signed-in) pass GREEN on `origin/main`
  (paste the evidenced runs). `npm run test:sync:infra` green where its env is
  provisioned (else explicitly deferred).
- Any breakage is FIXED via a PR, OR — when it is a half-landed feature needing a
  planned task to land (e.g. the sync-gate t2) — that task is driven to land and
  the lane re-run, rather than patched around.
- Each Maestro flow has a hard per-flow timeout so a hang fails fast and legibly
  (a "timeout", not an ambiguous long run).
- No further feature PRs merge while the integration branch's slow lanes are red.

**Output artifact:**
- Evidenced green slow-gate runs against `origin/main`; any fix PR(s); a short
  root-cause note. (Plus the per-flow-timeout change if not already present.)

**Out of scope:**
- Net-new features. tGATE only makes the merged integration branch's slow lanes
  green and surfaces structural gaps.
