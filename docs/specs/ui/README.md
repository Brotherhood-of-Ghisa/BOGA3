# UI Docs Bundle (Authoritative, M8)

## Purpose

This folder is the authoritative, app-specific UI documentation bundle for the current mobile app.

- Use these docs for current behavior, route contracts, and reusable UI component/primitives usage.
- Use `docs/specs/08-ux-delivery-standard.md` for process/policy expectations across UI tasks.
- Use `ai-design-policy.md` for provider-neutral design sources, handoff, and
  visual acceptance.

(The one-time M8 audit snapshots — `repo-discovery-baseline.md`,
`ui-pattern-audit.md` — were deleted 2026-06-10: dated 2026-02-26, they had
drifted from the code and predated several UI milestones. Git history has them.)

## Status legend

- `Current behavior (authoritative)`: verified against current code and expected to match the app now.
- `Pending / planned`: approved direction or audit-derived candidate that is not fully implemented yet.

## Bundle map

- `ai-design-policy.md`
  - canonical policy for accepted design targets, external artifacts,
    repository authority, generated design code, visual verification, and
    conflict/commit boundaries
- `ux-rules.md`
  - authoritative semantic UI rules and guardrails grounded in current behavior
- `screen-map.md`
  - current route-by-route screen purpose, sections, states, and entry/exit points
- `navigation-contract.md`
  - route paths, params, query behavior, and allowed transitions for current mobile flows
- `components-catalog.md`
  - current UI tokens/primitives and specialized shared components, with pending primitives tracked separately
- `design-language.md`
  - the screen-agnostic visual/interaction language: colour roles, type,
    surfaces, emphasis and data presentation
- `design-targets/`
  - accepted design target records per `ai-design-policy.md`, one file per
    accepted target
- `design-targets/train-page.md`
  - accepted Claude Design target for the Train page: one start disc, no
    title, planning beneath only when available; a workout in progress is
    opened directly, never offered as a Resume button
- `design-targets/today-landing.md`
  - accepted Claude Design target for the Today landing page (Progress and
    Group activity cards); built, gallery accepted 2026-10-03
- `design-targets/bodyweight.md`
  - accepted repo-native replacement target for optional private/group
    bodyweight calculations; integrated rendering and human acceptance remain
    required before closeout
- `design-targets/weekly-history-bars.md`
  - accepted weekly-history redesign: horizontal bars stacked newest first,
    with visible values and an average reference; implemented with runtime comparison
- `design-targets/group-competitions.md`
  - accepted group Volume/1RM target, public percentage units, rules review and
    safe record/session context; replaces the older group Weight examples
- `design-targets/progress-tables.md`
  - implemented and verified replacement target: grouped muscle
    comparisons, separate chevron selection/name history, inline contributions
    and minimal copy; `/progress` owns the shared `/stats-history` surface
- `design-targets/history-popup.md`
  - accepted, pending implementation: full-height muscle/exercise history
    popup with header swipe dismissal, no close button, and existing heatmaps

## Maintenance rules (for future tasks)

This section is the canonical trigger map for UI docs maintenance.
Task templates/task cards may summarize these triggers for convenience, but should defer to this section if wording drifts.

1. Route files added/removed/renamed:
   - Update `screen-map.md`
   - Update `navigation-contract.md`
2. Route params/query behavior or transition behavior changed:
   - Update `navigation-contract.md`
   - Update `screen-map.md` if screen entry/exit behavior changes
3. Reusable component/primitives API or variants changed:
   - Update `components-catalog.md`
4. UI semantics/pattern expectations changed (buttons, lists, states, error handling, modal conventions):
   - Update `ux-rules.md`
   - Update `docs/specs/08-ux-delivery-standard.md` only if the change is a cross-task/process-level UX rule
5. New UI docs added in this folder:
   - Add them to this index and keep descriptions concise
6. Design-source, artifact-boundary, or visual-acceptance policy changed:
   - Update `ai-design-policy.md`; do not copy its rules into tool-specific files

## Authoring style (required)

Keep `docs/specs/ui/**` docs synthetic and overview-first:

1. Treat these docs as entrypoints and navigation aids for AI/human contributors.
2. Prefer short summaries + source-file links over duplicated API/implementation detail.
3. Only include compact contract detail when it prevents ambiguity (for example route params or a behavior mode that materially changes a screen).
4. Do not turn these docs into full prop/variant references when the source files are the better authority.

## Canonical path note

`docs/specs/ui/` is the canonical location for authoritative UI discovery/audit/guardrail docs (see `docs/specs/09-project-structure.md`).
