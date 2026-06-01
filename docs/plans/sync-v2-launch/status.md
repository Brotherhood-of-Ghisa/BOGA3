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
