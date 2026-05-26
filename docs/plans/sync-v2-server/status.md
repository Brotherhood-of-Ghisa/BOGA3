# Status: Sync v2 — Server

Orchestrator log. Append one entry per iteration. Reverse-chronological.

## Iteration 1 — 2026-05-25

**State snapshot:**
- Plan PR `[plan] sync-v2-server` (#68) merged 2026-05-25.
- No task PRs (`[t1]`..`[t4]`, `[tFINAL]`) exist yet.
- DAG: t1 ready; t2/t3/t4 blocked on t1; tFINAL blocked on t2+t3+t4.

**Actions:**
- Dispatched `mao-builder` for **t1** (clean-room migration: drop v1 + create v2 schema). Sole ready task.

**Next:** wait for t1 PR; review on open; dispatch t2/t3/t4 in parallel after merge.

## Iteration 2 — 2026-05-25

**State snapshot:**
- t1 builder shipped PR [#69](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/69) — `[t1] clean-room migration — drop v1, create v2 schema`.
- Builder reports `supabase db reset --local --yes` clean, smoke test green, `./scripts/quality-slow.sh backend` exits 0.
- Three deviations declared in PR body: (a) preserved `gyms` latitude/longitude columns (M15 carry-over not in t1 §2.1); (b) retired v1 sync-api / sync-events-ingest contract tests from the slow gate; (c) patched `auth-authz-contract.sh` for the new NOT NULL `client_updated_at_ms` column.

**Actions:**
- Dispatched `mao-reviewer` for PR #69. Reviewer checks outcome coverage, schema correctness vs design t1 §§1/2/5.2/6.1/6.3, v1 drop completeness, smoke-test soundness, slow-gate skip-block per t1 §7.5, out-of-scope guard, three deviations, size budget.

**Next:** await verdict. APPROVED → human merges → iteration 3 dispatches t2/t3/t4 in parallel. CHANGES_REQUESTED → re-dispatch builder with the reviewer's punch list.

## Iteration 3 — 2026-05-25

**State snapshot:**
- Reviewer posted `Verdict: APPROVED` on PR [#69](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/69).
- Confirmed: 8 tables, 8 deferrable composite FKs, 16 triggers, 32 RLS policies, 16 grants, 0 CHECK constraints; full v1 surface dropped; smoke test asserts all invariants; slow-gate skip-block per t1 §7.5; gyms lat/long retention validated against client `gyms.ts`; 943/16 lines well within budget.

**Actions:**
- None — awaiting human merge. Coordinator does NOT merge per protocol.

**Next:** once #69 merges, iteration 4 verifies hand-off (v2 tables on `main`), then dispatches t2/t3/t4 builders in parallel (cap 4).

## Iteration 4 — 2026-05-25

**State snapshot:**
- PR [#69](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/69) merged at `de94612`. Hand-off verified: 4 artifacts present on `main` — migration `supabase/migrations/20260525120000_sync_v2_clean_room.sql`, smoke test, wrapper, and `scripts/quality-slow.sh` skip-block.
- DAG: t2, t3, t4 all now ready (deps satisfied). tFINAL still blocked on t2+t3+t4.

**Actions:**
- Appended t1 deviation entry to `plan.md ## Deviations log`.
- Propagated pointer markers to `tasks/t3.md`, `tasks/t4.md`, `tasks/tFINAL.md` for the `gyms` lat/long carry-over (must be included in their per-entity column projections / test assertions).
- Dispatching 3 `mao-builder` agents in parallel (under the cap of 4): t2 (drift checker + spec edit), t3 (`sync_push` RPC), t4 (`sync_pull` RPC).

**Next:** await each builder's PR; review on open; coordinate merges (each independent — no inter-task hand-off until tFINAL).

## Iteration 5 — 2026-05-26

**State snapshot:**
- All three parallel builders (t2/t3/t4) stalled with the stream watchdog at 600s. Inspecting the stalled worktrees showed partial work in each: t2 had `check-sync-schema-drift.ts` + `topo-order.ts` + `sync-extras.json` + npm dep bumps; t3 had the RPC migration + contract test (stalled at "Now write the wrapper"); t4 had only the migration SQL.
- No PRs were opened by any of the three stalled attempts.

**Actions:**
- Committed each agent's partial work and pushed to remote recovery branches: `t2-wip-recover`, `t3-wip-recover`, `t4-wip-recover`.
- Re-dispatched three fresh `mao-builder` agents pointed at the recovery branches with explicit "resume from here, audit, finish the missing pieces" instructions. Stall-avoidance guidance baked in: t2 told to compute fixture hashes from migration text (not by booting Supabase, which was the inferred stall cause); all three told not to retry `supabase start` in loops.
- Also flagged for each: the as-built `gyms` carries `latitude`/`longitude` and the column must surface in t3's dispatch and t4's projection.
- Noted timestamp collision risk between t3 and t4 (both started at `20260525130000_*`); t4 instructed to bump to `20260525130100`.

**Next:** await PRs; review on open. The two RPC migrations need distinct timestamps before both merge.

## Iteration 6 — 2026-05-26

**State snapshot:**
- All three parallel PRs are now APPROVED:
  - [#71 t3 sync_push](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/71): APPROVED on first review. Builder deviations (named `entities` param matching wire envelope; `anon` execute grant with AUTH_REQUIRED guard first; gyms dispatch covers latitude/longitude/coordinate_accuracy_m/coordinates_updated_at) all validated.
  - [#72 t2 drift checker](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/72): re-reviewed APPROVED after coordinator override punch list. Fixups: bumped `better-sqlite3` `^11.10.0` → `^12.10.0` (latest stable, no breaking API changes); full `./scripts/quality-slow.sh backend` run end-to-end and ticked in PR body; inline fix to `supabase/tests/sync-v2-schema-smoke.sh` docker container picker (multi-worktree cross-contamination — now reads `project_id` from `supabase/config.toml`).
  - [#73 t4 sync_pull](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/73): re-reviewed APPROVED after first-pass CHANGES_REQUESTED. Fixups: corrected layer partition (`exercise_tag_definitions` Layer 0 → Layer 1 in SQL `case` mapping, contract-test partition assertion, and seed-fixture IDs). Slow gate green; all 10 contract scenarios pass.
- Plan-level cross-cutting decision logged: layer→type partition is **Layer 0: gyms, exercise_definitions; Layer 1: sessions, exercise_muscle_mappings, exercise_tag_definitions; Layer 2: session_exercises; Layer 3: exercise_sets, session_exercise_tags.** This corrects the original t1 §2 / t2 §4.4 wording (which is internally inconsistent against the live FK graph).

**Actions:**
- Surfaced merge asks for all three PRs. Coordinator does not merge.

**Next:** once all three merge, iteration 7 will verify hand-offs (TS checker on `main`, both RPC migrations applied, layer partition in `topo-order.ts` matching the sync_pull SQL), append three deviation entries to `plan.md ## Deviations log`, propagate any remaining pointer markers to `tasks/tFINAL.md`, then dispatch the tFINAL builder.

## Iteration 7 — 2026-05-26

**State snapshot:**
- t2 PR [#72](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/72) merged at `8d7be1b`.
- t3 PR [#71](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/71) merged at `cd8703e`.
- t4 PR [#73](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/73) still OPEN (APPROVED, awaiting merge).
- Hand-off verified on `origin/main`: drift checker (`apps/mobile/scripts/check-sync-schema-drift.{ts,fixtures.json}`), `topo-order.ts`, `sync-extras.json`, sync_push migration `20260525130000_sync_v2_push_rpc.sql`, spec edit (`Client schema drift rule` subsection in `docs/specs/05-data-model.md`).

**Actions:**
- Appended t2 (final) and t3 deviation entries to `plan.md ## Deviations log`.

**Next:** wait for t4 merge. Then iteration 8: verify sync_pull migration on main, confirm SQL `case` matches `topo-order.ts` layer mapping (cross-cutting consistency check), dispatch tFINAL builder with the tFINAL pointer markers already in place.

## Iteration 8 — 2026-05-26

**State snapshot:**
- t4 PR [#73](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/73) merged at `71f6930` (post-rebase head `36602d5`).
- Hand-off verified on `origin/main`: pull migration `20260525130100_sync_v2_pull_rpc.sql`, contract test `supabase/tests/sync-pull-contract.sh`, wrapper `supabase/scripts/test-sync-pull-contract.sh`, slow-gate wiring in `scripts/quality-slow.sh run_backend()`.
- Cross-cutting consistency check: `apps/mobile/src/sync/topo-order.ts` `TOPO_LAYERS` and the sync_pull SQL `case` mapping agree on the corrected partition (Layer 0: gyms, exercise_definitions; Layer 1: sessions, exercise_muscle_mappings, exercise_tag_definitions; Layer 2: session_exercises; Layer 3: exercise_sets, session_exercise_tags).
- DAG: t1, t2, t3, t4 all merged. Only tFINAL remaining.

**Actions:**
- Appended t4 deviation entry to `plan.md ## Deviations log`.
- Dispatching `mao-builder` for tFINAL (final test card — integration-level E2E verification of each plan-level outcome).

**Next:** await tFINAL PR; review; merge; run `mao-audit` for end-of-plan verification.

## Iteration 9 — 2026-05-26

**State snapshot:**
- tFINAL PR [#74](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/74) merged at `df5e97f`.
- Hand-off verified on `origin/main`: nine `supabase/tests/sync-v2-*.sh` E2E scripts, wrapper `supabase/scripts/test-sync-v2-e2e.sh`, slow-gate wiring updated.
- All five tasks in the plan DAG (t1, t2, t3, t4, tFINAL) now merged. DAG complete.

**Actions:**
- Appended tFINAL deviation entry to `plan.md ## Deviations log`.
- Dispatching `mao-audit` for end-of-plan verification.

**Next:** await audit verdict. PASS → propose deleting plan root + advance to plan 2 (sync-v2-client). FAIL → audit appends remediation cards under `tasks/` + DAG edges; orchestration resumes.
