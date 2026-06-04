# t7b: soft-delete the session-rebuild cascade

**Type:** build

**Problem:** `t7` (PR #108) converted the simple user-delete paths
(tag-assignment, muscle-mapping) to soft-delete but deferred ONE site as
materially separate work: the session-rebuild cascade in
`apps/mobile/src/data/session-drafts.ts`. On every session edit it
hard-`DELETE`s `session_exercise_tags`, `exercise_sets`, and `session_exercises`
and re-inserts — a wipe-and-reinsert that **reuses PKs** for surviving rows and
**reassigns `order_index`** by loop position against unique `(parent,
order_index)` indexes. For deletion to survive reinstall, rows removed during a
rebuild must become tombstones (`deleted_at = Date.now()` + dirty bit via the
normal repo path) reconciled against the rebuilt set — not hard-deleted — while
keeping the PK-reuse and `order_index` invariants correct.

**Inputs:**
- Depends on `t7` (PR #108) merged. Branch from latest `origin/main` AFTER #108
  lands. Reuse the soft-delete conventions it established: the `includeDeleted`
  reader flag pattern, `isNull(<table>.deletedAt)` reader filters, and the
  soft-delete guard test (which currently lists `session-drafts.ts` as the single
  exempted remaining hard-delete site — t7b removes that exemption).
- `apps/mobile/src/data/session-drafts.ts` — the session-rebuild cascade
  (`tx.delete(...)` of `session_exercise_tags` / `exercise_sets` /
  `session_exercises` before re-insert).
- Every session reader of those three entities that must now filter tombstones:
  `apps/mobile/src/data/stats.ts`, `apps/mobile/src/data/exercise-history.ts`,
  `apps/mobile/src/data/session-list.ts`,
  `apps/mobile/src/data/exercise-block-history.ts` (grep the three entities for
  any other reader).
- Binding design context: `docs/plans/sync-v2/designs/t3.md` §3.1 / §5.2
  (tombstones count toward `rowsPulled`; deletion survives reinstall),
  `docs/plans/sync-v2/designs/t1.md` (deletion is `deleted_at != null`, no
  `deleted boolean`).

**Outcomes:**
- The session-rebuild cascade soft-deletes rows that are removed during a rebuild
  (set `deleted_at` + dirty bit via the normal repo path) and reconciles/revives
  surviving rows in place instead of hard-deleting and re-inserting. PK-reuse and
  `order_index` reassignment stay correct against the unique indexes.
- No user-facing hard `DELETE` against the 8 entities remains anywhere in
  `apps/mobile/src/` outside the exempt dev/fixture sites; the soft-delete guard
  test no longer exempts `session-drafts.ts` and still passes.
- Every session reader filters `WHERE deleted_at IS NULL` (except readers that
  explicitly opt into deleted rows).
- Jest covers: a session edit that removes an exercise/set/tag tombstones it (not
  removed), leaves it dirty, hides it from the default reader; a re-add revives
  the tombstoned row; the `order_index` + PK invariants hold.
- Quality gate `./scripts/quality-fast.sh frontend` passes; if any UI surface
  changes, `npm run test:e2e:ios:gates` passes.

**Output artifact:**
- Converted `apps/mobile/src/data/session-drafts.ts` + the session-reader filter
  updates.
- Updated soft-delete guard test (the `session-drafts.ts` exemption removed).
- Per-path Jest specs under `apps/mobile/app/__tests__/`.

**Out of scope:**
- The paths already converted by `t7` (tag assignment, muscle mappings).
- Any schema migration (columns + index already exist).
- The dev-reset full-table wipe and Maestro fixtures (exempt).
