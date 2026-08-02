---
task_id: T-20260726-02-History_muscle_failure_bars
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md"
---

# Add Failure-Intensity Bars to the By Muscle History View

## Task metadata

- Task ID: `T-20260726-02-History_muscle_failure_bars`
- Title: Add failure-intensity bars to the By Muscle History view
- Status: `completed`
- File location rule:
  - completed card lives at
    `docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`
- Session date: 2026-07-26
- Session interaction mode: `interactive`
- Required predecessor:
  `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md`
- Branch/PR contract:
  - implement this task after Task 1 on the same
    `codex/history-set-failure-implementation` branch
  - do not create a second implementation branch or PR for this task
  - close both task cards only after the combined branch diff passes every gate
    required by either card

## Parent references (required)

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested Stats / History refinement.
- Predecessor task:
  `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness (required at session start; update before edits)

- Verified implementation branch + pre-implementation HEAD commit:
  `codex/history-set-failure-implementation` at
  `9396fe39bebf8ce17dbbee79de55c3cdbac98605`.
- Start-of-session sync with `origin/main` completed?: `yes`; fetched
  `origin/main` at `c643eae71275c58bb9ab68836cc09c3d202ffba0`,
  created a fresh branch from that ref, and cherry-picked both task cards before
  implementing them together.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/tasks/README.md`
  - `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md`
- Code/docs inventory freshness checks run:
  - `apps/mobile/app/(tabs)/stats-history.tsx` inspected on 2026-07-26:
    family headers and nested muscle rows use separate name and metrics areas;
    collapsed single-muscle families render through the family header.
  - `apps/mobile/components/ui/tokens.ts` inspected on 2026-07-26: the shared
    palette already exposes four light-to-dark green heatmap buckets but no
    yellow-to-orange intensity ramp.
  - `apps/mobile/package.json` inspected on 2026-07-26: no linear-gradient
    package is installed.
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml` inspected on
    2026-07-26: the flow already enters and screenshots the By Muscle view.
  - `./boga test for <planned Task 2 paths>` run on 2026-07-26: Task 2 paths
    require `fast`, `frontend`, `docs-check`, and `meta-tests`; the combined
    branch will also require Task 1's `backend` gate.
- Known stale references or assumptions:
  - The current screen still exposes Sessions and has no set/failure aggregate;
    Task 1 must land first and provide `nearFailureCount`.
  - The user's word `failures` means the app's existing `Near failure` metric:
    valid performed `rir_0`, `rir_1`, or `rir_2` sets. It does not mean strict
    `rir_0` only.
  - The current UI offers 7-day and 30-day periods. The scale formula should
    accept every `StatsPeriodDays` value so future period options do not require
    a second visual contract.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`

## Objective

Add a semi-transparent left-to-right failure-intensity bar behind each name in
the Stats / History **By Muscle** view. The bar width represents the Task 1
near-failure count normalized to eight near-failure sets per seven days.
Muscle-family rows use a light-to-dark green ramp, while nested individual
muscle rows use a light-yellow-to-orange ramp.

The visual is an additional encoding of the exact parenthesized near-failure
count introduced by Task 1; it must not replace, recalculate, or disagree with
that count.

## Scope

### In scope

- Render the intensity bar behind the name area of every muscle-family header
  and visible individual-muscle row in By Muscle mode.
- Scale the width from the row's Task 1 `nearFailureCount` and the selected
  period.
- Reuse the existing green heatmap ramp for family rows.
- Add token-backed light-yellow-to-orange stops for individual-muscle rows.
- Preserve the name text above the bar and preserve all current metrics,
  comparisons, row actions, wrapping, loading, error, empty, and overlay states.
- Add pure scale coverage, screen rendering/interaction coverage, focused
  Maestro evidence, and canonical UI documentation.

### Out of scope

- Showing intensity bars in the By Exercise view, summary cards, session
  history, or either heatmap overlay.
- Changing Task 1's valid-set, near-failure, family-deduplication, comparison,
  or BoGa3 muscle-volume contracts.
- Treating the full-width threshold as a training recommendation, target, cap,
  warning, or validation rule.
- Changing row order, navigation, metric layout, or the 7-/30-day period
  options.
- Adding a legend, animation, tooltip, preference, or user-configurable scale.
- Adding a global reusable gradient/bar primitive.
- Adding a native gradient package or changing native configuration.
- Schema, migration, Supabase, RLS, sync-envelope, or backend-table changes.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- This adds a route-local, non-interactive visual encoding to existing By
  Muscle rows. It introduces no route, modal, navigation, or press behavior.
- The bar is decorative and must not become a nested accessibility or touch
  target.
- The existing name text and Task 1 numeric failure count remain the
  authoritative readable values.

## UX Contract

### Key user flows

1. Flow name: Scan muscle-family failure intensity
   - Trigger: user opens Stats / History, selects a period, and switches to By
     Muscle.
   - Steps: user scans the green bars behind family names and may tap a family
     row as allowed by the existing interaction contract.
   - Success outcome: longer bars correspond to larger deduplicated family
     near-failure counts for the selected period, and the exact count remains
     visible in the Task 1 `Sets` metric.
   - Failure/edge outcome: zero-count families show no fill; counts at or above
     the period threshold show a full-width bar without overflow or layout
     movement.
2. Flow name: Compare individual-muscle failure intensity
   - Trigger: user scans the expanded individual muscles within a family.
   - Steps: user compares the yellow-to-orange fills and may tap a muscle to
     open its existing history overlay.
   - Success outcome: each nested row uses its own near-failure count and the
     individual-muscle color ramp, without changing its text or tap behavior.
   - Failure/edge outcome: a collapsed single-muscle family stays at the family
     hierarchy and therefore uses the green family treatment; the individual
     yellow/orange treatment is reserved for rendered nested muscle rows.

### Interaction + appearance notes

- Start the bar at the left edge of the name cell and clip its right edge to
  the calculated progress; a full bar occupies the name cell only and never
  runs beneath the metrics area.
- Render the complete color ramp across the maximum name-cell width and reveal
  it through a width-clipped fill. Low counts therefore expose the lighter
  left stops; higher counts progressively reveal the darker stops to the right.
- Place the existing name text above the fill and start with fill opacity
  `0.28`; adjust only if simulator evidence shows a contrast problem, and
  record the final value in the card.
- Reuse `uiColors.heatmapBucket1` through `heatmapBucket4` for family rows.
  Individual rows use new semantic token stops progressing from light yellow
  to orange; route code must not contain raw color literals.
- The bar is non-interactive, hidden from the accessibility tree, and cannot
  intercept presses. The row label must expose the near-failure count and the
  period's full-scale threshold in words.

## Scale and data contract

Use one pure calculation for both hierarchy levels:

```text
fullScaleFailures(periodDays) = 8 * periodDays / 7
progress = clamp(nearFailureCount / fullScaleFailures(periodDays), 0, 1)
barWidth = progress * 100%
```

- Do not round `fullScaleFailures` before division.
- 7 days:
  - full-scale threshold: `8`
  - `0` failures -> `0%`
  - `4` failures -> `50%`
  - `8` or more failures -> `100%`
- 30 days:
  - full-scale threshold: `240 / 7`, approximately `34.29`
  - `8` failures -> approximately `23.33%`
  - `34` failures -> approximately `99.17%`
  - `35` or more failures -> `100%`
- Clamp negative or non-finite defensive inputs to `0`; Task 1 should normally
  provide non-negative integers.
- Family rows must use Task 1's physical-set-deduplicated family
  `nearFailureCount`.
- Individual rows must use their own Task 1 `nearFailureCount`.
- Period changes rescale the existing count; they do not mutate or cache bar
  progress independently.
- The threshold is a display scale only. Do not label it as a goal, recommended
  dose, limit, or warning.

## Acceptance criteria

1. Failure-intensity bars appear only in Stats / History By Muscle family and
   nested-muscle name cells.
2. Family rows use the existing light-to-dark green heatmap ramp; nested
   individual-muscle rows use a token-backed light-yellow-to-orange ramp.
3. Bar width follows the exact unrounded scale formula and clamps to `[0, 1]`.
4. Automated tests cover 7-day zero, partial, exact-full, and overflow inputs,
   plus 30-day partial, near-full (`34`), and full (`35`) inputs.
5. Zero failures produce no visible fill, and a full bar stops before the
   metrics area without overflowing the card.
6. Low counts reveal only the lighter left side of the fixed ramp; larger
   counts progressively reveal darker stops to the right.
7. Family rows use the deduplicated family count, individual rows use their own
   count, and period switching immediately rescales the bars.
8. Collapsed single-muscle family headers use the green family treatment.
9. Name text, Task 1 Sets/near-failure and Volume metrics, comparison copy, and
   two-line wrapping remain readable and unchanged.
10. The bar cannot intercept row presses, become a focus target, or alter the
    existing muscle/family history-overlay interaction.
11. Accessibility labels state the near-failure count and full-scale threshold;
    color, opacity, and width are not the only way to obtain the information.
12. No intensity bar is rendered in By Exercise, summary cards, session
    history, or history overlays.
13. No raw color literals are introduced in route files; new individual-muscle
    colors are named semantic tokens.
14. The implementation adds no gradient/native dependency and introduces no
    reusable component API.
15. Canonical UI documentation describes the By Muscle bar semantics, scale,
    hierarchy colors, and non-goal meaning.

## Docs touched (required)

- Planned docs/spec files to update:
  - `docs/specs/ui/ux-rules.md` - document the By Muscle intensity-bar
    hierarchy, scale, and accessibility semantics.
  - `docs/specs/ui/screen-map.md` - add the family/individual bar treatment to
    the `/stats-history` high-level state summary.
  - `docs/specs/ui/components-catalog.md` - note the added
    individual-muscle intensity-ramp tokens in the canonical token inventory.
- UI docs update required?: `yes`; this changes current route semantics and
  adds token roles, invoking maintenance triggers 3 and 4 in
  `docs/specs/ui/README.md`.
- `docs/specs/ui/navigation-contract.md`: no update; routes, params, redirects,
  and transitions do not change.
- `docs/specs/08-ux-delivery-standard.md`: no update; this is an app-specific
  visual contract, not a new cross-task delivery rule.
- `docs/specs/03-technical-architecture.md`: no update; no dependency, runtime,
  or architectural decision changes.
- `docs/specs/05-data-model.md`: no update; the task consumes Task 1's transient
  derived counts and changes no stored or aggregate semantics.
- Tokens/primitives compliance statement:
  - Reuse plan: existing family heatmap tokens, typography, spacing, cards,
    name/metric layout, and Pressable rows.
  - Planned screen-local exception: the clipped multi-stop name-background is
    specific to Stats / History and remains route-local rather than becoming a
    global primitive. Its colors come exclusively from `uiColors`.
  - Raw literal exceptions: none.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md`?: `yes`.
  - Planned captures: populated By Muscle view for Last 7 days and Last 30
    days, both showing a family bar and at least one nested individual-muscle
    bar; add a separate zero/full-width capture if the fixture cannot show
    those cases together.

## Testing and verification approach

- Planned targeted checks:
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
    - pure progress calculation for 7- and 30-day boundaries
    - family versus individual token/ramp selection
    - family and individual data-source selection
    - zero/no-fill, full-width clamp, collapsed-family, and By Exercise absence
    - period-switch rescaling, accessibility wording, and unchanged row presses
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml`
    - retain By Exercise behavior, enter By Muscle, assert the exact readable
      count plus row identifiers, and capture the populated hierarchy at 7 and
      30 days; the decorative bars themselves stay out of the accessibility
      tree and are asserted structurally by the screen test
- Targeted test command:
  - from `apps/mobile/`:
    `npm test -- --runInBand app/__tests__/stats-screen.test.tsx`
- Additional checks:
  - from `apps/mobile/`: `npm run lint:ui-guardrails`
  - `./boga test meta-tests` when the Maestro flow changes
- Test layers covered: pure calculation, RNTL screen behavior/accessibility,
  Maestro simulator interaction/visual evidence, and the combined branch's
  full regression gates.
- Execution triggers: targeted checks during implementation; every required
  combined-branch gate at closeout.
- Slow-gate triggers:
  - Task 2's Stats route/token/flow paths require `./boga test frontend`.
  - Task 1's derived-data paths require `./boga test backend`; because both
    tasks ship from one branch, the implementing agent must also run it before
    closing either card.
- Hosted/deployed smoke ownership: N/A; no hosted or deployed behavior.
- CI/manual posture note: CI does not replace local Maestro evidence. The
  implementing agent must run and inspect the required local iOS captures.
- Native build note: no new native dependency is planned, so a forced
  dev-client rebuild is not required. If implementation cannot meet the
  contract without one, stop and revise this card before adding it.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - `apps/mobile/components/ui/tokens.ts`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md`
- Implement Task 1 first. Consume its `nearFailureCount` fields directly and do
  not derive failures from session count, volume, metric copy, or rendered text.
- Prefer a small pure route-local scale helper and a route-local name-cell
  renderer shared by family and individual rows. Do not create a global
  progress/gradient primitive for one screen.
- Build a fixed four-stop ramp with native `View` layers across the maximum name
  width and reveal it with a clipping wrapper whose width is `progress * 100%`.
  This produces the required left-to-right progression without a native
  dependency.
- Render the bar and text as sibling layers so the bar opacity never fades the
  text.
- Set bar layers to ignore pointer events and accessibility. Keep the Pressable
  as the sole interactive element.
- Preserve the route's existing dynamic type controls (`numberOfLines`,
  `minimumFontScale`, and name-cell shrink behavior).
- Project structure impact: none; all changes stay in existing route, token,
  test, Maestro, and canonical UI-doc locations.
- Sync impact decision: none; this task consumes transient derived values and
  changes no entities, schema, ownership, sync envelope, or persistence.

## Mandatory verify gates

- Targeted Stats screen Jest command listed above.
- `npm run lint:ui-guardrails` from `apps/mobile/`.
- `./boga test meta-tests` after changing the Maestro flow.
- `./boga test fast`.
- `./boga test backend` for the combined Task 1 + Task 2 branch.
- `./boga test frontend`.
- `./boga test docs-check`.
- `./boga test for --diff origin/main...HEAD` and record the final
  combined-branch path-trigger explanation.
- `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`

## Evidence

- Targeted Stats screen test result: PASS as part of the focused 4-suite,
  102-test run; covers exact 7-/30-day boundaries, clipping, hierarchy colors,
  zero/full behavior, period rescaling, accessibility, and By Exercise absence.
- UI guardrail result: PASS with 0 violations.
- `./boga test for` required-gate output: `fast`, `backend`, `frontend`,
  `docs-check`, and `meta-tests` required by the combined implementation diff.
- `./boga test meta-tests` result: PASS - all 4 harness checks.
- `./boga test fast` result: PASS - lint, typecheck, 109 Jest suites / 992
  tests, runtime smoke, docs/meta checks, agent-auth web, and MCP units.
- `./boga test backend` result: PASS - all local backend contract and smoke
  lanes completed successfully for the combined Task 1 + Task 2 diff.
- `./boga test frontend` result and Maestro artifact paths: PASS - all four
  iOS lanes completed successfully:
  - smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260801-200946-60889`
  - data smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260801-201106-61926`
  - auth/profile: `apps/mobile/artifacts/maestro/ad-hoc/20260801-201241-63223`
  - sync e2e: `apps/mobile/artifacts/maestro/ad-hoc/20260801-201421-64619`
- `./boga test docs-check` result: PASS.
- UI/UX visual artifacts:
  - Last 7 days populated By Muscle view:
    `apps/mobile/artifacts/maestro/T-20260726-history/20260801-194639-40473/maestro-output/screenshots/02-muscle-failure-bars-7-days.png`
  - Last 30 days populated By Muscle view:
    `apps/mobile/artifacts/maestro/T-20260726-history/20260801-194639-40473/maestro-output/screenshots/03-muscle-failure-bars-30-days.png`
  - zero-fill rows are visible in the 7-day capture; full-width clamp and
    overflow are covered by screen tests.
- UX Contract traceability: family rows use the green ramp and deduplicated
  family count; visible nested muscles use the yellow-to-orange ramp and their
  own count; the same count visibly rescales from 7 to 30 days; By Exercise has
  no bar; existing row and overlay interactions remain operational.
- Accessibility/manual contrast verification: inspected both captures at the
  implemented `0.28` fill opacity; dark name text remains readable over both
  ramps, fills remain inside the name cell, and row labels expose the exact
  near-failure count plus the period threshold while bars stay decorative.
- Manual verification summary (required when CI is absent/partial): focused
  Maestro flow passed and screenshots were inspected for fixed-ramp reveal,
  hierarchy color distinction, period rescaling, text readability, clipping,
  zero state, By Exercise absence, and both existing history overlays.
- Deferred/manual hosted checks summary: N/A - no hosted-only behavior.

## Completion note

- What changed: added route-local clipped four-stop failure-intensity bars to
  By Muscle name cells, using green family tokens and new semantic
  yellow-to-orange muscle tokens, exact period scaling, decorative semantics,
  and unchanged readable row content/interactions.
- What tests ran: focused 102-test suite, UI guardrails, docs/meta checks,
  `./boga test fast`, `./boga test backend`, and `./boga test frontend`, plus a
  focused Maestro visual flow for both 7- and 30-day states and overlays.
- What remains: none.

## Status update checklist (mandatory at closeout)

- Implement and verify
  `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md` first.
- Update Status and frontmatter to `completed`, `blocked`, or `outdated`.
- If completed or outdated, move this card to `docs/tasks/complete/` and update
  affected references in the same session.
- Fill the Evidence and Completion note sections before handoff.
- Update `docs/specs/ui/ux-rules.md`, `docs/specs/ui/screen-map.md`, and
  `docs/specs/ui/components-catalog.md`.
- Re-check whether implementation introduced a native dependency or reusable
  primitive; if it did, revise the task contract and required gates/docs before
  closeout.
- Run the final combined-branch path-trigger query and every required local
  gate from both task cards.
- Run
  `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`.
