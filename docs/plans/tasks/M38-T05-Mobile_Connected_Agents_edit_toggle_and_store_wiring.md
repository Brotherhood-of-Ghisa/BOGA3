# M38-T05 — Mobile Connected Agents edit toggle and store wiring

- Status: `planned`
- Depends on: `M38-T01-Contract_specifications_and_schema_design`
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: frontend; UI impact: yes

## Objective

Add a dedicated "Allow coach to edit plans" toggle on the Connected Agents screen to manage `plan_edit_enabled` independently of create permissions, and update mobile plan store writes to stamp `last_modified_by = 'human'` on local mutations.

## Scope

- In:
  - Update `apps/mobile/src/auth/connected-agents.ts`:
    - Add `planEditEnabled` to `ConnectedAgent` type.
    - Implement `setAgentPlanEditEnabled(clientId, grantedAt, enabled)`.
  - Update `apps/mobile/app/connected-agents.tsx`:
    - Render a secondary switch for editing plans beneath the plan creation toggle for each connected coach.
    - Handle optimistic updates, error reverts, and accessible labels per UX standards.
  - Update `apps/mobile/src/data/session-plan-store.ts`:
    - Ensure human plan/programme mutations stamp `last_modified_by = 'human'`.
  - Component and service tests in `apps/mobile/__tests__/connected-agents-*.test.tsx`.
- Out:
  - Backend Edge Function routes (owned by T03).
  - MCP service tools (owned by T04).

## Decided

- D5: Separate `plan_edit_enabled` toggle with independent enable/disable state.
- D6: Human writes stamp `last_modified_by: 'human'`.

## Open — resolve with the user at session start

- Copy confirmation for the edit toggle subtitle and helper text.

## Deliverables and acceptance

1. Connected Agents screen displays separate toggles for Plan Creation and Plan Editing.
2. Toggling plan editing persists `plan_edit_enabled` in `public.agent_plan_permissions`.
3. Store updates set `last_modified_by: 'human'` on newly saved or modified plan entities.
4. Unit and screen tests pass.

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Enable coach edit | User flips "Allow coach to edit plans" switch ON | Switch turns active; `plan_edit_enabled` stored | API error rolls back switch and displays banner |
| Disable coach edit | User flips switch OFF | Switch turns inactive; permission disabled | API error rolls back switch |

## Specs to update

- None.

## Gates

Expected from `./boga test for`:
`fast`, `frontend-ui`
