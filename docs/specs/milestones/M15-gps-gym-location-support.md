# M15 - GPS Gym Location Support

## Milestone metadata

- Milestone ID: `M15`
- Title: GPS gym location support
- Status: `completed`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Milestone objective

Ship foreground-only GPS, hidden gym detection assistance, user-owned synced gym coordinates, no social/location sharing yet.

The MVP makes location quiet and private. The app may request current foreground location while the user is actively using the recorder or single-gym editor UI, but GPS should not become a prominent recorder feature surface. A brand-new session may use one foreground location read to preselect a single matching saved gym. After that, manual selection wins unless the user explicitly long-presses the gym box to retry GPS detection. The only persisted location data is nullable coordinate metadata on the user's own `gyms` rows.

## Execution model

Implementation should use the direct branch flow below, not the orchestration protocol, unless a human later explicitly invokes `execute plan at docs/plans/<plan-name>/` or asks to use the orchestration protocol.

Direct branch flow:

1. Create one branch per task from the latest `main`.
2. Finish, verify, and hand off each task before starting the next dependent task.
3. Merge tasks in order unless a later task explicitly documents it can safely start from an unmerged predecessor.
4. Keep each branch scoped to its task card; do not mix GPS runtime, recorder UI, gym-management UI, and closeout evidence in one branch.
5. Suggested branch names:
   - `codex/m15-t02-gym-coordinates-sync`
   - `codex/m15-t03-location-service-matching`
   - `codex/m15-t04-recorder-gps-suggestion`
   - `codex/m15-t05-gym-coordinate-controls`
   - `codex/m15-t06-gps-restore-evidence-closeout`
   - `codex/m15-t07-hidden-gps-gym-ux-correction`

Orchestration note:

- This milestone would qualify for an orchestrator proposal because it touches data model, sync, Supabase, Expo native configuration, UI, and E2E evidence.
- The direct branch flow is still the selected implementation path for M15 because the user requested it for this milestone.

## In scope

- Foreground-only location permission and current-position reads.
- User-owned nullable coordinate metadata on `gyms`.
- Quiet one-shot GPS gym preselection when a brand-new active session starts.
- User-initiated long-press GPS retry from the recorder gym box.
- Single gym editor controls to save, replace, or clear a gym's coordinates.
- Pure, deterministic matching rules for nearest eligible gym.
- Sync contract and restore parity for gym coordinates.
- Cross-stack evidence that synced/restored coordinates preserve user-owned gym state.

## Out of scope

- Background location permission or background tasks.
- Continuous tracking.
- Automatic check-ins.
- Repeated automatic gym detection after a session has started.
- Anti-cheat enforcement.
- Shared/public gym registry.
- Maps, geocoding, address lookup, Places APIs, or public gym discovery.
- Social visibility or location sharing.
- Multi-device conflict resolution beyond the current M13 assumptions.

## Product and privacy contract

1. Location is requested only from brand-new session creation, a user action, or a foreground single-gym editor affordance.
2. The app requests foreground permission only.
3. Denied permission must keep the recorder usable through manual gym selection.
4. Brand-new session startup may silently preselect a gym only when exactly one eligible saved gym matches.
5. Startup auto-detection runs at most once for a brand-new active session and never overwrites later manual selection.
6. Long-pressing the recorder gym box is an explicit user action that may retry GPS detection and select one matched gym.
7. `No gym` is represented by nullable session `gym_id`, not by a persisted gym row.
8. Persisting or replacing a gym's coordinates belongs in the single gym editor.
9. Stored coordinates belong to personal `gyms` rows and sync only for the authenticated owner.
10. No coordinate data is shown to other users in M15.

## User flows

### Foreground permission

- Trigger: user starts a brand-new session, long-presses the recorder gym box, or taps a current-location affordance in the single gym editor.
- Success: app receives a foreground position with accuracy metadata and evaluates local gym matches.
- Denied: app shows inline feedback and leaves manual gym selection/editing available.
- Unavailable: app shows inline feedback for device/service unavailability and does not alter session or gym rows.

### Recorder quiet GPS preselection

