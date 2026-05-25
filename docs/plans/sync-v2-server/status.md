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
