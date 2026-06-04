# Status: Sync v2 — Launch

Coordinator running log. One entry per iteration. The audit reads this; resumed
sessions reconstruct execution state from it.

Roots of the DAG (no in-plan dependency): **tPROG** (design), **t1**
(login-on-start), **t7** (soft-delete). Everything else waits on these per the
`plan.md` DAG.

## 2026-06-01 — iteration 1
- State at start: plan merged (PR #106); no task PRs exist; `designs/` and
  `status.md` absent. Coordinator synced to `origin/main` @ f138aeb.
- Dispatched (3, root tasks, parallel):
  - tPROG (designer) — sync/bootstrap progress-reporting contract → produces
    `designs/tPROG.md` + pointer edits to t2/t3/t9.
  - t1 (builder) — login-on-start enforcement / redirect-to-sign-in.
  - t7 (builder) — soft-delete everywhere (may split t7a/t7b per card size note).
- Merged this iter: none.
- Stuck: none.
- Notes: builder cap = 4; 3 in flight. Remaining tasks gated: t2/t3 need tPROG+t1;
  t8 needs t1; t9 needs tPROG+t3; t4/t5/t6/t10 need t3; tFINAL needs all.

## 2026-06-01 — iteration 2
- Builder batch returned 3 PRs: tPROG → #107, t1 → #109, t7 → #108.
- Hygiene incident: agents' work polluted the MAIN working tree
  (`/Users/dinohughes/Projects/BOGA3`); #107 (a DESIGN PR) had picked up 3 leaked
  BUILD files (`exercise-tags.ts`, `auth-required-signal.ts`, `cycle.ts`).
  Coordinator fixed #107 in a throwaway worktree: forward-revert commit restoring
  those files to `origin/main` state → PR #107 net diff is now design-only
  (push e0d487a..f1515e0, regular fast-forward, no history rewrite). #108/#109
  verified clean (file lists match scope).
- t7 SPLIT (legitimate, builder-surfaced): #108 ships only tag-assignment +
  muscle-mapping + simple-delete conversions; the `session-drafts.ts`
  session-rebuild cascade is deferred. Created `tasks/t7b.md`; added DAG nodes/
  edges (`t7 --> t7b`, `t7b --> tFINAL`) + task-list entry in plan.md.
- Dispatched 3 reviewers. Verdicts:
  - #107 (tPROG): APPROVED → ready for human merge.
  - #108 (t7): CHANGES_REQUESTED ×1 — `Builder-Agent: t7a` commit trailer
    (ephemeral id in a durable commit message). Code otherwise clean/approved.
  - #109 (t1): CHANGES_REQUESTED ×1 — `Builder-Agent: t1` commit trailer. Code
    otherwise clean/approved (all 9 outcomes substantiated, both gates pass).
- Blocker surfaced to user: removing the trailers needs a force-push (history
  rewrite) which this session's classifier denied for the coordinator. Also
  surfaced: main-working-tree contamination cleanup (user's checkout). Awaiting
  user decision before re-dispatching #108/#109 fixes.
- Stuck: none (>3-iter). Merged this iter: none.

## 2026-06-01 — iteration 3
- User decisions: (1) ACCEPT the `Builder-Agent:` trailer as a sanctioned
  provenance convention (coordinator posted a `[coordinator]` reconciliation note
  on #108/#109; reviewers re-issued verdicts). (2) CLEAN the main working tree —
  done: switched `/Users/dinohughes/Projects/BOGA3` back to `main` (synced to
  origin), removed the 9 untracked spill paths (all captured in PRs).
- Re-dispatched reviewers for #108 + #109 with the ruling. Verdicts now:
  - #107 (tPROG): `Verdict: APPROVED` (review, fresh).
  - #108 (t7): `Verdict: APPROVED` (issue comment @ 20:37:55, latest, post-commit).
  - #109 (t1): `Verdict: APPROVED` (review @ 20:37:58, latest, post-commit).
  Note: verdicts are COMMENT-type (same-identity can't formally APPROVE), so
  GitHub `reviewDecision` is empty — state derived from the verdict first line per
  protocol. All three are APPROVED + non-conflicting (distinct file sets).
- Awaiting HUMAN merge of #107, #108, #109 (coordinator never merges).
- Next wave once merged: t2 (tPROG+t1), t3 (tPROG+t1), t8 (t1), t7b (t7) → 4
  tasks = builder cap. t9/t4/t5/t6/t10 stay gated on t3.
- Open bookkeeping risk to resolve before dispatching t7b: `tasks/t7b.md` +
  plan.md DAG live only on the coordinator branch; builders branch from
  origin/main. Either land coordinator bookkeeping on main (docs PR, repo
  convention) or pass the t7b card inline. The audit reads status.md +
  deviations log from main — bookkeeping must reach main before audit.

## 2026-06-01 — iteration 4
- All 3 root PRs merged by user: #107 (tPROG), #108 (t7), #109 (t1). Coordinator
  synced by merging origin/main into the coordinator branch (no history rewrite,
  preserves bookkeeping).
- Hand-offs verified on main: tPROG design doc (1 `## Decision`) + t2/t3/t9
  pointer markers; t7 guard + converted-path tests present and `exercise-tags.ts`
  hard-delete gone; t1 sign-in/guard/hook files present.
- Consistency check (tPROG = single design merge): `SyncProgress` contract
  composes with merged t1 (AUTH_REQUIRED is the gate's route concern, not
  `offline`) and t7 (unrelated). Downstream cards point to it; nothing invalidated.
- Deviations log updated for #107/#108/#109.
- Dispatched WAVE 2 — 4 builders = cap:
  - t2 (sync-gate full-screen block; RENDERS `SyncProgress`; t9 accessor not built
    yet → consumes the typed shape + stubs the source, wiring point = shared
    accessor).
  - t3 (bootstrapper reorder; PRODUCES `SyncProgress` + owns instrumentation;
    stays 1 PR per tPROG's small-instrumentation decision, split t3a/t3b only if
    it balloons).
  - t8 (sign-out / account-switch LOCAL wipe per design §6.2; no server delete).
  - t7b (session-rebuild cascade soft-delete; card passed INLINE — not yet on main).
- Bookkeeping-to-main deferred to a pre-audit consolidation PR (repo convention
  #96/#104); t7b card + status + deviations land there. Builder/reviewer get t7b
  inline meanwhile.
- Still gated: t9 (needs t3), t4/t5/t6/t10 (need t3), tFINAL (needs all).

## 2026-06-01 — iteration 5
- Wave-2 PRs opened + reviewed. All 4 APPROVED:
  - t3 → #111 APPROVED. Reviewer re-ran fast gate (603 tests). OPEN CONCERN
    (follow-up, not a t3 blocker): as-built `seedSystemExerciseCatalog` writes
    seeds `local_dirty=0`, so fresh-account seeds don't push to server — tension
    with design intent. Belongs to the seed-bundle owner (t4/t5 territory). A
    reviewer also auto-spawned a background task chip for it.
  - t2 → #113 APPROVED. OPEN RISK: the new `sync-gate-first-cycle.yaml` Maestro
    flow is in the auth-profile lane, which flakes at Expo/Metro warm-up in this
    sandbox (reproduces on pristine origin/main, fails before app mounts). The
    card-named `test:e2e:ios:gates` (smoke+data-smoke) passes + covers t2's
    stand-aside; Jest covers block→dismiss. Verify the auth-profile lane on a
    healthy runner at tFINAL.
  - t8 → #110 APPROVED (clean).
  - t7b → #112 APPROVED (order_index/PK reconciliation verified correct).
- Cleaned main tree again (t3/t8/t7b spill, all captured in PRs); back on main.
- TWO merge-conflict pairs to sequence (both PRs independently green):
  - cycle.ts: #111 (t3) + #113 (t2).
  - soft-delete-guard.test.ts: #112 (t7b) + #110 (t8) — final exempt set must be
    {dev-reset, account-wipe, maestro, tests}, NOT session-drafts.
- MERGE PLAN surfaced to user: merge #111 (t3) + #112 (t7b) first (disjoint,
  clean) → coordinator re-dispatches #113 (t2) + #110 (t8) to rebase + resolve →
  re-review → merge. Awaiting the first two merges.
- t9 reconciliation reminder: t2 made `sync-progress.ts` + `scheduler-state.ts`
  seam; t3 made `progress.ts` + `getSyncProgress()` producer. t9 MUST unify into
  ONE SyncProgress type + ONE shared accessor (wire t3 producer → t2 consumer).
- Next wave (after t3 merges): t9 (tPROG+t3), t4/t5/t6/t10 (t3). t8/t7b feed tFINAL.

## 2026-06-01 — iteration 6
- Root-caused the recurring main-checkout contamination (user request). Cause:
  agent worktrees are nested at `<repo>/.claude/worktrees/agent-<id>` (inside the
  primary checkout); builders/designers were `cd`-ing to / hardcoding the primary
  checkout path `/Users/dinohughes/Projects/BOGA3` and writing there instead of
  their worktree (the shell resets cwd to the worktree between calls, but
  within-command cd + absolute Write paths bypass that). This polluted the live
  tree and once leaked build files into design PR #107.
- DURABLE FIX: added a "Stay in your isolated worktree — never touch the primary
  checkout" section to mao-builder + mao-designer agent defs (plugin commit
  465400f). Also reinforced in dispatch prompts going forward.
- t2 flake: USER RULED flakes NOT accepted. Re-dispatched the t2 builder (#113,
  background) to actually fix the `sync-gate-first-cycle.yaml` Expo/Metro warm-up
  flake and deliver a green Maestro gate (not re-document it as environmental).
  Awaiting completion → then re-review.
- Merge plan unchanged: still awaiting user merge of #111 (t3) + #112 (t7b);
  #110 (t8) + #113 (t2) rebase after. #113 also picks up the flake fix first.

## 2026-06-03 — iteration 7
- t2 flake re-dispatch returned. It FIXED the real warm-up bug (dev-client
  detached from Metro after `clearState`) — verified: quality-fast 624/624 +
  `test:e2e:ios:gates` green. BUT it surfaced a deeper defect blocking the
  auth-profile lane: after a successful sign-in the shared Supabase client's
  `getSession()` returns null in the sync cycle → spurious AUTH_REQUIRED → the
  guard bounces the signed-in user → redirect loop. Reproduces on t1's merged
  `launch-requires-sign-in.yaml`; the whole auth-profile lane is excluded from
  CI's gate (never verified E2E). Coordinator verified there is a SINGLE shared
  client (not an instance mismatch) — it's a session persistence/refresh/timing
  defect, in the t1/auth layer, out of t2's scope.
- USER DECISIONS: (1) add t11 (auth-session fix; first job = determine real-
  backend vs local-fixture severity, then fix + green the auth-profile lane).
  (2) HOLD t2 (#113) until the lane is genuinely green (flakes not accepted).
- Created `tasks/t11.md`; DAG: `t1 --> t11 --> tFINAL`; t11 also gates t2's #113
  lane-green merge. Dispatched t11 (background) off latest origin/main (depends
  only on merged t1; parallelizes with the pending #111/#112 merges). Card passed
  inline (not yet on main).
- t2 (#113) HELD: head 5e540a2 has new (unreviewed) commits — needs re-review +
  rebase on t3+t11 + a green auth-profile lane before it can merge.
- Process gap noted: the auth-profile Maestro lane (sign-in→sync) is not in the
  mandated gate, so login→sync was never enforced. t11 must wire it into an
  enforced run (or hand tFINAL the contract).
- Gating action UNCHANGED for the next build wave: user merges #111 (t3) + #112
  (t7b) → then dispatch t9/t4/t5/t6/t10 (t11 already in flight). t8 (#110) +
  t2 (#113) rebase after their pair-mates land.

## 2026-06-03 — iteration 8
- OUT-OF-BAND merge: user merged PR #115 (`seed starter catalog dirty so a fresh
  account pushes it`) — the seed-dirty fix the t3 reviewer auto-spawned. main →
  71ea317. Resolves open-concern #1 (iteration 5). Logged in deviations.
- #115 touches `exercise-catalog-seeds.ts` (also t3's territory). Checked: GitHub
  reports #111/#112/#110/#113 ALL still `MERGEABLE`/`CLEAN` on the new main — the
  seeder edits auto-reconcile. Semantic interaction (t3 bootstrapper → now-dirty
  seeder) actually matches t3's card outcome; left to next-wave gates + audit to
  validate (no t3 re-dispatch).
- #114 ("M17 exercise calendar heatmap") is an UNRELATED feature PR (not this
  plan); ignoring. (It touches Stats/History — a future conflict risk for t7b's
  readers if it merges, but that's #114's rebase problem, not ours.)
- t4/t5 dispatch note: must compose with #115's now-dirty seeder.
- Coordinator synced to 71ea317. State otherwise UNCHANGED: still awaiting user
  merge of #111 (t3) + #112 (t7b) to unblock the t9/t4/t5/t6/t10 wave. t11
  (auth fix) still running in background. t2 (#113) held; t8 (#110) rebases after
  t7b.

## 2026-06-03 — iteration 9
- User merged #111 (t3) + #112 (t7b). main → 97c0155. Hand-offs verified
  (bootstrapper.ts + progress.ts present; guard no longer exempts session-drafts).
  Deviations logged for both.
- t11 (auth fix) COMPLETED → PR #116. ROOT CAUSE: REAL / launch-blocking (not
  fixture): a signed-in Supabase session exceeds the iOS keychain's 2048-byte
  per-entry limit; the old single-key auth storage adapter silently persisted
  NOTHING; the cycle's getSession() reads storage → null → unsigned RPC →
  AUTH_REQUIRED → bounce loop. EVERY real user would hit this. Fix: chunk
  oversized values across keychain entries (`apps/mobile/src/auth/storage.ts`),
  public API unchanged. Enforced regression gate added in CI's FAST lane
  (`auth-session-visibility.test.ts`, real GoTrue client vs a 2048-byte ceiling —
  red on old adapter, green with fix). quality-fast 599 green. Guard/signal/
  classification untouched (loop fixed by removing the spurious signal).
  CAVEAT: the iOS auth-profile Maestro lane needs LOCAL Supabase (CLI/infra) the
  agent env lacks — not runnable in-agent; run on an iOS+Supabase host (tFINAL
  infra lane / user machine) to green `launch-requires-sign-in.yaml`.
- PROCESS GAP confirmed: ALL signed-in Maestro flows (t1/t2/t9/t10) live in the
  auth-profile lane needing local Supabase — not runnable by agents or CI's gate.
  Infra-free `test:e2e:ios:gates` (smoke+data-smoke) IS agent-runnable
  (stand-aside paths). Signed-in E2E verification belongs to tFINAL's provisioned
  infra lane (or a host run).
- WAVE 3 dispatch (conflict-aware): t4/t5/t6 all edit exercise-catalog-seeds.ts →
  SEQUENCE (t4 now; t6, t5 queued). t9/t10 both edit settings.tsx → t9 now, t10
  queued. Dispatched t4 (bg; fast gate only) + t9 (bg; single shared accessor +
  panel + Jest + infra-free gate; auth-profile Settings Maestro deferred to
  tFINAL/host). Both compose with #115's now-dirty seeder. Dispatched t11
  reviewer (#116).
- After t11 merges: rebase t2 (#113) + t8 (#110); verify auth-profile lane on a
  host. Queue t5/t6 (after t4), t10 (after t9).

## 2026-06-03 — iteration 10 (resume)
- Session interruption killed both background builders (t4 + t9) ~19:00 before
  either pushed a branch/PR (t4 had uncommitted slug-rename WIP in its worktree;
  t9 was at "deps installed, running specs"). No work lost (nothing was pushed).
- t11 reviewer left the MAIN checkout on branch `pr-116` (clean, no spill) —
  reviewers can switch the primary checkout's branch; switched it back to `main`.
  TODO (hygiene): add the worktree-discipline note to mao-reviewer too.
- Re-dispatched t4 (agent a4ebec82) + t9 (agent ac9f0d92), background, fresh from
  origin/main. Same conflict-aware plan (t6/t5 after t4; t10 after t9).
- #116 (t11) STILL OPEN + APPROVED + MERGEABLE/CLEAN — re-flagged to user as the
  top-priority merge (launch-blocking keychain fix; unblocks t2 rebase + signed-in
  flows). main unchanged at 97c0155.
- Pending merges/holds unchanged: #110 (t8) + #113 (t2) await t11 + rebase.

## 2026-06-03 — iteration 11
- User merged #116 (t11). main → c669c0a. Hand-off verified (storage.ts chunking,
  auth-session-visibility.test.ts on main). Deviation logged.
- #110 (t8) + #113 (t2) now CONFLICTING/DIRTY (expected). Re-dispatched t8 (#110)
  rebase (bg) to merge main + resolve the soft-delete-guard.test.ts UNION (exempt
  {dev-reset, account-wipe, maestro, tests}; NOT session-drafts) → re-review.
- HOLDING t2 (#113) rebase until t9 merges, so t2 rebases ONCE on t3+t11+t9 and
  adopts t9's canonical accessor (dropping its stub) instead of rebasing twice.
- t4 (a4ebec82) + t9 (ac9f0d92) still building (bg); no PRs yet.
- Reminder to user: with #116 on main, the auth-profile lane can be run on a host
  (`npm run test:e2e:ios:auth-profile`) to confirm the sign-in→sync fix E2E.

## 2026-06-03 — iteration 12 (policy correction: agents CAN run auth-profile lane)
- User: "all agents have local supabase." Investigated: the auth-profile runner
  (`apps/mobile/scripts/maestro-ios-auth-profile.sh`) calls
  `supabase/scripts/ensure-local-runtime-baseline.sh`, whose `run_supabase()` is
  `npx -y supabase@<SUPABASE_CLI_VERSION>` and which REUSES an already-running
  local instance. So `which supabase` failing is a RED HERRING — the lane
  self-bootstraps. The t11/t9(defer) agents wrongly bailed on `which supabase`.
- CORRECTED POLICY: every signed-in-flow task RUNS `npm run test:e2e:ios:auth-profile`
  to GREEN in-agent — no deferring to a host. Applies to t9 (re-run on return),
  t10, the t2 (#113) rebase, and tFINAL. (Note: the baseline uses a
  `runtime-baseline.lock`, so concurrent auth-profile runs serialize.)
- Action: when t9 returns (built with the now-stale "defer Maestro" instruction),
  re-dispatch it to run the auth-profile Settings flow green + update its PR
  before review. Future dispatches carry the corrected instruction.
- Durable follow-up: add a one-line note to the repo's Maestro/testing docs so
  agents stop bailing on `which supabase` (fold into tFINAL or a small doc PR).

## 2026-06-03 — iteration 13
- POLICY MADE DURABLE (user directive: agents have ALL local infra — Supabase via
  npx, Maestro, sims; NEVER accept PRs that excuse not running runnable tests,
  except genuinely cloud/branch-provisioned lanes):
  - Plugin defs (commit b6fa0fd): mao-builder step 5 = run every runnable gate
    green, "command not found" = bootstrap not unavailable, only cloud lanes
    deferrable; mao-reviewer check #11 = reject untested-excuse PRs, require
    evidenced green runs.
  - Repo docs PR #118 (`docs/testing-no-excuses`): AGENTS.md explicit
    Supabase/auth-profile bullet + "Testing is not optional" section; new
    CLAUDE.md pointer carrying the rule. AWAITING USER MERGE.
- t4 (#117) APPROVED; t8 (#110) APPROVED post-rebase. Both ready to merge.
- t9 (2nd attempt, agent ac9f0d92) did NOT ship: it branched from a STALE base
  (97c0155, pre-#116) so its signed-in Maestro flow hit the keychain bounce loop
  and looped forever; work was uncommitted. Re-dispatched FRESH (agent ac912b4f,
  bg) from current main (c669c0a, has #116), with: commit-early, branch-from-
  current-main verification, and RUN the auth-profile Settings lane to green (no
  defer). 
- Ready for user to merge: #110 (t8), #117 (t4), #118 (docs). Queued: t6→t5
  (after t4), t10 (after t9), t2 (#113) rebase (after t9).

## 2026-06-03 — iteration 14
- User merged #110 (t8) + #117 (t4). main → f13dc88. Deviations logged for both.
- t9 (3rd attempt, agent ac912b4f) KILLED again — but commit-early WORKED: it
  committed + pushed `claude/t9-sync-status-surface` (HEAD c814e11) on the CORRECT
  base (c669c0a, has #116) before dying at the auth-profile lane step. Build is
  SALVAGED on its branch; only the long Maestro run + PR-open didn't happen.
- KILL PATTERN diagnosed: short agents (builds, data) finish fine; the long
  auth-profile Maestro run (Docker+Maestro, ~15-30min) dies every time — almost
  certainly background agents are terminated when a new user turn starts (user has
  been messaging frequently). Affects t9, t10, t2, tFINAL (all need the lane).
- Dispatched t6 (agent a11858f, bg) — data-only, safe from the kill pattern.
  Unblocked by t4 merge. (t5 still queued behind t6 — same seed file.)
- DECISION PENDING (asked user): how to run the auth-profile lane reliably for the
  signed-in PRs (you-run-on-warm-stack / coordinator-foreground / consolidate-at-
  tFINAL). t9's build is ready; its PR + lane-green is the only remaining step.
- DECISION: user runs the auth-profile lane via a TASK THEY SPAWN (survives the
  background-kill), which opens the PR; user relays the PR number; coordinator
  then dispatches the reviewer. User = message-passer between coordinator and the
  spawned task. Applies to every signed-in-lane task (t9 now; t10, t2-rebase,
  tFINAL later: coordinator's bg builder commits+pushes the build, user's spawned
  task runs the lane + opens the PR).
- t9 hand-off to user's spawned task: branch `claude/t9-sync-status-surface`
  (build @ c814e11, base c669c0a/#116). Task: merge origin/main, run quality-fast
  + test:e2e:ios:gates + test:e2e:ios:auth-profile to green, open `[t9]` PR with
  evidence → relay PR # → coordinator dispatches reviewer.

## 2026-06-03 — iteration 15
- t6 (#119) APPROVED (reviewer re-ran gate, 615 green) → user merged. main →
  f469634. Deviation logged (none).
- Dispatched t5 (agent a87877be, bg) — bundle-migration runtime loop, last of the
  seed-file cluster. Data/logic only → safe from the kill pattern.
- t9: coordinator created a SPAWNED-TASK chip (`mcp__ccd_session__spawn_task`) to
  run the auth-profile lane + open the `[t9]` PR in its own session (survives the
  turn-boundary kills). User launched it; PR not yet open. When the `[t9]` PR
  lands → dispatch its reviewer.
- #118 (testing-policy docs) MERGED → no-excuses policy now on main for all agents.
- Remaining: t5 (building) → review/merge; t9 (spawned task) → review/merge; then
  t10 (after t9) + t2 (#113) rebase (after t9) → tFINAL.

## 2026-06-03 — iteration 16 (reconciliation snapshot)
Verified against the host. main = `f469634`.

MERGED (9 plan tasks): tPROG #107, t7 #108, t1 #109, t3 #111, t7b #112, t11 #116,
t4 #117, t6 #119, t8 #110. Out-of-band merged: #115 (seed-dirty), #118 (testing
docs). Deviations log in plan.md covers all 9 plan tasks + #115.

IN FLIGHT:
- t5 — building (agent a87877be); no branch/PR pushed yet. Data/logic; safe.
- t9 — spawned-task session running; branch `claude/t9-sync-status-surface`
  advanced to df3b699 (task is merging main / wiring the settings flow), `[t9]`
  PR NOT open yet. On open → dispatch reviewer.

HELD:
- t2 #113 — the visible `Verdict: APPROVED` is STALE (pre-rebase, from the
  original build). t2 is CONFLICTING and must: rebase on t9 (adopt t9's canonical
  accessor, drop its stub) + cycle.ts, then run the auth-profile lane green (via a
  spawned task), then RE-REVIEW. Do NOT merge on the stale approval.

NOT STARTED:
- t10 (dev-wipe verification) — dispatch after t9 merges (shares settings.tsx;
  its wipe-local Maestro needs the auth-profile lane → spawned-task pattern).
- tFINAL (final test card) — after t5, t9, t10, t2 all merge; asserts the 5
  cross-cutting outcomes; runs the live/round-trip + auth-profile E2E lanes.

NON-PLAN: #114 (M17 heatmap) — ignore.

CRITICAL PATH: t9 (spawned task) → its merge unblocks t10 + the t2 rebase →
those + t5 merge → tFINAL. t5 is parallel and nearly independent.

## 2026-06-03 — iteration 17
- t5 COMPLETED → PR #121: new `apps/mobile/src/data/bundle-migrations.ts`
  (`BundleMigration` type, EMPTY `BUNDLE_MIGRATIONS`, `runBundleMigrations()` —
  short-circuit on applied>=current, apply (applied,current] ascending each in own
  tx with atomic marker advance, empty-array still advances marker to current,
  resumes after partial failure); `CURRENT_APP_VERSION` constant (aliased to the
  existing `SEED_CATALOG_BUNDLE_VERSION`=1); wired into cycle.ts after
  runBootstrapper; 13 Jest tests; quality-fast 650 green. 2 deviations documented.
  Dispatched reviewer (agent a5beed04).
- NOTE for the t2 (#113) rebase: cycle.ts is now ALSO touched by t5 (#121) — when
  t2 rebases it must reconcile cycle.ts with both t3 (merged) and t5.
- t9 spawned task: still running (branch advanced; no `[t9]` PR yet).

## 2026-06-03 — iteration 18 (BROKEN TESTS ON MAIN discovered)
- t5 (#121) APPROVED (reviewer re-ran 650 green) → user merged. main → d9423aa.
  Deviation logged.
- t9 spawned worker reports BROKEN TESTS ON MAIN; asked user to spawn a fix worker.
- STRUCTURAL HYPOTHESIS (verified by file presence): main has login-on-start (t1,
  `auth-route-guard.tsx`) + bootstrapper (t3) but NOT the sync-gate (t2 —
  `SyncGate.tsx` absent, #113 still open/held). So a signed-in auth-profile e2e
  flow hits the post-sign-in bootstrapper state with NO gate UI → likely breaks
  the lane. HALF-FEATURE on main. Root process miss: t3 (and other behavior-
  changing "data-only" PRs) skipped the Maestro lanes because "no UI files",
  while actually changing the boot/sync behavior the e2e lanes exercise →
  breakage accumulated invisibly (CI runs only the fast gate).
- LIKELY REORDER: t2 (#113) may need to land to make main e2e-green. Its card
  permits its STUB accessor when t9 isn't merged, so t2 CAN land before t9
  (reversing the earlier t9-before-t2 hold). Pending the t9 worker's actual
  failure list to confirm (stale test vs real boot-flow break vs t9 code).
- DURATION CORRECTION: my "15-30 min auth-profile lane" was an UNVERIFIED guess
  (a hallucination). Measured reality: smoke ~17s, data-smoke ~53s. The t9 kills
  were an INFINITE bounce-loop HANG on the pre-#116 stale base, not a long run.
  Action: add per-flow Maestro timeouts (hang → fast legible failure) + have
  runners print elapsed; never assert unmeasured durations.

## 2026-06-03 — iteration 19
- BROKEN-MAIN RESOLVED out-of-band: user's spawned worker landed #123 (`fix: green
  the two red iOS Maestro lanes (data-runtime-smoke + auth-profile)`). main →
  0f0cafe; main's slow lanes are GREEN. Logged in deviations.
- CORRECTION: my "t2-gap" root-cause guess was WRONG. #123 fixed
  `auth/service.ts` + `data/bootstrap.ts` + the two flow YAMLs (+ 2 tests) — the
  break was in the auth/bootstrap path + flow assertions, not the missing gate.
  (Don't assert a root cause without the failure data — which is why I did NOT
  spawn a fix worker on the guess.) #123 was effectively the first tGATE
  checkpoint, run out-of-band.
- DURABLE MAO updates shipped: AGENTS.md slow-gate-checkpoint convention (#122,
  MERGED); plugin now checks repo CLAUDE.md/AGENTS.md for MAO conventions (planner
  bakes required gate tasks; audit fails on a missing checkpoint; SKILL +
  designer) — plugin commit 386d337.
- CURRENT STATE: main 0f0cafe, slow lanes green. Remaining plan work:
  - t9 — IN PROGRESS (user's spawned task; branch df3b699; no `[t9]` PR yet).
  - t2 #113 — CONFLICTING, HELD for t9 (rebase adopts t9's accessor + cycle.ts vs
    t3/t5). Could land with its stub if t9 stalls; cleaner to rebase once on t9.
  - t10 — not started; follows t9 (shares settings.tsx; wipe-local dev Maestro via
    spawned-task pattern).
  - tGATE re-run before tFINAL (after t9/t10/t2), then tFINAL.
- Nothing for the coordinator to DISPATCH now without conflicting with the
  in-progress t9. Staged to move the moment the `[t9]` PR lands.

## 2026-06-04 — iteration 20
- t9 merged as #125 (the spawned task ran the gates incl. auth-profile GREEN; user
  merged; no separate mao-reviewer pass — gate-verified). main → 59aa925. Hand-off
  verified on main: `getSchedulerStatus` in scheduler.ts, sync-status.ts, panel.
  Deviation logged.
- #124 (out-of-band CI fix) merged — lane Supabase-config isolation from leftover
  .env.local. Logged.
- DISPATCHED the final feature wave (disjoint, parallel; both bg):
  - t2 #113 REBASE (agent a7c8a9b) — merge main, ADOPT t9's `getSchedulerStatus`
    + drop t2's stub seam, reconcile cycle.ts (t2 error-signal + t3 bootstrapper +
    t5 bundle-migrations), build + fast/infra-free gates, commit-early + push;
    sync-gate auth-profile lane attempted, else spawned-task run.
  - t10 (agent af2aca19) — verify dev-wipe affordances vs launch state + Jest +
    fast/infra-free gates, commit-early + push + PR; wipe-local dev Maestro
    attempted, else spawned-task run.
- REMAINING: review t2 #113 + t10 → run their signed-in Maestro lanes green (in-
  agent or spawned task) → merge → tGATE re-run (slow lanes on merged main) →
  tFINAL.

## 2026-06-04 — iteration 21
- t10 → PR #126. Build solid: confirmed dev-wipe affordances correct vs launch
  state (no prod change); closed a real coverage gap in `dev-affordances.test.ts`
  (the prior mock collapsed `client.schema()`+`.rpc()` → never verified the
  `app_public` schema name); wrote `settings-dev-wipe-local.yaml`. quality-fast
  707 GREEN.
- t10 SURFACED: `test:e2e:ios:gates` (infra-free smoke + data-smoke) RED in the
  agent's run — app lands on /sign-in. ANALYSIS: the auth guard redirects only
  when auth is CONFIGURED; the infra-free build is configured ONLY with a leftover
  `apps/mobile/.env.local` (the KNOWN leak #124 targeted; #123 greened data-smoke;
  t9/#125 don't redirect). ⇒ almost certainly a WORKTREE-LOCAL `.env.local`
  artifact, NOT a real main regression — i.e. #124's isolation didn't clear a
  STALE leftover, or the agent's worktree carried one. (The t10 agent filed a
  spawn chip to harden the lane.)
- ACTION: confirm by running the infra-free gate + the wipe-local flow in a FRESH
  worktree (no leftover .env.local) — the spawned-task pattern does exactly that.
  If it ALSO fails clean → real regression to fix. Dispatched t10 code reviewer
  (scoped: code/Jest; wipe-local Maestro merge-gated on a clean-worktree run).
- t2 #113 rebase (agent a7c8a9b) still in flight.
