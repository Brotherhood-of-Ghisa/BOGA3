# M15 - GPS Gym Location Support

## Milestone metadata

- Milestone ID: `M15`
- Title: GPS gym location support
- Status: `in_progress`

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

Ship foreground-only GPS, user-confirmed gym detection, user-owned synced gym coordinates, no social/location sharing yet.

The MVP makes location advisory and private. The app may request current foreground location while the user is actively using the recorder or gym-management UI, but a GPS match is only a suggestion until the user confirms it. The only persisted location data is nullable coordinate metadata on the user's own `gyms` rows.

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

Orchestration note:

- This milestone would qualify for an orchestrator proposal because it touches data model, sync, Supabase, Expo native configuration, UI, and E2E evidence.
- The direct branch flow is still the selected implementation path for M15 because the user requested it for this milestone.

## In scope

- Foreground-only location permission and current-position reads.
- User-owned nullable coordinate metadata on `gyms`.
- GPS suggestion in the session recorder that can select a likely gym only after explicit user confirmation.
- Gym-management controls to save, replace, or clear a gym's coordinates.
- Pure, deterministic matching rules for nearest eligible gym.
- Sync contract and restore parity for gym coordinates.
- Cross-stack evidence that synced/restored coordinates preserve user-owned gym state.

## Out of scope

- Background location permission or background tasks.
- Continuous tracking.
- Automatic check-ins.
- Anti-cheat enforcement.
- Shared/public gym registry.
- Maps, geocoding, address lookup, Places APIs, or public gym discovery.
- Social visibility or location sharing.
- Multi-device conflict resolution beyond the current M13 assumptions.

## Product and privacy contract

1. Location is requested only from a user action or foreground recorder/gym-management affordance.
2. The app requests foreground permission only.
3. Denied permission must keep the recorder usable through manual gym selection.
4. A GPS match is presented as a suggestion, not applied silently.
5. Confirming a suggestion may select the gym for the active session. Persisting or replacing a gym's coordinates is a separate explicit action unless the task card scopes a clearly labeled confirm-and-save flow.
6. Stored coordinates belong to personal `gyms` rows and sync only for the authenticated owner.
7. No coordinate data is shown to other users in M15.

## User flows

### Foreground permission

- Trigger: user taps a GPS/current-location affordance in the recorder or gym-management UI.
- Success: app receives a foreground position with accuracy metadata and evaluates local gym matches.
- Denied: app shows inline feedback and leaves manual gym selection/editing available.
- Unavailable: app shows inline feedback for device/service unavailability and does not alter session or gym rows.

### Recorder GPS suggestion

- Trigger: user asks to detect current gym from the session recorder.
- Steps:
  - request foreground location if not already granted,
  - read current position,
  - filter gyms to rows with valid coordinates,
  - reject low-accuracy positions,
  - compute nearest eligible gym,
  - show suggestion with enough context to confirm or ignore.
- Success: user confirms and the active session's `gym_id` changes to the suggested gym.
- Failure/edge: no match, low accuracy, permission denial, unavailable location, or read timeout all leave existing session state unchanged.

### Manual override

- Trigger: user picks a different gym after a GPS suggestion appears or is applied.
- Success: manual selection wins immediately for the active session.
- Failure/edge: if the selected gym is archived/deleted by another flow, existing personal-gym rules decide whether the active draft clears or keeps historical display.

### Gym coordinate management

- Trigger: user opens gym management for a personal gym.
- Success cases:
  - save current location as the gym's coordinates,
  - replace existing coordinates after confirmation,
  - clear existing coordinates after confirmation.
- Failure/edge: denied permission, unavailable location, low accuracy, or persistence failure stays inline and does not corrupt the gym row.

## Data model proposal

Coordinate metadata extends the existing user-owned `gyms` model. Do not create a separate check-in/location entity for M15.

Proposed nullable fields:

| Field | Local type | Backend type | Notes |
| --- | --- | --- | --- |
| `latitude` | SQLite `real` nullable | Postgres `double precision` nullable | Valid range `-90..90`; `null` means no stored coordinate. |
| `longitude` | SQLite `real` nullable | Postgres `double precision` nullable | Valid range `-180..180`; `null` means no stored coordinate. |
| `coordinate_accuracy_m` | SQLite `real` nullable | Postgres `double precision` nullable | Accuracy radius in meters from the position reading used to save/replace coordinates. |
| `coordinates_updated_at` | SQLite `integer` ms nullable | Postgres `bigint` nullable | Epoch milliseconds for the latest coordinate save/replace/clear. |

Invariant:

- `latitude` and `longitude` are both null or both non-null.
- `coordinate_accuracy_m` and `coordinates_updated_at` may be null only when coordinates are null.
- Clearing coordinates sets all four fields to null except `coordinates_updated_at` may be set to the clear timestamp only if the implementation needs explicit last-change conflict handling; the data/sync task must choose one behavior and test it.
- Gym `updated_at` changes whenever coordinate metadata changes.

Sync impact decision: `in sync scope`.

