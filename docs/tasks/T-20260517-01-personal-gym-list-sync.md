---
task_id: T-20260517-01-personal-gym-list-sync
milestone_id: "M13"
status: planned
ui_impact: "yes"
areas: "frontend|cross-stack|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/05-data-model.md,docs/specs/tech/client-sync-engine.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260517-01-personal-gym-list-sync`
- Title: Personal database-backed gym list sync
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-17`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- MVP deliverable: `docs/specs/milestones/M13-simple-backend-sync.md` deliverables for full user-owned sync scope and restore parity (`00-mvp-deliverables.md` is not present in this repo)
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md` (completed baseline; this is a post-M13 hardening task)
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- API auth/authz guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI UX rules: `docs/specs/ui/ux-rules.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main` at `dbd095a`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes`
  - `git fetch origin` initially hit `.git/FETCH_HEAD` sandbox permission denial, then succeeded with approved escalation.
  - `git pull --ff-only` fast-forwarded local `main` from `9e9d717` to `dbd095a`.
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/10-api-authn-authz-guidelines.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/milestones/M13-simple-backend-sync.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/tasks/fix-sync/follow-ups.md`
  - `docs/tasks/fix-sync/plan.md`
  - `supabase/session-sync-api-contract.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - `apps/mobile/src/data/local-gyms.ts` - current repository only supports `upsertLocalGym()` and `loadLocalGymById()`; there is no persisted list/delete/undelete API.
  - `apps/mobile/src/data/schema/gyms.ts` - local `gyms` has `id`, `name`, `created_at`, and `updated_at`; unlike backend `app_public.gyms`, local schema has no `deleted_at`.
  - `apps/mobile/components/session-recorder/types.ts` - `SEEDED_LOCATIONS` still exports three globally visible gym rows for every user.
  - `apps/mobile/app/session-recorder.tsx` - recorder initializes `locations` from `SEEDED_LOCATIONS`; add/edit/archive lives in component state and only selected gyms are upserted during autosave/submit.
  - `apps/mobile/src/sync/bootstrap.ts` / `supabase/migrations/20260514120000_user_scoped_pk_redesign.sql` - backend projection supports `gyms.deleted_at`; mobile merge still treats local gyms as non-tombstoned because local schema cannot persist tombstones.
  - `docs/tasks/fix-sync/follow-ups.md` - P4 already records missing local tombstones for `gyms`, `session_exercises`, and `exercise_sets`; this task owns the `gyms` slice only.
- Known stale references or assumptions:
  - `docs/specs/ui/repo-discovery-baseline.md` still references `SEEDED_LOCATIONS`; update only if this task removes or repurposes that constant.
  - M13 is completed, so this card should not casually rewrite M13 completion status. Treat it as post-M13 hardening unless a human opens a new milestone.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260517-01-personal-gym-list-sync.md`

## Objective

Make the gym list a first-class personal, database-backed, sync-restorable user catalog, matching the ownership model already used for exercises. New users must not get a fake shared gym list by default; the empty picker may offer a non-persisted `Local Gym` starter action that becomes a normal personal gym only when selected. Gym add/edit/archive/undelete must persist locally, emit sync events, survive bootstrap/reinstall, and respect per-user backend ownership.

## Scope

### In scope

- Replace recorder-local seeded gym state with a local database-backed personal gym catalog.
- Add a `local-gyms` repository surface for listing active/archived gyms, creating, renaming, archiving, undeleting, and loading by id.
- Add local `gyms.deleted_at` support if still absent at execution time, including Drizzle schema, runtime migration bundle, drizzle SQL/meta artifacts, and migration tests.
- Map recorder `Archive` / `Unarchive` to soft-delete semantics (`gyms.delete` / `gyms.upsert`) rather than ephemeral component state.
- Ensure selected/historical gyms can still be resolved by id when archived, while the default picker hides archived gyms.
- Ensure first-enable bootstrap, merge, convergence events, reinstall restore parity, and remote tombstone handling preserve personal gym state.
- Remove or neutralize `SEEDED_LOCATIONS` so every user starts with no automatically persisted gym rows unless they create or restore gyms.
- Add a `Local Gym` starter affordance in the fresh empty picker. It must not be inserted on app launch, data bootstrap, sync bootstrap, reinstall, or merely opening the picker; selecting it creates a normal personal `gyms` row and selects it for the current session.
- Update UI docs for the recorder gym picker/manage semantics.
- Update sync/data-model docs for the local `gyms.deleted_at` and personal-catalog behavior.

