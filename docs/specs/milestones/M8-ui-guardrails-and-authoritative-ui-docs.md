# Milestone Spec

## Milestone metadata

- Milestone ID: `M8`
- Title: UI guardrails, authoritative UI docs, and convergence refactor
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `2026-02` / `2026-03`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone index: `docs/specs/milestones/README.md` (the retired `00-mvp-deliverables.md` index)
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- AI development playbook (integration target): `docs/specs/04-ai-development-playbook.md`
- Templates (integration targets):
  - `docs/specs/templates/milestone-spec-template.md`
  - `docs/specs/templates/task-card-template.md`
- Prior milestones (current UI behavior sources):
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `docs/specs/milestones/M4-session-list-screen-and-data-wiring.md`
  - `docs/specs/milestones/M6-exercise-taxonomy-and-muscle-analytics-foundation.md`
  - `docs/specs/milestones/M7-completed-session-detail-reopen-and-edit.md`

## Milestone objective

Establish a reality-based UI foundation for AI-assisted development by harvesting current app UI patterns, formalizing tokens/primitives and authoritative UI documentation, and refactoring the existing mobile screens to converge on those guardrails without changing product behavior.

## Repo discovery baseline (verified before drafting this milestone)

- Baseline only: this section captures draft-time facts and must be refreshed/confirmed at the start of each M8 task that depends on inventories (routes, styling, components, docs paths), with task docs updated if anything changed.
- Refreshed authoritative baseline (Task `T-20260226-01`): `docs/specs/ui/repo-discovery-baseline.md`
- UI pattern audit (Task `T-20260226-02`): `docs/specs/ui/ui-pattern-audit.md`
- Documentation/templates already exist in:
  - `docs/specs/`
  - `docs/specs/templates/`
  - `docs/tasks/` (active cards)
  - `docs/tasks/complete/` (completed archive)
