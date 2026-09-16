---
task_id: M26-T06-Cut_over_routes_and_preserve_compatibility
milestone_id: "M26"
status: completed
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; path-specific lanes from ./boga test for"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M26-T06 — Cut over routes and preserve compatibility

## Task metadata

- Status: `completed`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01 through M26-T05
- UI Impact: `yes`

## Context freshness at task start

- Branch/starting HEAD: `m26-option-c-navigation @ 23c88426`.
- Reread required specs, design policy, UX delivery standard, Maestro contract,
  and the mobile test README; inventoried current routes/call sites before edit.
- The user approved cutting over with the honest `Watch this space 👀`
  planning placeholder. Empty start and active resume remain real and usable;
  no dead planner action or invented plan data is exposed.

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

## Docs touched

- UI docs update required?: yes — `docs/specs/ui/navigation-contract.md`,
  `screen-map.md`, `components-catalog.md`, and `ux-rules.md` now describe the
  production four-tab shell and preserved route ownership.
- Tokens/primitives compliance statement: reused `BottomTray`, `MainTabs`, and
  existing token-backed button/surface primitives; no raw color exception.
- UI artifacts/screenshots expectation: standard and 375 pt root/recorder
  capture sets are mandatory and recorded below.

## Verification

- Unit/integration: root redirect, active tab mapping, every compatibility path,
  param retention, Back/dismiss behavior, auth/first-sync exemptions.
- Maestro: cold launch -> Today; all four tabs; group invite; completed-session
  edit; catalog round trip; active-session resume.
- Gates: `./boga test fast`, `./boga test frontend`, and every additional lane
  reported by `./boga test for`.

## Completion note

- What changed: the root and production shell now use exactly Today, Train,
  Progress, and More; recorder routes suppress persistent navigation; Settings
  moved under More; completion and completed-edit exits use Progress.
- Compatibility table/result:

  | Existing entry | Decision |
  | --- | --- |
  | `/` | redirect to canonical `/today` |
  | `/stats-history` | preserve exact dashboard/history UI; select Progress |
  | `/session-recorder` | preserve path/params; hide persistent navigation |
  | `/exercise-catalog`, `/groups`, `/settings` | preserve direct paths; select More |
  | group invite/detail routes | preserve paths, params, and native-stack behavior |
  | completed-session edit/summary | preserve params; safe completion exits go to Progress |
  | `/exercise-history` | preserve params/native header; render MainTabs with Progress selected |

- What tests ran: focused navigation/surface/detail tests; typecheck; UI
  guardrails; lint; `./boga test for`; `./boga test fast` (141 mobile suites,
  1,460 tests, plus backend-fast/docs/meta/auth-web/MCP); and `./boga test
  frontend` (all six iOS flows) are green.
- Visual evidence: the standard shell capture set is under
  `apps/mobile/artifacts/maestro/M26-T06-shell-final/20260916-154152-79676/`.
  The animation-settled 375 pt set is under
  `apps/mobile/artifacts/maestro/M26-T06-shell-small/20260916-152438-63910/`.
  Both show all four labels; the recorder captures show no persistent bar.
- Manual verification summary (required when CI is absent/partial): inspected
  all five standard and all five 375 pt captures; the four tabs fit, selected
  states are clear, and the focused recorder has no tray.
- What remains: no T06 implementation work. T07 keeps the milestone open only
  until the eventual closing PR records evidence and deletes ephemeral plans.
