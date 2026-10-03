# M31-T02 — Persist Progress preferences and weekly muscle targets

- Status: `planned`
- Depends on: `M31-T01-Design_and_contract`
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: data; backend/sync if selected in T01; UI impact: no

## Objective

Provide one validated read/write boundary for presentation granularity, the
accepted effort policies and weekly per-muscle targets. Implement the ownership,
offline behavior and restore contract accepted in T01.

## Scope and decided requirements

Milestone D2–D4 apply. Store configuration and raw source data; target attainment
and chart series remain derived. Use established persistence/write-notification
patterns. No target editor or chart UI in this task.

## Open — resolve at session start

Recheck T01's accepted storage/protocol decisions against current main. Confirm
the minimal schema and reader notification surface; if a synced model cannot
fit one reviewable PR, split this card before implementation.

## Deliverables and acceptance

1. Typed read/write APIs with accepted defaults, validation and a clear unset
   target representation. Invalid writes leave prior valid settings intact;
   read and write errors can be surfaced by later UI.
2. Migration/bootstrap and account lifecycle behavior match T01. Targets retain
   stable muscle identity when a display name changes, and deleted taxonomy
   entries have an explicit policy.
3. Synced scope, if chosen: owner-private schema/RLS, push/pull and drift parity,
   compatibility/defaults, LWW/deletion and wipe/restore are implemented together.
   Local-only scope, if chosen: account isolation and relaunch behavior are
   proven without creating a server mirror.
4. Meaningful repository/SQLite Jest tests for migration, defaults, validation,
   update/delete and account lifecycle; sync contract tests when applicable.
5. Delete this card and mark T02 completed in the milestone in this PR.

## Touchpoints and specs

Start at `apps/mobile/src/data/user-settings.ts`, `src/data/schema/`, the Drizzle
migration bundle and the established device preference store. If syncing,
include `src/sync/**`, `supabase/migrations/**` and contract fixtures. Load
`05-data-model.md`, `tech/sync-v2-server-contract.md`, `10-api-authn-authz-guidelines.md`
and `supabase/README.md` as applicable; read the owning test README before edits.
Update the data/wire/architecture specs for the chosen contract in this PR.

## Gates

Follow T01's agreed staging policy. Add/update Jest and pass `fast` plus the three
quality targets before the code PR. Propose backend and `ios-sync-e2e` if schema,
boot or sync contracts change; run agreed local lanes to green. No backend/sync
skip is granted merely because the feature is labelled a preference.
