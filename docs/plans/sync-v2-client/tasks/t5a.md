# t5a: write-path dirty-bit wiring — Layer 0/1 repos

**Type:** build

**Problem:** With t2's schemas in place (`local_dirty`,
`local_updated_at_ms` on every entity table) and t4's `nowMonotonic()`
helper available, every repo create / update / softDelete / cascade
path must flip `local_dirty = 1` and set `local_updated_at_ms =
nowMonotonic(tx)` **inside the same SQLite transaction as the data
write** per t2 §7.2. Without this, the cycle (t6) cannot discover
the row needs pushing. The eight entity tables fan out across seven
repo files (~5800 lines of source code, ~10–40 write paths each);
wiring all of them in one PR would blow past the size budget. t5a
covers the **Layer 0 and Layer 1 entities** per `topo-order.ts`:
`gyms`, `exercise_definitions`, `sessions`,
`exercise_muscle_mappings`, `exercise_tag_definitions`. t5b covers
Layer 2 / 3.

**Inputs:**

- t4 merged (`nowMonotonic` available at `apps/mobile/src/data/clock.ts`).
- t2 merged (`local_dirty` / `local_updated_at_ms` columns exist on
  every entity table; t2 also added `deleted_at` to the five
  schemas that lacked it).
- `docs/plans/sync-v2/designs/t2.md` §7 — the dirty-bit lifecycle
  contract.
- `apps/mobile/src/sync/topo-order.ts` — the layer partition. t5a
  covers Layer 0 entities (`gyms`, `exercise_definitions`) and
  Layer 1 entities (`sessions`, `exercise_muscle_mappings`,
  `exercise_tag_definitions`).
- Repo files in scope for t5a:
  - `apps/mobile/src/data/local-gyms.ts` (gyms — 192 LOC).
  - `apps/mobile/src/data/session-list.ts` (sessions — 330 LOC; the
    list / soft-delete / restore paths).
  - `apps/mobile/src/data/exercise-catalog.ts` (exercise_definitions
    and exercise_muscle_mappings — 487 LOC).
  - `apps/mobile/src/data/exercise-catalog-seeds.ts` (the seeder
    inserts into exercise_definitions, exercise_muscle_mappings,
    exercise_tag_definitions — 4342 LOC, but most is seed data;
    the write paths are concentrated in the helper functions at
    the top of the file).
  - `apps/mobile/src/data/exercise-tags.ts` partial — only its
    `exercise_tag_definitions` paths (the `session_exercise_tags`
    paths belong to t5b — call them out in the card by function
    name once the implementer reads the file).
- `apps/mobile/src/data/exercise-history.ts` — touches sessions but
  read-only; verify it has no writes in scope and note "no edit"
  in the PR body if so.

**Outcomes:**

- Every create / update / softDelete / cascade path that writes to
  `gyms`, `exercise_definitions`, `sessions`,
  `exercise_muscle_mappings`, or `exercise_tag_definitions` in the
  files listed in Inputs:
  - Sets `localDirty: 1` in the row payload.
  - Sets `localUpdatedAtMs: nowMonotonic(tx)` in the row payload
    using the same transaction handle as the surrounding
    `database.transaction((tx) => {...})`.
  - The transaction wraps both the row write and the
    `nowMonotonic` call so per t2 §8.3 the persisted
    `last_emitted_ms` advances in the same commit.
- Soft-delete paths (`deletedAt: now`) ALSO flip the dirty bit per
  t2 §7.2 — soft delete is a normal write.
- The seeder paths in `exercise-catalog-seeds.ts` are special:
  seed inserts produce rows that should NOT be marked dirty on
  fresh installs (they exist on the server already via the
  catalog), but on dev re-seeds they SHOULD be. The card delegates
  the precise rule to the implementer: stamp them as **clean +
  `local_updated_at_ms = nowMonotonic(tx)`** so they push only if
  a subsequent user edit dirties them. Justification line in the
  PR body explains the choice.
- Jest tests cover, **one test per entity in scope** (5 entities, 5
  tests minimum), the assertion: "after `<repo.create>(input)`,
  the row's `local_dirty = 1` and `local_updated_at_ms > 0`,"
  AND "after `<repo.update>(id, patch)`, the row's `local_dirty
  = 1` and `local_updated_at_ms` advanced past the prior value,"
  AND "after `<repo.softDelete>(id)`, the row's `local_dirty = 1`
  and `deletedAt` is set." Cascade paths (e.g. cascading a soft
  delete to children) get one additional assertion: "the cascaded
  child rows also flipped their dirty bit."
- `npm run lint && npm run typecheck && npm run test` passes from
  `apps/mobile/`.
- `npm run check:sync-drift -- --strict` continues to exit zero
  (no new exemptions added).

**Output artifact:**

- Edits to: `apps/mobile/src/data/local-gyms.ts`,
  `apps/mobile/src/data/session-list.ts`,
  `apps/mobile/src/data/exercise-catalog.ts`,
  `apps/mobile/src/data/exercise-catalog-seeds.ts`,
  `apps/mobile/src/data/exercise-tags.ts` (partial: only
  `exercise_tag_definitions` paths).
- New / updated Jest tests under
  `apps/mobile/app/__tests__/` exercising the dirty-bit
  contract for each Layer 0 / 1 entity. Reuse existing repo
  test files where possible (e.g. `local-gyms-*.test.ts`,
  `session-list-*.test.ts`); add new dedicated tests where the
  existing surface doesn't cover the dirty bit.

**Out of scope:**

- Layer 2 / 3 repos (t5b: `session_exercises`, `exercise_sets`,
  `session_exercise_tags`).
- The cycle that reads the dirty bit (t6).
- The push serialiser deciding which columns to send on the wire
  (t6 owns; the `localDirty` / `localUpdatedAtMs` columns are local
  only per t2 §9.5).
- Refactoring repo APIs beyond the minimum needed to thread the tx
  handle through to the write call (this is a wiring task, not a
  redesign).
