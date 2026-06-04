# tINVENTORY: inventory + review every non-unit test this plan introduced

**Type:** build (closure / test-suite hygiene)

**Problem:** This plan introduced a large number of NON-unit tests under schedule
pressure and against repeatedly-flaky lanes — Maestro e2e flows, Supabase /
real-instance (infra) tests, and mock-device-DB (in-memory SQLite) tests. Several
of those tests never ran green during development (the slow lanes were flaky
in-agent), some were written/rewritten across multiple rebases, and a real
gate bug still reached `main` (#129). The coherence and value of this test set is
unverified. Before closeout, inventory every non-unit test the plan added, decide
keep / drop for each, and verify each conforms to the repo's testing architecture
principles — removing the ones that don't earn their place and fixing the ones
that violate a principle.

**Inputs:**
- The testing architecture principles are AUTHORITATIVE — verify against them, do
  NOT redesign them: `docs/specs/06-testing-strategy.md` (esp. "In-memory SQLite
  unit tests (shared fixture)", "Maestro contract ownership", "Shared Supabase
  runtime contract (slow real-instance tests)", "iOS lane configuration contract",
  "Local data two-lane policy", "Backend / Supabase testing model"),
  `docs/specs/11-maestro-runtime-and-testing-conventions.md`,
  `docs/specs/09-project-structure.md` (test asset locations).
- The plan's merged PRs are the source of "what this plan introduced" — derive the
  introduced non-unit tests from them (the `## Deviations log` in `plan.md` lists
  every merged PR).
- The three categories to inventory:
  1. **Maestro e2e flows** — `apps/mobile/.maestro/flows/*.yaml` added/modified by
     this plan, and their runner wiring (`apps/mobile/scripts/maestro-ios-*.sh`).
  2. **Supabase / infra tests** — the real-instance / branch-provisioned tests
     (`apps/mobile/app/__tests__/sync/**`, the `test:sync:infra` targets, contract
     tests against `app_public`).
  3. **Mock-device-DB tests** — in-memory SQLite tests (those using the shared
     fixture `apps/mobile/app/__tests__/helpers/in-memory-db.ts`, and any that
     hand-roll DB/DDL setup instead).

**Outcomes:**
- A durable **inventory document** (e.g. `docs/testing/sync-v2-non-unit-test-inventory.md`
  or a section the testing spec links) listing every non-unit test the plan
  introduced, grouped by the three categories. For each entry: a one-line
  description of what it covers, a **keep / drop decision with rationale**, and a
  **principles-conformance check** — at minimum:
  - in-memory SQLite tests use the shared `createInMemoryDatabase()` fixture (not
    hand-rolled DDL), per 06 "In-memory SQLite unit tests"; bespoke fixtures only
    where the spec's negative-space exception applies;
  - Maestro flows obey the iOS lane configuration contract (no hand-edited
    `.env.local`; correct infra-free vs Supabase-configured lane) and Maestro
    contract ownership;
  - Supabase/infra tests follow the shared-Supabase runtime contract;
  - no redundant / overlapping / dead / flaky-by-design tests (e.g. two tests
    asserting the same thing, a Maestro flow superseded by another, a stub-heavy
    "e2e" that's really a unit test mislabeled).
- The drops are actually removed and the keep-but-violating ones are fixed (e.g.
  hand-rolled DB setup → shared fixture; a flow that mutates `.env.local` → use the
  runner). Net result: a coherent non-unit test set that matches the architecture.
- The fast gate passes; the slow gates relevant to any test touched run green
  (per the per-change slow-gate triggers in `docs/specs/06-testing-strategy.md`).
- A short summary in the PR of what was dropped, what was fixed, and why.

**Output artifact:**
- The inventory document (durable, under `docs/`).
- The test removals / fixes across `apps/mobile/.maestro/flows/`,
  `apps/mobile/app/__tests__/**`, and runner scripts as decided.

**Out of scope:**
- Net-new feature tests; redesigning the testing architecture (verify against it).
- Unit tests that are clearly fine (the focus is the NON-unit set: Maestro,
  Supabase/infra, mock-device-DB).
- The plan-level outcome assertions owned by `tFINAL` (this task reviews the test
  set's hygiene; tFINAL owns the 5 cross-cutting outcome assertions).
