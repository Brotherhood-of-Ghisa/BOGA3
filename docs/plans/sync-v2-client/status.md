# Status — sync-v2-client

> ## ⟳ RESUME CHECKPOINT (2026-05-30, after t6 merged) — read this first
>
> **Merged on `main`:** t1 (#83), t2 (#84), t3 (#82), t4 (#85), t5a (#89), t5b (#91), t6 (#95), t10 (#86). Plus out-of-band: infra sim/harness (#90), owner's reset/bootstrap race fix (#92), ephemeral-ref cleanup (#93), flaky settings-profile de-flake (#94). main HEAD at checkpoint: `eee3704`.
>
> **Remaining plan tasks:** **t7** (scheduler, t4 §2 four-state machine) and **t9** (dev-only wipe affordances behind `isDevMode()`) are BOTH READY now (both depend only on t6). Then **t8** (BG-task registration, t4 §4) after t7. Then **tFINAL** (client e2e verification) — its deps are t3+t8+t9+t10, so it's ready once t7→t8 and t9 land.
> **Next coordinator action:** dispatch t7 + t9 in parallel (`mao-builder`).
>
> **Standing rules in force (now also in the mao skill):**
> - Durable code/comments/tests/commit-messages must NOT reference ephemeral plan/card/design docs (`tX`, `t2 §…`, `docs/plans/…`, plan slug). PR title/body + status.md/deviations log are exempt.
> - Every task PR must pass `./scripts/quality-fast.sh frontend` AND `test:e2e:ios:smoke` + `test:e2e:ios:data-smoke` (Standard-checklist line `sim-smoke + data-smoke pass: YES (built rev: <sha>)`).
> - iOS sim gate now SELF-PROVISIONS (infra #90 on main): auto-creates the worktree sim, pre-authorizes URL schemes (no trust dialog), warms the cold bundle. Builders bootstrap (`npm install` + `worktree-setup.sh`) first; a "command not found" means un-bootstrapped, not missing.
>
> **Hard-won gotchas (don't relearn these):**
> - `apps/mobile` `test` script is bare `jest` (no `--forceExit`). A test that leaks an open handle OR an infinite async loop makes `jest` hang silently after tests pass → the **600s stream watchdog kills the agent with no output**. This killed ~5 dispatches across t5a/t6. If a builder/finisher stalls with no output, suspect a hung gate, not lost work — its commit is usually intact; preserve it and re-dispatch a finisher.
> - **Coordinator runs slow iOS sims directly (detached background Bash) when needed** — the main loop isn't subject to the subagent watchdog. Dispatched agents should run sims backgrounded + poll to emit periodic output.
> - Worktrees show a stray `package-lock.json` name-field churn from `npm install`; revert before committing.
>


## Iteration 1 — 2026-05-27

**State at start of iteration:**
- Plan PR [#76](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/76) merged 2026-05-27.
- No task PRs exist yet for this plan.
- DAG roots with no dependencies: t1 (delete v1 sync code paths) and t3 (manual-wipe procedure docs).

**Dispatched (parallel):**
- t1 — `mao-builder` (delete v1 sync code paths, including profile.tsx "Backup sync" card + v1 tests + DROP TABLE migration).
- t3 — `mao-builder` (docs-only: `docs/plans/sync-v2-client/manual-wipe.md` + cross-link from `apps/mobile/README.md`).

**Next iteration:** wait for t1 + t3 PR open / merge events, then dispatch t2 (depends on t1).

## Iteration 2 — 2026-05-27 — t1 stuck

Two consecutive `mao-builder` dispatches for t1 failed mid-task:

1. `afc239f57fb307ed0` — "API Error: Overloaded" after ~6 min. Worktree had v1 sync source + schema files deleted, `_layout.tsx`/`profile.tsx`/migrations index/schema index modified, `drizzle/0014_drop_v1_sync_tables.sql` created — no commit, no PR.
2. `a747f9fd69b538587` (retry) — stream watchdog "no progress for 600s" while editing `profile.tsx`. Worktree had the v1 source files + the eight v1 test files + the two v1 schema files deleted, plus `_layout.tsx` / `sync/index.ts` / `schema/index.ts` modifications — no profile.tsx edit, no repo cleanup, no commit, no PR.

t1 is a deletion-heavy task that spans 20+ files including a ~200-line surgical edit to `profile.tsx`. Both dispatches converged on the same stall point. Surfacing to user for direction (the protocol's "stuck-task watch" rule).

**t3 status:** still running in worktree `agent-a53c797876b100727`. `docs/plans/sync-v2-client/manual-wipe.md` is written (untracked); `RUNBOOK.md` modified instead of `apps/mobile/README.md` (will need to note in PR body Deviations). No commit yet, no PR.

**Action awaiting user:** decide t1 path forward — third dispatch, coordinator-led completion, or pause.

## Iteration 3 — 2026-05-28 — t1 + t3 redispatch

User directed "retry". Re-dispatched both t1 and t3 as fresh `mao-builder` agents in new worktrees. Prior stalled worktrees abandoned (work was uncommitted; the protocol's fresh-worktree-per-dispatch contract makes resuming them not portable).

## Iteration 4 — 2026-05-28 — t3 approved

- t3 builder shipped [PR #82](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/82) — `docs/plans/sync-v2-client/manual-wipe.md` (78 lines, all six required sections) + cross-link in `RUNBOOK.md` (deviation: `apps/mobile/README.md` does not exist; builder picked `RUNBOOK.md` as the dev-onboarding doc, surfaced in PR-body Deviations). Gates green at rev `2cfc7046a35af05294efae52fbc1180d529fc82a`.
- t3 reviewer dispatched against PR #82, posted **Verdict: APPROVED**. (gh `--approve` rejected the self-authored PR per GitHub policy; reviewer posted the verdict as a plain review comment per the fallback in the protocol.)
- PR #82 is ready for the human to merge. Coordinator never merges per the protocol.
- t1 builder still running.

## Iteration 5 — 2026-05-28 — t1 PR opened, reviewer dispatched

t1 builder shipped [PR #83](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/83): 36 files, 29 insertions, 8,139 deletions. Gates green (lint + typecheck + 40 suites / 318 tests + sim-smoke + data-smoke). Builder-reported deviations: pruned `settings-profile-navigation.test.tsx` rather than deleted (preferred per card); rewrote `root-layout-auth-bootstrap.test.tsx` to drop `@/src/sync` mocks; updated `dev-reset.ts` + test to drop deleted schema imports; hand-authored the m0014 migration + `_journal.json` entry because the on-disk journal had drifted from `migrations/index.ts`.

Dispatched `mao-reviewer` against PR #83 to score against `tasks/t1.md` and verify the four reported deviations are acceptable.

Next ready dispatch (after t1 merges): t2 (Drizzle schema additions + `sync_runtime_state` rewrite).

## Iteration 6 — 2026-05-28 — t1 approved

t1 reviewer posted **Verdict: APPROVED** on [PR #83](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/83) (plain-comment fallback per the self-authorship rule). One stale doc-comment nit noted in `apps/mobile/src/data/dev-reset.ts` — not blocking.

Awaiting human merge of PR #82 (t3) and PR #83 (t1). Once #83 merges, dispatch t2.

## Iteration 7 — 2026-05-28 — t3 merged, t1 amend in flight

- [PR #82](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/82) (t3) merged to `main` at `70c39b7`. Hand-off verified: `docs/plans/sync-v2-client/manual-wipe.md` exists (106 lines, six required sections) and `RUNBOOK.md` carries the cross-link under "Upgrading from v1 sync (one-time wipe)". Appended to plan.md `## Deviations log`. tFINAL already references the manual-wipe doc by path — no pointer marker needed.
- Per user direction, dispatched amend-builder against [PR #83](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/83) (t1) to: (a) squash Drizzle migrations 0000..0014 into a single `0000_v2_baseline.sql` (justified by manual-wipe contract — devices start clean), and (b) fix the stale doc-comment nit in `apps/mobile/src/data/dev-reset.ts` that the reviewer flagged.
- Single-merge consistency check (light): t3 is docs-only and doesn't invalidate any downstream card. Pass.
- Next dispatch (after t1 merges): t2 (Drizzle schema additions + `sync_runtime_state` rewrite). t3 unblocks tFINAL only.

## Iteration 8 — 2026-05-28 — t1 amend re-approved

t1 amend at `bace2aa39496ed10801480a118235d4d0d3d9197` on [PR #83](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/83) re-reviewed (focused scope: squash + nit). **Verdict: APPROVED.** Migration history collapsed to single `0000_silky_sinister_six.sql` baseline (167 lines, 11 tables, no v1 sync tables); `migrations/index.ts` reduced to one entry; new "squash invariants" guard test added to `domain-schema-migrations.test.ts`; `dev-reset.ts` doc nit fixed. Awaiting human merge.

## Iteration 9 — 2026-05-28 — t1 merged, t2 dispatched

- [PR #83](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/83) (t1) merged to `main` at `c1b65a5`. Hand-off verified on `origin/main`: all eight v1 source files gone, single `0000_silky_sinister_six.sql` baseline lives, `migrations/index.ts` reduced to `m0000`, `sync_runtime_state` still in v1 column shape (t2 owns the rewrite), three of eight entity schemas have `deleted_at`. Appended to plan.md `## Deviations log` with full squash rationale.
- Pointer marker added to `tasks/t2.md`: migration index becomes `m0001` (not `m0015`); t2 may re-squash or append; squash-invariants test may need relaxing depending on choice.
- Single-merge consistency check (light): t1's squash deviates from card but does not invalidate downstream cards — t2/t5a/t5b/t6 read `topo-order.ts` (untouched) and the Drizzle schema files (untouched in content; columns added in t2). Pass.
- Dispatched t2 builder.

## Iteration 10 — 2026-05-28 — t2 PR opened

t2 shipped [PR #84](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/84). Builder picked **option B (re-squash)** — old `0000_silky_sinister_six.sql` deleted, new `0000_living_bucky.sql` baseline includes the v2 columns natively. All eight entity schemas declare `local_dirty` + `local_updated_at_ms`; the five that lacked `deleted_at` got it + index; `sync_runtime_state` reshaped to v2 columns; `sync-extras.json` `server_only_columns` exemption removed; seed marker migrated to `appliedSeedMigrationAppVersion` with `SEED_CATALOG_BUNDLE_VERSION = 1` constant. Tests `seed-once.test.ts` and `dev-reset.test.ts` mechanically renamed. Dispatched reviewer.

Next ready dispatch (after t2 merges): t4 (`nowMonotonic()` clock helper).

## Iteration 11 — 2026-05-28 — t2 approved

t2 reviewer posted **Verdict: APPROVED** on [PR #84](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/84) via plain-comment fallback (self-authorship rule). Verified: 8 entity schemas declare both local-only columns, 5 schemas gained `deleted_at` + index, `sync_runtime_state` reshaped, `server_only_columns` exemption removed, Option B re-squash produces single `0000_living_bucky.sql` baseline, `SEED_CATALOG_BUNDLE_VERSION = 1` constant exported, seed-marker semantics shift preserved, squash-invariants test still passes.

Harness flagged a "security warning" for the reviewer posting under user identity — this is a false positive; reviewing PRs is the `mao-reviewer`'s entire purpose under the protocol the user invoked. Logging here for audit clarity.

Awaiting human merge of PR #84. Once merged, dispatch t4.

## Iteration 12 — 2026-05-29 — t2 merged, t10 added to DAG, t4 + t10 dispatched

- [PR #84](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/84) (t2) merged to `main` at `f8722ca`. Hand-off verified: 8 entity schemas carry `local_dirty` + `local_updated_at_ms`, 5 gained `deleted_at` + index, `sync_runtime_state` in v2 shape, single `0000_living_bucky.sql` baseline lives, `server_only_columns` exemption gone, `SEED_CATALOG_BUNDLE_VERSION = 1` exported.
- User raised the SQL-duplication question during t2 review (`migrations/index.ts` inlines the same SQL that `apps/mobile/drizzle/0000_*.sql` carries). Picked Option C (Drizzle stock generated bundle).
- **Added new task t10** — `docs/plans/sync-v2-client/tasks/t10.md`. Depends on t2, parallel with t4/t5a/t5b/t6/t7/t8/t9, feeds tFINAL. Updated plan.md DAG + Tasks list + Deviations log entry.
- Single-merge consistency check (light): t2's re-squash is internally consistent; the new t10 doesn't invalidate any in-flight card (none in flight). Pass.
- Dispatched **t4** (`nowMonotonic()` clock helper) and **t10** (drop inlined SQL) in parallel — both depend on t2 only.

Next ready dispatch (after t4 merges): t5a + t5b (both depend on t4) in parallel.

## Iteration 13 — 2026-05-29 — t4 approved

t4 reviewer posted **Verdict: APPROVED** on [PR #85](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/85) at sha `870819b` via plain-comment fallback (self-authorship). Verified: synchronous-persist contract via `INSERT ... ON CONFLICT DO UPDATE` inside caller's tx, module-scoped cache, `PRIMARY_RUNTIME_STATE_ID = 'primary'` compatible with the seeder's existing `'primary'` id usage in `exercise-catalog-seeds.ts`, 9 Jest tests cover all monotonicity cases.

Awaiting human merge of PR #85. t10 builder still running.

## Iteration 14 — 2026-05-29 — t10 PR opened (Option B deviation), deep-dive reviewer dispatched

t10 shipped [PR #86](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/86) at sha `f6d6f6a`. Builder deviated from Option C to **Option B** — justification: Option C works locally but requires creating `metro.config.js` + `babel.config.js` + `babel-plugin-inline-import` dev dep + Jest transform that don't exist in the repo today; blast radius across 40 jest suites + 2 Maestro flows + drift-checker tooling exceeds t10's scope. Option B reaches the same runtime shape with zero bundler config touched: `migrations/index.ts` shrinks 222 → ~24 lines, new `apps/mobile/scripts/bundle-migrations.ts` reads `_journal.json` + `*.sql` files and emits `apps/mobile/drizzle/migrations.generated.ts`. `db:generate` chains `drizzle-kit generate && tsx scripts/bundle-migrations.ts`. All gates green; drift checker clean.

User accepted the Option B deviation. Reviewer dispatched with **two scopes**: (1) standard outcome verification, (2) deep-dive critique of Option B — was the Option C cost analysis accurate? Is the bundle script well-engineered? Is the generated shape correct? Long-term maintenance cost?

Awaiting reviewer verdict on PR #86. t4 (PR #85) still awaiting human merge.

## Iteration 15 — 2026-05-29 — t10 approved (Option B critique was favourable)

t10 reviewer posted **Verdict: APPROVED** on [PR #86](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/86) via plain-comment fallback. Deep-dive confirmed: Option C cost analysis accurate (no `metro.config.js`, `babel.config.js`, or `.babelrc` in repo); bundle script is review-quality (correct escape ordering, loud failure on missing files, idempotent, style-consistent with existing scripts, zero new deps); wrapper preserves `localRuntimeMigrations` export shape; squash-invariants test passes. Minor cosmetic notes (unconditional write, double cast, indentation drift on journal entries) filed as inline `[reviewer]` comments — non-blocking.

Both PR #85 (t4) and PR #86 (t10) ready for human merge. Once #85 merges, dispatch t5a + t5b in parallel.

## Iteration 16 — 2026-05-29 — t4 + t10 merged, t5a + t5b dispatched

- [PR #85](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/85) (t4) merged at `651c5be`; [PR #86](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/86) (t10) merged at `163affb`. Hand-off verified on `origin/main`: `clock.ts` exports `nowMonotonic` + `PRIMARY_RUNTIME_STATE_ID = 'primary'`; `migrations/index.ts` is the 29-line wrapper importing `generatedMigrationBundle` from `../../../drizzle/migrations.generated`, zero DDL tokens.
- Appended t4 + t10 to plan.md `## Deviations log` (model switched to claude-opus-4-8[1m] this session — co-author trailer updated accordingly going forward).
- **Consistency check (light, single-merge each):** t4 + t10 are orthogonal (clock helper vs. migration bundling) and neither invalidates any downstream card. Pass.
- Dispatched **t5a** (Layer 0/1 repos: `gyms`, `exercise_definitions`, `sessions`, `exercise_muscle_mappings`, `exercise_tag_definitions`) and **t5b** (Layer 2/3 repos: `session_exercises`, `exercise_sets`, `session_exercise_tags`) in parallel — both depend on t4 only.
- **Shared-file seam flagged:** both edit `apps/mobile/src/data/exercise-tags.ts` (t5a → `exercise_tag_definitions` paths; t5b → `session_exercise_tags` paths) and both may touch `sessions` writes (t5a → `session-list.ts`; t5b → `session-drafts.ts`, disjoint files). Each builder instructed to touch ONLY its own entity's functions in `exercise-tags.ts` so the second-to-merge rebases cleanly on disjoint hunks. Whichever PR merges second may need a trivial rebase — coordinator will handle at merge time.

Next ready dispatch (after BOTH t5a + t5b merge): t6 (cycle — depends on t2 + t5a + t5b).

## Iteration 17 — 2026-05-29 — t5a builder killed on sim gate; recovered

- t5a builder (`a7d10e3943b4f8e4f`) was **killed** mid-run while thrashing on the iOS sim gate: its worktree's configured device (`BOGA wt42`) didn't exist at the time and `IOS_SIM_AUTO_CREATE` didn't trigger before the device lookup failed. The kill happened AFTER the code was complete.
- Coordinator inspected the killed worktree: all 5 source files wired correctly (`local-gyms.ts`, `session-list.ts`, `exercise-catalog.ts`, `exercise-tags.ts` [exercise_tag_definitions paths only — clean split from t5b], `exercise-catalog-seeds.ts` [batch-level clean stamp]) + a substantive new `dirty-bit-layer-0-1.test.ts`. Work was complete and correct; only the sim gate blocked it.
- Could not SendMessage to resume (tool unavailable). Coordinator committed the work in the killed worktree (commit `91c4b6a`), ran the fast gate directly (**44 suites / 375 tests pass**), but hit two infra walls the coordinator shell lacks: drift checker needs a running local Supabase stack, and `supabase` CLI is not on the coordinator's PATH. These are builder-environment tools.
- **Recovery decision:** pushed branch `worktree-agent-a7d10e3943b4f8e4f` to origin, then dispatched a fresh `mao-builder` (`aa755572f1d39f3ea`) instructed to `git reset --hard origin/worktree-agent-a7d10e3943b4f8e4f` (adopt the completed work), verify against the card, run the FULL gate suite in its provisioned env (supabase + sim), and open the PR. Gave explicit sim guidance (run `worktree-setup.sh`, set `IOS_SIM_AUTO_CREATE=1` or target a booted `BOGA wt35`/`wt43` via `IOS_SIM_UDID`) to prevent a repeat kill. Gate-assertion ownership stays with the builder.
- **Sim-infra watch:** the per-worktree sim-slot provisioning race is a recurring risk for t5b (running now) and all remaining sim-gated tasks (t6/t7/t8/t9/tFINAL). If t5b also dies on the sim gate, apply the same recovery and consider pre-creating sim slots or raising the issue with the user.

t5b builder (`a0894f935445c0fe0`) still running — watch for the same sim failure mode.

## Iteration 18 — 2026-05-29 — t5a recovered + PR #89 open; infra-fix task dispatched

- t5a finisher (`aa755572f1d39f3ea`) adopted the committed branch, confirmed the code was correct (no changes needed), and ran the FULL gate suite green: fast gate 44 suites / 375 tests; `check:sync-drift --strict` errors=0 (against local Supabase slot 44); `test:e2e:ios:smoke` + `test:e2e:ios:data-smoke` both passed (on a freshly-created `BOGA wt44`, after a cold-start expo-dev-client URL-scheme dialog warmed up — documented in the PR body as a harness timing issue, not a t5a regression). **[PR #89](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/89)** open at rev `91c4b6a`. Dispatched t5a reviewer.
- **User feedback captured (two corrections / asks):**
  1. **All agents have access to ALL tools.** A "missing" tool (e.g. the coordinator's `supabase: command not found` in iteration 17) almost always means `npm install` / worktree bootstrap hasn't run in that worktree — NOT that the tool is unavailable. My iteration-17 conclusion that "the coordinator lacks the toolchain" was a misdiagnosis. This must be made explicit in CLAUDE.md.
  2. **Fix the worktree/sim provisioning.** If a simulator isn't provisioned for a worktree, it should be provisioned on the fly rather than failing the gate. The recurring sim-slot race that killed the first t5a dispatch should self-heal.
- Dispatched a **standalone infra-fix builder** (outside the plan DAG — not a plan task, no tFINAL dependency) to: (a) make iOS sim provisioning automatic in the maestro/worktree scripts; (b) clarify the all-tools-available + npm-install point in CLAUDE.md; (c) validate by deleting its own sim slot and proving the smoke gate self-provisions. Ships as its own PR `[infra] …`. Tracked here for audit; will not gate plan tasks but benefits t6–tFINAL once merged.

t5b (`a0894f935445c0fe0`) still running.

## Iteration 19 — 2026-05-29 — t5a APPROVED

t5a reviewer posted **Verdict: APPROVED** on [PR #89](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/89) (plain-comment fallback). Reviewer independently ran `dirty-bit-layer-0-1.test.ts` (15/15 pass), confirmed the `exercise-tags.ts` split is byte-for-byte clean vs base (t5b merge will be conflict-free), verified the seeder clean-stamp and the type-level same-tx enforcement (`nowMonotonic(tx: Transaction)` rejects the bare db), and found no out-of-scope leakage. Awaiting human merge of PR #89.

Still in flight: t5b builder (`a0894f935445c0fe0`), infra-fix builder (`a51595486e374eea7`).

## Iteration 20 — 2026-05-29 — infra PR #90 (provisioning fixed; cold-start dialog amend dispatched)

- Infra-fix builder shipped [PR #90](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/90) at rev `c49edba`. **Root cause of the sim-slot race:** `maestro-env.sh` sources `.maestro/maestro.env.sample` (which set `IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}"`) BEFORE the local env file, so the var was already pinned to `0` and `worktree-setup.sh`'s `:-1` was a no-op. Fixed by defaulting to `1` in both `maestro-env.sh` and the sample; the auto-create code in `ios-sim-boot.sh` (newest-installed-runtime + preferred iPhone device type, no hard-coded version) already existed and now actually runs. Validated by deleting `BOGA wt46` and proving auto-create + boot + idempotency. CLAUDE.md/AGENTS.md + maestro docs updated with the all-tools-available + bootstrap-first guidance.
- **Second issue surfaced (not yet fixed):** both smoke gates on PR #90 exit non-zero, failing at the first app-flow assertion `stats-history-screen is visible` AFTER the sim is up + app installed. Builder labeled it "pre-existing app defect, out of scope." **Coordinator assessment: almost certainly the cold-sim first-launch expo-dev-client "Open in Boga3?" URL-scheme trust dialog** — t5a's finisher hit the identical failure on a fresh `BOGA wt44` and got past it by warming the dev-client once; t1/t2/t3/t4/t10 all passed on warm sims. Now that auto-provisioning creates a COLD sim on every fresh worktree, this dialog will fail the smoke gate for every downstream task (t6/t7/t8/t9/tFINAL) unless automated. A gate that auto-provisions but then fails on first launch isn't fixed.
- **Dispatched an amend** to PR #90: diagnose warm-vs-cold (run smoke on an existing booted sim vs the cold auto-created one); if it's the dev-client trust dialog, automate the first-launch warm-up in the provision/launch path so a freshly-provisioned sim passes the smoke GREEN; validate with delete+rerun showing a green smoke. If it's a genuine app regression instead, STOP and surface (do not fix app code in an infra PR). Holding the infra reviewer until the amend lands.

Still in flight: t5b builder (`a0894f935445c0fe0`); infra amend (PR #90).

## Iteration 21 — 2026-05-30 — session resumed after long gap; both background agents dead; recovered

Session was suspended ~15-19h and resumed. Re-derived state from host: only unrelated PR #88 merged since iter 20; **t5a #89 and infra #90 both still OPEN, awaiting human merge.** Both background agents were dead (no terminal notification across the gap):
- **t5b (`a0894f935445c0fe0`): dead, ZERO work product** (1125 min silent, empty worktree, no commits). Re-dispatching fresh.
- **infra amend (`ac66676eeceb638bb`): dead mid-fix** (881 min silent) with a well-built but uncommitted + unvalidated cold-start warm-up: a `maestro_warm_dev_client` fn (in `maestro-ios-runtime.sh`) that drives the dev-client `url=` + harness teleport, taps the optional "Open" trust dialog (no-ops on warm sims), and waits for the RN root to mount — warming URL-scheme trust AND the cold Metro bundle; plus a call site in `maestro-ios-run-flow.sh`. Diagnosis matches the coordinator's hypothesis (dialog + cold bundle compound to blow the 30s assertion window).
- **Recovery:** committed the warm-up to PR #90's branch at `d741c30` (preserving the careful logic), pushed. Dispatched an **infra finisher** to adopt `d741c30`, validate the warm-up green (delete sim → both smokes pass on a cold auto-created sim), iterate if it needs tweaks, and update the PR body. Holding the infra reviewer until validation lands.
- **Re-dispatched t5b fresh.** Its code is independent of the infra fix; for the sim gate (main lacks the infra fix until #90 merges) it's instructed to use the manual workaround t5a's finisher proved: export `IOS_SIM_AUTO_CREATE=1`, create the slot if missing, warm the dev-client once before the smoke. exercise-tags.ts split (session_exercise_tags only) reinforced so the eventual t5a/t5b merges stay conflict-free.

Awaiting human merge: t5a #89 (approved). In flight: infra finisher (PR #90), t5b (fresh).

## Iteration 22 — 2026-05-30 — t5b shipped (PR #91), reviewer dispatched

- t5b re-dispatch (`ae0b90ce494291443`) shipped [PR #91](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/91) at rev `5ea82d6`. All gates green: fast gate (lint+typecheck+370 jest), `check:sync-drift --strict` errors=0, `test:e2e:ios:smoke` + `test:e2e:ios:data-smoke` both 1/1. New `dirty-bit-layer-2-3.test.ts` (10 tests).
- **Notable deviations (relayed to reviewer):** (1) `replaceSessionExerciseGraph` threads a precomputed `localUpdatedAtMs: number` (one `nowMonotonic(tx)` per top-level tx, applied to the whole rebuilt graph) because its narrowed `Pick` tx type can't satisfy the helper's `Transaction`. (2) `removeTagAssignment` is a hard DELETE left unchanged — no row to dirty; soft-delete-everywhere is plan 3 t7. (3) `exercise-tags.ts`: only `createTagAssignment` touched; `exercise_tag_definitions` fns byte-for-byte unchanged → clean merge with t5a #89.
- **Sim insight captured for infra fix:** on iOS 26.2 the "Open in Boga3?" trust dialog is OUTSIDE Maestro's app-scoped accessibility tree — t5b dismissed it by **coordinate-tap**, not `tapOn: text "Open"`. The infra warm-up (PR #90, d741c30) currently uses `tapOn: text: "Open"` which may NOT clear the dialog on iOS 26.2. If the infra finisher reports the warm-up doesn't clear the dialog, relay the coordinate-tap approach (or a `simctl` URL-scheme pre-approval) as the fix.
- Dispatched t5b reviewer (PR #91).

Awaiting human merge: t5a #89, t5b #91 (after review). In flight: infra finisher (PR #90), t5b reviewer (PR #91).
Once t5a #89 AND t5b #91 both merge → t6 (cycle) unblocks.

## Iteration 23 — 2026-05-30 — infra data-smoke conclusion CHALLENGED; re-dispatched

Infra finisher (`a6fcef1a4d4306d21`) hardened the warm-up (`19e59f3`): smoke now passes GREEN cold. But it concluded data-smoke fails on a "pre-existing `reset=data` app-navigation regression" (fails on cold + warm identically) and recommended a separate app-fix task. **Coordinator REJECTS this conclusion as likely misdiagnosed:**
- t5a's finisher AND t5b BOTH reported `test:e2e:ios:data-smoke` PASSING green on main within the last day — contradicting "data-smoke is broken on main."
- The resolving detail (from t5b): on **iOS 26.2 the "Open in Boga3?" trust dialog is OUTSIDE Maestro's app-scoped accessibility tree**, so `tapOn: text "Open"` cannot dismiss it — t5b succeeded only by **coordinate-tap**. The infra warm-up (incl. the `19e59f3` hardening) STILL dismisses via `tapOn: text "Open"`, so it **never actually establishes URL-scheme trust**. Its "warm" validation sims were therefore effectively still untrusted → both its cold and warm data-smoke runs failed "identically." That's the warm-up failing to clear the dialog, NOT a pre-existing app bug.
- Second confound: PR #90 is based at `163affb`, BEHIND current main `5ea82d6` (missing #87 heatmap redesign + #88 padding — which touch the history/stats UI the data-smoke flow asserts). t5a/t5b ran WITH those; infra ran WITHOUT.
- **Did NOT spawn the app-fix task.** Re-dispatched the infra work to: (1) merge `origin/main` into the branch (kill the base-divergence confound); (2) run a CONTROL — establish trust definitively via coordinate-tap or `simctl` URL-scheme pre-approval (reproduce t5b) and run data-smoke → confirm it passes on current main; (3) fix the warm-up dialog dismissal robustly (prefer `simctl` URL-scheme pre-approval for determinism; coordinate-tap fallback per t5b); (4) validate BOTH smoke + data-smoke GREEN cold (delete sim → full auto-provision + warm-up + both flows); (5) escalate as a genuine app regression ONLY if data-smoke still fails with trust definitively established on current main.

In flight: infra re-finish (PR #90), t5b reviewer (PR #91). Awaiting human merge: t5a #89 (approved).

## Iteration 24 — 2026-05-30 — t5b APPROVED (conflict-free with t5a confirmed)

t5b reviewer posted **Verdict: APPROVED** on [PR #91](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/91) (plain-comment fallback). Ran `dirty-bit-layer-2-3.test.ts` (10/10) + `session-drafts-repository.test.ts` (12/12) + clean `tsc`. Both deviations verified sound (precomputed `localUpdatedAtMs` from one in-tx `nowMonotonic(tx)`; `removeTagAssignment` genuine hard DELETE strands no needed tombstone). **Ran a 3-way merge simulation off the identical base → t5a #89 + t5b #91 are conflict-free, import deduped, all four write sites present.** 591 additions, under budget.

**Both t5a #89 and t5b #91 are now APPROVED and awaiting human merge.** When BOTH merge, t6 (cycle — depends on t2 + t5a + t5b) unblocks.

In flight: infra re-finish (PR #90, `a79bc73ced011c3d7`). Awaiting human merge: t5a #89, t5b #91 (both approved).

## Iteration 25 — 2026-05-30 — infra re-finish died mid-fix; diagnosis CONFIRMED; work preserved

Infra re-finish (`a79bc73ced011c3d7`) died (~4.8h silent, no notification) but had done excellent work, **confirming the coordinator's iter-23 rejection of the "pre-existing app regression" conclusion**. It merged main in (`ce3a552`) and produced (uncommitted) two harness fixes for TWO compounding cold-sim causes — neither an app bug:
1. **Trust dialog — deterministic fix:** new `maestro_preauthorize_url_schemes` (in `maestro-ios-runtime.sh`, called from `maestro-ios-launch.sh` before the first `openurl`) seeds the `com.apple.launchservices.schemeapproval` SpringBoard preference (the same record iOS writes when a human taps "Open") for `exp+boga3` / `boga3` / bundle-id, keyed to the `simctl` CoreSimulatorBridge caller — so the dialog NEVER renders on a cold sim. (It also empirically found the "Open" button IS in Maestro's tree on iOS-26.2 after all, and kept text+coordinate taps as optional defense-in-depth.) The warm-up's remaining job is just driving the cold Metro bundle hot.
2. **data-smoke flow cold-sim flakiness — the REAL "data-smoke fails" cause:** `data-runtime-smoke.yaml` selected the exercise via a fragile `tapOn: point: "50%,26%"` that raced the cold-sim picker render and hit empty space (passed warm, failed cold). Replaced with exact seeded name (`Barbell Back Squat`) + `extendedWaitUntil` on the row's accessibility label + content-stable `tapOn: text` — strengthens the assertion, does not weaken it. **This vindicates not spawning the app-fix task: there is no app regression.**
- **Recovery:** reverted the `package-lock.json` worktree-name churn (the only junk), committed the 4 legitimate harness files (`2b10d58`), pushed to PR #90's head branch (fast-forward through the main-merge). Dispatched a finisher to validate BOTH flows green cold (delete sim → auto-provision → pre-auth → warm-up → both flows) and finish the PR. **Deviation flagged:** the flow-YAML edit goes beyond the original "infra/harness only, no flow YAML" instruction — accepted because the flow is test harness and the change makes it cold-robust; called out for reviewer scrutiny.

In flight: infra finisher (PR #90, `a27626a33407924a2`). Awaiting human merge: t5a #89, t5b #91 (both approved). t6 unblocks when t5a + t5b merge.

## Iteration 26 — 2026-05-30 — t5a comment-cleanup + merge dispatched

User flagged a minor review comment on PR #89 (`exercise-catalog.ts:186`): "remove this comment and all similar comments across all files" — i.e. strip the t5a-added inline `// Dirty-bit wiring (sync-v2-client t5a, …)` / `// Clean seed stamp …` explanatory comments across all five t5a files. User explicitly authorized merging #89 after.
- Dispatched `mao-builder` (`afb55745079e065c9`) to: checkout PR #89, remove the comments surgically (code byte-for-byte unchanged), run the fast gate (lint+typecheck+test — fully covers a comment-only change), push, and **merge #89** (`gh pr merge 89 --merge`, repo convention).
- **Sim gate intentionally skipped for this delta:** smokes were green at the reviewed rev `91c4b6a`; comment deletion has zero runtime impact; fast gate re-run suffices. Rationale recorded for the merge note. (Coordinator judgment call vs. the "sim per task" rule — proportionate for a comment-only post-approval tweak.)
- **t5b #91 note:** it carries the identical comment style (`// Dirty-bit wiring (sync-v2-client t5b…)`). User scoped this request to t5a only — will offer the same cleanup for t5b before its merge rather than expand scope unasked.

In flight: t5a cleanup+merge (`afb55745079e065c9`), infra finisher (PR #90, `a27626a33407924a2`). Awaiting: t5b #91 merge (approved). t6 unblocks when t5a + t5b both merge.

## Iteration 27 — 2026-05-30 — t5a MERGED; protocol change (ephemeral plan refs); t5b comments dispatched

- **t5a [PR #89] MERGED** (merge commit `3f25ee8`; comment-cleanup commit `816f71b`). Hand-off verified on `origin/main`: Layer 0/1 dirty-bit wiring present, the `(sync-v2-client t5a…)` comments gone, `createTagAssignment` (session_exercise_tags) still un-wired (correct — t5b owns it). Appended t5a to plan.md `## Deviations log`. **t6 still needs t5b.**
- **PROTOCOL CHANGE (user directive):** plans, task cards, and design docs are ephemeral (audit deletes `<plan-root>/`), so durable code/comments/tests/docs/commit-messages must NEVER reference plan/card/design ids or `docs/plans/...` paths. Encoded into the mao skill (canonical at `~/.claude/plugins/local/multi-agent-orchestration/`):
  - `agents/mao-builder.md` — new "Durable code must not reference the ephemeral plan" section + grep-before-PR step.
  - `agents/mao-reviewer.md` — new check #10 (reject leaked references).
  - `skills/.../SKILL.md` — new "For all" subagent-prompting rule.
  - `references/templates.md` — PR-body Standard-checklist item + builder & reviewer prompt rule.
  - Exemptions: PR title `[<id>]` tag, PR body, and the orchestrator's `status.md` / `## Deviations log` (transient host/plan state).
  - **Going forward, all builder/reviewer dispatch prompts inherit this; coordinator will also state it inline until the new agent defs are confirmed in effect.**
- **t5b [PR #91] review comments dispatched** to `mao-builder` (`a814725fc1a43d82b`), NOT merged (user said "address those"): (1,3,4) strip task-card references from code/test comments (now also the standing rule); (2) extract a shared in-memory-SQLite test helper that applies all migrations, refactor BOTH the merged `dirty-bit-layer-0-1.test.ts` and `dirty-bit-layer-2-3.test.ts` onto it (consistency, no duplicated setup), adopt in `clock.test.ts` where clean, and document the pattern in the testing-strategy docs. Fast gate required; sim skipped (test/comment/doc-only delta). After it lands, dispatch a re-review (substantive test-infra refactor) then surface for owner merge.

In flight: infra finisher (PR #90, `a27626a33407924a2`), t5b comment-fix (`a814725fc1a43d82b`). Awaiting owner merge: none currently green-and-clean (t5a merged; t5b being revised). t6 unblocks when t5b merges.

## Iteration 28 — 2026-05-30 — infra #90 validated (smoke GREEN cold); data-smoke = genuine app bug

Infra finisher v2 (`a27626a33407924a2`) validated PR #90 at `2b10d58` (no new commits needed):
- **`smoke` GREEN on a genuinely cold sim** (deleted `BOGA wt50` first): auto-create ✓, URL-scheme pre-auth ✓ (trust dialog gone — `tapOn:"Open"` = Element not found), warm-up logged RN root mounted, `1/1 Flow Passed in 17s`. **Infra deliverables 1 (auto-provision) + 2 (pre-auth) are validated working.** Quality gate clean (43 suites / 360 tests).
- **`data-smoke` still red — but now traced to a real app bug, not harness.** With the two cold-start confounds removed, it now clears recorder entry + exercise selection on cold, then fails LATER at `Tap "Weight for exercise 1 set 1"` (picker stuck open showing TWO identical "Barbell Back Squat" rows). On a WARM, already-trusted sim it ALSO fails, at a DIFFERENT/earlier step (stale "squat" filter, recorder empty-state missing). Different failure cold vs warm + no dialog on either ⇒ **pre-existing non-deterministic `reset=data` app-state contamination**: the `(tabs)/session-recorder` instance survives `router.replace` after `resetLocalAppData()`, so its in-memory draft + open picker + stale filter aren't reset on re-entry. Branch changes zero app/src files; suspects: `app/(tabs)/session-recorder.tsx`, `app/maestro-harness.tsx`, `src/data/bootstrap.ts`.
- This is the SECOND "app issue" conclusion; unlike iter-23's (which was wrong — really the dialog + coordinate tap), this one survives scrutiny: the two harness confounds are now provably eliminated, and it fails on warm too. Coordinator accepts it as a likely-genuine app bug **outside the sync-v2-client plan's scope** (session-recorder reset, not sync dirty-bit).
- **Consequence for the plan's data-smoke gate:** once auto-provisioning lands, future tasks run on COLD sims; if the recorder reset bug stands, cold-sim data-smoke is unreliable for every remaining task. Needs resolution. **Escalated to owner for the call (merge #90 + spin off the recorder fix, vs hold #90, vs investigate further).**

In flight: t5b comment-fix (`a814725fc1a43d82b`). PR #90 validated (smoke green) awaiting owner decision on the data-smoke app bug. t6 unblocks when t5b merges.

## Iteration 29 — 2026-05-30 — owner fixed the reset=data race (PR #92); re-validating #90

Owner merged **PR #92** (`2d4574b`, merge `eff6d9c` — now main HEAD): *"serialize data-layer reset/bootstrap so reset=data lands on stats-history."* This is exactly the app bug the infra finisher diagnosed (iter 28) — **the finisher's second diagnosis was correct.** The fix:
- `src/data/bootstrap.ts` — routes every data-layer op through a single async lock chain so reset's close→delete→reopen runs atomically; concurrent bootstraps queue behind it (was a native-SQLite crash/hang race).
- `app/maestro-harness.tsx` — depends on stable primitive params so the `reset=data` action fires once per URL, not on every re-render.
- new `local-data-bootstrap.test.ts` regression test.
- #92's own verification: smoke green; **data-smoke green 2/3, the lone failure at the brittle `point 50%,26%` exercise-picker tap** — which is precisely what infra #90's by-name selector (`Select exercise Barbell Back Squat`) replaces.
- **⇒ #90 (URL-scheme pre-auth + by-name selector) + #92 (reset/bootstrap serialization) are complementary; together data-smoke should be fully green.** The earlier AskUserQuestion was dismissed because the owner went and fixed the app bug directly.
- Dispatched an infra finisher to: adopt #90 (`2b10d58`), merge the new `origin/main` (incl. #92), re-run BOTH smokes cold, and if green finalize #90 (both-flows-green PR body + evidence). Reviewer to follow once green.

In flight: t5b comment-fix (`a814725fc1a43d82b`), infra #90 re-validation (`<dispatching>`). t6 unblocks when t5b merges.

## Iteration 30 — 2026-05-30 — t5b comments addressed; re-review dispatched

t5b comment-fix (`a814725fc1a43d82b`) updated [PR #91] at `988f95b`, all 4 owner comments addressed:
- New shared helper `apps/mobile/app/__tests__/helpers/in-memory-db.ts` applies ALL migrations from the generated bundle (`drizzle/migrations.generated.ts`) in journal order — single source of truth, no hand-copied DDL. Returns drizzle handle + raw client + `close()`.
- BOTH `dirty-bit-layer-2-3.test.ts` and the merged `dirty-bit-layer-0-1.test.ts` (t5a's, pulled via `origin/main` merge) refactored onto the helper as a consistent matched pair — no duplicated DB setup.
- `clock.test.ts` intentionally NOT migrated (it creates only `sync_runtime_state` as a negative-space guard that the clock must touch no other table; full-schema fixture would erase that signal) — documented exception; its card refs removed.
- Plan/card references removed from `exercise-tags.ts`, `session-drafts.ts`, and the test comments (per the new standing protocol rule).
- `docs/specs/06-testing-strategy.md` gained an "In-memory SQLite unit tests (shared fixture)" section.
- Fast gate GREEN (45 suites / 385 tests; 3 pre-existing `import/first` warnings only). Sim NOT re-run (test/comment/doc-only delta — zero app-runtime impact).
- **Spin-off flagged:** pre-existing ephemeral-plan references in files OUTSIDE this PR (`topo-order.ts`, `dev-reset.ts`, `clock.ts`, `schema/sync-runtime-state.ts`, `domain-schema-migrations.test.ts`) — left for a separate repo-wide cleanup to keep #91 scoped.
- Dispatched t5b RE-review (substantive delta: shared helper + refactor of a merged test + doc). After APPROVED → surface for owner merge → t6 unblocks.

In flight: infra #90 re-validation (`aa27bfdfc7a66daa5`), t5b re-review (`<dispatching>`). t6 unblocks when t5b #91 merges.

## Iteration 31 — 2026-05-30 — t5b MERGED; t6 (cycle) dispatched

- **t5b [PR #91] MERGED** (`ed25e51`, merged after the owner; the re-review `a604b4e64783f2eae` is now moot). Hand-off verified on `origin/main`: Layer 2/3 dirty-bit wiring present in `exercise-tags.ts`/`session-drafts.ts`, shared helper `apps/mobile/app/__tests__/helpers/in-memory-db.ts` present. Appended to plan.md `## Deviations log`.
- **t6 (cycle) is now unblocked** — its deps t2 + t5a + t5b are all merged. It is the sole ready task (t7/t8 need t6; t9 needs t6; tFINAL needs t3/t8/t9/t10). Dispatched `mao-builder` for t6 (`apps/mobile/src/sync/cycle.ts` — pull→push→pull convergence per t2 §6, layered drain §4.4, push batch §3.4, push-in-flight race §7.3, AUTH_REQUIRED/FK_VIOLATION/INTERNAL handling §2.2; RPC signatures from plan 1 — named `entities` for push, unnamed jsonb for pull). Prompt carries: import `topo-order.ts` (don't redefine), use the shared `in-memory-db.ts` test helper per the new testing-strategy doc, the standing no-ephemeral-references rule, and the manual-sim workaround (since infra #90 isn't merged yet).
- **Sim infra status:** infra #90 (auto-provision + URL-scheme pre-auth + by-name data-smoke selector) is in re-validation on top of #92; once it's green + owner-merged, remaining tasks' sim gates self-heal. Until then, builders use the manual workaround. #92 (reset=data fix) is already on main, so data-smoke's stats-history assertion now passes; the brittle exercise-picker coordinate tap remains on main until #90 merges.

In flight: t6 builder (`a7c5f95f8a90a0a60`), infra #90 re-validation (`aa27bfdfc7a66daa5`). Next after t6 merges: t7 + t9 in parallel.

## Iteration 32 — 2026-05-30 — t5b re-review APPROVED (post-merge); cleanup spun off

- t5b re-review (`a604b4e64783f2eae`) posted **Verdict: APPROVED** (PR #91 was already merged ahead of it; verdict moot for the gate but confirms the merged state is sound): verified the shared `in-memory-db.ts` helper produces the FULL v2 schema (Layer 2/3 tables carry `local_dirty`/`local_updated_at_ms`/`deleted_at` → dirty-bit assertions non-vacuous), the t5a test refactor dropped no `expect` bodies, and the dirty-bit wiring in `session-drafts.ts`/`exercise-tags.ts` is unchanged. 45 suites / 385 tests pass.
- **Spun off** (via spawn_task chip, owner can one-click) the repo-wide ephemeral-plan-reference cleanup the re-review re-flagged: pre-existing refs in `topo-order.ts`, `dev-reset.ts`, `clock.ts`, `schema/sync-runtime-state.ts`, `domain-schema-migrations.test.ts`. Comment/string-only, no logic; should land before the plan's final audit. Not on the critical path.

## Iteration 33 — 2026-05-30 — infra #90 re-validated: smoke GREEN, data-smoke isolated to a 1-call app bug

Infra #90 re-validation (`aa27bfdfc7a66daa5`) on top of #92, PR #90 now at `81c6c45` (main merged in, fast-forward):
- **`smoke` GREEN cold** (auto-create + 3-scheme pre-auth + warm-up; `1/1 Flow Passed 17s`). All of #90's harness fixes validated working. Fast gate green (44 suites / 376 tests).
- **`data-smoke` RED, deterministic 2/2** at `Tap "Weight for exercise 1 set 1"`. Everything upstream now works (#92 nav fix lands `session-recorder-empty-state`; by-name selector active) — but the exercise picker shows **two duplicate "Barbell Back Squat" rows** (both screenshots confirm), so the by-name tap can't resolve to one and the modal stays open.
- **Root cause (precise):** #92 serialized the DB reset/bootstrap race but did NOT invalidate the in-memory exercise-catalog cache on reset. `resetLocalAppData()` (`apps/mobile/src/data/bootstrap.ts`) wipes + re-seeds SQLite but never calls `invalidateExerciseCatalogCache()`; the `useSyncExternalStore` cache in `apps/mobile/src/exercise-catalog/cache.ts` keeps its pre-reset snapshot and renders it alongside the re-seeded catalog ⇒ duplicate rows. In-memory staleness, not DB duplication (seed idempotent, keyed by id). **Fix:** call `invalidateExerciseCatalogCache()` from `resetLocalAppData()` (or `runMaestroHarnessReset('data')`).
- Finisher correctly did NOT touch app code (#92/owner owns the reset path) and did NOT falsely claim green; posted evidence on PR #90.
- **Blocking implication:** #90's by-name selector EXPOSES this bug deterministically (can't pick between two identical rows); the original coordinate-tap flow on `main` MASKS it. So #90 must not merge until the cache-invalidation fix lands, and the data-smoke gate isn't honest for downstream tasks until then. **Surfaced to owner** (same reset path they fixed in #92) — recommended the one-call fix; offered to dispatch a small PR if they prefer.

In flight: t6 builder (`a7c5f95f8a90a0a60`). Awaiting owner direction on the exercise-catalog-cache invalidation fix (blocks data-smoke gate + #90 merge). PR #90 validated for smoke; held on data-smoke.

## Iteration 34 — 2026-05-30 — owner: fold cache-invalidation fix into #90

Owner directed: fix the exercise-catalog-cache invalidation **as part of PR #90** (so #90 lands fully green for both flows). Dispatched a builder to:
- Add `invalidateExerciseCatalogCache()` to the reset path — preferably inside `resetLocalAppData()` (`apps/mobile/src/data/bootstrap.ts`) so every reset caller (incl. t9's dev wipe) gets it; watch for data→exercise-catalog import cycles and fall back to the reset call sites if needed.
- Re-validate BOTH smokes GREEN on a cold sim (the duplicate-rows failure must be gone).
- Finalize #90 body (both flows green) and post evidence. Do NOT merge.
- #90 now legitimately includes a small app-code fix (reset-path cache invalidation) in addition to the harness fixes + flow change; this is the owner-sanctioned exception to the earlier "infra/harness only" scope.
After it's green, dispatch a reviewer for #90 (it has grown to harness + flow + app reset-path fix), then surface for owner merge.

In flight: t6 builder (`a7c5f95f8a90a0a60`), #90 cache-fix + re-validate (`a0429030c079e4e7d`).

## Iteration 35 — 2026-05-30 — t6 builder stalled post-implementation; work preserved; finisher dispatched

t6 builder (`a7c5f95f8a90a0a60`) stalled (stream watchdog, 600s) AFTER implementing — produced complete-looking work uncommitted: `apps/mobile/src/sync/cycle.ts` (647 lines, all required exports — `runSyncCycle`/`selectPushBatch`/`applyPullPage`/`entityToWire`/`wireToEntity`, `BATCH_CAP=200`, `MAX_CYCLES_PER_CALL=5`, `classifyRpcResult`, wire+cursor types; no TODO/placeholder markers) + 5 test files (~932 lines: push/pull/convergence/race/wire). Same pattern as the t5a stall.
- **Preserved:** reverted the `package-lock.json` worktree-name churn, committed the 6 files (`b25de0e`, self-contained commit message per the no-ephemeral-refs rule), pushed branch `worktree-agent-a7c5f95f8a90a0a60`.
- **Dispatched a finisher** to adopt the branch, verify against `tasks/t6.md`, run the full gate (fast + sims, manual-sim workaround), fix anything that fails, and open the `[t6]` PR. Gate-assertion ownership stays with the finisher.
- **data-smoke caveat for the finisher:** main currently has the stale-catalog-cache duplicate-rows bug (fix in flight on #90, not merged). If t6's data-smoke fails ONLY at the exercise-picker/"Weight for exercise" step with duplicate rows, that's the known #90-tracked issue, NOT a t6 regression (t6 changes the sync engine, which data-smoke doesn't exercise) — document it, don't treat as a t6 failure. fast-gate (runs the cycle unit tests — the actual deliverable) + smoke must pass.

In flight: t6 finisher (`<dispatching>`), #90 cache-fix + re-validate (`a0429030c079e4e7d`).

## Iteration 36 — 2026-05-30 — #90 FULLY GREEN (coordinator-validated); t6 typecheck fixed; both reviews/gates running

**Agents keep dying on the long, quiet iOS sim runs (stream watchdog at 600s).** Two more deaths this iteration: the t6 finisher (`a69e84b7618736c73`, killed mid-gate) and the #90 cache-fix agent (`a0429030c079e4e7d`, ~2.8h silent). Both had done their work. Coordinator broke the cycle by **running the validation directly** (the main loop isn't subject to the subagent watchdog; sims run via detached background Bash).

**#90 — DONE, both flows GREEN:**
- The dead #90 cache-fix agent had (uncommitted) TWO complementary fixes for the duplicate-rows/stuck-picker data-smoke failure: (1) `resetLocalAppData()` now calls `invalidateExerciseCatalogCache()` after re-seed (inside the lock) + a bootstrap regression test; (2) `session-recorder.tsx` exercise-picker `ScrollView` set to `keyboardShouldPersistTaps="handled"` (the default `"never"` ate the first row tap dismissing the keyboard → exercise never selected). Both are sound, owner-authorized (folded into #90).
- Coordinator preserved + committed (`0a3c3a3`), pushed to #90's branch, ran the fast gate (**44 suites / 377 tests GREEN**), then ran BOTH sims in a detached background shell on a cold auto-created sim: **smoke 1/1 Passed 18s; data-smoke 1/1 Passed 54s** (no trust dialog; single Barbell Back Squat row; exercise selected). Posted `[coordinator]` evidence comment. Dispatched final #90 reviewer (`a5753315e98cea733`) — diff + fast gate only, sims NOT re-run (rely on the posted evidence). **#90 ready to merge once reviewed.**

**t6 — code validated at unit level:**
- The stalled-builder's commit `b25de0e` had 3 tsc errors in `sync-cycle-wire.test.ts` (narrow inferred type on `sample`). The killed t6 finisher's uncommitted tweak fixed exactly this; coordinator applied it (`sample: Record<string, unknown>`) in the t6 worktree and is re-running the fast gate (`b7kg6w7mt`). Once green, commit the fix + open the `[t6]` PR.
- **t6 data-smoke dependency:** the duplicate-rows fix lives in #90 (not yet on main), so t6's data-smoke on current main would still hit it. Plan: once #90 merges, t6 merges main → clean sims. t6's real deliverable (the cycle) is proven by the fast gate (unit tests) + smoke.

In flight: t6 fast gate (`b7kg6w7mt`), #90 final reviewer (`a5753315e98cea733`). Next: merge #90 (owner) → finish t6 sims on top of it → open t6 PR.

## Iteration 37 — 2026-05-30 — #90 APPROVED + body fixed → ready for owner merge; t6 typecheck clean

- **#90 reviewer APPROVED** (`a5753315e98cea733`, plain-comment fallback). Verified all four parts (auto-provision default flip; pre-auth best-effort/idempotent; the two app fixes — cache invalidation after re-seed inside the lock with the `invocationCallOrder` regression test, and the picker `keyboardShouldPersistTaps="handled"`; cold-robust flow selector). Ran fast gate (44/377) + `local-data-bootstrap.test.ts` 6/6; did NOT re-run sims (relied on coordinator's cold-sim evidence per instruction). (The harness "security warning" is a false positive — posting the Verdict comment is the reviewer's role; self-approve correctly blocked → plain comment.)
- Reviewer flagged stale "data-smoke does NOT pass" text in the PR body. **Coordinator corrected the body** (banner + flipped the two checklist boxes to reflect both-flows-green at `0a3c3a3`).
- **Infra PR #90 is now: APPROVED + both flows green cold (coordinator-validated) + body accurate → READY FOR OWNER MERGE.** Merging it makes the data-smoke gate honest + self-provisioning for every remaining task.
- **t6:** the wire-test typecheck fix cleared the 3 tsc errors on `b25de0e` (`npx tsc --noEmit` clean); the cycle jest run is finishing. Once green, commit the fix + open the `[t6]` PR. t6's data-smoke goes clean once #90 is on main (merge main into t6 then).

In flight: t6 cycle jest run (`bui11ofpk`). **Awaiting owner merge of #90** (approved, green). Then: finish t6 (merge main → sims → PR).

## Iteration 38 — 2026-05-30 — #90 MERGED; CI fast-gate flaky test → fix dispatched

- **#90 MERGED** (merge `a15a389`). main CI on a15a389 = **SUCCESS** (auto-provision + pre-auth + cache/keyboard fixes all on main now; sim gate self-heals for downstream tasks). Need to append #90 to plan.md deviations (next).
- **Owner flagged CI fast-gate failures.** Investigated: the CI run on the #90 branch (`0a3c3a3`) failed ONE jest test — `app/__tests__/settings-profile-navigation.test.tsx` › "submits authenticated email updates…" (line 389) — `Unable to find element with text: "Email change submitted…"`. main's own merge run (a15a389) PASSED the same test ⇒ **flaky, not a hard regression.**
- **Root cause:** async-assertion race. The test `await waitFor(updateUserEmail called)` then does a SYNCHRONOUS `expect(screen.getByText('Email change submitted…')).toBeTruthy()`. The success message renders after the submit promise resolves + a state flush, so under CI load the sync `getByText` fires before it mounts. (`permission denied for table app_logs` / `insert failed` console noise = an unawaited logging side-effect in the same path.) Unrelated to #90's code; #90's merge likely just shifted module-init timing enough to expose it.
- **Dispatched a standalone fix-it builder** to harden it: replace the bare `getByText` with `await screen.findByText(...)` / `waitFor`, sweep the file for the same synchronous-after-async antipattern, quiet/await the app_logs logging side-effect if it contributes, and prove stability over many repeated runs. Test-only change → fast gate + repeated-run stability; sim skipped. Standalone PR (CI hygiene, not a plan task).

In flight: t6 cycle jest run (`bui11ofpk`), CI flaky-test fix (`<dispatching>`). #90 merged.

## Iteration 39 — 2026-05-30 — ROOT CAUSE of every t6 stall: cycle tests leak an open handle (jest hangs)

Owner: "these tests seem way too slow." Investigated and found the real cause of ALL the t6 builder/finisher stalls:
- `apps/mobile/package.json` `test` script is plain `jest` — **no `--forceExit`**, no `testTimeout`/forceExit in jest config (`preset: jest-expo` only).
- The cycle test suite leaves an **open async handle**. Proof: `sync-cycle-wire` (11 pure serialization tests, no `runSyncCycle`/RPC) passes in **0.68s** but jest prints *"Force exiting Jest: …async operations that kept running after all tests finished"* — only because I passed `--forceExit`. Under the real gate (`jest`, no `--forceExit`), jest **hangs forever at the end** after tests pass → zero output → the 600s stream watchdog kills the agent. The 44-suite gate exits cleanly WITHOUT cycle tests, so the leak is in the cycle suite.
- Likely leak: importing `cycle.ts` pulls in the real `@/src/auth/supabase` → `@supabase/supabase-js`; test files that don't mock `@/src/auth/supabase` (e.g. the wire test) load the real client/transport. (Needs `--detectOpenHandles` to pin exactly.)
- This also = the "too slow" symptom (hang ≈ infinite slowness) AND would hang CI on t6's PR.
- **Committed** the wire-test typecheck fix to the t6 branch (`767dcb8`; `b25de0e` had 3 tsc errors there). **Dispatching a finisher** whose PRIMARY job is to eliminate the open handle so `npx jest sync-cycle` exits cleanly WITHOUT `--forceExit`, then full fast gate exits cleanly, then sims + PR.

CI flaky-test fix shipped separately: **[PR #94]** (5 async assertions hardened in `settings-profile-navigation.test.tsx`, 50/50 stable) — ready for review/merge.
In flight: t6 finisher (open-handle fix) `<dispatching>`; PR #94 (flaky-test fix) awaiting review.

## Iteration 40 — 2026-05-30 — t6 PR #95 open (push-leg infinite-loop fixed); reviewer dispatched

t6 finisher (`a778b44c4a0d5c83f`) completed → **[PR #95] `[t6] cycle implementation`** open. The "open handle" was a misread symptom; the real defect was an **infinite loop in `runPushLeg`** (`cycle.ts`): the push-in-flight race test re-edits the row on every push, so `local_updated_at_ms` always moves past the captured `sent_at_ms` → ack never clears the dirty bit → `selectPushBatch` returns the same row → spin forever (jest then hung after all other tests passed → 600s watchdog kill — this is what killed every prior t6 dispatch). **Real cycle correctness bug, not just a test artifact.** Fix (`8a61f03`, +21 lines): forward-progress guard — `runPushLeg` tracks row identities already sent this drain and breaks once a batch contains no new row, deferring the perpetually-dirty row to the next convergence round (matches the dirty-bit lifecycle: "next cycle re-pushes the newer value"). Deliberately did NOT add `--forceExit`/`testTimeout` (would mask leaks repo-wide).
- **Proof the hang is gone:** `npx jest sync-cycle` (no flags) → 5 suites / 35 tests, ~2s, EXIT=0, no "Force exiting". Full gate `quality-fast.sh frontend` → 50 suites / 422 tests, whole gate EXIT=0 in ~14s.
- **Sims at `8a61f03`:** smoke 1/1 Passed, data-smoke 1/1 Passed (both clean on #90's auto-provisioned cold sim).
- Diff 1604 added lines (cycle.ts + 5 sync-cycle-*.test.ts), within budget. Branch had main merged in (#90 + #93).
- Dispatched a thorough t6 reviewer — scrutinize the push-leg forward-progress guard (terminates AND doesn't drop rows that must push AND preserves the §7.3 race contract), the cycle contract vs t2 §3/4/6/7, and confirm the gate exits cleanly without `--forceExit`.

In flight: t6 reviewer (PR #95) `<dispatching>`. After t6 merges → t7 (scheduler) + t9 (dev wipe) fan out in parallel.

## Iteration 41 — 2026-05-30 — t6 APPROVED → ready for owner merge

t6 reviewer (`a7bbdfb25baeb533a`) posted **Verdict: APPROVED** on [PR #95] (plain-comment fallback). Deep-checked the push-leg forward-progress guard: per-drain `attempted` Set breaks only when a whole batch introduces no new `(type,id)`; genuinely-new dirty rows still drain (no dropped work); deferred rows stay `local_dirty=1` and re-push next round; §7.3 race contract intact (ack clears only on `current === sent_at_ms`; race test asserts dirty stays 1); `MAX_CYCLES_PER_CALL` bounds a re-edit storm; convergence terminates in two rounds. Full cycle contract verified vs t2 §3/4/6/7 + wire field maps column-for-column. **Re-ran the gate at `8a61f03` with NO `--forceExit`: `npx jest sync-cycle` 5 suites/35 tests EXIT=0, no force-exit/open-handle message** — hang fixed via control flow, no mask. Full gate 50 suites/422 tests EXIT=0. Sim checklist `sim-smoke + data-smoke pass: YES (built rev 8a61f03)` matches.
- **t6 #95 ready for owner merge.** On merge → dispatch t7 (scheduler, t4 §2) + t9 (dev-wipe affordances behind isDevMode) in parallel (both depend on t6). Then t8 (BG-task) after t7; tFINAL last (depends on t3+t8+t9+t10 — all but t8 already merged).

**Recurring note:** worktrees keep showing a stray `package-lock.json` name-field churn from `npm install`; coordinator reverts it before any commit. Harmless; flagging in case it's worth a `.gitignore`/script tweak later.

Awaiting owner merge of PR #95 (t6).

## Iteration 42 — 2026-05-30 — t6 MERGED; context-restart checkpoint

- **t6 [PR #95] MERGED** (`eee3704`). Hand-off verified on `origin/main`: `apps/mobile/src/sync/cycle.ts` + the 5 `sync-cycle-*.test.ts` present. Appended t6 to plan.md `## Deviations log` (incl. the push-leg infinite-loop fix). Added the RESUME CHECKPOINT block at the top of this file.
- **Owner is restarting the coordinator session to clean up context.** Per request: (1) plan.md + status.md brought fully current; (2) opening a PR to merge the orchestration-doc updates (plan.md, status.md, tasks/t2.md pointer, tasks/t10.md card, tasks/tFINAL.md test-12) from the coordinator branch onto `main` so the next session reads current state from `main`; (3) spinning up a task chip for the owner to run all tests + time them (the test-performance concern that surfaced the t6 open-handle/hang).
- **Next session:** dispatch t7 (scheduler) + t9 (dev-wipe) in parallel.

(End of checkpoint — next entries belong to the resumed coordinator session.)

## Iteration 43 — 2026-05-31 — session resumed; t7 + t9 dispatched, both APPROVED; t9 cold-sim location-dialog surfaced

**State re-derived from host on resume:** main HEAD `9d9179d`. Since the t6 checkpoint, two PRs merged: **#96** (the prior session's orchestration-doc update) and **#97** (`test(mobile): hang-safety nets + faster combined iOS e2e gate` — the owner's test-perf follow-up: `jest.config.js` now sets `testTimeout: 15000` [no `--forceExit`], a global inert Supabase mock in `jest.setup.ts`, a `test:handles` open-handle guard, and a NEW combined `test:e2e:ios:gates` runner that shares one provision/launch/warm/teardown across BOTH flows). No open PRs at resume. All plan tasks merged: t1, t2, t3, t4, t5a, t5b, t6, t10. Ready: **t7** + **t9** (both depend only on t6).

**Dispatched (parallel `mao-builder`):** t7 (scheduler, t4 §2) and t9 (dev-wipe affordances behind `isDevMode()`). Both prompts carried the post-#97 hang-safety guidance (jest now has `testTimeout`; run `test:handles`; never `--forceExit`), the self-provisioning sim note, the no-ephemeral-refs rule, and (t9) the no-`__DEV__` rule.

**Both shipped + APPROVED:**
- **t7 → [PR #98](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/98)** (`b5c1a73`): `scheduler.ts` four-state machine literal, both transition tables cell-for-cell, NetInfo sole authority, AppState foreground edge, cold-launch `requestSync()`, `_layout.tsx` wired, 32-test cell-by-cell suite. Fast gate 51 suites/456 tests, `test:handles` clean, **both sim flows GREEN** (smoke 20s, data-smoke 1m4s). Reviewer **APPROVED** (all 11 Outcomes substantiated; accepted both deviations — defensive try/catch around listener registration, and the environmental infra notes which are correctly NOT in the diff). Added `@react-native-community/netinfo@11.4.1` (t8's 3 deps correctly absent). **Ready for owner merge.**
- **t9 → [PR #99](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/99)** (`d82f498`): `dev-affordances.ts` (sync-throw via non-async wrapper), two Settings buttons behind the existing `isDevMode()` block (remote-wipe modal → RPC → local wipe), backend migration `20260531120000_dev_wipe_my_data.sql` (`security definer`, fail-closed env guard, all 8 entity tables owner-scoped, contract test). Fast gate 52 suites/433 tests, `test:handles` clean, **backend slow gate PASS** (3 contract scenarios). Reviewer **APPROVED** on code merits + full security review of the migration (env guard fails closed incl. when unset; all 8 tables covered; grants correct; sync-throw genuine). **iOS sim gate RED — control-proven environmental:** builder ran `git stash -u` (tree == `origin/main`) + `test:e2e:ios:smoke` and reproduced the IDENTICAL `session-recorder-screen` failure on clean main → NOT a t9 regression.

**Cold-sim location-permission dialog (root cause of t9's sim red):** the maestro launch path pre-authorizes URL schemes (#90's `maestro_preauthorize_url_schemes`, `maestro-ios-launch.sh:54`) but NOT location permission. Provision does a `full` reset (uninstall+reinstall) which clears location TCC, so the native location dialog renders at session-start and blocks the render-visibility assertions (app renders fine underneath, no JS error). t7 hit this EXPLICITLY and got both flows green by granting `location-always` to the sim; t9 didn't apply the grant → its run + its clean-main control both failed identically at `session-recorder-screen`. This gap will recur for **t8 and tFINAL** (every cold-sim run). The durable fix mirrors #90: add a location pre-auth to the launch path. **Surfaced to owner for the call** (durable infra PR vs one-off coordinator-validated grant vs merge-t9-as-is) since the owner has owned every sim-infra decision historically and both PRs are ready for their merge.

**No forward dispatch possible until owner acts:** t8 depends on t7 (APPROVED, not merged); tFINAL depends on t8+t9. Critical path waits on (a) owner merging t7 → unblocks t8, and (b) the t9 sim decision.

## Iteration 44 — 2026-05-31 — owner picked durable infra fix; PR #100 (cold-sim location pre-auth) shipped + validated; reviewer dispatched

Owner answered the t9-sim question: **"Durable infra PR."** Dispatched a background `mao-builder` (`aec4b5d0a5cafbb8d`) to add location pre-authorization to the maestro launch path (mirroring #90's URL-scheme pre-auth).

**[PR #100](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/100) `[infra] cold-sim location-permission pre-authorization`** (`c38e11a`, off `main` 9d9179d, NOT merged). Harness-only, 2 files / 54 insertions:
- `maestro-ios-runtime.sh` — new `maestro_preauthorize_location()` (grants `location-always` + `location` via `xcrun simctl privacy <udid> grant`; best-effort, idempotent, loud, returns 0 on missing args).
- `maestro-ios-launch.sh` — calls it immediately after `maestro_preauthorize_url_schemes` (post-install, post-boot).

**Validation (rigorous — a real baseline-vs-fix control on a genuinely cold auto-created "BOGA wt61"/udid `91B4D6FA…` sim, deleted before each run, no manual grant):**
- BASELINE (grant skipped): smoke FAILED 47s (`session-recorder-screen is visible` = false), data FAILED → exit 1. **Reproduces PR #99's failure exactly.**
- WITH FIX: pre-auth log + both grants succeeded for `com.anonymous.boga3`; smoke PASSED 17s, data PASSED 53s → exit 0. **Both flows GREEN.**
- Fast gate 50 suites/422 tests PASS.
- Honest deviation: first draft had a no-arg `simctl privacy` support-probe that misfired under `set -o pipefail` (usage text + SIGPIPE) and silently skipped the grant (that produced the baseline run); removed it — helper now grants directly with graceful fallback. Note: `simctl privacy grant` needs a BOOTED sim (405 on shutdown) — the post-boot call site is correct; a maintainer reordering must keep it post-boot.

**Diagnosis now triply confirmed** (t7's manual grant green; t9's clean-main control red; #100's baseline-vs-fix control). Dispatched `mao-reviewer` for #100 → **APPROVED** (traced the provision→`bootstatus -b`→reinstall→launch chain: grant is always post-boot, 405-on-shutdown regression impossible; confirmed the fragile probe is gone from shipped code; judged the control-based evidence sound). **Merge order for owner:** #100 first (makes t8/tFINAL gates honest), then t7 #98 (unblocks t8), then re-validate t9 #99 sims on top of #100 → merge. After t7 merges → dispatch t8. After t8+t9 → tFINAL.

## Iteration 45 — 2026-05-31 — owner left 6 inline comments on t7 #98; all addressed + replied, PR updated green

Owner posted 6 inline review comments on `apps/mobile/src/sync/scheduler.ts` in PR #98 and asked me to ensure they're addressed with GH replies. Dispatched `mao-builder` (`a0a3bfb2ff955173a`) — SendMessage is unavailable in this harness, so it checked out the PR head branch fresh (`git checkout -B … origin/worktree-agent-a2099f2fc1028586d`), fixed, and pushed back to the same branch (PR updated in place, no new PR). **New head sha `1066174`**, scoped to `scheduler.ts` + `sync-scheduler.test.ts` (`_layout.tsx` untouched — the re-throw propagates through the existing synchronous call).

Resolutions (all six replied, prefixed `[builder]`, threaded):
1. (l.160) cycle-error log → added `sync_scheduler_cycle_error` (warn) in the cycle catch; control flow unchanged. reply `3330289622`.
2. (l.174) switch exhaustiveness/eslint → added `assertNever(value: never)` helper + `default:` guard in BOTH switches; reported the repo uses `eslint-config-expo/flat` with no `@typescript-eslint`, so the type-aware `switch-exhaustiveness-check` rule would be a repo-wide change — picked the targeted compile-time guard. reply `3330289944`.
3. (l.180) log ignored events → `sync_scheduler_ignored_event` (debug) on every no-op path in both switches (incl. the SHORT_TIMEOUT × request-sync deliberate no-op). reply `3330290096`.
4. (l.283) specific event for appState syncs → `sync_scheduler_foreground_sync_requested` (debug) on the `background → active` edge; machine input stays the single no-`reason` `requestSync` (design §2.5 intact). reply `3330290263`.
5. (l.322) bubble up wiring error → catch keeps the `error`-level log then **re-throws** (reverses round-1's defensive-swallow deviation per owner directive); test updated to assert logs-at-error AND re-throws. In healthy builds the listeners don't throw, so normal boot is unaffected; only a broken build (missing native module) now surfaces/crashes instead of silently disabling sync. In-app error surface is plan-3 territory. reply `3330290446`.
6. (l.336) "do we need stopSyncScheduler?" → YES, no code change; it's the `_layout.tsx` effect-cleanup return (cancels timer + removes NetInfo/AppState listeners on remount/Fast-Refresh) + the Jest `afterEach` teardown. reply `3330290635`.

Gates at `1066174`: fast gate 51 suites / **464 tests** (scheduler suite now 40: 32 kept + 8 new), `test:handles` clean (no `--forceExit`), `test:e2e:ios:gates` GREEN (smoke 18s, data 55s on cold `BOGA wt62`; cleared the location dialog by temporarily applying #100's two harness pre-auth files then reverting before commit — diff stayed scheduler-only). Ephemeral-ref grep clean. Verified independently: head sha, all 6 threaded replies present, and the diff carries `assertNever`+`default:` (both switches), the three new log events, and the `throw error` re-throw. **t7 #98 ready for owner's final pass + merge** (no separate re-review dispatched — owner is the reviewer and will validate the responses).

## Iteration 46 — 2026-05-31 — #100 MERGED; t9 sim re-validation dispatched

Owner merged **#100** (infra cold-sim location pre-auth). main HEAD now `7649fc5`; `maestro_preauthorize_location` confirmed live in `maestro-ios-launch.sh` on main. (Append #100 to plan.md `## Deviations log` at the next doc-sync — it's an out-of-band infra PR, not a plan task, but tracked.)

State re-derived: **#98 (t7)** OPEN at `1066174` (comment-fix head) — approved + green, **awaiting owner merge → unblocks t8**. **#99 (t9)** OPEN at `d82f498` — code APPROVED + backend gate green; only the cold-sim location red remained, now fixed on main.

Dispatched a background `mao-builder` (`a8079884a58d44496`) to re-validate t9's sims honestly on top of #100: checkout `claude/dev-wipe-affordances`, `git merge origin/main` (pulls in #100; clean merge expected — disjoint files), run the combined sim gate which must now be GREEN with NO manual grant, push the main-merge, flip the PR #99 sim line + post evidence. The main-merge adds no t9 code change, so the prior code-APPROVAL stands. Instructed to STOP + report if the gate fails for any non-location reason.

**Blocked until owner merges t7 #98:** t8 (BG-task) depends on t7-on-main; tFINAL depends on t8+t9. Once t7 merges → dispatch t8. Once t9 reval is green + t9 merges → (with t8) tFINAL.

## Iteration 47 — 2026-05-31 — t9 sim re-validation GREEN; both t7 #98 + t9 #99 merge-ready

t9 reval builder (`a8079884a58d44496`) finished. **PR #99 head `bff151e`** — clean `origin/main` merge (added only #100's two harness scripts, NO t9 code change → prior code-APPROVAL stands), MERGEABLE, 0 behind main. Gates: fast 52 suites/433 tests, `test:handles` clean, **combined sim gate GREEN on a genuinely cold freshly-auto-created sim** (`iPhone-17-Pro`/`iOS-26-2`, `BOGA wt63` didn't pre-exist): `smoke-launch` 17s, `data-runtime-smoke` 55s, both `failures=0`. #100's location pre-auth log appeared (`granted 'location-always'/'location'`), **no manual grant**. PR body sim line flipped to `YES (built rev bff151e)`; `[builder]` evidence comment posted. **t9 #99 is now honestly done — code+backend+sims all green.**

Verified host state: **#99** OPEN/MERGEABLE/0-behind; **#98** (t7, `1066174`) OPEN/MERGEABLE/2-behind-main (the 2 are #100 + its merge, disjoint from t7 files — merges clean; repo CI runs fast gate only, not sims, so t7's local sim-green stands). **Both ready for owner merge.** Critical path: merging **t7 #98** → dispatch t8 (BG-task); merging **t9 #99** + t8 → tFINAL. Surfaced both to owner.

## Iteration 48 — 2026-05-31 — t7 #98 MERGED; t8 (BG-task) dispatched; t9 in owner review

- **t7 [PR #98] MERGED** (`58aa8ec`). Hand-off verified on `origin/main`: `apps/mobile/src/sync/scheduler.ts` + `sync-scheduler.test.ts` present, `@react-native-community/netinfo@11.4.1` in package.json, `_layout.tsx` carries `startSyncScheduler`/`stopSyncScheduler`. Appended t7 (#98, incl. the 6-comment owner review round + the re-throw behavior reversal) AND #100 (infra location pre-auth) to plan.md `## Deviations log`.
- **t8 (BG-task) unblocked + dispatched** — background `mao-builder` (`abe2c7d72cab476a3`). Card: `apps/mobile/src/sync/background-task.ts` (`registerBackgroundSyncTask` + `BACKGROUND_SYNC_TASK_IDENTIFIER`; `defineTask` at module-load; `registerTaskAsync({minimumInterval:15})`; body = `expo-network` pre-flight → one `runSyncCycle()` directly, bypassing the four-state machine; stateless, no `requestSync`/scheduler-state access), `app.config.ts` plugins += `expo-background-task`, `_layout.tsx` calls it alongside `startSyncScheduler`, three new deps (`expo-background-task`/`expo-task-manager`/`expo-network`), `background-sync-task.test.ts`, manual `expo prebuild` Info.plist verification (UIBackgroundModes `processing` + identifier in `BGTaskSchedulerPermittedIdentifiers`, don't commit generated `ios/`). Sims now clean via #100 (no manual grant). **t8 is conflict-free with t9 #99** (disjoint files) so it runs in parallel with the owner's t9 review.
- **t9 [PR #99]** — fully green + MERGEABLE, in owner review. The three deps t8 adds are different from t9's footprint; no merge-order constraint between them.

**Remaining after t8:** tFINAL (depends on t3+t8+t9+t10 — t3/t10 merged; needs t8 + t9 merged). Then the one-shot audit.

## Iteration 49 — 2026-05-31 — t9 #99 MERGED; tFINAL now waits only on t8

- **t9 [PR #99] MERGED** (`6b7ab83`). Hand-off verified on `origin/main`: `apps/mobile/src/sync/dev-affordances.ts`, the `20260531120000_dev_wipe_my_data.sql` migration, and the two Settings wipe buttons all present. Appended t9 to plan.md `## Deviations log`.
- **tFINAL deps:** t3 ✓, t10 ✓, t9 ✓ — **only t8 remains.** t8 builder (`abe2c7d72cab476a3`) still running in background (no PR yet). When t8's PR opens → review → owner merge → dispatch tFINAL.
- No open PRs at this moment. Nothing else dispatchable until t8 lands (tFINAL is the sole downstream and needs t8 on main).

## Iteration 50 — 2026-05-31 — t8 builder stalled post-implementation (turn budget); work preserved + committed; finisher dispatched

t8 builder (`abe2c7d72cab476a3`) implemented the full task correctly but **ended without committing** — it ran long (172k subagent tokens / 97 tool_uses / ~13 min) and stopped while the combined sim gate was still installing deps (the `Monitor` event showed the sim mid-startup). NOT a watchdog kill — a turn-budget exhaustion after all the code was written. Same preserve-and-finish pattern as t5a/t6.

**Coordinator verified the uncommitted work is complete + correct against `tasks/t8.md`:**
- `apps/mobile/src/sync/background-task.ts` — `runBackgroundSyncTask` (expo-network pre-flight → Success-on-offline / one `runSyncCycle()` → Success/Failed, stateless, logged), `registerBackgroundSyncTask` (`registerTaskAsync({minimumInterval:15})`), `defineTask` at module-load, `BACKGROUND_SYNC_TASK_IDENTIFIER='com.expo.modules.backgroundtask.processing'`. **Key finding:** the expo-background-task plugin HARDCODES that identifier (no option to change it), so the constant matches the plugin's Info.plist output by necessity — a drift test reads it back. This satisfies the card's "the same constant … AND the Info.plist's BGTaskSchedulerPermittedIdentifiers (the plugin writes this)".
- `app.config.ts` plugins += `expo-background-task`; `_layout.tsx` `void registerBackgroundSyncTask().catch(...)` (fire-and-forget); `root-layout-auth-bootstrap.test.tsx` mocks the module + asserts one call; `package.json`/`lock` add the 3 deps (`expo-background-task ~1.0.10`, `expo-network ~8.0.8`, `expo-task-manager ~14.0.9`); `background-sync-task.test.ts` covers module-load-identifier-match, 15-min floor, online/offline/null-reachability/throws, foreground-scheduler isolation, and identifier-doesn't-drift (reads app.config.ts + Info.plist).
- package-lock diff is clean (only the 3 dep additions; no name-field churn).

**Recovery:** committed the preserved work (`22ddf2e`, self-contained message, no ephemeral refs), pushed `worktree-agent-abe2c7d72cab476a3`. Dispatched a background **finisher** (`a3623a1704d23d6f1`) to adopt the branch, bootstrap, run the FULL gate (fast + `test:handles` + combined sims [clean via #100, no manual grant] + manual `expo prebuild` Info.plist verification, delete the generated `ios/`), fix only if a gate fails, and open the `[t8]` PR. Gate-assertion ownership stays with the finisher.

After t8 PR → review → owner merge → **tFINAL** (last task; its other deps t3/t9/t10 all merged).

## Iteration 51 — 2026-05-31 — t8 #101 opened + APPROVED; ready for owner merge → tFINAL next

- t8 finisher (`a3623a1704d23d6f1`) opened **[PR #101](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/101)** at `22ddf2e` (adopted the preserved work unchanged — no source edits). Gates: fast 54 suites/489 tests, `test:handles` clean, combined sims GREEN (smoke 17s, data 55s), manual `expo prebuild` → `Info.plist` has `UIBackgroundModes [fetch, processing]` + `BGTaskSchedulerPermittedIdentifiers [com.expo.modules.backgroundtask.processing]` matching the constant; generated `ios/` deleted (not committed). **Two env-only fixes (no source):** force dev-client rebuild (the cached `.app` predated the 3 new native modules → `Cannot find native module 'ExpoTaskManager'` boot crash; cache keys on artifact existence, not native-dep set), and UTF-8 locale for CocoaPods. **Follow-up chip flagged:** dev-client build cache lacks a native-dep fingerprint (will bite any future native-module-adding task — but t8 is the last such task in this plan; tFINAL adds no native deps, so non-blocking here).
- t8 reviewer (`a5c7673535187d760`) **APPROVED**: all 8 Outcomes substantiated; independently confirmed the plugin hardcodes the identifier (grepped `node_modules/expo-background-task/plugin/build/withBackgroundTask.js`) and the drift test reads it back; diff source-only (7 files, +471/-1, no `ios/`, no churn); fast gate re-run 2 suites/17 tests + typecheck + lint clean; ephemeral-ref grep clean; no `__DEV__`. **PR #101 MERGEABLE.**
- **⇒ t8 ready for owner merge. On merge, tFINAL is fully unblocked** (t3 ✓, t8 →, t9 ✓, t10 ✓). tFINAL is the final test card AND requires a live Supabase branch deployment for the e2e cycle round-trip (its builder owns the deploy, per the Orchestration block).

## Iteration 52 — 2026-05-31 — t8 #101 MERGED; ALL build tasks done; tFINAL dispatched

- **t8 [PR #101] MERGED** (`f812061`; owner said "merged 100" but the open PR was #101 — #100 was already in). Hand-off verified on `origin/main`: `background-task.ts` present, `app.config.ts` carries the `expo-background-task` plugin, `_layout.tsx` calls `registerBackgroundSyncTask`. Appended t8 to plan.md `## Deviations log` (incl. the plugin-hardcoded identifier, the preserve-and-finish recovery, and the dev-client-cache follow-up chip).
- **ALL eleven build tasks (t1–t10 + the two infra PRs) are now on `main`.** tFINAL's deps (t3, t8, t9, t10) are all merged → **tFINAL dispatched** (background `mao-builder` `acfda145c3def975d`).
- tFINAL prompt highlights: the 12 test files + README + runner under `apps/mobile/app/__tests__/sync-v2-final/`, each mapping to a plan `## Outcomes` item; **owns a live Supabase branch** for test #5 (cycle round-trip — uses the `supabase` MCP/CLI per plan 1's tFINAL pattern, wires `SUPABASE_BRANCH_URL`/`_ANON_KEY` env vars, test skips-if-unset, tear down after); gate = `quality-fast.sh frontend` + `check:sync-drift --strict` + `test:handles` + combined sims. **CRITICAL instruction:** the card's "comment mapping each `it()` to the t4 §2.2/§2.3 cell" wording is SUPERSEDED by the standing no-ephemeral-refs rule — tests map to BEHAVIORS in self-contained terms; the directory name `sync-v2-final` is allowed (feature descriptor, not a plan id). Grep-before-PR enforced.
- After tFINAL PR → review → owner merge → the one-shot **`mao-audit`** (verifies each plan Outcome is tested by the final card + tests pass on the integration branch; deviations log complete per merged PR; status.md spans execution; hand-off artifacts exist; no card restates a design doc; gates pass on `main`). **Pending pre-audit housekeeping:** sync the coordinator-branch doc updates (this `status.md` + plan.md deviations log entries for #100/t7/t9/t8) to `main` (a `[docs]` PR like the prior session's #96) so the audit reads current state from `main`.

## Iteration 53 — 2026-05-31 — tFINAL #103 opened + APPROVED; final verification caught a real production bug

- tFINAL builder (`acfda145c3def975d`) opened **[PR #103](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/103)** at `d70b30a` — 12 test files + README + `helpers/live-branch.ts` under `apps/mobile/app/__tests__/sync-v2-final/`, `test:sync-v2-final` runner. Gates: fast 64 suites/574 pass (+5 skipped live), `check:sync-drift --strict` exit 0, `test:handles` clean, sims GREEN (smoke 17s/data 54s). Built sha `d70b30a`. Size ~2128 added (≈all tests; ~23 lines production), marginally over the soft budget — acceptable for a test-heavy final card.
- **🐛 LOAD-BEARING FINDING (deviation #3):** the final card's real-endpoint round-trip caught a **production bug in the merged cycle**: `cycle.ts` (and `dev-affordances.ts`) called `.rpc()` on the default `public` schema, but the sync RPCs live in `app_public` — so the merged v2 cycle **could never have synced against the real server**. t6's tests all stubbed the RPC client, so it passed review undetected (t6's "e2e round-trip against the plan-1 server" outcome was never validated on a real endpoint until now). Fix: `.schema('app_public').rpc(...)` at all three RPC call sites (sync_push, sync_pull, dev_wipe_my_data). 3 existing t6 mock tests updated to a schema-aware stub (assertions intact). **This is the entire justification for the final test card.**
- **Deviation #2:** used the repo's LOCAL Supabase stack (real Postgres+PostgREST+RLS+GoTrue, v2 migrations applied via `ensure-local-runtime-baseline.sh`) rather than a remote billed branch — the reachable Supabase MCP org has no BOGA project to branch from; same pattern plan 1's tFINAL used. Test is endpoint-agnostic (env-gated `SUPABASE_BRANCH_URL`/`_ANON_KEY`, loud `describe.skip` when unset). No billed branch left dangling.
- tFINAL reviewer (`a15ca52a9dbf58415`) **APPROVED**: schema fix sound on all 4 axes (necessary — `createClient` sets no `db.schema`; correct — `app_public` confirmed + matches `profile.ts`; all 3 call sites; mocks not weakened); round-trip non-vacuous + fails without the fix; **all 12 plan Outcomes covered, no gaps** (scheduler 23 cells; `sync_runtime_state` covered via cursor advance + `last_emitted_ms` + drift); ephemeral-ref clean except the card-mandated `manual-wipe.md` path in test #8; independent `typecheck` + `jest sync-v2-final` pass (live skip). **PR #103 MERGEABLE.**
- **⚠️ Teardown blocker flagged:** the manual-wipe runbook lives at `docs/plans/sync-v2-client/manual-wipe.md` (a DURABLE user/dev runbook) but the audit's teardown deletes `docs/plans/sync-v2-client/`. Test #8 asserts that path exists and `RUNBOOK.md` cross-links it. **Before teardown:** relocate `manual-wipe.md` to a durable home (e.g. `docs/` or fold into `RUNBOOK.md`) and update test #8 + the RUNBOOK link, OR have the audit/teardown preserve it. Surfaced to owner. **⇒ tFINAL ready for owner merge → then [docs] sync PR → mao-audit → teardown (incl. manual-wipe relocation).**

## Iteration 54 — 2026-05-31 — owner left 7 inline comments on tFINAL #103; addressing + replying (background)

Owner posted 7 inline comments on PR #103 (test-suite shape/value). Dispatched background `mao-builder` (`a0d884dc44edb5ef0`) to address all + reply on GH (checkout PR head branch, push back). Per-comment resolution:
1. `3330533889` live-branch.ts:33 ("fail, not print") — implement loud-skip ONLY on clean total env-absence (the documented CI-without-branch path); **hard-fail on partial/misconfigured env or set-but-unreachable**. Reply explains the CI tradeoff of a pure always-fail (would redden repo CI which has no branch) and asks the owner to confirm if they want unconditional unset→fail.
2. `3330535305` all-gates.test.ts ("why needed") — **drop** it; circular (shells the gate from inside `npm test`) and redundant with the real CI gate + PR checklist. Reply explains.
3. `3330541266` bg-task-identifier-match.test.ts ("very low value") — **drop** it; duplicates the merged `background-sync-task.test.ts` identifier-drift test; aligns with the card's own "Out of scope: don't duplicate task-level tests." Reply explains coverage isn't lost.
4. `3330542783` + 5. `3330543192` cycle-round-trip.test.ts mocks — **extract** the recurring `@/src/data/bootstrap` and `@/src/auth/supabase` mocks into shared helper(s); reply names them.
6. `3330544118` README.md ("drop") — **delete** the README; preserve Outcome→test traceability via self-documenting describe blocks + the mapping moved into the PR body (audit reads the body).
7. `3330545884` cycle-round-trip.test.ts:3 ("difference vs existing sync tests") — reply + concise comment: existing `sync-cycle-*.test.ts` use STUBBED RPCs (control flow only); this runs against a REAL endpoint (real LWW/cursors/auth) — the only thing that could surface (and did surface) the `app_public` schema bug.
- Builder must confirm no plan Outcome loses coverage from the #2/#3 drops (all-gates → real CI gate + checklist; bg-task id → merged background-sync-task test) and put the Outcome→test map in the PR body. Production schema fix + its 3 mock-test updates stay. Gates: fast + drift `--strict` + `test:handles`; sims (test-only delta).
- **Open item to watch:** comment #1's CI tradeoff — if the owner wants unconditional fail-on-unset, that's a CI-provisioning decision (CI would need to always stand up a branch). The builder surfaces it in its reply; coordinator will relay the owner's response.

## Iteration 55 — 2026-05-31 — tFINAL #103 comments resolved (head 739279c); one open question to owner

Builder (`a0d884dc44edb5ef0`) addressed all 7 + posted 7 threaded `[builder]` replies. **New head `739279c`** (was d70b30a), MERGEABLE. Verified file changes: `README.md` deleted; `all-gates.test.ts` + `bg-task-identifier-match.test.ts` dropped; new `helpers/sync-cycle-mocks.ts` (extracted bootstrap + supabase mocks, used by cycle-round-trip/auth-required/dirty-bit); new `migration-wrapper-no-inlined-sql.test.ts` (preserves all-gates' one load-bearing assertion); `live-branch.ts` three-state contract; round-trip distinction comment added. Suite net 12→11 files; **no plan Outcome lost** (all-gates gate-existence → real CI gate + PR checklist; bg-task id → merged `background-sync-task.test.ts`). Gates: fast PASS (63 suites/566, +5 skipped live), drift `--strict` exit 0, `test:handles` clean; full `sync-v2-final` lane with live env (provisioned `user_a`) 11 suites/82 green incl. live round-trip + auth-required. Sims not re-run (test-only delta; prior green at d70b30a recorded). Ephemeral-ref grep clean (only the card-mandated `manual-wipe.md` path).
- **#1 (first pass) — owner chose "keep the honest middle"** at `739279c`. **Then SUPERSEDED by a follow-up (iteration 56).**

## Iteration 56 — 2026-05-31 — owner probed the CI/skip design; restructured the live test lane (fail-hard)

Owner asked whether the honest-middle skip is even needed given "CI already skips the quality-slow gates." **Investigated and corrected the premise:** CI's only test job (`.github/workflows/ci.yml` "Frontend Quality Gates") runs `lint → typecheck → npm test → test:handles`; it does NOT run `quality-slow.sh backend` or the maestro `test:e2e:*` gates (owner correct there). BUT `npm test` is bare `jest` and `jest.config.js` matches `**/*.test.[tj]s?(x)` while `testPathIgnorePatterns` excludes ONLY `sync-reinstall-restore-parity.test.ts` — so the two LIVE suites (`cycle-round-trip.test.ts`, `auth-required-envelope.test.ts`) ARE picked up by `npm test` and DO run in CI's fast lane (hence the "2 suites/5 skipped" the builder saw). So CI skipping the slow/backend lanes does NOT cover these jest tests; the in-test skip WAS load-bearing as structured.
- **Owner chose to RESTRUCTURE** (the cleaner, repo-consistent option): exclude the 2 live suites from the fast lane via `testPathIgnorePatterns` (same mechanism as the existing reinstall-parity exclusion) and run them only via a dedicated branch-provisioned lane where they FAIL-HARD on missing/partial/unreachable env — which delivers the owner's original "fail, not print" with zero CI-green risk. The 9 infra-free sync-v2-final suites stay in CI's fast gate.
- Dispatched background `mao-builder` (`aeb70c679e0ed24b0`): add the 2 paths to `testPathIgnorePatterns`; add `test:sync-v2-final:live` script; change `live-branch.ts` to throw (not skip) on missing/partial/unreachable; de-skip the 2 live files; reply on comment thread `3330533889`; prove fast `npm test` no longer runs the 2 (count drops by 2), `test:handles` clean, drift exit 0, and the `:live` lane fails-hard without env + passes with a branch.
- **Audit implication (note for the audit step):** the audit's standard gate (`quality-fast.sh frontend`) now EXCLUDES the live round-trip; the audit must run `test:sync-v2-final:live` with a provisioned branch (or accept the PR's recorded live evidence) to confirm the cycle round-trip Outcome — same branch-provisioned pattern plan 1's tFINAL used.
- **DONE + verified (head `bd13314`):** builder (`aeb70c679e0ed24b0`) landed the live-lane restructure.

## Iteration 57 — 2026-05-31 — #103 CI was RED (drift test needs Supabase); fixing + renaming folder sync-v2-final→sync

Owner: "CI fails on 103" + "rename the test folder sync-v2-final → sync." **Diagnosed the CI failure** (`gh run view 26719124158 --log-failed`): the "Frontend Quality Gates" job (lint→typecheck→`npm test`→`test:handles`, on a runner with NO Docker/Supabase) fails ONLY on `app/__tests__/sync-v2-final/drift-check.test.ts` — it shells `npm run check:sync-drift -- --strict`, which runs `supabase db reset` (needs a local Supabase stack CI doesn't have): `[sync-drift] fatal: supabase db reset failed (rc=1)` → Expected 0 Received 1, `Test Suites: 1 failed, 62 passed`. This was the CI failure on ALL THREE revisions (d70b30a/739279c/bd13314) — masked locally because builders had Supabase. It's a THIRD infra-dependent test in the fast lane (the 2 live suites were already excluded). **The owner's earlier instinct was right and generalizes: no Docker/Supabase/branch-dependent test belongs in CI's fast `npm test`.**
- Dispatched background `mao-builder` (`aec286b24e82e00be`) to: (1) keep the infra-free `server_only_columns`-exemption assertion in the fast lane, move the `check:sync-drift --strict` shell-out into the infra lane (`testPathIgnorePatterns` + the dedicated script) so fast `npm test` is green with NO Supabase; (2) **rename** `app/__tests__/sync-v2-final/` → `app/__tests__/sync/` (git mv all files incl. helpers), update jest.config paths, rename scripts `test:sync-v2-final`→`test:sync` (fast) and `test:sync-v2-final:live`→`test:sync:infra` (the infra lane now runs drift shell-out + the 2 live suites), grep-and-fix every `sync-v2-final` straggler in apps/mobile. Required CI-replication: run fast gate + `npm test` with NO Supabase running and confirm GREEN + `jest --listTests` shows no infra test in the default lane.
- Coordinator (this worktree) updating the ephemeral tFINAL card's folder path `sync-v2-final/`→`sync/` for audit consistency; plan.md needs no change (its Outcomes describe behaviors, not the folder path).
- **DONE + CI GREEN (head `10a5706`):** builder (`aec286b24e82e00be`) split the drift test — infra-free exemption assertion → new fast-lane `sync/drift-exemption-removed.test.ts`; `check:sync-drift --strict` shell-out stays in `sync/drift-check.test.ts`, now in `testPathIgnorePatterns`. Folder renamed `sync-v2-final/`→`sync/` (git mv; `grep -rn sync-v2-final apps/mobile` = nothing); scripts `test:sync` (fast) + `test:sync:infra` (the 3 Supabase-dependent suites). Fast `npm test` 63 suites/565, 0 skipped; `--listTests` = 0 infra tests in the default lane. Infra lane: fail-hard without env, 3 suites/6 tests green with the local stack (slot 69, torn down, no billed branch). **GitHub Actions "Frontend Quality Gates" on `10a5706` = SUCCESS** (coordinator waited via `gh run watch`); PR #103 `MERGEABLE`/`CLEAN`. tFINAL card path + Output-artifact section updated for the rename + the dropped-README/lane-split (coordinator note added). **⇒ #103 finally CI-green + all review rounds resolved; ready for owner merge.** Then: [docs] sync PR → mao-audit (runs `test:sync:infra` with a branch + the standard gate) → teardown (incl. manual-wipe relocation).

## Iteration 58 — 2026-05-31 — tFINAL #103 MERGED; ALL tasks done; opening [docs] sync PR before audit

- **tFINAL [PR #103] MERGED** (`14a376e`). Hand-off verified on `origin/main`: `apps/mobile/app/__tests__/sync/` present (13 files), old `sync-v2-final/` gone, the `app_public` schema fix intact in `cycle.ts` (`SYNC_RPC_SCHEMA` + `.schema(...).rpc(...)` ×2) and `dev-affordances.ts`, `test:sync`/`test:sync:infra` scripts present. Appended tFINAL to plan.md `## Deviations log` (incl. the load-bearing schema-bug fix + the 2-round review + the CI fix). **CI green at the merged rev.**
- **EVERY plan task is now on `main`:** t1, t2, t3, t4, t5a, t5b, t6, t7, t8, t9, t10, tFINAL + infra #90/#100. No open PRs.
- **Next: [docs] sync PR.** This session's orchestration-doc updates (status.md iterations 43–58, plan.md deviations entries for #100/t7/t9/t8/tFINAL, the tFINAL card path+shape updates) are uncommitted on the coordinator branch `claude/stoic-carson-75edce`. Opening a `[docs]` PR to land them on `main` (same as the prior session's #96) so `mao-audit` reads current state from `main`. Coordinator-driven (docs-only; no code).
- **Then mao-audit** (isolated worktree off `main`): verify each plan Outcome is tested by the `sync/` final card + tests pass on `main` (standard gate `quality-fast.sh frontend` is infra-free/green; the audit additionally provisions a local Supabase stack to run `npm run test:sync:infra` for the cycle round-trip + drift, mirroring how tFINAL validated); deviations log complete per merged PR; status.md spans execution; hand-off artifacts exist; no card restates a design doc; gates pass on `main`.
- **Teardown caveat (carry into audit/teardown):** `docs/plans/sync-v2-client/manual-wipe.md` is a DURABLE user/dev runbook that test `sync/manual-wipe-doc-exists.test.ts` asserts exists and `RUNBOOK.md` cross-links — but teardown deletes `docs/plans/sync-v2-client/`. Before/as part of teardown: relocate `manual-wipe.md` to a durable home (e.g. `docs/` or fold into `RUNBOOK.md`) and update the test path + the RUNBOOK link, OR have teardown preserve that one file. `jest.config.js` `testPathIgnorePatterns` now excludes both live suites (alongside reinstall-parity); `test:sync-v2-final:live` script added (working invocation: `jest --runTestsByPath <2 files> --testPathIgnorePatterns=/node_modules/` — the card's suggested `--testPathIgnorePatterns /node_modules/ <files>` ordering let yargs swallow the file paths into the ignore array, so the builder corrected it, which the card authorized); `live-branch.ts` throws on missing/partial/unreachable (no skip); both live files de-skipped. Gates: fast `npm test` **63 suites/566, 0 skipped** (was 65 with 2 skipped — the 2 live no longer run in CI), `test:handles` clean, drift exit 0. Live-lane proof: **fails-hard without env** (names the missing var), **passes with a branch** (local stack wt68, 2 suites/5 green, torn down — no billed branch). Reply `3330621492` posted on thread `3330533889`. Ephemeral-ref grep clean. **⇒ tFINAL #103 fully resolved across both comment rounds + the live-lane restructure; MERGEABLE at `bd13314`; ready for owner's final pass + merge.**
- **Note:** head moved past the prior mao-reviewer APPROVED (d70b30a). Owner is the de-facto reviewer (drove these comments) → owner verifies replies + merges; offered a fresh mao-reviewer pass if wanted. After #103 merges → [docs] sync PR → mao-audit → teardown (incl. manual-wipe relocation).

















