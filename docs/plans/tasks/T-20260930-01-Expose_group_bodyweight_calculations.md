# T-20260930-01 — Expose group bodyweight calculations

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend, backend; UI impact: yes

## Objective

Show each group's Bodyweight calculations setting in both Create group and Edit
group. Match the personal Settings control's label, row layout, On/Off button,
accessibility and feedback, while keeping private and group values independent.
Keep the shipped calculation and privacy rules.

## Scope

- In:
  - Show the Off/On control in Create group, defaulting to Off, and save its
    selected state atomically with group creation.
  - Replace Edit group's segmented control with the same visible row and
    trailing On/Off switch used in personal Settings. Preserve the group's
    saved state on load and after a failed write; refresh affected views after
    a successful change.
  - Share the presentation code between personal and group controls where
    useful, without sharing their state or write handlers.
  - Extend `group_create` and its mobile API to accept the selected state;
    preserve the default-off behavior for callers that do not supply it.
  - Cover create, edit, role access, failed writes and off/on/off/on
    persistence in focused tests and the native group flow.
- Out:
  - Changes to bodyweight formulas, contribution defaults, private readings,
    group scoring, certification or the independent private preference.
  - A new settings route, a group-page status row or a redesign of group
    administration.

## Decided

- Group calculations remain a server-authoritative, owner/admin-controlled
  boolean, independent of each member's private preference. New groups default
  Off. Disabling the group setting hides and ignores exercise contributions
  without deleting them.
- Use the personal Settings control's `Bodyweight calculations` label, ListRow
  layout, trailing On/Off switch, pressed/selected styling and accessible
  switch role/state. Group create/edit still commit through their form's
  Create/Save action. A member cannot edit. Online-only group writes keep
  entered values after failure and show the existing inline error.

## Accepted design target and UX contract

Target: a repo-native brief using
`docs/specs/ui/design-targets/bodyweight.md` and
`docs/specs/ui/design-targets/groups.md` as the existing visual language.
The Create and Edit forms present the same `Bodyweight calculations` row and
On/Off switch as personal Settings (`components/bodyweight/settings-row.tsx`),
apart from its separate `Body weight log` link. Compare all three controls in
their Off, On, pressed and error states at the phone viewports listed in the
bodyweight target before closeout.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Create group | Create group → inspect default Off → choose On or leave Off → submit → open Edit | Edit shows the saved state; subsequent group exercises follow it | Username gate preserves the selection; validation or failed online write keeps the form and selection |
| Change group mode | Owner/admin opens Edit → switch Off/On → save → reopen Edit → repeat | Edit and group exercise editor reflect the saved state; existing contributions reappear when re-enabled | Member cannot reach the edit control; failed write keeps the selected value and shows that nothing changed; group results publish under one coherent revision |

## Deliverables and acceptance

1. Create group and Edit group both show the same Bodyweight calculations row
   and On/Off switch appearance and accessibility behavior as personal Settings.
   The existing segmented control is removed from Edit group.
2. Create defaults Off, can create On in one successful write, and retains the
   selected state through the username gate and write/validation failures.
3. Existing groups display their server state in Edit. Owner/admin edits
   persist; members cannot edit. Off/on/off/on preserves group exercise
   contributions.
4. Edit and group exercise editor states refresh after a successful change,
   without showing mixed group-result revisions.
5. Focused component/API/backend assertions cover the changed paths; the
   native group flow proves the control is visible and operable in both forms.
   Capture small and large phone states, including failed-write feedback.

## Specs to update

- `docs/specs/tech/groups-contract.md` — `group_create` parameter and group
  administration behavior.
- `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md` — create/edit
  controls and role states; check the UI docs maintenance map for any other
  changed component contract.
- `docs/specs/ui/design-targets/bodyweight.md` — accepted group placement and
  visual comparison states if this card changes that target.

## Gates

Use `./boga test for` on the implementation diff. Expected: `./boga test fast`,
`./boga test backend`, `./boga test frontend-ui` and
`./boga test ios-groups-e2e`; run the large/shared-UI sweep if selected.
The UI implementation requires hands-on review of Create and Edit beside the
personal Settings control before aggregate closeout.