### Out of scope

- Shared/public gym catalog, gym discovery, gym search, location services, maps, or geocoding.
- Multi-device conflict resolution beyond the current M13 single-device assumptions.
- Cross-device tombstone hardening for `session_exercises` and `exercise_sets`; those remain covered by `docs/tasks/fix-sync/follow-ups.md` P4 unless separately scoped.
- New routes or a standalone gym-management screen.
- Hosted database reset or deployment work unless implementation unexpectedly changes hosted Supabase schema.
- Broad session-recorder visual redesign.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - The recorder gym picker and manage modal change from a pre-populated seeded list to a user-owned list with loading, empty, `Local Gym` starter, archived, and persisted mutation states.

## UX Contract

### Key user flows

1. Flow name: Fresh user opens the gym picker
   - Trigger: User opens `/session-recorder`, taps the gym selector, and has no local/restored gyms.
   - Steps: recorder loads personal gyms from SQLite; picker renders a compact empty state with `Local Gym` as a starter action plus `Add new`.
   - Success outcome: no seeded/default gyms are persisted or shown as real rows; the user can either pick `Local Gym` in one tap or create a named gym.
   - Failure/edge outcome: load failure stays inline in the modal and does not block the rest of the recorder.
2. Flow name: Use the `Local Gym` starter
   - Trigger: Fresh user taps `Local Gym` in the empty gym picker.
   - Steps: app creates a normal personal `gyms` row with name `Local Gym`, enqueues a `gyms.upsert` event, selects it for the current session, and closes the picker.
   - Success outcome: `Local Gym` now behaves exactly like any user-created gym: editable, archiveable, restorable, and syncable.
   - Failure/edge outcome: persistence failure leaves the picker open with retryable inline feedback; no partial selection is applied.
3. Flow name: Add or rename a personal gym
   - Trigger: User taps `Add new` or `Edit` in the gym modal.
   - Steps: user enters a non-empty name; app persists the gym through `local-gyms`; outbox receives a `gyms.upsert` event.
   - Success outcome: the picker/manage list reflects the saved name immediately and the gym is restorable after sync.
   - Failure/edge outcome: invalid empty names are ignored or shown near the editor; persistence failure leaves the editor available for retry.
4. Flow name: Archive and unarchive a gym
   - Trigger: User opens `Manage Gyms` and taps `Archive` or `Unarchive`.
   - Steps: app soft-deletes or undeletes the local gym; outbox receives `gyms.delete` or `gyms.upsert`; visible lists reload from SQLite.
   - Success outcome: archived gyms disappear from the default picker, appear only when archived visibility is enabled, and do not erase historical session references.
   - Failure/edge outcome: a selected gym that gets archived is cleared from the active draft, while completed/history reads can still resolve its name.
5. Flow name: Restore personal gyms after login/reinstall
   - Trigger: User signs in/enables sync, or reinstalls and bootstraps from remote projection.
   - Steps: sync fetches `app_public.gyms`, merges local/remote rows and tombstones, writes SQLite, and queues convergence events for local-only rows.
   - Success outcome: the restored picker shows only that user's active gyms; archived/deleted remote gyms remain hidden by default, and `Local Gym` is not injected when restored gyms exist.
   - Failure/edge outcome: offline/backend failures retain local tracker usability and queued events retry under existing sync policy.

### Interaction + appearance notes

- Keep the existing in-route gym modal pattern (`picker`, `manage`, `editor`); no new route.
- Add compact loading/error/empty states inside the modal instead of full-screen blocking UI.
- Show `Local Gym` only as an empty-state starter action; once any personal active gym exists, normal picker rows replace it.
- Reuse existing tokens/primitives/styles in `session-recorder`; no raw color literals.
- Preserve `Show archived` / `Hide archived` semantics, but back them with persisted soft-delete rows.
- Avoid explanatory product copy; keep modal text operational and short.

## Acceptance criteria

