---
task_id: M26-T01-Add_four_tab_navigation_foundation
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md"
---

# M26-T01 — Add the four-tab navigation foundation

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- UI Impact: `yes`

## Context freshness at task start

- Run `./scripts/task-bootstrap.sh docs/plans/tasks/M26-T01-Add_four_tab_navigation_foundation.md`.
- Record current branch/HEAD and reread `AGENTS.md`, specs `02`, `03`, `09`,
  `08`, and the UI bundle index.
- Read the test-directory README before editing navigation tests.
- Re-inventory `(tabs)/_layout.tsx`, `TopLevelTabs`, `BottomTray`, root redirects,
  and route-resolution tests; do not assume this planning snapshot is current.

## Objective

Create an inactive, testable foundation for `Today / Train / Progress / More`
without changing the app's default destination or removing the current shell.

## Figma guidance

- [Approved board](https://www.figma.com/design/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=8-363)
- Use frames `01–04` for tab order, labels, selected state, and small-phone
  composition. Figma icons are directional; production uses the existing icon,
  token, and accessibility conventions.

## UX contract

### Four-tab route resolution

- Trigger: navigate directly to any new tab root during development.
- Steps: resolve the route to one of four typed keys and render the matching
  selected tab state.
- Success outcome: the correct tab is selected and every tab has a unique
  accessible label/test ID.
- Failure/edge outcome: unknown/nested segments resolve predictably without
  crashing or selecting an unrelated action.

### Recorder navigation suppression

- Trigger: enter an active recorder route.
- Steps: the shell recognizes recorder context and suppresses persistent tabs.
- Success outcome: workout controls receive the full viewport and no second
  session can be launched from the tab bar.
- Failure/edge outcome: completed-edit/invalid recorder states retain a clear
  exit path even with tabs suppressed.

## Scope

- Add typed four-tab navigation configuration and route-resolution helpers.
- Add new route adapters/scaffolds behind the current shell.
- Define labels, icons, test IDs, selected states, and recorder visibility rule.
- Preserve current navigation as the default until T06.

Out of scope: composing the four destination screens or removing legacy routes.

## Acceptance criteria

1. Four tab keys exist in canonical order with accessible labels and stable IDs.
2. Route resolution is covered for each root, nested/detail contexts, and an
   unknown segment.
3. The recorder visibility contract is centralized rather than implemented by
   unrelated screen-local hacks.
4. Current users still land in the existing shell; no destination is orphaned.
5. Shared UI tokens/primitives are reused; no raw screen color literals.
6. UI navigation/component docs are updated for behavior that has actually
   shipped in this task.

## Implementation notes

- Expected areas: `apps/mobile/app/(tabs)/_layout.tsx`,
  `apps/mobile/components/navigation/**`, `apps/mobile/src/navigation/**`, and
  focused tests.
- Prefer one declarative tab model consumed by layout and presentation.
- Do not copy data/loading logic into navigation components.
- No project-structure change is expected.

## Verification

- Unit: route-to-tab mapping, tab callbacks, accessibility labels, recorder
  suppression, unknown route fallback.
- Visual: selected/unselected shell at 375 pt and a larger supported phone.
- Gates: `./boga test fast`, `./boga test frontend`, plus anything reported by
  `./boga test for`.

## Completion note

- What changed:
- What tests ran:
- Visual evidence:
- What remains:
