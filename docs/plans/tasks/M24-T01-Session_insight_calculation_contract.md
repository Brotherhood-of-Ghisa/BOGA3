---
task_id: M24-T01-Session_insight_calculation_contract
milestone_id: "M24"
status: completed
ui_impact: "no"
areas: "frontend"
runtimes: "node"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md"
---

# M24-T01 — Session insight calculation contract

## Task metadata

- Task ID: `M24-T01-Session_insight_calculation_contract`
- Status: `completed`
- Depends on: none

## Parent references

- Milestone: `docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md`
- Product/data/architecture: `docs/specs/00-product.md`,
  `docs/specs/03-technical-architecture.md`, `docs/specs/05-data-model.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- Existing calculations: `apps/mobile/src/data/muscle-analytics.ts`,
  `apps/mobile/src/data/exercise-block-history.ts`,
  `apps/mobile/src/exercise-calculations/index.ts`

## Objective

Create one pure, deterministic calculation surface for the current-session
muscle summary and exercise PR achievements so the recorder and completion
presentation cannot drift.

## Scope

### In scope

- Add a focused session-insights module under `apps/mobile/src/` and export only
  the public types/functions its UI consumers need.
- Adapt an active in-memory session plus exercise catalog metadata into the
  existing muscle analytics contract.
- Return physical performed/working set counts, contributing muscle values,
  stable ordering, unmapped-set count, and session-relative bar ratios.
- Extract or reuse the current PR comparison as a pure helper.
- Add a repository adapter that derives PR achievements for a target completed
  session against eligible as-of-session history.
- Preserve the existing Wathan, confirmation, set-type, load-mode, mapping-role,
  retroactive-metadata, and deleted-history semantics.

### Out of scope

UI, navigation, sharing, schema/backend/sync work, persisted achievements, or
changing analytics formulae.

## Acceptance criteria

1. The current-session muscle output matches existing analytics for identical
   input and counts source sets once across multiple mappings.
2. Mapped, partially mapped, and unmapped sessions have explicit deterministic
   outputs without inventing zero-valued contributing muscles.
3. Total/per-side load, role factors, warm-up volume, and working-set counts
   match the M24 calculation contract.
4. PR output covers strict greater-than, equality, below-best, no baseline,
   deleted history, missing exercise identity, repeated definition blocks, and
   deterministic tie behavior.
5. Live recorder and completed-session inputs use the same pure PR helper.
6. New tests do not depend on wall-clock time or developer timezone.
7. No data-model, sync, route, or UI behavior changes land in this task.

## Docs touched

- `docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md`:
  align implementation names only if the final module boundary differs.
- UI docs update required: **no**; this task changes no rendered behavior.

## Testing and verification approach

- Add focused unit tests beside the existing data/session tests.
- Run `./boga test fast`.
- Run `./boga test for --diff origin/main` plus an explicit-path audit for
  untracked additions and record the required lanes.
- Run `./boga test frontend`: the pure test lives in the canonical
  `apps/mobile/app/__tests__/` tree, which the path registry conservatively
  classifies with route/UI changes.

## Implementation notes

- Suggested home: `apps/mobile/src/session-insights/`.
- Prefer adapters around `collectMuscleSetContributions(...)` to a second muscle
  formula.
- Keep platform sharing and React state out of the calculation module.
- Project-structure impact: a small feature module only; update
  `docs/specs/09-project-structure.md` only if it becomes a canonical subsystem.

## Evidence

- `npm test -- --runTestsByPath app/__tests__/session-insights.test.ts --runInBand`
  — 15 tests passed.
- `./boga test fast` — passed (123 Jest suites / 1,235 tests, plus lint,
  typecheck, docs/meta, consent/MCP, and local backend smoke lanes).
- `./boga test frontend` — passed. The canonical `app/__tests__` placement
  triggers this gate through `scripts/triggers.tsv`; artifacts:
  `apps/mobile/artifacts/maestro/ad-hoc/20260912-161335-8926/`,
  `20260912-161445-10122/`, `20260912-161609-11631/`,
  `20260912-161749-13191/`, and `20260912-161944-14960/`.
- `./boga test for` — explicit changed-path audit requires `fast`, `frontend`,
  and `docs-check`; all are covered by the two aggregate runs above.

## Completion note

- What changed: added the shared pure muscle-load and PR calculation surface,
  plus the completed-session as-of-history repository adapter.
- What tests ran: focused session-insights Jest coverage, `./boga test fast`,
  and `./boga test frontend`.
- What remains: M24-T02 through M24-T05; this task intentionally adds no UI,
  navigation, sharing, schema, backend, or sync behavior.
