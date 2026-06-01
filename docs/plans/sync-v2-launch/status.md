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
