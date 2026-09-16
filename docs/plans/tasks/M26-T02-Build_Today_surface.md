---
task_id: M26-T02-Build_Today_surface
milestone_id: "M26"
status: completed
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; conditional ./boga test ios-groups-e2e when group paths change"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/ux-rules.md"
---

# M26-T02 — Build the Today surface

## Task metadata

- Status: `completed`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01
- UI Impact: `yes`

## Context freshness at task start

- Verified branch + HEAD at task start: `m26-option-c-navigation @ 96198790`.
- Reread the required UI/test specs and `apps/mobile/app/__tests__/README.md`.
- Inventoried the current group stream, session list/active draft, and planning
  surfaces. The first two are shipped; no planning read/materialization API or
  route exists on `main` or the M23 planning branch, so that dependency remains
  explicit rather than being guessed.

## Objective

Create Today as the default orientation surface: what is happening socially,
what personal session is next, and what the user did recently.

## Figma guidance

- [Primary prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- Frames: `01 Today · Default`, `06 Today · Active session`.
- The prototype shows hierarchy and actions; actual group/session facts come
  from existing models and preserve their loading/offline/auth semantics.

## UX contract

### Personal planning before M23

- Trigger: open Today with no active session before the planning milestone has
  shipped its read/materialization interface.
- Steps: review the planning slot and choose Train if an empty workout is useful.
- Success outcome: the slot reads `Watch this space 👀`, explains that
  personal planning is warming up, and routes to the functional Train hub.
- Failure/edge outcome: no plan, schedule, route, or metric is synthesized.

### Resume an active session

- Trigger: open Today while an active draft exists.
- Steps: Today promotes the live session above the planned CTA; press Resume.
- Success outcome: the existing draft opens in the recorder.
- Failure/edge outcome: stale/missing draft state refreshes safely and falls
  back to the normal Today composition.

### Review activity

- Trigger: scan social activity or recent sessions.
- Steps: open a group activity item or the full personal-history affordance.
- Success outcome: navigate to the existing group/session detail destination.
- Failure/edge outcome: signed-out, offline-with-cache, offline-without-cache,
  empty-group, and empty-history states remain explicit and non-blocking.

## Scope

- Compose active/next-plan, group activity, and recent-session modules.
- Define ordering and empty/loading/error states.
- Link snapshots to full group and Progress destinations.
- Keep Today concise; it is not a replacement for full feeds or history.

Out of scope: group discovery/admin, plan editing, or new activity aggregation.

## Acceptance criteria

1. Active session takes priority over the planning placeholder.
2. Resuming uses the existing repository and cannot create a second active
   session; future planned launch remains behind the shared typed coordinator.
3. Social activity shows only joined-group/current-user-visible data and keeps
   existing offline/auth patterns.
4. Recent sessions are a bounded snapshot with a clear path to Progress.
5. Empty Today remains useful: it offers the valid next action without fake
   content or invented metrics.
6. Happy, launch-failure, empty, and offline/auth states have coverage and
   screenshots.
7. Existing primitives/tokens and group/session shared components are reused.

## Implementation notes

- Expected areas: new Today tab route/component plus shared composition helpers.
- Group cards should reuse the stream-card and offline-marker patterns.
- Do not add a cross-domain Today database query if existing resource hooks can
  compose the sections independently.

## Docs touched

- UI docs update required?: yes — `docs/specs/ui/screen-map.md`,
  `navigation-contract.md`, and `ux-rules.md` describe Today ownership, states,
  exits, and the approved placeholder.
- Tokens/primitives compliance statement: reused existing UI tokens, buttons,
  surfaces, text, and group/session components; no raw color exception.
- UI artifacts/screenshots expectation: required standard and 375 pt captures
  are recorded by the M26 shell verification flow.

## Verification

- Unit/integration: section priority, planning placeholder, active resume, bounded
  recents, group empty/auth/offline states.
- Maestro: Today shell/tab switching; Today -> group detail; Today -> Progress.
- Gates: `./boga test fast`, `./boga test frontend`; also
  `./boga test ios-groups-e2e` if group-owned paths change.

## Completion note

- What changed: Today composes existing active/recent-session and joined-group
  sources, prioritizes active resume, and uses the approved `Watch this space
  👀` planning placeholder without inventing M23 data.
- What tests ran: focused Today/group/navigation tests, mobile typecheck and
  lint, `./boga test fast`, and `./boga test frontend` were green during the
  surface task; cutover gates are rerun in T06/T07.
- Visual evidence: Today appears in the M26 standard and small-phone Maestro
  capture sets recorded by the milestone verification tasks.
- Manual verification summary (required when CI is absent/partial): inspected
  standard and 375 pt Today captures; hierarchy, placeholder, and four-tab bar
  are visible without clipping.
- What remains: M23 will replace the typed unavailable state with its canonical
  plan query/materializer when that contract ships; this is not an M26 blocker.