- Trigger: user starts a brand-new active session.
- Steps:
  - request foreground location if not already granted,
  - read current position,
  - filter gyms to rows with valid coordinates,
  - reject low-accuracy positions,
  - compute nearest eligible gym,
  - preselect the gym only if exactly one eligible gym matches.
- Success: the new active session starts with the matched gym selected.
- Failure/edge: no match, ambiguous match, low accuracy, permission denial, unavailable location, or read timeout all create the session with `gym_id = null` and show `No gym`.

### Recorder explicit GPS retry

- Trigger: user long-presses the recorder gym box in an active session.
- Success: if exactly one eligible saved gym matches, the active session's `gym_id` changes to that gym.
- Failure/edge: no match, ambiguous match, low accuracy, permission denial, unavailable location, or read timeout leave the existing gym selection unchanged.

### Manual override

- Trigger: user picks a different gym or `No gym` after startup preselection or a long-press retry.
- Success: manual selection wins immediately for the active session.
- Failure/edge: if the selected gym is archived/deleted by another flow, existing personal-gym rules decide whether the active draft clears or keeps historical display.

### No gym selection

- Trigger: user opens the gym picker and selects `No gym`.
- Success: the active session stores `gym_id = null`; no gym row is created, synced, managed, archived, or shown in the gym list.
- Failure/edge: a later explicit long-press GPS retry may select a matched gym, but the user can return to `No gym` manually.

### Gym coordinate management in single gym editor

- Trigger: user opens the editor for one personal gym.
- Success cases:
  - save current location as the gym's coordinates,
  - replace existing coordinates after confirmation,
  - clear existing coordinates after confirmation.
- Failure/edge: denied permission, unavailable location, low accuracy, or persistence failure stays inline and does not corrupt the gym row.

## Implemented data model

Coordinate metadata extends the existing user-owned `gyms` model. Do not create a separate check-in/location entity for M15.

Implemented nullable fields:

| Field | Local type | Backend type | Notes |
| --- | --- | --- | --- |
| `latitude` | SQLite `real` nullable | Postgres `double precision` nullable | Valid range `-90..90`; `null` means no stored coordinate. |
| `longitude` | SQLite `real` nullable | Postgres `double precision` nullable | Valid range `-180..180`; `null` means no stored coordinate. |
| `coordinate_accuracy_m` | SQLite `real` nullable | Postgres `double precision` nullable | Accuracy radius in meters from the position reading used to save/replace coordinates. |
| `coordinates_updated_at` | SQLite `integer` ms nullable | Postgres `bigint` nullable | Epoch milliseconds for the latest coordinate save/replace/clear. |

Invariant:

- `latitude` and `longitude` are both null or both non-null.
- `coordinate_accuracy_m` and `coordinates_updated_at` may be null only when coordinates are null.
- Clearing coordinates sets all four coordinate fields to null.
- Gym `updated_at` changes whenever coordinate metadata changes.

Sync impact decision: `in sync scope`.

- Gym coordinates are user-owned backup/restore data.
- `gyms.upsert` payloads must carry coordinate metadata.
- Backend projection, bootstrap fetch, merge, convergence events, and reinstall restore parity must include coordinate metadata.
- Project-level docs and sync contract updates are complete as of M15 closeout.

## Sync contract requirements

1. Extend the `GymRecord` contract with nullable coordinate metadata.
2. Validate coordinate ranges in local repository/domain code and backend ingest/projection.
3. Preserve existing per-user composite primary key and RLS behavior.
4. Preserve soft-delete semantics for `gyms.deleted_at`.
5. Ensure bootstrap merge compares coordinate-bearing gym rows coherently with the existing `updated_at` winner rule unless a task documents a stronger reason to add field-level merge.
6. Ensure convergence events include coordinates for local winners.
7. Ensure reinstall restore parity includes active, archived/deleted, and coordinate-bearing gyms in normalized snapshots.

## Location matching rules

Default constants:

- Maximum acceptable current-position accuracy: `100m`.
- Default match radius: `150m`.
- Tie threshold: `25m`.
- Location read timeout target: implementation task should choose a practical foreground timeout and test timeout handling.

