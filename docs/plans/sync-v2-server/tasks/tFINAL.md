# tFINAL: server end-to-end verification

> Updated from t1 (PR #69, merged 2026-05-25): retired v1 contract suites
> (`session-sync-api-contract.sh`, `sync-events-ingest-contract.sh`) have
> been removed from `scripts/quality-slow.sh run_backend()`; this card's
> "full slow gate exits 0" assertion stays valid. The as-built `gyms` table
> carries `latitude` / `longitude` — include those columns in any
> push-roundtrip / pull-drain projection assertion that touches `gyms`.
>
> Updated from t2 (PR #72, awaiting merge — APPROVED): the layer→type
> partition has been corrected. The canonical partition is **Layer 0:
> `gyms`, `exercise_definitions`; Layer 1: `sessions`,
> `exercise_muscle_mappings`, `exercise_tag_definitions`; Layer 2:
> `session_exercises`; Layer 3: `exercise_sets`, `session_exercise_tags`.**
> Outcome 8a's "every entity is reachable via exactly one layer" assertion
> uses this partition. The seed-and-drain test must seed under this layout
> and assert the per-layer type sets match the corrected mapping.
>
> See plan.md `## Deviations log` for both.

**Type:** build (final test card)

**Problem:** Verify that the plan's outcomes hold end-to-end on a freshly
reset Supabase. Each test in this card maps 1:1 (or as a coherent test
group) to one of `plan.md`'s `## Outcomes` bullets. Failing the test card
means a plan outcome regressed, not a flaky test.

Read `docs/plans/sync-v2-server/plan.md` `## Outcomes` verbatim — every
outcome there is asserted below. The individual task cards (t1–t4) already
ship per-feature contract tests. This card focuses on **integration-level**
assertions that cross task boundaries and on outcomes that no single task
card naturally owns (the migration-tree invariants, the synthetic drift
case, the layered push→pull round-trip).

**Inputs:**

- t1, t2, t3, t4 (this plan) all merged.
- `docs/plans/sync-v2-server/plan.md` — read `## Outcomes` verbatim.
- `docs/plans/sync-v2/designs/t1.md` and `t2.md` — the upstream design
  references whose contracts the tests assert against.

**Outcomes:**

- One automated test (or coherent test group) per `plan.md` outcome,
  running in the repo's quality gate. Specifically:

  1. **Clean migration tree (plan outcome #1).** Test
     `supabase/tests/sync-v2-clean-room.sh` calls
     `supabase db reset --local --yes`, then queries
     `pg_proc` / `pg_class` / `pg_trigger` to assert: zero v1 objects by
     name (`sync_apply_projection_event`, `sync_events_ingest`,
     `sync_events_ingest_impl`, `sync_ingest_failure`,
     `sync_device_ingest_state`, `sync_ingested_events`); all eight v2
     tables present in `app_public`.
  2. **Schema shape per t1 §2 (plan outcome #2).** Same script asserts,
     for each of the eight entity tables: composite PK
     `(owner_user_id, id)`, presence of `owner_user_id`,
     `client_updated_at_ms`, `server_received_at`, `deleted_at` columns
     with correct types; zero CHECK constraints (queried via
     `information_schema.check_constraints` filtered to the table);
     `<table>_owner_received_idx` index present.
  3. **Triggers (plan outcome #3).** Asserts every entity has both
     `<table>_touch_server_received_at` and
     `<table>_owner_user_id_immutable` triggers (queried via
     `information_schema.triggers`). Asserts the
     `enforce_owner_user_id_immutable` function body contains the
     literal strings `IS DISTINCT FROM` and `auth.uid() IS NULL`
     (`pg_proc.prosrc` introspection).
  4. **Deferrable FKs (plan outcome #4).** Test
     `supabase/tests/sync-v2-deferrable-fk.sh` opens a transaction as a
     fixture user, inserts an `exercise_sets` row referencing a
     not-yet-existing `session_exercises.id`, then inserts the parent
     `session_exercises` referencing a not-yet-existing
     `sessions.id`, then the `sessions` and `gyms` ancestors —
     COMMIT succeeds without a "row violates foreign key" error.
     Also asserts via `information_schema.referential_constraints` that
     all eight expected FKs are present with `is_deferrable = 'YES'`
     and `initially_deferred = 'YES'`.
  5. **RLS isolation (plan outcome #5).** Test
     `supabase/tests/sync-v2-rls-cross-owner.sh` provisions two fixture
     users A and B (via existing `auth-provision-local-fixtures.sh`),
     directly inserts rows for each via service-role bypass, then with
     A's JWT exercises `SELECT`, attempted `INSERT` (with
     `owner_user_id = B`), `UPDATE` (targeting B's row), `DELETE`
     (targeting B's row) on each of the eight entity tables. All four
     ops return zero rows / RLS-deny. RLS-enabled status asserted via
     `pg_class.relrowsecurity = true`.
  6. **`sync_push` end-to-end (plan outcome #6).** Test
     `supabase/tests/sync-v2-push-roundtrip.sh` POSTs a multi-row,
     multi-layer batch (rows across all four topological layers
     including both join tables) **in non-topological array order**.
     Asserts response is `{ok: true, server_received_at: <iso>}`,
     every row is queryable via direct service-role SELECT, every row's
     `client_updated_at_ms` is `<= now()+5min` (future-clock clamp test
     uses an inflated input to exercise the branch). A second POST of
     the same payload at a strictly-greater `client_updated_at_ms`
     overwrites every column (LWW newer wins); a third POST at a
     strictly-lesser `client_updated_at_ms` is a no-op (LWW older
     loses). An orphan-child POST (a `session_exercises` whose parent
     `sessions` is neither in the batch nor on the server) returns the
     `FK_VIOLATION` error envelope and no rows land.
  7. **`sync_pull` end-to-end (plan outcome #7).** Test
     `supabase/tests/sync-v2-pull-drain.sh` seeds rows across all four
     layers for user A (using `sync_push`), then drains every layer
     with `limit: 2`. Asserts: pages within a layer are
     non-overlapping in `(server_received_at, owner_user_id, type, id)`
     order; the union of all pages exactly equals the seeded set; the
     last page of every layer has `has_more: false`; tombstones (rows
     with `deleted_at` set) are included in pull responses.
  8. **Push→pull round-trip (cross-task integration).** Same script
     pushes a batch as user A, then pulls every layer as A — every
     pushed row reappears in pull responses with identical
     `fields`. Pulling as user B returns zero of A's rows.
  8a. **Layered drain preserves client-FK closure (plan outcome
      "Layer→type mapping integrity").** Test
      `supabase/tests/sync-v2-pull-fk-closure.sh` pushes a
      fully-connected dataset as user A with the FK chain populated
      (at minimum: 1 `gyms`, 1 `exercise_definitions`, 1
      `exercise_tag_definitions`, 1 `sessions` referencing the gym, 1
      `exercise_muscle_mappings`, 1 `session_exercises` referencing
      the session + exercise_definition, 1 `exercise_sets`
      referencing the session_exercise, 1 `session_exercise_tags`
      referencing the session_exercise + exercise_tag_definition).
      Drains layers 0→3 sequentially. For every row in the layer-N
      response, asserts that *every* foreign-key reference resolves
      to a row that appeared in a layer-M response with M ≤ N (or in
      the same layer-N response if siblings reference each other,
      though the t1 §5 FK graph has no intra-layer references).
      Equivalently: simulate a client SQLite by maintaining a running
      `seen_ids: Set<(type, id)>` across layer responses and assert
      every FK column value in every row is in `seen_ids` by the time
      that row is inserted, with no forward references. Also asserts
      via Layer 0..3 type-set assertions (matching t4 "Layer→type
      mapping integrity") that the eight entity types partition
      exactly across the four layers. Failure of this test means a
      client drain would FK-fail on insert.
  9. **Drift checker rejects synthetic drift (plan outcome #8 and
     outcome #9 negative case).** Test
     `supabase/tests/sync-v2-drift-synthetic.sh` saves the current
     content of `apps/mobile/src/data/schema/exercise-sets.ts`,
     programmatically appends a `notes: text('notes')` column to the
     schema definition, runs `npm run check:sync-drift -- --strict`
     (or `./scripts/quality-slow.sh backend` if it composes), asserts
     **exit code is non-zero** and stdout includes the literal strings
     `exercise_sets`, `notes`, and the t1 §7.4 fix-flow template (the
     `alter table app_public.exercise_sets add column notes` snippet),
     then restores the original file. Test is hermetic — leaves the
     working tree clean.
  10. **Drift checker passes on as-built schema (plan outcome #9
      positive case).** Same script (or a companion) runs `npm run
      check:sync-drift -- --strict` against the unmodified working tree
      and asserts exit 0.
  11. **Spec edit landed (plan outcome #10).** A one-line grep test in
      `supabase/tests/sync-v2-spec-rule.sh` greps
      `docs/specs/05-data-model.md` for the literal heading
      `## Client schema drift rule (Sync v2)` and the literal sentence
      `the server migration must be deployed to production before the
      client change ships` (or the exact wording from t1 §8.2). Exits
      non-zero if either is missing.

- All test scripts above are wired into
  `./scripts/quality-slow.sh backend`'s `run_backend()` so a single
  invocation of the slow gate exercises every plan outcome. Test
  scripts follow the same shell-script conventions as existing
  `supabase/tests/*.sh` (use `_common.sh`, `auth-fixture-constants.sh`,
  jq, exit non-zero on first failure with a useful message).

- The full slow gate (`./scripts/quality-slow.sh backend`) exits 0 on
  the integration branch with all four prior tasks merged.

**Output artifact:**

- `supabase/tests/sync-v2-clean-room.sh` (outcomes 1, 2, 3)
- `supabase/tests/sync-v2-deferrable-fk.sh` (outcome 4)
- `supabase/tests/sync-v2-rls-cross-owner.sh` (outcome 5)
- `supabase/tests/sync-v2-push-roundtrip.sh` (outcome 6)
- `supabase/tests/sync-v2-pull-drain.sh` (outcomes 7, 8)
- `supabase/tests/sync-v2-pull-fk-closure.sh` (outcome 8a — layered
  drain FK closure)
- `supabase/tests/sync-v2-drift-synthetic.sh` (outcome 9 negative case)
- `supabase/tests/sync-v2-drift-asbuilt.sh` (outcome 9 positive case) —
  or fold into the synthetic script as a second test case
- `supabase/tests/sync-v2-spec-rule.sh` (outcome 10)
- `supabase/scripts/test-sync-v2-e2e.sh` — wrapper that runs every test
  above; invoked from `scripts/quality-slow.sh`'s `run_backend()` as
  one new step.

**Out of scope:**

- Client-side behaviour. The client engine ships in plan 2 and is
  tested by plan 2's final test card.
- Login enforcement, sync-gate, seed reorder, settings sync surface —
  all plan 3.
- Maestro / e2e UI tests — irrelevant to a server-only plan.
- Performance / load tests — v2's push and pull are batched per t2
  §3.7 / §4.1 to fit Supabase's RPC envelope; correctness is the
  outcome, throughput is not.
- The concurrent-commit cursor race (t2 §4.3 documented limitation);
  the test that would surface it is deliberately omitted because the
  limitation is known and accepted for v2.