1. Fresh local state no longer displays the three seeded gyms (`Downtown Iron Temple`, `Westside Barbell Club`, `North End Strength Lab`) unless they were actually created/restored for the user.
2. Fresh local state does not auto-create any gym row on install, data bootstrap, sync bootstrap, reinstall, or picker open.
3. When no active personal gyms exist, the picker may show a `Local Gym` starter action; selecting it creates a normal personal `gyms` row, selects it for the current session, and enqueues `gyms.upsert`.
4. `Local Gym` is not a magic row after creation: it can be renamed, archived, unarchived, restored, and synced through the same paths as any other gym.
5. `Local Gym` is not injected after restore when the user already has restored gyms.
6. Recorder gym picker lists active personal gyms from SQLite, ordered deterministically by name or creation/update time as documented in the implementation.
7. Add gym persists a `gyms` row immediately, selects it for the current session, and enqueues a `gyms.upsert` outbox event.
8. Rename gym persists immediately and enqueues a `gyms.upsert` event with the original `created_at_ms` and new `updated_at_ms`.
9. Archive gym persists a local tombstone, hides the gym from the default picker, clears it from the current active draft if selected, and enqueues a `gyms.delete` event.
10. Unarchive gym clears the tombstone, returns it to the active picker, and enqueues a `gyms.upsert` event.
11. Historical/completed session reads do not lose the gym display name merely because the gym is archived.
12. Bootstrap/merge handles remote gym tombstones coherently: deleted remote gyms do not reappear in the active picker, and local tombstones can converge to backend delete events.
13. Reinstall restore parity includes active and archived personal gyms in the normalized snapshot, with UI/default-picker filtering applied only at presentation time.
14. Backend ownership remains per-user through existing RLS/composite primary-key behavior; no mobile code can write another user's gym rows.
15. `docs/specs/05-data-model.md` records the local `gyms.deleted_at` model if added, and keeps `gyms` explicitly in sync scope.
16. Relevant UI docs describe the personal database-backed gym picker/manage semantics, including the non-persisted `Local Gym` starter affordance.
17. Screen UI uses documented tokens/primitives/shared components for common controls, or records a justified exception.
18. No raw color literals are introduced in screen/component `.tsx` files.
19. Relevant local/cross-stack gates pass, or blockers are documented with exact failing command and next action.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - record any local `gyms.deleted_at` addition and the personal gym catalog/tombstone sync behavior.
  - `docs/specs/tech/client-sync-engine.md` - document gym bootstrap/merge/convergence behavior if local tombstone handling changes.
  - `supabase/session-sync-api-contract.md` - update only if implementation changes gym payload/event semantics; otherwise explicitly record `no change required`.
  - `docs/specs/ui/screen-map.md` - update recorder state summary for personal DB-backed gym picker states if behavior changes.
  - `docs/specs/ui/ux-rules.md` - update modal/list/archived semantics for personal gyms and the non-persisted `Local Gym` starter.
  - `docs/specs/ui/repo-discovery-baseline.md` - update only if `SEEDED_LOCATIONS` is removed or no longer exported.
  - `RUNBOOK.md` - review in-session; update only if local run/test/operator workflow changes.
  - `docs/tasks/fix-sync/follow-ups.md` - after implementation, narrow P4 so it no longer claims `gyms` are deferred if this task completes that slice.
- Cross-cutting docs rule:
  - Because this task changes a sync-scoped local data model and restore behavior, do not leave the stable behavior only in this task card. Promote it to `docs/specs/05-data-model.md` and, if merge/convergence behavior changes materially, `docs/specs/tech/client-sync-engine.md`.
- UI docs update required?: `yes`
  - `screen-map.md`: recorder gym picker state set changes.
  - `ux-rules.md`: personal gym list, empty state, `Local Gym` starter, persisted archive/undelete semantics.
  - `repo-discovery-baseline.md`: only if seeded location exports are removed/changed.