Rules:

1. Reject current-position readings with missing accuracy or accuracy greater than `100m`.
2. Ignore gyms whose coordinates are missing, partially missing, out of range, or archived/deleted.
3. Compute distance with the Haversine formula in meters.
4. A gym is eligible when distance is `<= 150m`.
5. If no eligible gym exists, return `no_match`.
6. If two or more eligible gyms are within `25m` of the closest distance, return an ambiguous result and require manual selection.
7. Otherwise return the nearest gym suggestion.
8. Matching logic must be pure and covered by deterministic unit tests without calling native location APIs.

## UI / UX requirements

Recorder quiet GPS assistance:

- Uses no visible detect/current-location button in the default recorder surface.
- Brand-new session creation may preselect a gym from one automatic foreground detection attempt.
- Startup auto-detection runs only once per brand-new active session and never re-runs for a restored active draft.
- Short press on the gym box opens the manual picker.
- Long press on the gym box explicitly retries GPS detection and may select one matched gym.
- Permission-denied, unavailable, low-accuracy, no-match, ambiguous, and read-failure states do not force a visible GPS suggestion panel.
- Manual gym selection remains available at all times and wins over startup detection.
- The picker includes `No gym` as a null-gym option; it is not a database row.

Gym coordinate controls:

- Reuse the existing in-route single gym editor pattern from the recorder.
- Remove coordinate actions from the multi-gym Manage screen.
- Provide `Save current location` in the single gym editor.
- For a newly added gym, attempt to save current coordinates automatically when a usable foreground position is available; failure must not block gym creation.
- Show whether a gym has saved coordinates without exposing excessive precision.
- Keep errors near the editor control that produced them.

UI docs:

- Recorder UI changes update `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md`.
- Route/path changes are not expected. If a task adds a route or query behavior, it must update `docs/specs/ui/navigation-contract.md`.
- Screenshots or equivalent simulator captures are required for UI implementation tasks.

## Deliverables

1. Data model, sync contract, backend projection, and migration support for gym coordinates.
2. Mobile foreground location service wrapper and pure matching domain logic.
3. Hidden session-recorder GPS gym assistance.
4. Single gym editor coordinate controls.
5. Restore parity, runtime evidence, and final docs closeout.

## Acceptance criteria

1. Foreground-only GPS is the only location mode used.
2. Permission denial, unavailable service, low accuracy, no match, and ambiguous match do not mutate session or gym data.
3. A recorder GPS match is applied automatically only during brand-new session startup or after explicit gym-box long press.
4. User-owned `gyms` rows can store nullable coordinate metadata.
5. Gym coordinate metadata is in sync scope and survives first-enable bootstrap, convergence, and reinstall restore.
6. Backend RLS and per-owner composite key semantics continue to prevent cross-user gym-coordinate reads/writes.
7. The pure matcher uses Haversine distance, rejects invalid/missing coordinates, honors radius and accuracy thresholds, and handles ties deterministically.
8. Single gym editor UI can save, replace, and clear coordinates with clear feedback.
9. Manual gym selection and `No gym` remain available and win over startup GPS preselection.
10. `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is completed first or each GPS implementation task re-checks and adapts to its current state before editing gym UI/data code.
11. `expo-location` and native permission config are added only in the mobile GPS service task after checking current Expo documentation.
12. Local fast gates pass for every implementation branch; slow gates run when task risk triggers require real Supabase, SQLite, Maestro, or permission evidence.
13. Final M15 closeout updates project-level source-of-truth docs so stable GPS behavior is not left only in task cards.
14. Corrective task `M15-T07` removes the visible recorder GPS suggestion surface and preserves GPS as quiet assistance plus an explicit long-press retry.

## Task breakdown

1. `docs/tasks/complete/M15-T01-gps-gym-location-mvp-spec.md` - create this milestone spec and the direct branch implementation flow. (`completed`)
2. `docs/tasks/complete/M15-T02-gym-coordinate-data-sync-contract.md` - add gym coordinate schema, sync contract, backend projection, and tests. (`completed`)
3. `docs/tasks/complete/M15-T03-mobile-location-service-and-matching.md` - add foreground location service and pure matching domain logic. (`completed`)
4. `docs/tasks/complete/M15-T04-recorder-gps-suggestion-ui.md` - add recorder detection/suggestion UI. (`completed`)
5. `docs/tasks/complete/M15-T05-gym-management-coordinate-controls.md` - add gym-management save/replace/clear coordinate controls. (`completed`)
6. `docs/tasks/complete/M15-T06-gps-restore-evidence-and-docs-closeout.md` - prove restore parity/runtime behavior and close M15 docs. (`completed`)
7. `docs/tasks/complete/M15-T07-hidden-gps-gym-ux-correction.md` - correct GPS UX so detection is hidden, one-shot at new session start, retryable by gym-box long press, supports `No gym`, and moves coordinate actions to the single gym editor. (`completed`)

## Risks / dependencies

- `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is a prerequisite or live dependency because M15 builds on personal, database-backed gyms.
- Expo permission APIs and config requirements may differ from memory; implementation tasks must re-check current Expo docs before adding `expo-location`.
- Supabase schema/contract details must be re-checked against the current migrations before changing projection functions.
- Native permission behavior is hard to fully prove in Jest; M15 needs at least one real iOS simulator/manual or Maestro evidence path for permission-aware UI states.
- Coordinate precision has privacy implications; M15 keeps coordinates private and user-owned, with no social exposure.
- Hidden GPS assistance must not make the app feel like it is fighting the user. Manual gym choice and `No gym` selection remain authoritative unless the user explicitly long-presses the gym box to retry GPS detection.

