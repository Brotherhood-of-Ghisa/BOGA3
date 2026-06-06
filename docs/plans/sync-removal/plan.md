# Sync & Auth Removal — Teardown Plan

> **Status:** planning · **Branch:** `claude/sync-functionality-assessment-CbZJj` · **Date:** 2026-06-06
>
> ⚠️ **This is a TEARDOWN artifact, not a sync design.** It describes the
> *existing* sync implementation only so we can delete it cleanly. It is itself
> scheduled for deletion as the final step (see §7). Future sync work MUST start
> from a brand-new brainstorm with **zero** reference to the removed code — that
> is an explicit objective of this exercise.

---

## 1. Objectives

1. **Remove all sync functionality** (and the auth/login that exists only to gate
   it), returning the mobile app to a clean **offline-only / local-first** state.
2. **Leave no breadcrumbs that confuse or mislead a future sync builder.** After
   teardown, an agent asked to "build sync" must find a clean slate — no stale
   engine, no half-specs, no contradictory milestone docs, no `sync_*` symbols,
   no dormant scheduler. The *reason* the feature kept getting half-rebuilt is
   that every attempt inherited the previous attempt's surface; this teardown
   exists to break that cycle.
3. **Keep the app provably functioning at every step** — no "looks done, actually
   broken." Each phase is gated by tests that must stay green (§5, §6).

### Definition of done
- `grep -rinE 'sync|outbox|scheduler|bootstrap.*remote|auth|sign-?in|supabase' apps/mobile/src apps/mobile/app`
  returns only incidental domain matches (e.g. `bootstrapLocalDataLayer`), no sync/auth machinery.
- No sync/auth files, tests, Maestro flows, package scripts, specs, plans, or task history remain.
- The full fast gate (`lint` + `typecheck` + `jest`) is green, and the offline
  Maestro guardrails (`smoke-launch`, `data-runtime-smoke`) pass on a booted sim.
- This document is deleted.

---

## 2. The change is three changes — split along the risk seam

Removal naturally separates into tiers with very different validation needs. The
**fast gate (tsc + jest) fully proves Tiers A/B/D**; only **Tier C needs the
emulator/slow gates**. Sequencing (§5) follows this seam so the risky 10% is
isolated and never blocks the safe 90%.

| Tier | Scope | Risk | Proven by |
|---|---|---|---|
| **A** | Leaf sync/auth modules + their tests | Low | `tsc` (every importer errors) |
| **B** | App wiring (`_layout`, `settings`, `profile`, recorder, harness) | Medium | `tsc` + jest component tests; boot via data-smoke |
| **C** | **Data layer**: drop `local_dirty`/`local_updated_at_ms`, remove clock, regen Drizzle baseline, prune native deps | **High** | jest repo/seed/migration tests **+ data-smoke on a populated DB** |
| **D** | Supabase backend + docs | Low | No app dependency (build unaffected) |

---

## 3. What we are removing — the manifest

### 3.A — Leaf feature code (LOW risk)
- `apps/mobile/src/sync/**` — 18 files: `cycle.ts`, `scheduler.ts`, `SyncGate.tsx`,
  `bootstrapper.ts`, `background-task.ts`, `dev-affordances.ts`, `progress.ts`,
  `topo-order.ts`, `account-wipe.ts`, the signals/gate-state/hooks.