- Existing AI development guidelines document: `docs/specs/04-ai-development-playbook.md`
- Current navigation approach: `expo-router` file-based routing in `apps/mobile/app/`
- Current route files (user-facing + layout):
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/app/index.tsx`
  - `apps/mobile/app/session-list.tsx`
  - `apps/mobile/app/session-recorder.tsx`
  - `apps/mobile/app/exercise-catalog.tsx`
  - `apps/mobile/app/completed-session/[sessionId].tsx`
- Current styling approach: React Native `StyleSheet.create` (screens + shared components), with repeated raw literals (colors/spacing/radius/typography values)
- Current reusable UI components (baseline inventory, not exhaustive):
  - `apps/mobile/components/navigation/top-level-tabs.tsx`
  - `apps/mobile/components/session-recorder/session-content-layout.tsx`
  - `apps/mobile/components/session-recorder/types.ts`
- Size rule decision for this milestone:
  - Current app is within the "small app" threshold (approximately <= 6 user-facing routes), so this milestone targets refactoring all current user-facing screens to tokens/primitives.

## In scope

- Phase 0 repo discovery outputs and UI pattern audit based on the current codebase (no speculative design system work first).
- A single source of truth for UI tokens derived from current usage patterns (colors, spacing, typography, radius; dark mode optional and only if it already fits current architecture).
- A minimal primitive/component layer (target: `10-20` primitives, reuse-first, no redesign).
- Lightweight enforcement to discourage ad hoc screen styling and raw literals in UI files (lint/script/conventions, pragmatic scope).
- Authoritative UI docs bundle in the existing docs area, including:
  - repo discovery baseline (for AI context)
  - UI pattern audit with code references
  - UX rules
  - screen map
  - navigation contract
  - components/primitives catalog
- Refactor current mobile screens to use tokens/primitives and converge on documented patterns.
- Update `docs/specs/04-ai-development-playbook.md` with a concise UI rules summary and links to detailed UI docs.
- Update task template(s) so UI-affecting tasks explicitly require tokens/primitives compliance and UI docs maintenance.

## Out of scope

- Product redesign, feature expansion, or behavior changes beyond UI consistency/convergence.
- Introducing a heavyweight design system framework or large theming dependency without a clear need.
- Pixel-perfect design polish work unrelated to consistency guardrails.
- Full design-token automation pipelines (Figma sync, codegen, visual regression infrastructure) unless they are trivial and low-risk.
- Backend/auth/sync changes unrelated to UI documentation/guardrails.

## Deliverables

1. UI discovery + audit documentation set that inventories routes/screens, current patterns, and reusable components with code references.
2. Tokens source of truth and a small primitive layer derived from the audit (reuse-first, no redesign).
3. Lightweight UI guardrail enforcement (automated check and/or documented review convention) that flags or discourages raw/ad hoc styling in screens.
4. Authoritative UI docs bundle for AI/human development:
   - `ux-rules`
   - `screen-map`
   - `navigation-contract`
   - `components-catalog`
   - audit/discovery docs
5. Refactored mobile screens aligned to tokens/primitives (all current user-facing screens under the small-app rule).
6. Playbook + task-template integration updates that make UI rules and UI-doc maintenance explicit in future tasks.

## Execution phases (Harvest -> Formalize -> Refactor)

### Phase 0 - Harvest (required before design-system formalization)

- Repo discovery and inventory baseline:
  - docs paths/templates
  - AI playbook location
  - navigation and route inventory
  - styling approach inventory
  - current reusable component inventory
- UI pattern audit with code references:
  - buttons, headers, lists, forms, empty/loading/error, typography, spacing, layout conventions
  - candidate primitives already present in code

### Phase 1 - Formalize guardrails (derived from audit)

- Define tokens source of truth from observed values/patterns.
- Introduce minimal primitives (target `10-20` max) based on real repeated patterns.
- Simplify/consolidate overlapping current UI patterns/components where needed so existing screens can be refactored onto the documented patterns/primitives without redesigning behavior.
- Add pragmatic guardrail enforcement (lint/script/convention) and document exceptions.

### Phase 2 - Authoritative UI docs bundle (AI-friendly, reality-based)

- Create/update UI docs that describe actual routes/components/semantics.
- Keep docs aligned to refactor outputs, not speculative future architecture.
- Add concise summary + links in `docs/specs/04-ai-development-playbook.md`.
- Update task templates so UI tasks require docs updates and tokens/primitives usage.

### Phase 3 - Refactor existing screens to converge

- Refactor all current user-facing screens to tokens/primitives (current repo is within small-app threshold).
- Preserve behavior and data flows; limit changes to UI consistency and reusable pattern adoption.
- When a risky refactor/change is identified, create a targeted test first, confirm it fails or would catch the regression, then execute the change.
- Remove/deprecate duplicate overlapping UI components when safe and covered by tests.

## Definition of done (milestone closeout)

- Audit doc exists and references code locations.
- Tokens exist and are used by primitives.
- Primitives exist and match current UX patterns (derived from audit, not invented redesign).
- All current user-facing screens are refactored to tokens/primitives (per current small-app size rule).
- UI docs bundle is accurate post-refactor (`screen-map`, `navigation-contract`, `components-catalog`, `ux-rules`, audit/discovery docs).
- `docs/specs/04-ai-development-playbook.md` contains a concise UI rules summary and links to the detailed UI docs.
- Task template(s) enforce UI rules and require docs updates for UI-affecting work.

## Acceptance criteria

1. A repo discovery baseline document records the exact UI-related docs/template paths, current navigation approach (`expo-router`), current route inventory, current styling approach, and current reusable component inventory.
2. A UI audit document exists in the docs folder and inventories current screen/pattern usage with direct code references.
3. A single token source of truth is introduced and covers at least colors, spacing, typography, and radius used by the primitive layer.
4. A minimal primitives layer (target `10-20` components/helpers) is introduced and documented in a components catalog, and it is explicitly derived from the audit.
5. A lightweight enforcement mechanism (lint/script/convention + documented exceptions) exists to discourage raw styling/ad hoc literals in screen files.
6. Authoritative UI docs exist and are linked together (at minimum: discovery baseline, audit, UX rules, screen map, navigation contract, components catalog).
7. Because the current app is within the small-app threshold, all current user-facing mobile routes are refactored to use tokens/primitives, with no intentional behavior regressions.
8. Duplicate/overlapping UI components introduced by earlier milestones are deprecated or consolidated where safe, with rationale documented when duplicates remain.
9. `docs/specs/04-ai-development-playbook.md` includes a concise "UI Development Rules Summary" and links to the UI docs bundle.
10. `docs/specs/templates/task-card-template.md` is updated so UI-impacting tasks include a `UI Impact` checkpoint, docs-update requirements, acceptance boilerplate, and a `Docs touched` section.
11. The task template includes explicit mapping guidance for when to update `screen-map`, `navigation-contract`, `components-catalog`, and `ux-rules`.
12. Any new canonical docs path introduced for the UI docs bundle is reflected in `docs/specs/09-project-structure.md`.

## Task breakdown

1. `docs/tasks/complete/T-20260226-01-m8-ui-repo-discovery-and-inventory-baseline.md` - create the required repo discovery baseline and confirm exact UI/doc/template/navigation/styling facts. (`completed`)
2. `docs/tasks/complete/T-20260226-02-m8-ui-pattern-audit-doc.md` - produce the UI pattern audit with code references and primitive candidates. (`completed`)
3. `docs/tasks/complete/T-20260226-03-m8-ui-tokens-and-primitives-foundation.md` - implement tokens source of truth and an initial primitive set derived from the audit. (`completed`)
4. `docs/tasks/complete/T-20260226-04-m8-ui-guardrail-enforcement.md` - add lightweight UI guardrail enforcement and document exceptions/usage. (`completed`)
5. `docs/tasks/complete/T-20260226-05-m8-authoritative-ui-docs-bundle.md` - create/update UI docs bundle (`ux-rules`, `screen-map`, `navigation-contract`, `components-catalog`) and register docs path conventions. (`completed`)
6. `docs/tasks/complete/T-20260226-06-m8-screen-refactor-to-tokens-and-primitives.md` - refactor current user-facing screens to converge on tokens/primitives with regression checks. (`completed`)
7. `docs/tasks/complete/T-20260226-07-m8-ai-playbook-ui-rules-summary-and-links.md` - add concise UI rules summary + links to `docs/specs/04-ai-development-playbook.md`. (`completed`)
8. `docs/tasks/complete/T-20260226-08-m8-task-template-ui-impact-and-docs-enforcement.md` - update task template(s) to enforce UI impact checks, docs updates, and UI acceptance boilerplate. (`completed`)

## Risks / dependencies

- The current screens are large and `StyleSheet`-heavy; extracting primitives without behavioral regressions requires tight scope discipline and targeted tests.
- Over-formalizing too early can create a "new design system" instead of codifying existing patterns; the audit-first rule is mandatory to avoid this.
- Guardrail enforcement that is too strict may create churn in legacy files; allowlists/exceptions must be explicit and minimal.
- UI docs can drift quickly during refactors; sequencing and "Docs touched" requirements in task cards are part of the mitigation.
- Introducing a new canonical docs path (for example `docs/specs/ui/`) requires coordinated updates to `docs/specs/09-project-structure.md` and future task templates.

## Completion note (fill when milestone closes)

- What changed: Completed the remaining M8 documentation integration tasks by adding a concise UI rules summary + authoritative UI docs links to `docs/specs/04-ai-development-playbook.md`, and updating `docs/specs/templates/task-card-template.md` / `docs/tasks/README.md` to require a UI impact checkpoint, UI docs maintenance planning, tokens/primitives compliance statements, and UI acceptance boilerplate for UI-affecting tasks. Prior M8 tasks already delivered the UI docs bundle, tokens/primitives foundation, enforcement, and screen refactors.
- Verification summary: Docs-only verification for Tasks 07/08 (path existence checks for referenced UI docs, grep/section review for required playbook/template content, and manual template walkthrough for UI/non-UI authoring paths). Earlier M8 implementation verification remains documented in the owning task cards.
- What remains: M8 milestone scope is complete. Follow-on improvements to AI context ergonomics/guardrails can be tracked as new tasks if desired.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