## Project docs maintenance

Original M15 closeout verified the following source-of-truth docs were aligned with the implemented foreground-only GPS, private gym-coordinate, sync/restore, and UI behavior. The completed `M15-T07` corrective follow-up updated the UI docs for quiet GPS assistance and editor-owned coordinate controls:

- `docs/specs/03-technical-architecture.md` when stable location-service/sync behavior lands.
- `docs/specs/05-data-model.md` when gym coordinate fields are added.
- `docs/specs/06-testing-strategy.md` when GPS-specific verification expectations are adopted.
- `supabase/session-sync-api-contract.md` when `GymRecord` and `gyms.upsert` payloads change.
- `docs/specs/tech/client-sync-engine.md` when bootstrap/merge/convergence behavior changes.
- `docs/specs/ui/*.md` when UI behavior changes.
- `RUNBOOK.md` if any local operator command or evidence workflow changes.

## Completion note

- What changed:
  - Added private nullable coordinate metadata to user-owned `gyms` locally and in Supabase projection, with `gyms.upsert` sync payloads, backend validation, bootstrap/merge/convergence handling, and reinstall restore parity.
  - Added foreground-only location reads behind an injectable service, pure Haversine gym matching, quiet one-shot recorder gym preselection, explicit gym-box long-press retry, `No gym` picker semantics, and single-gym editor controls to save, replace, or clear coordinates.
  - Kept GPS advisory/private for M15: no background location, no automatic check-ins, no maps/geocoding, and no social/shared location exposure.
- Verification summary:
  - Restore parity: `cd apps/mobile && npm run test:sync:reinstall-parity` passed with coordinate-bearing gyms in the normalized snapshot.
  - Backend contracts: `./scripts/quality-fast.sh backend` and `./scripts/quality-slow.sh backend` passed, including coordinate projection and invalid-coordinate rejection in `sync_events_ingest`.
  - Frontend/runtime: `./scripts/quality-fast.sh frontend` and `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend` passed.
  - Final frontend slow artifacts:
    - smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-081944-13493/`
    - data smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-082047-14652/`
    - auth/profile: `apps/mobile/artifacts/maestro/ad-hoc/20260524-082225-15858/`
- What remains:
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md` remains planned; M15 adapted to the current route-local gym management state and does not claim full database-backed gym-list sync is complete.
  - M15 branches are stacked on the T02-T05 lineage until those prerequisite branches land on `main`.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note.