- Gym coordinates are user-owned backup/restore data.
- `gyms.upsert` payloads must carry coordinate metadata.
- Backend projection, bootstrap fetch, merge, convergence events, and reinstall restore parity must include coordinate metadata.
- Project-level docs and sync contract updates are owned by the data/sync implementation task, not this planning task.

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

Recorder GPS suggestion:

- Uses an explicit detect/current-location affordance near the gym picker area.
- Shows loading, permission-denied, unavailable, low-accuracy, no-match, ambiguous, and matched states inline or in the existing recorder modal pattern.
- Does not change `gym_id` until the user confirms the suggestion.
- Manual gym selection remains available at all times.

Gym management coordinate controls:

- Reuse the existing in-route gym management pattern from the personal gym catalog work.
- Show whether a gym has saved coordinates without exposing excessive precision in the primary row.
- Provide explicit save/replace/clear actions and confirmation for replacing or clearing coordinates.
- Keep errors near the control that produced them.

UI docs:

- Recorder UI changes update `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md`.
- Route/path changes are not expected. If a task adds a route or query behavior, it must update `docs/specs/ui/navigation-contract.md`.
- Screenshots or equivalent simulator captures are required for UI implementation tasks.

## Deliverables

1. Data model, sync contract, backend projection, and migration support for gym coordinates.
2. Mobile foreground location service wrapper and pure matching domain logic.
3. Session recorder GPS suggestion UI.
4. Gym-management coordinate controls.
5. Restore parity, runtime evidence, and final docs closeout.

## Acceptance criteria

1. Foreground-only GPS is the only location mode used.
2. Permission denial, unavailable service, low accuracy, no match, and ambiguous match do not mutate session or gym data.
3. A recorder GPS match is only applied after user confirmation.
4. User-owned `gyms` rows can store nullable coordinate metadata.
5. Gym coordinate metadata is in sync scope and survives first-enable bootstrap, convergence, and reinstall restore.
6. Backend RLS and per-owner composite key semantics continue to prevent cross-user gym-coordinate reads/writes.
7. The pure matcher uses Haversine distance, rejects invalid/missing coordinates, honors radius and accuracy thresholds, and handles ties deterministically.
8. Gym-management UI can save, replace, and clear coordinates with clear feedback.
9. Manual gym selection remains available and wins over any GPS suggestion.
10. `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is completed first or each GPS implementation task re-checks and adapts to its current state before editing gym UI/data code.
11. `expo-location` and native permission config are added only in the mobile GPS service task after checking current Expo documentation.
12. Local fast gates pass for every implementation branch; slow gates run when task risk triggers require real Supabase, SQLite, Maestro, or permission evidence.
13. Final M15 closeout updates project-level source-of-truth docs so stable GPS behavior is not left only in task cards.

## Task breakdown

1. `docs/tasks/complete/M15-T01-gps-gym-location-mvp-spec.md` - create this milestone spec and the direct branch implementation flow. (`completed`)
2. `docs/tasks/complete/M15-T02-gym-coordinate-data-sync-contract.md` - add gym coordinate schema, sync contract, backend projection, and tests. (`completed`)
3. `docs/tasks/complete/M15-T03-mobile-location-service-and-matching.md` - add foreground location service and pure matching domain logic. (`completed`)
4. `docs/tasks/complete/M15-T04-recorder-gps-suggestion-ui.md` - add recorder detection/suggestion UI. (`completed`)
5. `docs/tasks/complete/M15-T05-gym-management-coordinate-controls.md` - add gym-management save/replace/clear coordinate controls. (`completed`)
6. `docs/tasks/M15-T06-gps-restore-evidence-and-docs-closeout.md` - prove restore parity/runtime behavior and close M15 docs. (`planned`)

## Risks / dependencies

- `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is a prerequisite or live dependency because M15 builds on personal, database-backed gyms.
- Expo permission APIs and config requirements may differ from memory; implementation tasks must re-check current Expo docs before adding `expo-location`.
- Supabase schema/contract details must be re-checked against the current migrations before changing projection functions.
- Native permission behavior is hard to fully prove in Jest; M15 needs at least one real iOS simulator/manual or Maestro evidence path for permission-aware UI states.
- Coordinate precision has privacy implications; M15 keeps coordinates private and user-owned, with no social exposure.

## Project docs maintenance

This planning task does not mark coordinate schema as implemented/adopted at the project level. Downstream implementation tasks must update:

- `docs/specs/03-technical-architecture.md` when stable location-service/sync behavior lands.
- `docs/specs/05-data-model.md` when gym coordinate fields are added.
- `docs/specs/06-testing-strategy.md` when GPS-specific verification expectations are adopted.
- `supabase/session-sync-api-contract.md` when `GymRecord` and `gyms.upsert` payloads change.
- `docs/specs/tech/client-sync-engine.md` when bootstrap/merge/convergence behavior changes.
- `docs/specs/ui/*.md` when UI behavior changes.
- `RUNBOOK.md` if any local operator command or evidence workflow changes.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note.
