# Parked: test-architecture follow-ups (E + F from the sync retrospective)

> Status: **parked ideas, not commitments.** Captured 2026-06-10 during the
> sync-v2 retrospective, alongside the changes that DID land (AGENTS.md as the
> single symlinked entrypoint, the `SYNC_TEST_SUPABASE_*` rename, the
> lane-timing measurement database, and the `test:e2e:ios:sync` UI↔server e2e
> lane). Evidence base: the PR history #60–#196 — five consecutive PRs
> (#125, #142, #149, #150, #151) deferred `test:sync:infra` citing the
> "branch-provisioned" env-var name, #152/#154 were doc-patch attempts, and the
> UI↔backend bug class (#116, #129, #147, #151) shipped while the jest
> cross-stack lane stayed green.

## E — Doc slimming / colocation (devil in the details)

Problem: test knowledge spans `02` (quickref), `06` (572 lines), `11` (Maestro,
497 lines), plus per-feature coverage policies inside `06` that agents rarely
load at the right moment. The 3-way "ownership protocol" between the docs is
itself a drift symptom (e.g. `06`'s auth-profile flow list went stale within a
day of #196).

Ideas, in rough order of value:

1. **Colocate per-feature coverage policies with the code they govern** — e.g.
   move `06`'s "Sync integration coverage policy" to
   `apps/mobile/app/__tests__/sync/README.md`, GPS policy next to the location
   code, etc. Agents editing a directory see its README; a policy two specs away
   is invisible. `06` keeps strategy + the entry-point catalog only.
2. **Generate the lane matrix from the lane registry.** The registry now
   exists (`scripts/lanes.tsv`, consumed by `./boga`); what remains is
   generating/drift-checking `02`'s matrix table from it so the doc cannot
   drift from reality.
3. ~~A dispatcher over the ~60 scripts~~ — **LANDED** as `./boga` +
   `scripts/lanes.tsv` (2026-06-10): `boga test --list`, `boga doctor`,
   per-lane runs with automatic timing records. Still open from this idea:
   `boga test for <changed-path>` (path-trigger mapping).

Open questions: who regenerates the matrix (pre-commit? CI check?); whether
colocated READMEs need a loading rule in AGENTS.md ("read the README of any
test directory you touch"); how `11`'s runtime contract splits from runbook
content.

## F — Mechanical PR Tests-table enforcement

Problem: the PR template's gate table is honest *when filled*, but wrong ⛔ N/A
reasons were never machine-checked (e.g. #171 declared the backend lane N/A on a
sync-registry change; #149/#150 cited a "permitted deferral" that was a doc
bug).

Ideas:

1. Extend `./scripts/task-closeout-check.sh` to fail when the PR body's Tests
   table still has unfilled ⬜ rows, and to require every ⛔ N/A row to cite the
   path-trigger rule it relies on (the "which gate for what you changed" table
   in `02` / AGENTS.md).
2. A cheap CI job that diffs the PR's changed paths against the trigger table
   and flags rows that *should* be ✅ but are ⛔ (advisory comment first; hard
   fail once trusted).
3. Require the Result column to carry the measured duration as printed by the
   lane (cross-checkable against `./scripts/test-timings.sh` ceilings) — makes
   fabricated runs detectable.

Open questions: where CI gets the PR body (event payload vs API); whether
path-mapping lives in the lane registry from E.2 (it should); how to keep the
check from blocking genuinely-N/A docs-only PRs.
