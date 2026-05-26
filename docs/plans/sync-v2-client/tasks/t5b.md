# t5b: write-path dirty-bit wiring — Layer 2/3 repos

**Type:** build

**Problem:** Counterpart to t5a covering Layer 2 (`session_exercises`)
and Layer 3 (`exercise_sets`, `session_exercise_tags`) entities. The
contract is identical: every create / update / softDelete / cascade
flips `local_dirty = 1` and bumps `local_updated_at_ms =
nowMonotonic(tx)` inside the same transaction as the row write. The
split from t5a is purely size-driven; both halves must merge before
t6 (cycle) can rely on the dirty stream being authoritative.

**Inputs:**

- t4 merged (`nowMonotonic` available).
- t2 merged (`local_dirty`, `local_updated_at_ms`, `deletedAt`
  columns exist).
- `docs/plans/sync-v2/designs/t2.md` §7 — same dirty-bit contract
  as t5a.
- `apps/mobile/src/sync/topo-order.ts` — Layer 2: `session_exercises`;
  Layer 3: `exercise_sets`, `session_exercise_tags`.
- Repo files in scope for t5b:
  - `apps/mobile/src/data/session-drafts.ts` (the session-recorder
    draft state — touches `sessions`, `session_exercises`, and
    `exercise_sets`; 1054 LOC; the largest single file in scope).
    Note: `sessions` writes IN THIS FILE belong to t5b because the
    draft path's transactions are shared with the
    `session_exercises` / `exercise_sets` writes; cleaner to keep
    them together. t5a's `session-list.ts` covers the
    list / soft-delete / restore writes which use distinct
    transactions. Coordinate which Sessions-touching writes are
    t5a's vs t5b's via this card's "Inputs" section.
  - `apps/mobile/src/data/exercise-tags.ts` (partial — only the
    `session_exercise_tags` paths; the `exercise_tag_definitions`
    paths landed in t5a).
  - Any other repo file that writes to `session_exercises`,
    `exercise_sets`, or `session_exercise_tags` (re-grep
    `apps/mobile/src/data/` after t5a merges to confirm scope).

**Outcomes:**

- Every create / update / softDelete / cascade path that writes to
  `session_exercises`, `exercise_sets`, or `session_exercise_tags`
  in the files listed in Inputs:
  - Sets `localDirty: 1` in the row payload.
  - Sets `localUpdatedAtMs: nowMonotonic(tx)` in the row payload
    using the same transaction handle as the surrounding
    `database.transaction((tx) => {...})`.
- Session-draft reorder writes (which touch many sibling rows in
  one transaction per t1 §11.1 #1 / #2) flip the dirty bit on
  every row touched — t2 §10.1 #1 / #2 explicitly relies on this
  to keep the uniqueness invariants intact across the push batch.
- Cascade paths (e.g. soft-deleting a `session_exercise` cascades
  to its `exercise_sets` and `session_exercise_tags` children)
  flip the dirty bit on every cascaded child row in the same
  transaction.
- Jest tests, **one per entity in scope** (3 entities, 3 tests
  minimum), assert the same dirty-bit contract as t5a:
  create / update / softDelete each leave the row with
  `local_dirty = 1`. The reorder test additionally asserts: "after
  a reorder that swaps two siblings, BOTH siblings are dirty."
- `npm run lint && npm run typecheck && npm run test` passes from
  `apps/mobile/`.
- `npm run check:sync-drift -- --strict` continues to exit zero.

**Output artifact:**

- Edits to `apps/mobile/src/data/session-drafts.ts` and
  `apps/mobile/src/data/exercise-tags.ts` (and any other repo
  file the post-t5a re-grep surfaces).
- New / updated Jest tests under
  `apps/mobile/app/__tests__/` exercising the dirty-bit
  contract for each Layer 2 / 3 entity. The
  `draft-autosave-controller.test.ts` already exists for
  session-drafts — extend or add to it.

**Out of scope:**

- Layer 0 / 1 repos (t5a).
- The cycle that reads the dirty bit (t6).
- The push serialiser (t6).
- Coordination of the `sessions`-touching writes between t5a and
  t5b: if a Sessions write lives in `session-drafts.ts` it's t5b's;
  if it lives in `session-list.ts` it's t5a's. The split is by
  file, not by entity, where files cross layers.
