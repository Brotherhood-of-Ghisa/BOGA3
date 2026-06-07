# Status: muscle_groups synced entity

## 2026-06-07 — iteration 1
- State at start: plan PR #167 merged; coordinator synced to `origin/main` (5afbc97). No task PRs exist.
- Ready work (DAG): only `t1` (design) has no deps. t2/t3 depend on t1; t4 depends on t1+t3; rest are downstream.
- Dispatched: t1 (designer) — pin the canonical muscle_groups synced-entity contract.
- Merged this iter: none.
- Stuck: none.
- Notes: First iteration. t1 is the sole front-of-DAG task; all 7 build tasks + tFINAL consume its `## Decision`. Holding all build dispatch until t1 merges.
- Reviewed: t1 PR #168 → `Verdict: APPROVED` (reviewer agent acefcfe). PR is OPEN + MERGEABLE. Awaiting merge to unblock t2 + t3.

## 2026-06-07 — iteration 2
- Merged this iter: t1 (PR #168, human-merged). Coordinator synced to `origin/main` @ 3e04d16. Hand-off verified: `designs/t1.md` present, one `## Decision`; all 7 downstream cards carry the `Updated from t1` pointer; merge was plan-dir-only (+157 lines, no build code). Deviations log updated (no deviation; FK on-delete = cascade recorded).
- Ready work (DAG): t2 (server baseline) and t3 (client schema + baseline regen) — both depend only on t1.
- Dispatched: t2 (builder) + t3 (builder), in parallel. Concurrency 2/4.
- Stuck: none.
- Notes: t2 = supabase migrations (clean-room + push/pull RPC); runs slow-backend gate. t3 = drizzle schema + `m0000` regen; runs fast + handles. t4 (registry) waits on t3; t5/t6/t7 wait on t4. Merge policy: human merges each approved+mergeable PR; I ping.

## 2026-06-07 — iteration 3
- Reviewed: t3 PR #169 → `Verdict: APPROVED` (reviewer abccc13); t2 PR #170 → `Verdict: APPROVED` (reviewer a4bb8b5). Both OPEN + MERGEABLE. Awaiting human merge.
- t2 builder flagged: merging t2 reddens `main`'s `check:sync-drift --strict` (slow-backend sub-lane) until t6 lands — by design (server-first window; plan outcome 7 = t6). t2 also fixed 11 backend test shells + dev_wipe migration (reviewer confirmed in-scope under t2's "existing contract suites pass" outcome).
- PROCESS CHANGE: reviewers triggered repeated SECURITY WARNINGs for posting `Verdict:` comments. Honoring the user's broader standing rule (memory: agents report to coordinator, do not auto-post PR verdicts). Going forward reviewers RETURN verdict to coordinator only; post nothing to the PR. Coordinator derives state from agent return + host open/merged/mergeable. Already-posted comments on #168/#169/#170 left in place.
- LATENT DEPS discovered (stricter than drawn DAG; enforcing):
  - t6 (drift green under --strict) needs t2 (server table) merged in addition to t4 — dispatch t6 only after t2+t3+t4 merged.
  - t5 runs `quality-slow.sh backend` (incl. drift --strict) → dispatch t5 only after t6 merged, so its backend gate is green. (t6 → t5.)
  - t7 card Inputs say "t4 AND t5 merged" (DAG drew only t4→t7) → dispatch t7 after t5. (t5 → t7.)
  - Net build order: t3 → t4 ; t2 anytime ; (t2+t3+t4) → t6 → t5 → t7 ; (t5+t6+t7) → t8 ; all → tFINAL. t4 runs fast+handles only (no drift), safe to dispatch right after t3.
- Dispatched: none this iter (awaiting merges).
- CI note: t2 PR #170 showed a Frontend-Quality-Gates failure — single flaky test `apps/mobile/app/__tests__/sync-status-panel.test.tsx` ("dirty count from the source", expected 7 got 0). Diagnosed pre-existing race (its `waitFor` guards on "Never" which is unchanged by the mock, so the un-awaited dirty-count assertion races the mocked `readStatus` promise). NOT a t2 regression (server-only diff; main 3e04d16 green; t3 #169 green on same gate). Filed as background task `task_7f180da5` (out of scope). Watch for the same flake on t4–tFINAL PRs → re-run, don't chase.

