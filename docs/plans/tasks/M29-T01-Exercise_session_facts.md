# M29-T01-Exercise_session_facts — Per-exercise, per-session facts and PR flags

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (local data layer, local migration, no UI); UI impact: no

## Objective

Make "is this a PR?" and PR history cheap reads instead of a replay of the whole
training history. Add a local-only, derived table with one row per exercise
definition per completed session, holding that exercise's best estimated 1RM,
top weight, volume and working sets for the session, plus a PR flag for each of
the three metrics. Keep it correct under every write path and every
calculation-policy change, and prove it against a full rebuild.

## Why

Today `loadCompletedSessionInsights` (`src/session-insights/repository.ts`)
loads every earlier completed session with all of its exercises and sets, for
every exercise rather than only the one asked about. It then recomputes each
set's 1RM in JS to find the historical best (`calculations.ts`,
`collectHistoricalBestByExerciseDefinition`). One PR answer costs O(all sets
ever logged). Counting PRs per window (Today) or drawing PR history would
multiply that. The server already chose "derive once, index it" for groups
(`group_set_facts`, `group_board_entries`); this brings the same shape to the
owner's own data on the device.

## Decided

- **Grain:** one row per (completed, non-deleted session × linked exercise
  definition). Repeated blocks of one definition in a session fold into one
  row. Unlinked legacy session exercises are excluded (they have no history
  today either). Active sessions have no rows.
- **Columns (names indicative):** `session_id`, `exercise_definition_id`,
  `achieved_at` (the session's `completed_at`; ties ordered by `session_id`,
  as `compareSessionOrder` does), `best_e1rm_kg` + `best_e1rm_set_id`,
  `top_weight_kg` + `top_weight_set_id`, `volume_kg` + `volume_complete`,
  `working_sets`, `pr_e1rm`, `pr_weight`, `pr_volume`, `rules_version`.
  Index `(exercise_definition_id, achieved_at)`.
- **Metric rules are the existing ones, unchanged:**
  - 1RM uses the personal calculation policy
    (`docs/specs/tech/bodyweight-load-contract.md`).
  - Top weight is raw entered kg.
  - Volume is calculated load × reps over valid confirmed sets, warm-ups
    included, as in the completed-session volume comparison (spec `05` #10).
  - Eligible sets are `isEligiblePerformedSet`; working sets are
    `isWorkingSetType`.
- **PR flag rule:**
  - A metric is flagged when the session's value strictly beats the best of
    every earlier completed session for that definition.
  - At most one set per exercise per session carries each flag.
  - An exercise's first session carries no flag. A PR history view shows that
    session as the baseline, not as a PR.
  - An incomplete volume total is never a volume PR and never raises the bar.
  - The 1RM flag must equal `deriveSessionPersonalRecords` on every session.
- **Local-only, out of sync scope:**
  - Derived and rebuildable. No server table, no wire change, and outside the
    sync-drift checker, like `group_cache`.
  - FK-free (local integrity rule 2). Readers inner-join the live rows.
  - Cleared by the sign-out / account-switch wipe.
  - Each device derives its own rows from synced raw data, so devices on
    different rule versions never mix values.
- **Staleness is never served:**
  - `rules_version` marks rows built under older rules.
  - A stale or missing exercise is rebuilt before a read returns. Reads never
    fall back silently to a partial answer.
- **Scope of recompute:**
  - A raw-data change touching definition D rebuilds D's rows. Flags depend on
    all earlier sessions, so D's flags are recomputed in date order. Cost is
    bounded by D's history, not the whole history.
  - A policy change (bodyweight toggle, a definition's contribution or load
    mode, a bodyweight reading) rebuilds the affected definitions; a toggle may
    rebuild all.
  - A rules bump rebuilds everything once.
- **Correctness oracle:** a full rebuild from raw rows is the definition of
  truth. Jest asserts incremental maintenance equals a full rebuild after each
  kind of write, and that the 1RM flags equal `deriveSessionPersonalRecords`.
- Not used for the muscle PR timeline, which is not being built. That timeline
  is a later read-time join of these rows with `exercise_muscle_mappings`, with
  no extra storage.

## Open — resolve with the user at session start

1. **How writes mark rows stale.** Writes reach the three raw tables from
   several places: the recorder and completed-edit autosave
   (`src/data/session-drafts.ts`), the session list (`src/data/session-list.ts`),
   the generic sync pull-apply (`src/sync/cycle.ts`), the local import and
   dev-seed scripts (`scripts/import/`), and dev reset. Policy writes also
   count: exercise definitions, `user_settings`, and the bodyweight readings in
   `src/data/bodyweight`.
   - Option A: SQLite triggers write a stale-definition queue table, which a TS
     drain empties before reads.
   - Option B: an explicit call at each write site.
   - Recommendation: **A**. It catches every path, pull-apply and imports
     included, and the 1RM calculation stays in TS.
2. **When the drain runs.** Before each facts read only, or also after session
   completion and after a pull drain (warm cache), or both?
3. **Ties inside a session.** `findBestPersonalRecordCandidate` breaks ties by
   set position before block position. With repeated blocks, set 1 of block 2
   beats set 2 of block 1. Recommendation: switch both it and the new table to
   session order (block, then set), so the differential test holds. This
   changes which tied set the PR badge highlights.
4. **Rewire the existing PR readers now or later?** Live/completion PRs, the
   exercise page and exercise history could read the table. Recommendation:
   later, one reader per PR, after this lands. This task only adds the table,
   its maintenance and a read API.

## Deliverables and acceptance

1. **Storage.** A Drizzle schema plus a local migration for the facts table and
   the stale-definition queue (if Open 1 picks A), and the wipe clearing both.
2. **Maintenance.** Rebuild-one-definition, rebuild-all and drain functions,
   plus a read API: rows for a definition in date order, and flagged rows in a
   time window.
3. **Jest.**
   - Each metric and flag rule: first session, tie across sessions, two
     qualifying sets in one session, repeated blocks, incomplete volume, a
     warm-up best set, an unlinked exercise, a deleted session, an active
     session.
   - Incremental equals a full rebuild after: completion, completed-edit,
     backdating `completed_at`, delete/undelete, relinking a session exercise,
     pull-apply, a bodyweight toggle or reading change, and a contribution or
     load-mode edit.
   - The 1RM flags equal `deriveSessionPersonalRecords` on a generated history.
4. **Measurement on a large fixture history** (e.g. `seed-dev-rich-history`
   scaled up): full rebuild, the incremental update after one completed
   session, and the old replay path, recorded in the PR body. Do not estimate
   these numbers; measure them.

## Specs to update

- `docs/specs/05-data-model.md`:
  - The table under *Test/runtime-only data* (local-only, derived, rebuildable).
  - Sync impact decision `out of sync scope`, with its guardrails.
  - The wipe list.
  - The note that derived metrics stay outside the mirror.
- `docs/specs/03-technical-architecture.md`: the decision register entry,
  "derive-once local facts for history metrics".

## Gates

Expected from `./boga test for` (authoritative): a local migration plus
`src/sync/account-wipe.ts` default to `fast` + `backend` + `ios-sync-e2e`;
propose a set to the operator. Before the PR: `jest-coverage`, `complexity`,
`dependencies`.
