---
task_id: M26-T06-Cut_over_routes_and_preserve_compatibility
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; path-specific lanes from ./boga test for"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M26-T06 — Cut over routes and preserve compatibility

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01 through M26-T05
- UI Impact: `yes`

## Context freshness at task start

- Run the task bootstrap helper and record branch/HEAD.
- Reread required specs and every relevant test README.
- Run current route/call-site inventories and `./boga test for` before editing.
- Verify all four destination tasks are complete and the planning action is real;
  do not cut over around missing functionality.

## Objective

Make the four-tab shell the production default while maintaining explicit,
tested behavior for old routes and deep links.

## Figma guidance

- [Approved board](https://www.figma.com/design/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=8-363)
- [Primary prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- Treat the four-tab order and ownership boundaries as approved. Production
  behavior remains governed by current auth, sync, group, and recorder contracts.

## UX contract

### Default launch and tab switching

- Trigger: complete app launch/auth/first-sync or press a top-level tab.
- Steps: `/` resolves to Today; switching tabs preserves expected state and
  highlights exactly one destination.
- Success outcome: every primary capability is reachable in the approved
  ownership model.
- Failure/edge outcome: auth/first-sync gates still run before data surfaces and
  cannot flash an incorrect tab.

### Legacy entry point

- Trigger: open an existing route/deep link or return target from an older flow.
- Steps: preserve it or adapt/redirect to the new canonical destination without
  losing required params.
- Success outcome: the intended capability opens and Back/dismiss behavior is
  understandable.
- Failure/edge outcome: invalid params keep the existing safe error state; no
  redirect loops or dropped group invite codes.

## Scope

- Switch root redirect and persistent navigation to Today/Train/Progress/More.
- Remove old destinations from the visible tab bar.
- Preserve/adapt `/stats-history`, `/session-recorder`, `/exercise-catalog`,
  `/groups`, `/settings`, group invites, completed-edit, and detail return paths.
- Update authoritative UI docs to current post-cutover behavior.

Out of scope: removing compatibility paths solely for code tidiness.

## Acceptance criteria

1. `/` resolves to Today after existing route-layer gates.
2. Exactly four persistent tabs render in approved order; Settings is under More.
3. Recorder and other focused detail contexts follow the agreed navigation
   visibility/back behavior.
4. Every old route has a documented keep/redirect/adapter decision with tests.
5. Params for completed-edit, exercise history/filtering, catalog return intent,
   and group joins survive their relevant transitions.
6. No visible orphan feature remains after old tabs disappear.
7. Navigation contract, screen map, component catalog, and UX rules match the
   shipped implementation and remain concise/source-linked.

## Implementation notes

- Prefer compatibility wrappers/redirects over a flag-day rename where Back or
  query semantics would otherwise change.
- Search for string route literals across mobile code/tests before deleting any
  screen.
- Keep auth and first-sync gates route-agnostic except for intentional exemptions.

## Verification

- Unit/integration: root redirect, active tab mapping, every compatibility path,
  param retention, Back/dismiss behavior, auth/first-sync exemptions.
- Maestro: cold launch -> Today; all four tabs; group invite; completed-session
  edit; catalog round trip; active-session resume.
- Gates: `./boga test fast`, `./boga test frontend`, and every additional lane
  reported by `./boga test for`.

## Completion note

- What changed:
- Compatibility table/result:
- What tests ran:
- Visual evidence:
- What remains:
