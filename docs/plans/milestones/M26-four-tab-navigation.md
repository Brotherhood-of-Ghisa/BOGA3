# M26 — Four-tab navigation and home surfaces

## Milestone metadata

- Milestone ID: `M26`
- Title: Four-tab navigation and home surfaces
- Status: `in_progress`
- Delivery branch: `m26-option-c-navigation`

## Parent references

- Project directives: `AGENTS.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing and gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX delivery: `docs/specs/08-ux-delivery-standard.md`
- UI bundle: `docs/specs/ui/README.md`
- Current navigation contract: `docs/specs/ui/navigation-contract.md`
- Current screen map: `docs/specs/ui/screen-map.md`

## Approved design guidance

- [Approved Option C board](https://www.figma.com/design/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=8-363)
- [Primary navigation prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- [Active-session prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A1044&show-proto-sidebar=1)

Accepted target record (reviewed 2026-09-16):

- Target: the three Figma links above; the approved board node is the visual
  source and the two flows are the interaction source.
- Brief: preserve a four-destination ownership model, keep active training
  focused, and move secondary administration out of the persistent tab bar.
- States: frames `01–04` cover the four roots; `05–08` cover planned, active,
  empty, and planning states; `09–10` cover existing Progress drill-downs; and
  `11–12` cover More-owned groups and exercise-database management.
- Target viewport: `390 × 844` pt phone frames. Implementation closeout must
  also capture the repository's required 375 pt small-phone view.
- Authority boundary: Figma governs hierarchy and intended transitions for
  these states; repository contracts govern production behavior, data,
  accessibility, tokens, and error/offline/auth semantics.

The Figma prototype is interaction and information-architecture guidance, not
permission to invent product data. In particular, Progress must reuse the
current Stats / History dashboards and existing daily/weekly heat maps.

## Milestone objective

Replace the crowded `History / Log / Exercises / Groups + Settings` navigation
with four stable destinations — `Today / Train / Progress / More` — while
preserving every existing capability, deep link, offline/auth state, and
analytics surface.

## Product ownership model

| Tab | Owns | Does not own |
| --- | --- | --- |
| Today | Joined-group/social activity, the next planned personal session, active-session resume, recent-session snapshot | Group discovery/admin, full history, plan management |
| Train | Start planned session, start empty session, resume active training, manage personal planning | Exercise-database administration, analytics |
| Progress | Existing Stats / History dashboard, full session history, existing exercise/muscle daily and weekly heat maps | New metrics or speculative analytics |
| More | Discover/join/manage groups, MCP and integrations, exercise-database management, settings/account, secondary tools | Day-to-day workout launch or progress summaries |

## In scope

- Four persistent top-level destinations with accessible labels and stable
  small-phone layout.
- A Today composition that prioritizes an active session, then the next planned
  session, joined-group activity, and recent personal sessions.
- A Train hub for planned/empty session entry and planning management.
- Rehoming the existing Stats / History implementation under Progress without
  changing its analytics model.
- A More hub that makes secondary capabilities findable without crowding the
  tab bar.
- Hiding top-level navigation while the recorder is actively being used, with
  explicit resume/exit behavior.
- Compatibility for existing route paths and deep links during migration.
- Canonical UI specification updates and automated/visual verification.

## Out of scope

- New analytics, insight cards, milestones, trend models, or server queries.
- New session-planning domain/schema work; M26 consumes the planning interfaces
  delivered by the planning milestone.
- Changes to group backend contracts, sync semantics, MCP protocol behavior, or
  exercise-catalog business rules.
- A visual redesign of existing Progress dashboards or heat maps beyond the
  navigation/header adaptation required by the new ownership model.

## Delivery strategy

1. Add the four-tab navigation model and route adapters without switching the
   default shell.
2. Build Today and Train against existing repositories/hooks and the approved
   prototype states.
3. Rehome the current Progress surfaces unchanged and build the More hub.
4. Cut over the root route and tab shell only after all destinations are
   feature-complete and legacy paths have explicit compatibility behavior.
5. Run the complete local frontend gate, capture visual evidence, and close the
   milestone.

This sequence keeps every merged PR usable and avoids a partially populated
navigation bar on `main`.

## Deliverables

1. Four-tab route and component foundation.
2. Today surface, including default and active-session states.
3. Train surface and recorder/planner entry behavior.
4. Progress surface backed only by existing analytics and heat maps.
5. More hub and secondary-feature routing.
6. Default-route cutover, legacy compatibility, and authoritative UI docs.
7. End-to-end interaction, accessibility, visual, and gate evidence.

## Acceptance criteria

1. The persistent bottom navigation contains exactly `Today`, `Train`,
   `Progress`, and `More`, in that order, and fits the supported small-phone
   viewport without clipped labels or horizontal scrolling.
2. `/` lands on Today after auth/first-sync gates complete.
3. Today exposes joined-group activity, the next planned session, and recent
   sessions; an active session replaces the planned CTA with an unambiguous
   resume action.
4. Train can start an empty session, start the next planned session, resume an
   active session, and enter plan management without duplicating planner logic.
5. Progress preserves the existing Stats / History dashboard, full session
   history, exercise/muscle breakdowns, and daily/weekly heat maps. No new
   analytics are added.
6. More provides routes to group discovery/administration, MCP/integrations,
   exercise-database management, settings/account, and remaining secondary
   tools without making every destination a tab.
7. Active recorder screens do not show the persistent top-level navigation and
   cannot accidentally start a second concurrent session.
8. Existing public/internal route paths have an explicit redirect, adapter, or
   preserved destination; group invite deep links and completed-session edit
   flows continue to work.
9. Every UX-contract happy path and at least one relevant failure/empty/offline
   path per surface has automated coverage and visual evidence.
10. `./boga test fast` and `./boga test frontend` are green at milestone
    closeout; any path-specific lanes reported by `./boga test for` are also
    green.

## Task breakdown

1. **Completed:** inactive four-tab route/navigation foundation.
2. `docs/plans/tasks/M26-T02-Build_Today_surface.md` — compose the default and active Today states.
3. `docs/plans/tasks/M26-T03-Build_Train_surface_and_session_entry.md` — centralize session launch/resume and planner entry under Train.
4. **Completed:** Progress reuses the existing Stats / History implementation,
   session history, and daily/weekly heat maps without adding analytics.
5. `docs/plans/tasks/M26-T05-Build_More_hub.md` — organize secondary capabilities under More.
6. `docs/plans/tasks/M26-T06-Cut_over_routes_and_preserve_compatibility.md` — switch the default shell and preserve old entry points.
7. `docs/plans/tasks/M26-T07-Validate_and_close_four_tab_navigation.md` — run cross-flow validation, gates, docs review, and closeout.

## Dependencies and ordering

- T01 precedes every surface task.
- T02–T05 can be developed independently after T01, but T06 waits for all four.
- T03 consumes the planning route/materialization interface; if that interface
  is not yet available, T03 may land an adapter but T06 must not cut over with a
  dead or misleading planning action.
- T02 and T05 reuse group read/action surfaces. Changes under
  `apps/mobile/src/groups/**` trigger the groups-specific contract and iOS
  lanes in addition to the normal navigation gates.
- T06 precedes T07.

## Risks and controls

- **Route regression:** keep old paths as adapters/redirects until call sites
  and deep links are verified; add route-resolution tests before cutover.
- **Duplicated business logic:** tab roots compose existing repositories,
  hooks, dashboards, and shared components rather than copying data logic.
- **Active-session ambiguity:** use one shared session-entry guard and make the
  active state visible on Today and Train.
- **Progress scope creep:** compare implementation to the current
  `stats-history.tsx`, `DailyHeatmap`, and `WeeklyHeatmap`; reject prototype-only
  metrics.
- **Group offline/auth regressions:** preserve current cached/offline and
  sign-in-required patterns wherever group data is surfaced.
- **Small-phone crowding:** make 375 pt and a larger phone mandatory visual
  evidence for the navigation shell and each hub.

## Closeout

- Keep milestone status and task entries current while work is in flight.
- Move durable route/ownership decisions into `docs/specs/ui/**` in the task
  that ships them.
- Put gate output and screenshots in PR bodies, not this plan.
- Delete this milestone and its task cards in the closing PR; git history keeps
  the plan.