- `apps/mobile/src/auth/**` — 6 files: `provider.tsx`, `service.ts`, `storage.ts`,
  `profile.ts`, `supabase.ts`, `index.ts`.
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/components/sync-status/**`, `apps/mobile/components/navigation/auth-route-guard.tsx`
- Scripts: `scripts/check-sync-schema-drift.ts` (+ `.fixtures.json`), `scripts/maestro-ios-auth-profile.sh`
- `apps/mobile/package.json` lanes: `test:sync`, `test:sync:infra`, `check:sync-drift`, `test:e2e:ios:auth-profile`
- Maestro flows: `auth-profile-happy-path`, `launch-requires-sign-in`, `settings-sync-status`, `sync-gate-first-cycle`
- **Tests deleted in lockstep (same commit as the code they cover) — see §6.B**

### 3.B — Wiring edits (MEDIUM risk) — *edit, do not delete the file*
- `app/_layout.tsx` — unwrap `AuthProvider`/`AuthRouteGuard`/`SyncGate`; drop scheduler + background-task boot + `requestSync`; remove the `sign-in` route → `SafeAreaProvider → Stack`.
- `app/(tabs)/settings.tsx` — remove `SyncStatusPanel`, `useAuth`, remote-wipe affordances. **Keep** local dev-reset (domain).
- `app/profile.tsx` — 663 lines of pure account UI (username/email/password). With auth gone it has no offline content → **delete the screen and its nav entry**. (Decision: delete, not stub.)
- `app/(tabs)/session-recorder.tsx` — remove `getAuthSnapshot` gating; keep recorder.
- `src/maestro/harness.ts` + `app/maestro-harness.tsx` — remove sync-gate/auth test hooks; keep domain hooks.

### 3.C — Data layer (HIGH risk) — *the deferred, emulator-gated piece*
- Strip `local_dirty` + `local_updated_at_ms` from 8 schema files (`sessions`, `gyms`,
  `exercise-definitions`, `exercise-sets`, `exercise-muscle-mappings`,
  `exercise-tag-definitions`, `session-exercises`, `session-exercise-tags`).
- Remove `apps/mobile/src/data/clock.ts` (`nowMonotonic`) and rip stamping out of 8 repos
  (`session-drafts`, `session-list`, `exercise-catalog`, `exercise-tags`, `local-gyms`,
  `exercise-catalog-seeds`, `bundle-migrations`) + `scripts/import/import-boga-json-local.ts`.
  First relocate the generic `Transaction` type (only non-sync export) to `src/data/tx.ts`.
- Delete the `sync_runtime_state` table **but rehome the seed marker first** (see §4, Risk ①).
- Regenerate the Drizzle baseline (`drizzle/0000_*.sql`, `drizzle/meta/*`, `migrations.generated.ts`).
- Prune native deps **only after a dev-client rebuild** (see §4, Risk ④):
  `@supabase/supabase-js`, `expo-secure-store`, `expo-background-task`, `expo-task-manager`,
  `@react-native-community/netinfo`.

### 3.D — Backend + docs (LOW risk)
- `supabase/**` → empty migration baseline; keep `config.toml` + generic `health` function only.
  **The live hosted DB is intentionally left untouched** (reconcile before any future `db push`).
- Purge **all** sync/auth docs *including history* (objective 2): `docs/specs/tech/client-sync-engine.md`,
  milestones `M5`/`M11`/`M13`/`M14`, `docs/plans/sync-v2*`, brainstorms `004/005/009/011`,
  `docs/tasks/fix-sync/**`, all `docs/tasks/**` sync/auth records, `docs/specs/10-api-authn-authz-guidelines.md`.
- Edit (don't delete) to strip sync/auth references: `AGENTS.md`, `RUNBOOK.md`,
  `docs/specs/README.md`, `03-technical-architecture.md`, `05-data-model.md`, `06-testing-strategy.md`.

---

## 4. What we are KEEPING — and the rationale (answers Q2)

Nothing is kept by default; each retention has an explicit reason.

### Code / schema
| Kept | Rationale |
|---|---|
| **Soft-delete (`deletedAt`) on all tables + its 3 tests** | A **user-facing domain feature** — `completed-session/[sessionId].tsx` toggles delete/restore; stats & history filter on it. It predates and is independent of sync. Removing it would delete product behavior. |
| **`updatedAt` / `createdAt` domain columns** | Drive list ordering (`orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))`) and display. Verified stamped from `input.now` (a `Date`), **not** the monotonic clock — so they survive the clock removal unchanged. |
| **A local runtime-state table (renamed from `sync_runtime_state`)** | **Not purely sync.** It hosts the **seed-once marker** `appliedSeedMigrationAppVersion`, read/written by `exercise-catalog-seeds.ts` on every launch. The "sync" name is misleading; the row's seed-marker duty is pure offline domain. *Open decision:* rename-and-keep the table vs. move the marker to a new `app_runtime_state`/KV. Either is fine; **deleting it outright is not** (breaks seed idempotency → boot failure). |
| **`bundle-migrations.ts`, `exercise-catalog-seeds.ts`, `dev-reset.ts`** | Local migration runner, starter-catalog seeder, and dev reset are **offline domain infra**. Only their *dirty/clock stamping lines* are removed, never the mechanisms. |
| **All other `src/data/*` repos + `src/data/bootstrap.ts`** | The offline data layer is the app. Edits are surgical (remove sync columns/imports), not deletions. |
| **Native deps (kept installed-but-unused for now)** | Removing native modules forces a Maestro dev-client rebuild or every flow boot-fails with `Cannot find native module`. Leaving them dormant is harmless and de-risks the main pass; prune in a later build-validated change. |

### Backend / infra
| Kept | Rationale |
|---|---|
| **Supabase project + endpoints + `config.toml` + `health` fn** | User wants the project retained for future use. `health` is a generic check with no sync/auth logic. The empty migration baseline keeps the repo honest while the live DB is left untouched. |

### Docs
| Kept | Rationale |
|---|---|
| **`00-product`, `08-ux-delivery-standard`, `12-worktree`, `docs/specs/ui/**`** | Pure product/UX/dev-environment docs with no sync/auth content. |
| **Domain milestones/tasks (UI, stats/heatmap, GPS-gym domain, screen-refactor)** | Record real offline product work. Incidental sync paragraphs get trimmed, not the docs. |
| **`AGENTS.md`, `RUNBOOK.md`, specs `03/05/06/09/11`** | Edited in place — they carry essential non-sync guidance (worktree setup, Maestro smoke lanes, offline architecture, the data model minus sync columns). |

> **Why "purge history" (delete completed sync/auth task records) despite keeping
> domain history:** objective 2. The recurring failure mode is new agents being
> *influenced* by the prior implementation's docs. Dated "this is how sync worked"
> records are exactly the misleading breadcrumbs to remove. Domain history carries
> no such risk.

---

## 5. Sequencing — order chosen for continuous confidence

Each phase ends on a **green gate**; we do not start the next until it's green.
Phases 1–3 + 5 are fully validated by the fast gate (no emulator). Phase 4 (the
risky data layer) is isolated and gated by the slow lane.

**Phase 0 — Baseline.** Run `lint` + `typecheck` + `jest`; record the green count.
This is the "still works" reference. (Also: snapshot the domain-guardrail subset, §6.A.)

**Phase 1 — Tier A (leaf code + its tests).** Delete `src/sync/**`, `src/auth/**`,
sign-in, sync-status, auth-route-guard, **and every test that covers them, in the
same commit.** Run `tsc` → it lists any importer still referencing deleted code;
fix in Phase 2. Run `jest` → domain set stays green. *Gate: fast.*

**Phase 2 — Tier B (wiring).** Edit `_layout`/`settings`/`session-recorder`/harness;
delete `profile.tsx` + its nav. `tsc` now clean; `jest` green. *Gate: fast.*

**Phase 3 — Tier D (backend + docs).** Delete `supabase/**` sync/auth + reset baseline;
purge & edit docs. No app code touched → build unaffected. *Gate: fast (unchanged).*

> After Phases 1–3 the app is **source-level sync-free and auth-free** and the fast
> gate proves it. The two vestigial columns + runtime-state table remain as **inert
> dead fields** (nothing writes them) — safe to leave until Phase 4.

**Phase 4 — Tier C (data layer) — DEFERRED to an emulator-equipped session.**
Relocate `Transaction`; strip columns + clock; rehome seed marker; regen Drizzle baseline;
rebuild dev-client; prune native deps. *Gate: fast **plus** data-smoke on a
**populated** DB (the upgrade path jest cannot see — §6.C).*

**Phase 5 — Final sweep & self-destruct.** Run the Definition-of-Done grep; confirm
clean; delete this plan doc.

---

## 6. Keeping the app functioning (answers Q1)

The guarantee is **a stable set of domain tests that never reference sync and must
stay green at every commit**, plus **deleting sync/auth tests in lockstep with their
code** so the suite never references something removed. We never delete a domain
test to go green.

### 6.A — Domain guardrails — MUST STAY GREEN throughout (the "app still works" proof)
These touch no sync/auth code. The **bolded** ones sit directly on the Tier-C edit
surface and are the highest-value signal that the data layer survived the strip:

- **`session-drafts-repository`**, **`session-list-repository`**, **`session-recorder-{interactions,persistence,screen,submit}`** — the primary write/recorder path that Tier C edits.
- **`exercise-catalog-seeds`**, **`seed-once`**, `seed-catalog-slug-shape`, **`muscle-group-bootstrap-idempotent`** — seeder + the seed-marker (Risk ①).
- **`local-data-bootstrap`**, **`domain-schema-migrations`**, `bundle-migrations`, `runtime-smoke`, `smoke-records` — boot/migration path (Risk ②/③).
- `completed-session-detail-screen`, `session-rebuild-soft-delete`, `soft-delete-guard`, `soft-delete-converted-paths` — soft-delete domain feature.
- `exercise-{analytics,block-history,calculations,catalog-cache,catalog-repository,catalog-screen,catalog-search,catalog-stats,history-repository,history-screen,tag-repository}`, `muscle-analytics`, `heatmap-data`, `stats-{repository,screen}` — analytics/catalog/stats.
- `foreground-location-service`, `gym-location-matcher` — GPS-gym domain.
- `draft-autosave-controller`, `index`, `is-dev-mode`, `dev-reset`, `logging-log-event`, `ui-{guardrails-script,primitives}`.
- `maestro-harness` — kept, edited to drop sync hooks.

### 6.B — Tests DELETED in lockstep with their subject code (never left dangling)
`account-switch-local-wipe`, `auth-{profile-service,route-guard,service,session-visibility,storage-adapter}`,
`sign-in-screen`, `root-layout-auth-bootstrap`, `use-auth-required-redirect`,
`background-sync-task`, `clock`, `cycle-error-signal`, `dev-affordances`,
`dirty-bit-layer-0-1`, `dirty-bit-layer-2-3`, `scheduler-status-accessor`,
all `sync-*`, the whole `__tests__/sync/**`, and `helpers/sync-cycle-mocks.ts`.
Two need **trim, not delete**: `settings-dev-wipe` (keep local-wipe assertions, drop
remote-wipe) and `settings-profile-navigation` (rewrite/remove with the profile screen).

### 6.C — The one gap jest cannot close (why Phase 4 needs the emulator)
jest runs against **fresh in-memory SQLite**, so it never exercises **migrating an
existing, populated database**. The Tier-C column drop triggers a SQLite table
rebuild; a mis-generated baseline can silently drop user rows or fail to open the DB
at launch. Coverage:
1. **Keep `domain-schema-migrations` + `local-data-bootstrap` green** (catches in-process regressions).
2. **Add an explicit upgrade test:** open a pre-seeded fixture DB at the *old* schema → run migrations → assert row counts/integrity preserved.
3. **Run the `data-runtime-smoke` Maestro flow on a booted sim** (boot + read existing data + write) — the only check that proves the on-device upgrade path. This is the gate that must pass before Phase 4 merges.

### 6.D — Offline Maestro guardrails (after sync/auth flows removed)
Remaining flows are the runtime safety net: `smoke-launch`, `data-runtime-smoke`,
`exercise-block-history-fixture`, `exercise-heatmap-evidence`, `stats-heatmap-ux`,
`stats-view-toggle-ux`, `settings-dev-wipe-local`.

---

## 7. Clean-slate guarantee for future sync work (objective 2) + self-destruct

When teardown is complete, verify the slate is clean so the *next* sync attempt is
not influenced by this one:
- `grep -ri 'sync\|outbox\|scheduler' apps/mobile/src apps/mobile/app docs/specs` → no machinery, no specs.
- No `docs/specs/tech/client-sync-engine.md`, no `M5/M11/M13/M14`, no `sync-v2` plans, no `fix-sync`.
- `AGENTS.md` has no sync/auth/Supabase test lanes or "slow-gate sync launch" section.
- A future "build sync" task starts from a **new brainstorm**, citing the product
  need only — never this teardown doc or any removed artifact.
- **Delete this file** (`docs/plans/sync-removal/`) as the final commit of Phase 5.
  It has served its purpose; leaving it behind would reintroduce exactly the
  breadcrumb problem objective 2 exists to eliminate.
