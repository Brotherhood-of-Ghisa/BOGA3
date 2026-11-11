# M42-T02 — Mobile injury management UI and profile navigation

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: frontend, mobile UI; UI impact: yes

## Objective and scope

Deliver the dedicated Injury Management screen in Profile / Settings as well
as in-session modal launch affordances for athletes to view active and resolved
injuries, log a new injury or tweak, record pain check-ins, update lifecycle
states, and resolve injuries. Follow milestone D1 and D2. This task delivers
the UI surfaces and editor sheet; in-workout warning banners and exercise
substitutions follow in T03.

## Baseline to verify

Load `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/ai-design-policy.md`,
and `docs/specs/ui/components-catalog.md`. Inspect existing settings screens
(`apps/mobile/app/settings-muscles.tsx`, `settings-enabled-muscles.tsx`) and
form components (`components/ui/form-field.tsx`, `form-section.tsx`). Inspect
`muscle-body-projection.ts` for 3D body mesh hit-testing patterns.

## Open — resolve before coding

- Screen navigation structure: dedicated route `app/injuries.tsx` and modal
  editor `app/injury-editor.tsx` (or sheet component reusable from both Profile
  and in-session trigger sites).
- In-session launch points: ensure the editor sheet can be triggered directly
  with pre-filled muscle context from live workout exercise headers or skip
  prompts.
- Input interaction design:
  - Search-as-you-type using `ANATOMY_ALIASES` with muscle group fallback.
  - Interactive body mesh tap selector to pick anatomy and side visually.
  - Side selector: segmented control (`Left`, `Bilateral`, `Right`).
  - Pain slider (0–10) with semantic descriptive bands (*Mild / Niggle*,
    *Moderate / Impairs Movement*, *Severe / Cannot Load*).
- Lifecycle status transitions: `acute` → `managing` → `monitoring` → `resolved`.
- Active list (grouped by recency/severity) versus Resolved archive section.

## Deliverables and acceptance

1. Implement `app/injuries.tsx` showing active injuries, severity badges, and
   resolved history.
2. Implement injury creation/editing modal sheet with alias search, side
   selection, pain rating slider, and optional notes/contraindications.
3. Expose reusable modal triggers so the live session recorder can open the
   injury editor with pre-filled anatomical context.
4. Mobile repository `apps/mobile/src/data/injuries.ts` with local SQLite CRUD
   operations, dirty-flag marking, and reactive queries.
5. Component and unit tests covering validation, state transitions, and
   repository persistence.
6. Maestro verification flow for injury creation, update, and resolution.

## Gates

Expected from `./boga test for`:
`fast` | `frontend-ui` (or platform default)
