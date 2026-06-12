# UI Docs Bundle (Authoritative, M8)

## Purpose

This folder is the authoritative, app-specific UI documentation bundle for the current mobile app.

- Use these docs for current behavior, route contracts, and reusable UI component/primitives usage.
- Use `docs/specs/08-ux-delivery-standard.md` for process/policy expectations across UI tasks.

(The one-time M8 audit snapshots — `repo-discovery-baseline.md`,
`ui-pattern-audit.md` — were deleted 2026-06-10: dated 2026-02-26, they had
drifted from the code and predated several UI milestones. Git history has them.)

## Status legend

- `Current behavior (authoritative)`: verified against current code and expected to match the app now.
- `Pending / planned`: approved direction or audit-derived candidate that is not fully implemented yet.

## Bundle map

- `ux-rules.md`
  - authoritative semantic UI rules and guardrails grounded in current behavior
- `screen-map.md`
  - current route-by-route screen purpose, sections, states, and entry/exit points
- `navigation-contract.md`
  - route paths, params, query behavior, and allowed transitions for current mobile flows
- `components-catalog.md`
  - current UI tokens/primitives and specialized shared components, with pending primitives tracked separately

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

## Authoring style (required)

Keep `docs/specs/ui/**` docs synthetic and overview-first:

1. Treat these docs as entrypoints and navigation aids for AI/human contributors.
2. Prefer short summaries + source-file links over duplicated API/implementation detail.
3. Only include compact contract detail when it prevents ambiguity (for example route params or a behavior mode that materially changes a screen).
4. Do not turn these docs into full prop/variant references when the source files are the better authority.

## Canonical path note

`docs/specs/ui/` is the canonical location for authoritative UI discovery/audit/guardrail docs (see `docs/specs/09-project-structure.md`).
