# T-20261003-01 — Account-local preferences and browsing migration

- Status: `planned`
- Depends on: none
- Milestone: none; independent of M31
- Areas: frontend / settings / local preferences / account lifecycle; UI impact: existing controls only
- Delivery: one implementation task, session, worktree and PR
- Followed by: `T-20261003-02-User_settings_targets_and_progress`

## Objective

Persist browsing preferences per account in device-local storage and retain
saved choices through upgrade and relaunch. Supply typed preference access for
Settings and browsing consumers, ready for the following Progress task.

## Storage and ownership

Settings use the following persistence paths:

| Scope | Existing settings | Persistence |
| --- | --- | --- |
| Device | Theme preset | Existing `boga3.themePreset.v1` key in `expo-sqlite/kv-store` |
| Account-local | Exercise sort, Show never-done, date format, past-records gym filter | Account-scoped preference keys in the existing `expo-sqlite/kv-store`; device-only |
| Account-synced | Bodyweight calculations enabled | Existing `user_settings.bodyweight_calculations_enabled` column and sync path |

The following task adds the six Progress and effort preferences through the
account-local path. Local preference keys must never be included in a sync
payload. Auth tokens, credentials, runtime sync state and group-admin
configuration retain their current boundaries.

Reuse `apps/mobile/src/exercise-catalog/list-preferences.ts` and its defaults
in `list-model.ts`, `apps/mobile/components/ui/theme-launch.ts`, and the
bodyweight data/hook path in `apps/mobile/src/data/user-settings.ts` and
`apps/mobile/src/bodyweight/calculation-preference.ts`.

## Account-local preference access

- Provide typed reads, updates and subscriptions for account-local
  preferences. Reuse the existing defaults, normalization and
  `useSyncExternalStore` pattern; callers do not manage account keys.
  Missing values receive defaults and updates preserve unrelated preferences.
- Use ordinary scalar keys for scalar choices. Collection values use the
  serialization required by the key-value store, with typed validation.
  Prefer the store's synchronous operations when they remove async hydration
  and ordering machinery. Preserve correct ordering if writes remain async.
- Report failed saves and retain the last durable values and recoverable input;
  do not report an in-memory change as a successful save. A failed read must not
  cause a write that overwrites the stored choice.
- Keep types/defaults in a dependency-safe layer. Existing browsing hooks consume
  the account-local access; screens use those hooks.
  Preserve current public behaviour, including sort/date/filter defaults and
  the theme applying on the next launch.
- Keep the existing synchronous theme loading before UI tokens evaluate,
  independent of authentication and React hooks. Any async preference loading or
  migration captures its account ID and discards late UI results after a switch.
  Local-only builds use a separate local profile, never another account's keys.
- Sign-out hides account preferences and clears active snapshots while preserving
  saved account-local keys. Returning to an account restores its choices.
  A sync database rebuild preserves these keys; an explicit settings reset
  affects only its intended scope. Reinstallation starts with defaults.

## Browsing migration

- Migrate the legacy SecureStore key `boga3.exerciseListPreferences.v1` into
  account-scoped local preference keys: preserve all four active fields, keep
  the existing `recentsOnTop` conversion, and ignore obsolete grouping/period fields.
- The legacy record has no account owner. Claim it once for the first
  authenticated account during migration, persisting the claim for retries.
  Other accounts start with defaults unless they already have scoped
  preferences. Defer the claim while signed out; never copy one account's
  subsequent edits into another account. A local-only profile does not claim
  it for a user.
- Browsing migration is idempotent and retryable. Existing valid scoped values win;
  do not overwrite later edits. Retain legacy source values until durable
  migration succeeds. Failed or interrupted conversion must not lose settings
  or mark migration complete.

## Deliverables and acceptance

1. Existing browsing preference consumers use account-local access, with saved
   choices retained through upgrade and relaunch. Theme and bodyweight consumers
   retain their existing access paths.
2. Jest proves migration/defaults, legacy aliases, partial updates,
   failed reads/writes, interrupted/repeated migration and writes during loading.
   Cover first-account migration ownership, A/B switching, stale requests,
   local-only profiles and sign-out/rebootstrap preservation.
3. Existing theme, browsing and bodyweight UI behaviour stays correct. Prove the
   startup theme and bodyweight-dependent calculations/facts retain their rules.
4. Jest proves account-local edits do not dirty `user_settings` or nudge sync.
   Existing bodyweight sync coverage remains the regression check.
5. Update the architecture, account-local ownership rules in the data model and
   relevant UI contracts. Delete this card in its implementation PR; the
   following card depends on this PR being merged. Evidence lives in the PR body.

## Gates

Run `./boga test fast`. Use `./boga test for` to propose the appropriate existing
UI/account-lifecycle lanes and `jest-coverage`, `complexity` and `dependencies`.
Account-switch integration may select `backend` and `ios-sync-e2e`; explain
whether those lanes exercise the actual diff, and agree all lanes beyond fast
with the operator before running them. Read each affected test directory's
README. Follow the repository review, design-comparison, PR and worktree-cleanup rules.
