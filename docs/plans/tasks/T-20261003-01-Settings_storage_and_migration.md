# T-20261003-01 — Settings handling and migration to versioned JSON

- Status: `planned`
- Depends on: none
- Milestone: none; independent of M31
- Areas: cross-stack / settings / local data / sync; UI impact: existing controls only
- Delivery: one implementation task, session, worktree and PR
- Followed by: `T-20261003-02-User_settings_targets_and_progress`

## Objective

Introduce a common settings boundary with typed, versioned JSON persistence and
migrate existing settings into that format without losing saved choices.
Existing browsing preferences become account-isolated; bodyweight calculations
keep their current account synchronization; the theme remains device-wide.
This task adds no new Progress settings or effort controls.

## Decided storage scopes

Use one settings API, with separate JSON records where ownership differs:

| Scope | Existing settings to migrate | Persistence |
| --- | --- | --- |
| Device | Theme preset | Device-wide versioned JSON in `expo-sqlite/kv-store` |
| Account-local | Exercise sort, Show never-done, date format, past-records gym filter | One versioned JSON record per authenticated account in `expo-sqlite/kv-store`; device-only |
| Account-synced | Bodyweight calculations enabled | Versioned JSON on the existing local/server `user_settings` entity, synchronized with the account |

Later device-only settings extend the account-local record. The six Progress
and effort preferences belong to the following task. Local and device JSON
must never be included in a sync payload. Auth tokens, credentials, runtime
sync state and group-admin configuration retain their current boundaries.

## Settings boundary

- Provide typed defaults, validated loading, patch updates and subscriptions
  behind one settings boundary; callers do not manage persistence keys.
  Each record has a schema version and named setting fields. Missing fields
  receive defaults; unrelated fields survive writes. Future fields with the
  same ownership can extend that record without a DB column per setting.
- Serialize writes per record and preserve fields outside a patch. Report failed
  saves and retain the last durable values and recoverable input; do not report
  an in-memory change as a successful save. Preserve unreadable/unsupported
  records for recovery rather than replacing them on a failed read.
- Keep types/defaults in a dependency-safe layer. Existing feature hooks can
  adapt the common boundary; avoid a second storage implementation in a screen.
  Preserve current public behaviour, including sort/date/filter defaults and
  the theme applying on the next launch.
- Theme loading must remain synchronous before UI tokens evaluate, without
  depending on authentication or React hooks. Account records load for a captured
  account ID; discard late results after an account switch. Local-only builds
  use a separate local profile, never another account's saved record.
- Sign-out hides account settings and clears active snapshots while preserving
  saved account-local records. Returning to an account restores its choices.
  A sync database rebuild preserves these records; an explicit settings reset
  affects only its intended scope. Reinstallation starts with defaults.

## Migration and compatibility

- Migrate the legacy SecureStore key `boga3.exerciseListPreferences.v1` into the
  account-local JSON: preserve all four active fields, keep the existing
  `recentsOnTop` conversion, and ignore obsolete grouping/period fields.
- The legacy record has no account owner. Claim it once for the first
  authenticated account during migration, persisting the claim for retries.
  Other accounts start with defaults unless they already have a new-format
  record. Defer the claim while signed out; never copy one account's subsequent
  edits into another account. A local-only profile does not claim it for a user.
- Migrate `boga3.themePreset.v1` into the device JSON, preserving the selected
  preset and next-launch semantics. Keep current unknown-preset/read-failure
  diagnostics and fallback behaviour.
- Add an explicit `settings_json` field to local/server `user_settings`
  (SQLite JSON text and Postgres `jsonb`). Backfill a versioned object containing
  `bodyweightCalculationsEnabled` from each existing boolean, including pending
  local edits, before normal sync. Preserve ownership and LWW metadata.
- Make JSON authoritative for new readers/writers. Keep the legacy bodyweight
  column as a compatibility projection during the additive migration: new writes
  keep it consistent; older clients' accepted writes update the corresponding
  JSON field while preserving other JSON keys. Do not drop the old column here.
- Update sync serialization, push/pull and drift checks for the named JSON
  setting field; support existing protocol-3 clients during rollout. Keep the
  row-level LWW/dirty-bit/cursor contract, singleton identity and owner-only RLS.
  Update the server contract to explicitly allow versioned settings JSON while
  ordinary domain entities retain their typed-column rules.
- Preserve bodyweight behaviour in every personal reader, derived-facts
  invalidation and the agent training API. Group calculations keep their
  independent preference. Deploy the additive server migration before enabling
  new clients; prove old/new client compatibility, including a missing JSON field.
- Migration is idempotent and retryable. Existing valid new-format values win;
  do not overwrite later edits. Retain legacy source values until durable
  migration succeeds. Failed or interrupted conversion must not lose settings
  or mark migration complete.

## Deliverables and acceptance

1. Existing Settings controls and all current preference consumers use the
   common boundary, with saved choices retained through upgrade and relaunch.
2. Jest proves migration/defaults, legacy aliases, partial writes, schema versions,
   failed reads/writes, interrupted/repeated migration and writes during loading.
   Cover first-account migration ownership, A/B switching, stale requests,
   local-only profiles and sign-out/rebootstrap preservation.
3. Existing theme, browsing and bodyweight UI behaviour stays correct. Prove the
   startup theme and bodyweight-dependent calculations/facts retain their rules.
4. Local backend contracts prove JSON backfill, old/new client round-trips, LWW,
   owner isolation and OAuth denial. A local-only preference edit produces no
   settings sync write; a bodyweight edit still converges across devices.
5. Update the architecture, data model, sync contract, relevant UI contracts and
   drift checks. Delete this card in its implementation PR; the following card
   depends on this PR being merged. Evidence lives in the PR body.

## Gates

Run `./boga test fast`. Propose `backend` and `ios-sync-e2e`, the appropriate
existing UI lanes from `./boga test for`, and `jest-coverage`, `complexity` and
`dependencies`; agree all lanes beyond fast with the operator before running
those lanes. Read each affected test directory's README. Follow the repository
review, design-comparison, PR and worktree-cleanup rules.
