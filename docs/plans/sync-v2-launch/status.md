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