## 2026-06-07 — iteration 4
- Merged this iter: t2 (PR #170) + t3 (PR #169), human-merged. Coordinator synced to `origin/main` @ 28abee5. Hand-offs verified: server table/FK/push/pull all present (t2); client sync columns present + journal len=1 tag `0000_living_bucky` (t3). Deviations log updated (t1/t2/t3).
- Ready work (DAG + latent deps): t4 (registry) — needs t1+t3, both merged. Runs only fast+handles (no drift lane) so safe even though `main` drift is currently red (t2-in, t6-out window). t6 still blocked (needs t2+t3+t4); t5 blocked (needs t6); t7 blocked (needs t5).
- Dispatched: t4 (builder) — register muscle_groups as 9th entity (TOPO_LAYERS Layer 0 + ENTITY_FIELDS + ENTITY_TABLES).
- Stuck: none.
- Notes: Single-task iteration by necessity — the drift coupling serializes t4→t6→t5→t7. After t4 merges, t6 unblocks (drift goes green), then t5, then t7, then t8, then tFINAL.

## 2026-06-07 — iteration 5
- Reviewed: t4 PR #171 → `Verdict: APPROVED` (reviewer a1209b9, reported to coordinator only, no PR post). CI SUCCESS (no flake). OPEN + MERGEABLE pending check. Awaiting human merge.
- GAP surfaced by t4 builder + verified by coordinator: `apps/mobile/src/sync/sync-status.ts` `DIRTY_COUNTED_TABLES` (line 28) excludes `schema.muscleGroups`; `apps/mobile/app/__tests__/sync-status-composer.test.ts:88` asserts the old "muscle_groups is NOT one of the eight dirty-counted tables". Once t5 seeds muscle_groups dirty, the Settings pending-push count undercounts until first sync (cosmetic, transient, not a brick). No existing card owns it (t7 is tests-only; production array + test are coupled). Plan-relevant per the Goal ("treated identically to every other synced table") but NOT in explicit outcomes 1–9. Builder spawned a background chip; coordinator surfacing a scope decision to the user (fold into plan as new task vs. keep standalone).
- Dispatched: none yet (awaiting t4 merge + gap decision).
- DECISION (user): fold the dirty-count gap into the plan as new task **t9** (DIRTY_COUNTED_TABLES + reconcile sync-status-composer test). Created `tasks/t9.md`; wired DAG `t4 → t9 → tFINAL`; added to task list; updated tFINAL inputs to t1-t9. t9 runs fast+handles only (no drift/backend), parallel-safe with t6. No new plan-level outcome added (outcomes 1-9 stay the locked contract); t9 carries its own test coverage. Builder's background chip for this is now superseded by t9 (can't auto-dismiss it — spawned in subagent context; user may dismiss the duplicate chip).
- Next ready after t4 merges: t6 (drift; needs t2+t3+t4) + t9 (dirty-count; needs t4) — dispatch in parallel.

## 2026-06-07 — iteration 6
- Merged this iter: t4 (PR #171), human-merged. Also unrelated #172 (silly-carson) landed on main — incorporated via rebase. Coordinator sync model SWITCHED from `reset --hard` to commit-bookkeeping + `git rebase origin/main` (stops wiping tracked plan-dir edits; bookkeeping now persists in coordinator branch). HEAD @ 834fe39 (bookkeeping) on top of d59357d (#171). t4 hand-off verified: muscle_groups in TOPO_LAYERS Layer 0 + ENTITY_FIELDS + ENTITY_TABLES; sync-status.ts still excludes muscleGroups (t9 target).
- Dispatched (parallel, disjoint files): t6 (builder) — drift checker drops muscleGroupId exemption + 9th entity, makes `check:sync-drift --strict` GREEN on main; t9 (builder) — DIRTY_COUNTED_TABLES + reconcile composer test.
- Stuck: none.
- Notes: t6 is the drift-coherence task — once it merges, main's drift lane goes green and t5 unblocks (t5 backend gate needs green drift). t9 runs fast+handles only (no drift), safe in parallel with red-drift main. Concurrency 2/4. Bookkeeping (plan.md/status.md) reconciled onto main before audit.

## 2026-06-07 — iteration 7
- Reviewed: t6 PR #174 → `Verdict: APPROVED` (reviewer a0269c7); t9 PR #173 → `Verdict: APPROVED` (reviewer a4a62eb). Both reported to coordinator only (no PR posts). Both OPEN + MERGEABLE. Awaiting human merge.
- Bonus: unrelated #172 ("fix sync-status-panel waitFor race flake") already fixed the flake I'd filed as task_7f180da5; that background task was already started by the user (will likely no-op). 
- INVESTIGATION — t2 fallout (the `quality-slow.sh backend` wrapper failure t6 flagged):
  - Git evidence: only commit touching `supabase/` or catalog seeds since pre-plan baseline 5afbc97 is `8cf5d04` (t2). So the failure is NOT pre-existing-before-the-plan; it's t2 fallout OR a polluted-DB artifact in t6's worktree (t6 noted an orphaned Supabase stack on its slot).
  - `sync-pull-contract.sh` scenario 1 (line 254) seeds 3 Layer-0 rows, pulls {layer0,limit10}, asserts has_more=false. "got true" ⇒ >10 Layer-0 rows for the user ⇒ real regression OR non-hermetic DB pollution. Needs a CLEAN-RESET reproduction to settle.
  - DURABLE-HYGIENE LEAKS from t2 (definite, audit-blocking): `sync-pull-contract.sh:427`, `sync-v2-pull-fk-closure.sh:23` + `:275`, `sync-v2-clean-room.sh:7` reference plan.md/Deviations/t1/t2. (t2 reviewer missed these.)
- DECISION: created remediation task **t10** (hygiene leaks + clean-reset verify/fix of pull-contract scenario 1). Wired DAG `t6 → t10 → t5`, `t10 → tFINAL`; added to tasks list; tFINAL inputs → t1-t10. t10 gated on t6 (so it branches off green-drift main and the only backend question is the pull-contract). 
- Dispatched: none yet (awaiting t6+t9 merge; then dispatch t10).
- Revised build order: (t6 ∥ t9) → t10 → t5 → t7 → t8 → tFINAL.
- Per user request: dispatched a fresh reviewer for t9 that POSTED its verdict to PR #173 (`Verdict: APPROVED`, COMMENTED review, reviewer a6c2b14). Posting reviewer verdicts to the PR is now USER-DIRECTED-OK (overrides the earlier conservative report-only default for verdicts the user asks to be posted). No security warning fired. t6 #174 review remains report-to-me only (user didn't ask to post that one).