- Tokens/primitives compliance statement:
  - Reuse plan: keep existing session-recorder modal/list/button styling and UI tokens from `apps/mobile/components/ui`; compose from existing patterns before adding route-local style.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - fresh-user empty gym picker with `Local Gym` starter
    - manage gyms with at least one active gym
    - manage gyms with archived visibility enabled
  - If Maestro screenshots are not practical in the implementation session, capture equivalent simulator/app screenshots and record the paths in the completion note.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-domain-event-emission.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-bootstrap-merge.test.ts`
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:infra`  <!-- was test:sync:reinstall-parity (retired with sync v1) -->

  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` is mandatory.
  - `./scripts/quality-slow.sh frontend` is mandatory because this task touches recorder UI, local SQLite schema/migrations, and user-facing data-smoke behavior.
  - `./scripts/quality-slow.sh backend` is `N/A` unless backend migrations/RLS/contract code changes; if backend files change, promote it to mandatory.
- Test layers covered:
  - repository/domain Jest coverage for `local-gyms`
  - migration/schema canary
  - RNTL recorder interaction coverage
  - sync merge/outbox coverage
  - cross-stack restore parity with local Supabase
  - Maestro/data-smoke runtime evidence through the frontend slow gate
- Execution triggers:
  - targeted tests after repository/schema and recorder UI changes
  - restore-parity after sync merge/convergence changes
  - full frontend fast/slow gates before closeout
- Slow-gate triggers:
  - required for local SQLite migration/runtime confidence and visible recorder modal behavior.
- Hosted/deployed smoke ownership:
  - `N/A` if no Supabase hosted schema/API changes are made.
  - If backend schema/contract changes become necessary, this same task owns a local backend slow gate and must either run hosted smoke or document the exact deferred hosted owner.
- CI/manual posture note:
  - Local evidence is mandatory. Any partial CI coverage is not a substitute for local restore-parity and frontend slow-gate evidence.
- Notes:
  - Use the existing M13 event protocol. Do not introduce direct table CRUD as the mobile sync path.
  - Do not parse backend free-text error messages for control flow.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/session-recorder.tsx`
  - `apps/mobile/components/session-recorder/types.ts`
  - `apps/mobile/src/data/local-gyms.ts`
  - `apps/mobile/src/data/index.ts`
  - `apps/mobile/src/data/schema/gyms.ts`
  - `apps/mobile/src/data/migrations/index.ts`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/sync/bootstrap.ts`
  - `apps/mobile/app/__tests__/session-recorder-screen.test.tsx`
  - `apps/mobile/app/__tests__/sync-domain-event-emission.test.ts`
  - `apps/mobile/app/__tests__/sync-bootstrap-merge.test.ts`
  - `apps/mobile/app/__tests__/sync-reinstall-restore-parity.test.ts`
  - `docs/specs/**`
  - `docs/tasks/fix-sync/follow-ups.md`
  - `RUNBOOK.md` if operator workflow changes
- Project structure impact:
  - none expected; changes stay inside existing mobile data/UI/sync/test/docs locations.
- Constraints/assumptions:
  - "Personal to user" means no shared/global gym catalog and no default persisted gym list for every user.
  - `Local Gym` is a UX starter action, not seeded product data. It must be created only after an explicit user action.
  - Prefer a stable starter id such as `local-gym` only if collision behavior is handled like normal upsert/rename; otherwise generate a normal local id and rely on the name.
  - Backend `app_public.gyms` already has `deleted_at`, RLS, and composite `(id, owner_user_id)` ownership; use that unless inventory proves otherwise.
  - Local archive maps to sync soft-delete, not physical deletion.
  - `gyms.name` remains non-unique unless a human explicitly chooses a uniqueness rule.
  - Existing sessions may reference a gym id that is archived; presentation should prefer showing the archived gym name over dropping to `null`.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Additional required gates:
  - targeted Jest suites listed above
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:infra`  <!-- was test:sync:reinstall-parity (retired with sync v1) -->

- Conditional gate:
  - `./scripts/quality-slow.sh backend` if any `supabase/**` schema/API/contract implementation changes are made.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260517-01-personal-gym-list-sync.md`

## Evidence

- Targeted repository/schema test output:
- Targeted recorder UI test output:
- Targeted sync merge/outbox test output:
- Restore-parity output:
- Fast gate output:
- Slow frontend gate output and Maestro artifact root:
- UI screenshots/artifacts:
  - fresh-user empty gym picker with `Local Gym` starter:
  - active gym manage view:
  - archived gym manage view:
- Manual verification summary:
- Deferred/manual hosted checks summary:
  - expected `N/A` unless backend schema/API changes are made.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:
- RUNBOOK.md reviewed:
- Parent milestone status:
  - `docs/specs/milestones/M13-simple-backend-sync.md` remains `completed` unless a human explicitly reopens it; this task is post-M13 hardening.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Ensure completion note is filled before handoff.
- Update `docs/specs/05-data-model.md` for local schema/sync-scope changes.
- Update `docs/specs/tech/client-sync-engine.md` if merge/convergence behavior changes.
- Update relevant UI docs (`screen-map.md`, `ux-rules.md`, and optionally `repo-discovery-baseline.md`) or record explicit no-update rationale.
- Update `docs/tasks/fix-sync/follow-ups.md` if the `gyms` slice of P4 is completed.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260517-01-personal-gym-list-sync.md` or document why `N/A`.
