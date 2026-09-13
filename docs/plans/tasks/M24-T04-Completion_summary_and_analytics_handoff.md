---
task_id: M24-T04-Completion_summary_and_analytics_handoff
milestone_id: "M24"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M24-T04 — Completion summary and analytics handoff

## Task metadata

- Task ID: `M24-T04-Completion_summary_and_analytics_handoff`
- Status: `planned`
- Depends on: `M24-T02`, `M24-T03`

## Parent references

- Milestone: `docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md`
- UX/UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Routes: `apps/mobile/app/(tabs)/session-recorder.tsx`,
  `apps/mobile/app/completed-session/[sessionId].tsx`,
  `apps/mobile/app/(tabs)/stats-history.tsx`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Replace the abrupt post-submit jump with a screenshot-friendly completion
presentation that celebrates exercise PRs first, explains session muscle load
second, and leads directly to the existing seven-day muscle analysis.

## Scope

### In scope

- Add and validate `presentation=completion` on the existing completed-session
  route.
- Route successful active-session submit to that presentation after persistence
  and completion succeed.
- Render completion metadata, zero/one/many PR states, per-PR sharing, and the
  shared session muscle summary.
- Add accessible one-at-a-time multiple-PR navigation with stable position
  wording.
- Add validated optional `period` and `breakdown` query values to Stats /
  History and wire the seven-day muscle action.
- Preserve normal history detail and completed-edit save behavior.

### Out of scope

A new tab/route solely for achievements, durable celebration state, generated
share media, changes to heatmaps, and replay after completed-session editing.

## UX Contract

### Key user flows

1. **Finish with a PR**
   - Trigger: submit a valid active session containing one or more T01 PRs.
   - Steps: completion opens with session context, then PR hero, muscle summary,
     seven-day action, and Done.
   - Success outcome: the user can capture/share each PR before leaving.
   - Failure/edge outcome: multiple PRs are navigable one at a time; share
     cancellation/failure preserves the presentation.
2. **Finish without a PR**
   - Trigger: submit a valid active session with no strict PR.
   - Steps: the PR section is omitted and muscle load becomes the first insight.
   - Success outcome: completion still feels intentional without false praise or
     placeholder copy.
   - Failure/edge outcome: unmapped work gets the explicit unmapped muscle state.
3. **Continue to historical analysis**
   - Trigger: tap `View 7-day muscle load`.
   - Steps: replace to Stats / History with period 7 and By Muscle selected.
   - Success outcome: the existing multi-day analysis renders without adding a
     current-session heatmap range.
   - Failure/edge outcome: invalid direct query values fall back to existing
     defaults.
4. **Leave safely**
   - Trigger: tap Done or use the system back action.
   - Success outcome: return to Stats / History with no active copy of the
     completed session.
   - Failure/edge outcome: missing/deleted/load-error target offers one safe
     return and never exposes a broken recorder state.

### Interaction + appearance notes

- Completion is an alternate presentation of the existing detail route, not a
  new top-level navigation destination.
- PR hero owns the celebratory/screenshot layer; muscle load is supporting
  context below it.
- One PR card must fit with its full facts on the smallest supported phone;
  multiple cards use accessible paging rather than a dense grid.
- Hide ordinary edit/delete/append detail actions in completion presentation.
- Reuse T02/T03 components and existing tokens/primitives; no raw colors.

## Acceptance criteria

1. Successful active submit routes only after persistence/completion succeeds;
   failure keeps the recorder available for retry.
2. Completion-mode hierarchy and zero/one/many PR states match the milestone.
3. PR and muscle values come from T01 and match their live recorder equivalents.
4. Multiple PR paging has deterministic order, visible/accessibility position,
   and independent sharing.
5. Done/back cannot reopen the completed draft.
6. Seven-day action lands with `period=7` and `breakdown=muscle`; invalid query
   values preserve current Stats defaults.
7. Normal completed-session detail keeps edit/delete/append behavior, while
   completed-edit save retains its current direct Stats return.
8. Loading/not-found/error states remain accessible and have a safe exit.
9. Tokens/primitives, no-raw-color, navigation docs, and UI docs checks pass.
10. Required Jest/RNTL and Maestro flows cover all four user flows.

## Docs touched

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: completion presentation and Stats initial
    query state.
  - `docs/specs/ui/navigation-contract.md`: new query values and transitions.
  - `docs/specs/ui/components-catalog.md`: completion/PR/muscle components.
  - `docs/specs/ui/ux-rules.md`: completion hierarchy, multiple PRs, safe exit,
    and analysis handoff.
- Tokens/primitives reuse: T02/T03 components plus current shared surfaces,
  text, paging, buttons, and semantic colors; exceptions none planned.
- Required captures: PR completion, no-PR completion, multiple PRs, unmapped
  load, share launch/error, safe Done, and seven-day By Muscle destination on
  small and large phone viewports.

## Testing and verification approach

- Add route/component integration tests for submit navigation, query parsing,
  completion modes, share boundary, and safe exit.
- Extend the M24 Maestro golden path through submit, completion, share-sheet
  launch/return, and seven-day muscle destination.
- Run `./boga test fast` and `./boga test frontend` before PR.
- Run `./boga test for --diff origin/main`; use only measured gate durations.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
