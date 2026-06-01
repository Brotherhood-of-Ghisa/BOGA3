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
